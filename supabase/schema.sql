-- =====================================================================
-- Cycle Count Suite: database schema (PostgreSQL / Supabase)
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Safe to re-run: it only creates what doesn't exist yet.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Users and roles
--   admin      : everything, including user roles and deleting drafts
--   supervisor : create counts, upload files, review, recount, reconcile
--   counter    : mobile app only; can count in open sessions
-- ---------------------------------------------------------------------
do $$ begin
  create type app_role as enum ('admin', 'supervisor', 'counter');
exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  full_name   text not null default '',
  email       text,
  role        app_role not null default 'counter',
  site        text not null default '',
  active      boolean not null default false,
  created_at  timestamptz not null default now()
);
-- Version 5: what the person does on the phone. Security staff only see the gate screens.
alter table public.profiles add column if not exists job text not null default 'operator';
alter table public.profiles drop constraint if exists profiles_job_check;
alter table public.profiles add constraint profiles_job_check check (job in ('operator', 'security'));

-- New sign-ups get a profile. The very first user becomes admin.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, full_name, email, role, active)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'full_name', ''), split_part(new.email, '@', 1)),
    new.email,
    case when exists (select 1 from public.profiles where role = 'admin') then 'counter'::app_role else 'admin'::app_role end,
    not exists (select 1 from public.profiles where role = 'admin')   -- everyone after the first admin waits for approval
  )
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.my_role()
returns app_role language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() in ('admin', 'supervisor'), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- ---------------------------------------------------------------------
-- Count sessions
--   draft -> open -> closed -> reconciled   (closed can be reopened)
-- ---------------------------------------------------------------------
create table if not exists public.count_sessions (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  site              text not null default '',
  zone              text not null default '',
  tolerance_pct     numeric(6,2) not null default 2 check (tolerance_pct >= 0),
  blind             boolean not null default true,
  confirm_location  boolean not null default true,
  rack_grouping     text not null default 'last_segment',
  excess_batch      text not null default 'optional' check (excess_batch in ('hidden', 'optional', 'required')),
  excess_mfg        text not null default 'optional' check (excess_mfg in ('hidden', 'optional', 'required')),
  excess_expiry     text not null default 'required' check (excess_expiry in ('hidden', 'optional', 'required')),
  status            text not null default 'draft' check (status in ('draft', 'open', 'closed', 'reconciled')),
  source_file       text,
  line_count        integer not null default 0,
  location_count    integer not null default 0,
  created_by        uuid references public.profiles (id) default auth.uid(),
  created_at        timestamptz not null default now(),
  opened_at         timestamptz,
  closed_at         timestamptz,
  closed_by         uuid references public.profiles (id)
);
-- Columns added in version 2 (for databases created with the first version)
alter table public.count_sessions add column if not exists rack_grouping text not null default 'last_segment';
alter table public.count_sessions add column if not exists excess_batch  text not null default 'optional';
alter table public.count_sessions add column if not exists excess_mfg    text not null default 'optional';
alter table public.count_sessions add column if not exists excess_expiry text not null default 'required';
alter table public.count_sessions drop constraint if exists count_sessions_rack_grouping_check;
alter table public.count_sessions add constraint count_sessions_rack_grouping_check check (rack_grouping in ('none', 'last_segment', 'last_char'));
-- Version 4: a recount must be done by a different person than the first count (optional per count)
alter table public.count_sessions add column if not exists recount_other boolean not null default false;
-- Version 4: if the entered quantity differs from the system by more than this %, the phone asks for it again (0 = off)
alter table public.count_sessions add column if not exists recheck_pct numeric(6,2) not null default 5;
create index if not exists count_sessions_status_idx on public.count_sessions (status, created_at desc);

-- ---------------------------------------------------------------------
-- Count lines: one row per SKU per location. seq is the walking order.
-- ---------------------------------------------------------------------
create table if not exists public.count_lines (
  id                 bigint generated always as identity primary key,
  session_id         uuid not null references public.count_sessions (id) on delete cascade,
  seq                integer not null,
  location           text not null,
  sku                text not null,
  barcode            text not null default '',
  batch              text not null default '',
  mfg_date           date,
  expiry_date        date,
  description        text not null default '',
  uom                text not null default '',
  units_per_case     numeric(14,3) not null default 1,
  system_qty         numeric(14,3) not null default 0,
  unit_cost          numeric(14,4) not null default 0,
  counted_qty        numeric(14,3),
  counted_by         uuid references public.profiles (id),
  counted_at         timestamptz,
  count_round        integer not null default 0,
  recount_requested  boolean not null default false,
  accepted           boolean not null default false,
  accepted_by        uuid references public.profiles (id),
  accepted_at        timestamptz,
  is_found           boolean not null default false,   -- excess: found physically, not expected here
  expected_location  text,                             -- for misplaced stock: where the system expects it
  remarks            text,
  updated_at         timestamptz not null default now()
);
alter table public.count_lines add column if not exists barcode text not null default '';
alter table public.count_lines add column if not exists batch text not null default '';
alter table public.count_lines add column if not exists mfg_date date;
alter table public.count_lines add column if not exists expiry_date date;
alter table public.count_lines add column if not exists expected_location text;
alter table public.count_lines add column if not exists remarks text;
alter table public.count_lines add column if not exists units_per_case numeric(14,3) not null default 1;
-- Version 4: damaged units found while counting. counted_qty is the GOOD quantity only, so damaged units show as short,
-- and the damage record explains why. first_counted_by remembers who counted before a recount was requested.
alter table public.count_lines add column if not exists damaged_qty      numeric(14,3) not null default 0;
alter table public.count_lines add column if not exists damage_reason    text;
alter table public.count_lines add column if not exists damage_note      text;
alter table public.count_lines add column if not exists damage_photos    text[] not null default '{}';
alter table public.count_lines add column if not exists first_counted_by uuid references public.profiles (id);
alter table public.count_lines drop constraint if exists count_lines_damaged_check;
alter table public.count_lines add constraint count_lines_damaged_check check (damaged_qty >= 0);
alter table public.count_lines drop constraint if exists count_lines_session_id_location_sku_key;
create unique index if not exists count_lines_unique_idx on public.count_lines (session_id, upper(location), upper(sku), upper(batch));
create index if not exists count_lines_barcode_idx on public.count_lines (session_id, barcode);
create index if not exists count_lines_seq_idx      on public.count_lines (session_id, seq);
create index if not exists count_lines_sid_idx      on public.count_lines (session_id, id);
create index if not exists count_lines_updated_idx  on public.count_lines (session_id, updated_at);
create index if not exists count_lines_sku_idx      on public.count_lines (upper(sku));
create index if not exists count_lines_loc_idx      on public.count_lines (upper(location));

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists count_lines_touch on public.count_lines;
create trigger count_lines_touch before update on public.count_lines
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------
-- Audit trail: every count, recount request, acceptance and status
-- change. Rows are never updated or deleted by the app.
-- client_id makes offline re-sends safe (the same entry is stored once).
-- ---------------------------------------------------------------------
create table if not exists public.count_events (
  id          bigint generated always as identity primary key,
  session_id  uuid not null references public.count_sessions (id) on delete cascade,
  line_id     bigint references public.count_lines (id) on delete cascade,
  event       text not null check (event in ('count', 'found', 'recount_request', 'accept', 'unaccept', 'status', 'reconcile', 'import')),
  qty         numeric(14,3),
  prev_qty    numeric(14,3),
  note        text,
  user_id     uuid references public.profiles (id) default auth.uid(),
  device      text,
  client_id   uuid unique,
  client_ts   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists count_events_session_idx on public.count_events (session_id, created_at);
-- Version 4: items reported during a recount that weren't on the recount list (never counted), and photos on events
alter table public.count_events add column if not exists location text;
alter table public.count_events add column if not exists code     text;
alter table public.count_events add column if not exists photos   text[];
alter table public.count_events drop constraint if exists count_events_event_check;
alter table public.count_events add constraint count_events_event_check
  check (event in ('count', 'found', 'recount_request', 'accept', 'unaccept', 'status', 'reconcile', 'import', 'not_on_list'));
create index if not exists count_events_line_idx on public.count_events (line_id, created_at);

-- ---------------------------------------------------------------------
-- Reconciliation records: the permanent summary of each finished count.
-- ---------------------------------------------------------------------
create table if not exists public.reconciliations (
  id              uuid primary key default gen_random_uuid(),
  session_id      uuid not null unique references public.count_sessions (id) on delete restrict,
  lines_total     integer not null,
  lines_counted   integer not null,
  lines_within    integer not null,
  lines_out       integer not null,
  lines_accepted  integer not null,
  found_lines     integer not null,
  accuracy_pct    numeric(6,2),
  net_units       numeric(16,3) not null,
  net_value       numeric(18,2) not null,
  abs_value       numeric(18,2) not null,
  wms_reference   text,
  notes           text,
  approved_by     uuid references public.profiles (id),
  approved_at     timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Line status and live statistics
-- ---------------------------------------------------------------------
create or replace function public.line_status(p_counted numeric, p_system numeric, p_tol numeric, p_recount boolean, p_accepted boolean)
returns text language sql immutable as $$
  select case
    when p_counted is null then case when p_recount then 'recount' else 'uncounted' end
    when p_counted = p_system then 'match'
    when (case when p_system = 0 then 100 else abs(p_counted - p_system) / abs(p_system) * 100 end) <= p_tol then 'within'
    when p_accepted then 'accepted'
    else 'out'
  end
$$;

drop view if exists public.session_list, public.count_lines_v, public.reconciliation_list, public.event_list;
drop view if exists public.session_stats;
create view public.session_stats with (security_invoker = true) as
select s.id as session_id,
       count(l.id)                                                              as lines_total,
       count(l.counted_qty)                                                     as lines_counted,
       count(distinct l.location)                                               as locations_total,
       count(distinct l.location) filter (where l.counted_qty is null)          as locations_open,
       count(*) filter (where public.line_status(l.counted_qty, l.system_qty, s.tolerance_pct, l.recount_requested, l.accepted) in ('match', 'within')) as lines_within,
       count(*) filter (where public.line_status(l.counted_qty, l.system_qty, s.tolerance_pct, l.recount_requested, l.accepted) = 'out')      as lines_out,
       count(*) filter (where l.accepted and l.counted_qty is not null)         as lines_accepted,
       count(*) filter (where l.recount_requested and l.counted_qty is null)    as lines_recount,
       count(*) filter (where l.is_found)                                       as found_lines,
       coalesce(sum(l.counted_qty - l.system_qty) filter (where l.counted_qty is not null), 0)                 as net_units,
       coalesce(sum((l.counted_qty - l.system_qty) * l.unit_cost) filter (where l.counted_qty is not null), 0) as net_value,
       coalesce(sum(abs(l.counted_qty - l.system_qty) * l.unit_cost) filter (where l.counted_qty is not null), 0) as abs_value,
       coalesce(sum(l.damaged_qty) filter (where l.counted_qty is not null), 0)  as damaged_units,
       (select count(*) from public.count_events e where e.session_id = s.id and e.event = 'not_on_list') as reported_items
from public.count_sessions s
left join public.count_lines l on l.session_id = s.id
group by s.id;

-- ---------------------------------------------------------------------
-- Row-level security: who can read and change what
-- ---------------------------------------------------------------------
alter table public.profiles        enable row level security;
alter table public.count_sessions  enable row level security;
alter table public.count_lines     enable row level security;
alter table public.count_events    enable row level security;
alter table public.reconciliations enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (true);
drop policy if exists profiles_admin_write on public.profiles;
create policy profiles_admin_write on public.profiles for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists sessions_read on public.count_sessions;
create policy sessions_read on public.count_sessions for select to authenticated
  using (public.is_staff() or (status = 'open' and public.my_role() is not null));
drop policy if exists sessions_insert on public.count_sessions;
create policy sessions_insert on public.count_sessions for insert to authenticated with check (public.is_staff());
drop policy if exists sessions_update on public.count_sessions;
create policy sessions_update on public.count_sessions for update to authenticated
  using (public.is_staff() and status in ('draft', 'open', 'closed')) with check (public.is_staff() and status <> 'reconciled');
drop policy if exists sessions_delete on public.count_sessions;
create policy sessions_delete on public.count_sessions for delete to authenticated using (public.is_admin() and status = 'draft');

drop policy if exists lines_read on public.count_lines;
create policy lines_read on public.count_lines for select to authenticated using (public.is_staff());
-- Counters read lines only through mobile_lines(), which hides system qty on blind counts.
drop policy if exists lines_insert on public.count_lines;
create policy lines_insert on public.count_lines for insert to authenticated
  with check (public.is_staff() and exists (select 1 from public.count_sessions s where s.id = session_id and s.status = 'draft'));
drop policy if exists lines_delete on public.count_lines;
create policy lines_delete on public.count_lines for delete to authenticated
  using (public.is_staff() and exists (select 1 from public.count_sessions s where s.id = session_id and s.status = 'draft'));
-- No update policy: counts change only through the functions below, which also write the audit trail.

drop policy if exists events_read on public.count_events;
create policy events_read on public.count_events for select to authenticated using (public.is_staff() or user_id = auth.uid());

drop policy if exists recon_read on public.reconciliations;
create policy recon_read on public.reconciliations for select to authenticated using (public.is_staff());

-- ---------------------------------------------------------------------
-- Functions the apps call
-- ---------------------------------------------------------------------

-- Counter submits quantities (one location or a batch from the offline queue).
-- p_entries: [{ "line_id": 123, "qty": 10, "client_id": "uuid", "client_ts": "2026-09-30T10:00:00Z",
--               "damaged_qty": 2, "damage_reason": "Crushed", "damage_note": "…", "photos": ["count/<session>/<line>/<id>.jpg"] }, ...]
-- qty is the GOOD quantity. Damaged units need a reason and at least one photo.
create or replace function public.submit_counts(p_session uuid, p_entries jsonb, p_device text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e jsonb; v_line public.count_lines; v_saved int := 0; v_dupes int := 0; v_skipped int := 0; v_qty numeric; v_cid uuid;
  v_sess public.count_sessions; v_dmg numeric; v_reason text; v_photos text[];
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  select * into v_sess from count_sessions where id = p_session and status = 'open';
  if not found then
    raise exception 'This count is not open for counting' using errcode = 'P0001';
  end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    v_cid := nullif(e ->> 'client_id', '')::uuid;
    if v_cid is not null and exists (select 1 from count_events where client_id = v_cid) then v_dupes := v_dupes + 1; continue; end if;
    v_qty := (e ->> 'qty')::numeric;
    if v_qty is null or v_qty < 0 then v_skipped := v_skipped + 1; continue; end if;
    select * into v_line from count_lines where id = (e ->> 'line_id')::bigint and session_id = p_session for update;
    if not found then v_skipped := v_skipped + 1; continue; end if;
    if v_sess.recount_other and v_line.recount_requested and v_line.first_counted_by = auth.uid() then
      raise exception '% at % must be recounted by a different operator than the first count', v_line.sku, v_line.location using errcode = 'P0001';
    end if;
    v_dmg := coalesce((e ->> 'damaged_qty')::numeric, 0);
    v_reason := nullif(trim(coalesce(e ->> 'damage_reason', '')), '');
    v_photos := coalesce(array(select jsonb_array_elements_text(coalesce(e -> 'photos', '[]'::jsonb))), '{}');
    if v_dmg < 0 then raise exception 'Damaged quantity can''t be below 0' using errcode = 'P0001'; end if;
    if v_dmg > 0 and v_reason is null then raise exception 'Choose a reason for the damaged units of % at %', v_line.sku, v_line.location using errcode = 'P0001'; end if;
    if v_dmg > 0 and cardinality(v_photos) = 0 then raise exception 'Take a photo of the damaged units of % at %', v_line.sku, v_line.location using errcode = 'P0001'; end if;
    update count_lines set counted_qty = v_qty, counted_by = auth.uid(),
           counted_at = coalesce((e ->> 'client_ts')::timestamptz, now()),
           count_round = count_round + 1, recount_requested = false, accepted = false, accepted_by = null, accepted_at = null,
           damaged_qty = v_dmg, damage_reason = case when v_dmg > 0 then v_reason end,
           damage_note = case when v_dmg > 0 then nullif(trim(coalesce(e ->> 'damage_note', '')), '') end,
           damage_photos = case when v_dmg > 0 then v_photos else '{}' end
     where id = v_line.id;
    insert into count_events (session_id, line_id, event, qty, prev_qty, note, photos, device, client_id, client_ts)
    values (p_session, v_line.id, 'count', v_qty, v_line.counted_qty,
            nullif(concat_ws('; ', case when (e ->> 'first_entry') is null then null
                                        when (e ->> 'first_entry')::numeric = v_qty then 'Confirmed by typing twice: ' || v_qty
                                        else 'Re-entered: first ' || (e ->> 'first_entry') || ', final ' || v_qty end,
                                   case when v_dmg > 0 then 'Damaged ' || v_dmg || ': ' || v_reason end), ''),
            case when v_dmg > 0 then v_photos end,
            p_device, v_cid, (e ->> 'client_ts')::timestamptz);
    v_saved := v_saved + 1;
  end loop;
  return jsonb_build_object('saved', v_saved, 'duplicates', v_dupes, 'skipped', v_skipped);
end $$;

-- Excess stock: physically found at a location where the system doesn't expect it.
-- Also used for misplaced stock (p_expected_location = where the system has it).
drop function if exists public.add_found_stock(uuid, text, text, text, text, numeric, uuid, text);
create or replace function public.add_excess(p_session uuid, p_location text, p_sku text, p_qty numeric,
    p_barcode text default null, p_description text default null, p_uom text default null,
    p_batch text default null, p_mfg_date date default null, p_expiry_date date default null,
    p_expected_location text default null, p_remarks text default null,
    p_client_id uuid default null, p_device text default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare v_id bigint; v_prev numeric; s public.count_sessions; v_batch text := coalesce(trim(p_batch), '');
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  select * into s from count_sessions where id = p_session and status = 'open';
  if not found then raise exception 'This count is not open for counting'; end if;
  if p_client_id is not null and exists (select 1 from count_events where client_id = p_client_id) then
    select line_id into v_id from count_events where client_id = p_client_id; return v_id;
  end if;
  if coalesce(trim(p_location), '') = '' or coalesce(trim(p_sku), '') = '' then raise exception 'Location and SKU are required'; end if;
  if p_qty is null or p_qty < 0 then raise exception 'Enter a quantity of 0 or more'; end if;
  if s.excess_batch = 'required' and v_batch = '' then raise exception 'Batch number is required for excess stock'; end if;
  if s.excess_mfg = 'required' and p_mfg_date is null then raise exception 'Manufacturing date is required for excess stock'; end if;
  if s.excess_expiry = 'required' and p_expiry_date is null then raise exception 'Expiry date is required for excess stock'; end if;
  if p_mfg_date is not null and p_expiry_date is not null and p_expiry_date < p_mfg_date then raise exception 'Expiry date can''t be before the manufacturing date'; end if;
  select id, counted_qty into v_id, v_prev from count_lines
   where session_id = p_session and upper(location) = upper(trim(p_location)) and upper(sku) = upper(trim(p_sku)) and upper(batch) = upper(v_batch);
  if v_id is null then
    insert into count_lines (session_id, seq, location, sku, barcode, batch, mfg_date, expiry_date, description, uom, system_qty,
                             counted_qty, counted_by, counted_at, count_round, is_found, expected_location, remarks)
    values (p_session, coalesce((select max(seq) from count_lines where session_id = p_session), 0) + 1,
            trim(p_location), trim(p_sku), coalesce(trim(p_barcode), ''), v_batch, p_mfg_date, p_expiry_date,
            coalesce(p_description, ''), coalesce(p_uom, ''), 0, p_qty, auth.uid(), now(), 1, true,
            nullif(trim(coalesce(p_expected_location, '')), ''), nullif(trim(coalesce(p_remarks, '')), ''))
    returning id into v_id;
  else
    update count_lines set counted_qty = p_qty, counted_by = auth.uid(), counted_at = now(), count_round = count_round + 1,
           recount_requested = false, mfg_date = coalesce(p_mfg_date, mfg_date), expiry_date = coalesce(p_expiry_date, expiry_date),
           remarks = coalesce(nullif(trim(coalesce(p_remarks, '')), ''), remarks)
     where id = v_id;
  end if;
  insert into count_events (session_id, line_id, event, qty, prev_qty, device, client_id, note)
  values (p_session, v_id, 'found', p_qty, v_prev, p_device, p_client_id, p_expected_location);
  return v_id;
end $$;

-- Supervisor sends lines back for a fresh count.
create or replace function public.request_recount(p_session uuid, p_line_ids bigint[], p_note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_staff() then raise exception 'Only supervisors can request recounts' using errcode = '42501'; end if;
  if not exists (select 1 from count_sessions where id = p_session and status = 'open') then raise exception 'Reopen the count before requesting recounts'; end if;
  insert into count_events (session_id, line_id, event, prev_qty, note)
    select p_session, id, 'recount_request', counted_qty, p_note from count_lines where session_id = p_session and id = any (p_line_ids) and counted_qty is not null;
  update count_lines set first_counted_by = coalesce(first_counted_by, counted_by),
         counted_qty = null, counted_by = null, counted_at = null, recount_requested = true, accepted = false, accepted_by = null, accepted_at = null,
         damaged_qty = 0, damage_reason = null, damage_note = null, damage_photos = '{}'
   where session_id = p_session and id = any (p_line_ids) and counted_qty is not null;
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Supervisor accepts (or un-accepts) an out-of-tolerance variance.
create or replace function public.set_accepted(p_session uuid, p_line_ids bigint[], p_accepted boolean, p_note text default null)
returns integer language plpgsql security definer set search_path = public as $$
declare v_n int;
begin
  if not public.is_staff() then raise exception 'Only supervisors can accept variances' using errcode = '42501'; end if;
  if not exists (select 1 from count_sessions where id = p_session and status in ('open', 'closed')) then raise exception 'This count is already reconciled'; end if;
  update count_lines set accepted = p_accepted, accepted_by = case when p_accepted then auth.uid() end, accepted_at = case when p_accepted then now() end
   where session_id = p_session and id = any (p_line_ids) and counted_qty is not null;
  get diagnostics v_n = row_count;
  insert into count_events (session_id, line_id, event, note)
    select p_session, unnest(p_line_ids), case when p_accepted then 'accept' else 'unaccept' end, p_note;
  return v_n;
end $$;

-- After the desktop app uploads lines: record totals and file name.
create or replace function public.finish_import(p_session uuid, p_source_file text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_lines int; v_locs int;
begin
  if not public.is_staff() then raise exception 'Only supervisors can import' using errcode = '42501'; end if;
  select count(*), count(distinct upper(location)) into v_lines, v_locs from count_lines where session_id = p_session;
  update count_sessions set line_count = v_lines, location_count = v_locs, source_file = p_source_file where id = p_session and status = 'draft';
  insert into count_events (session_id, event, qty, note) values (p_session, 'import', v_lines, p_source_file);
  return jsonb_build_object('lines', v_lines, 'locations', v_locs);
end $$;

-- Status changes: open for counting, close, reopen.
create or replace function public.set_session_status(p_session uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare v_cur text;
begin
  if not public.is_staff() then raise exception 'Only supervisors can change a count''s status' using errcode = '42501'; end if;
  select status into v_cur from count_sessions where id = p_session for update;
  if v_cur is null then raise exception 'Count not found'; end if;
  if not ((v_cur = 'draft' and p_status = 'open') or (v_cur = 'open' and p_status = 'closed') or (v_cur = 'closed' and p_status = 'open')) then
    raise exception 'A % count can''t be changed to %', v_cur, p_status;
  end if;
  if p_status = 'open' and not exists (select 1 from count_lines where session_id = p_session) then raise exception 'Upload lines before opening the count'; end if;
  update count_sessions set status = p_status,
         opened_at = case when p_status = 'open' and opened_at is null then now() else opened_at end,
         closed_at = case when p_status = 'closed' then now() else null end,
         closed_by = case when p_status = 'closed' then auth.uid() else null end
   where id = p_session;
  insert into count_events (session_id, event, note) values (p_session, 'status', v_cur || ' -> ' || p_status);
end $$;

-- Final step: freeze the count and store the reconciliation record.
create or replace function public.reconcile_session(p_session uuid, p_wms_reference text default null, p_notes text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare st public.session_stats; v_id uuid;
begin
  if not public.is_staff() then raise exception 'Only supervisors can reconcile' using errcode = '42501'; end if;
  if not exists (select 1 from count_sessions where id = p_session and status = 'closed') then raise exception 'Close the count before reconciling it'; end if;
  select * into st from session_stats where session_id = p_session;
  if st.lines_out > 0 then raise exception '% lines are still out of tolerance. Recount or accept them first.', st.lines_out; end if;
  insert into reconciliations (session_id, lines_total, lines_counted, lines_within, lines_out, lines_accepted, found_lines, accuracy_pct,
                               net_units, net_value, abs_value, wms_reference, notes, approved_by)
  values (p_session, st.lines_total, st.lines_counted, st.lines_within, st.lines_out, st.lines_accepted, st.found_lines,
          case when st.lines_counted > 0 then round(st.lines_within::numeric / st.lines_counted * 100, 2) end,
          st.net_units, st.net_value, st.abs_value, p_wms_reference, p_notes, auth.uid())
  returning id into v_id;
  update count_sessions set status = 'reconciled' where id = p_session;
  insert into count_events (session_id, event, note) values (p_session, 'reconcile', p_wms_reference);
  return v_id;
end $$;

-- Location list for the mobile walk screen (small payload, one row per location).
create or replace function public.session_locations(p_session uuid)
returns table (location text, first_seq int, lines int, open_lines int, recount_lines int)
language sql stable security invoker set search_path = public as $$
  select location, min(seq), count(*)::int, count(*) filter (where counted_qty is null)::int,
         count(*) filter (where recount_requested and counted_qty is null)::int
  from count_lines where session_id = p_session group by location order by min(seq)
$$;

-- Lock down direct execution to signed-in users.
revoke all on function public.submit_counts(uuid, jsonb, text) from public, anon;
revoke all on function public.add_excess(uuid, text, text, numeric, text, text, text, text, date, date, text, text, uuid, text) from public, anon;
revoke all on function public.request_recount(uuid, bigint[], text) from public, anon;
revoke all on function public.set_accepted(uuid, bigint[], boolean, text) from public, anon;
revoke all on function public.finish_import(uuid, text) from public, anon;
revoke all on function public.set_session_status(uuid, text) from public, anon;
revoke all on function public.reconcile_session(uuid, text, text) from public, anon;
grant execute on function public.submit_counts(uuid, jsonb, text), public.add_excess(uuid, text, text, numeric, text, text, text, text, date, date, text, text, uuid, text),
  public.request_recount(uuid, bigint[], text), public.set_accepted(uuid, bigint[], boolean, text), public.finish_import(uuid, text),
  public.set_session_status(uuid, text), public.reconcile_session(uuid, text, text), public.session_locations(uuid) to authenticated;
grant select on public.session_stats to authenticated;

-- ---------------------------------------------------------------------
-- Views for the desktop app (they respect the security rules above)
-- ---------------------------------------------------------------------
create view public.count_lines_v with (security_invoker = true) as
select l.*,
       public.line_status(l.counted_qty, l.system_qty, s.tolerance_pct, l.recount_requested, l.accepted) as status,
       (l.counted_qty - l.system_qty)                                  as variance,
       case when l.counted_qty is null then null when l.system_qty = 0 then case when l.counted_qty = 0 then 0 else 100 end
            else round((l.counted_qty - l.system_qty) / abs(l.system_qty) * 100, 2) end as variance_pct,
       (l.counted_qty - l.system_qty) * l.unit_cost                    as variance_value,
       abs(coalesce(l.counted_qty - l.system_qty, 0)) * greatest(l.unit_cost, 0.0001) as sort_weight,
       p.full_name  as counted_by_name,
       s.name       as session_name,
       s.site       as session_site,
       s.status     as session_status,
       s.created_at as session_created_at
from public.count_lines l
join public.count_sessions s on s.id = l.session_id
left join public.profiles p on p.id = l.counted_by;

create view public.session_list with (security_invoker = true) as
select s.*, p.full_name as created_by_name, c.full_name as closed_by_name,
       st.lines_total, st.lines_counted, st.locations_total, st.locations_open, st.lines_within, st.lines_out,
       st.lines_accepted, st.lines_recount, st.found_lines, st.net_units, st.net_value, st.abs_value, st.damaged_units, st.reported_items
from public.count_sessions s
left join public.session_stats st on st.session_id = s.id
left join public.profiles p on p.id = s.created_by
left join public.profiles c on c.id = s.closed_by;

create view public.reconciliation_list with (security_invoker = true) as
select r.*, s.name as session_name, s.site, s.zone, s.source_file, s.created_at as session_created_at, s.closed_at,
       p.full_name as approved_by_name
from public.reconciliations r
join public.count_sessions s on s.id = r.session_id
left join public.profiles p on p.id = r.approved_by;

create view public.event_list with (security_invoker = true) as
select e.id, e.session_id, e.line_id, e.event, e.qty, e.prev_qty, e.note, e.user_id, e.device, e.client_id, e.client_ts, e.created_at,
       e.code, e.photos, p.full_name as user_name, coalesce(l.location, e.location) as location, coalesce(l.sku, e.code) as sku
from public.count_events e
left join public.profiles p on p.id = e.user_id
left join public.count_lines l on l.id = e.line_id;

-- ---------------------------------------------------------------------
-- Feeds for the mobile app
-- ---------------------------------------------------------------------
drop function if exists public.mobile_sessions();
create or replace function public.mobile_sessions()
returns table (id uuid, name text, site text, zone text, tolerance_pct numeric, blind boolean, confirm_location boolean,
               rack_grouping text, excess_batch text, excess_mfg text, excess_expiry text,
               lines_total bigint, lines_counted bigint, locations_total bigint, locations_open bigint, recheck_pct numeric)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.site, s.zone, s.tolerance_pct, s.blind, s.confirm_location,
         s.rack_grouping, s.excess_batch, s.excess_mfg, s.excess_expiry,
         st.lines_total, st.lines_counted, st.locations_total, st.locations_open, s.recheck_pct
  from count_sessions s join session_stats st on st.session_id = s.id
  where s.status = 'open' and public.my_role() is not null
  order by s.opened_at desc nulls last
$$;

-- Lines for counting. Page with p_after_id (the last id you received); pass p_since to fetch only changes.
drop function if exists public.mobile_lines(uuid, timestamptz, int, int);
drop function if exists public.mobile_lines(uuid, timestamptz, bigint, int);
create or replace function public.mobile_lines(p_session uuid, p_since timestamptz default null, p_after_id bigint default 0, p_limit int default 1000)
returns table (id bigint, seq int, location text, sku text, barcode text, batch text, description text, uom text, units_per_case numeric, system_qty numeric,
               counted_qty numeric, counted_by_name text, counted_at timestamptz, recount_requested boolean, is_found boolean, updated_at timestamptz,
               damaged_qty numeric, damage_reason text, damage_note text, damage_photos text[], recount_blocked boolean, ref_v numeric)
language plpgsql stable security definer set search_path = public as $$
declare v_role app_role := public.my_role(); v_show_sys boolean; v_other boolean;
begin
  if v_role is null then return; end if;
  -- Blind means blind on the phone for EVERYONE, supervisors and admins included. They see system quantities on the console.
  select not s.blind, s.recount_other into v_show_sys, v_other
    from count_sessions s where s.id = p_session and (s.status = 'open' or v_role in ('admin', 'supervisor'));
  if v_show_sys is null then return; end if;
  return query
  select l.id, l.seq, l.location, l.sku, l.barcode, l.batch, l.description, l.uom, l.units_per_case,
         case when v_show_sys and not l.recount_requested then l.system_qty end,   -- recounts are always blind
         l.counted_qty, p.full_name, l.counted_at, l.recount_requested, l.is_found, l.updated_at,
         l.damaged_qty, l.damage_reason, l.damage_note, l.damage_photos,
         (v_other and l.recount_requested and l.first_counted_by = auth.uid()),
         -- scrambled system quantity, used only by the phone's "enter it again" check and never displayed
         case when not l.is_found then l.system_qty * 97 + l.id * 13 end
  from count_lines l
  left join profiles p on p.id = l.counted_by
  where l.session_id = p_session and l.id > coalesce(p_after_id, 0)
    and (p_since is null or l.updated_at > p_since)
  order by l.id
  limit least(greatest(p_limit, 1), 1000);
end $$;

drop function if exists public.whoami();
create or replace function public.whoami()
returns table (id uuid, full_name text, email text, role app_role, site text, active boolean, job text)
language sql stable security definer set search_path = public as $$
  select id, full_name, email, role, site, active, job from profiles where id = auth.uid()
$$;

-- During a recount the operator may only count the SKUs on his list. Anything else he finds there is REPORTED, never counted:
-- it goes to the supervisor as an exception with a note and a photo, and inventory isn't touched.
create or replace function public.report_not_on_list(p_session uuid, p_location text, p_code text, p_note text default null,
    p_photos text[] default '{}', p_client_id uuid default null, p_device text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  if not exists (select 1 from count_sessions where id = p_session and status = 'open') then raise exception 'This count is not open for counting'; end if;
  if p_client_id is not null and exists (select 1 from count_events where client_id = p_client_id) then return; end if;
  insert into count_events (session_id, event, location, code, note, photos, device, client_id)
  values (p_session, 'not_on_list', trim(p_location), trim(p_code), nullif(trim(coalesce(p_note, '')), ''), coalesce(p_photos, '{}'), p_device, p_client_id);
end $$;
revoke all on function public.report_not_on_list(uuid, text, text, text, text[], uuid, text) from public, anon;
grant execute on function public.report_not_on_list(uuid, text, text, text, text[], uuid, text) to authenticated;

grant execute on function public.mobile_sessions(), public.mobile_lines(uuid, timestamptz, bigint, int), public.whoami() to authenticated;
revoke all on function public.mobile_sessions(), public.mobile_lines(uuid, timestamptz, bigint, int), public.whoami() from public, anon;

-- Table access for signed-in users (row-level security above still decides which rows).
grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.count_sessions to authenticated;
grant select, insert, delete on public.count_lines to authenticated;
grant select on public.count_events, public.reconciliations to authenticated;
grant select on public.count_lines_v, public.session_list, public.reconciliation_list, public.event_list to authenticated;
revoke all on all tables in schema public from anon;

-- =====================================================================
-- ORDER QC (quantity check of picked orders before dispatch)
-- Added in version 3. Safe to re-run.
--
--   pending ──> in_progress ──> passed                        (final)
--                    │
--                    └──> short ──> in_progress (after the extra pick)
--                            └──> released  (supervisor approves shipping short, final)
--   pending / in_progress / short ──> cancelled (supervisor, final)
--
-- Rules the database enforces (not just the apps):
--   * An order can't be uploaded twice (same storer + order number) unless the first was cancelled.
--   * Only one person checks an order at a time. A supervisor can unlock it.
--   * Scanned quantity can never be more than the order quantity. Extra units are logged as
--     "set aside" and never counted.
--   * An order passes only when every line is complete. A short order needs the missing units
--     scanned, or a supervisor's release with a reason.
--   * Passed, released and cancelled orders are frozen.
--   * Every scan, rejected scan, undo and status change is kept in qc_events. A scan sent twice
--     from an offline phone is stored once.
-- =====================================================================
create table if not exists public.qc_orders (
  id           uuid primary key default gen_random_uuid(),
  order_no     text not null,
  reference    text not null default '',          -- second number, e.g. the customer's order number
  storer       text not null default '',
  customer     text not null default '',
  source_file  text,
  status       text not null default 'pending' check (status in ('pending', 'in_progress', 'short', 'passed', 'released', 'cancelled')),
  tote_mode    text not null default 'off' check (tote_mode in ('off', 'optional', 'required')),
  allow_qty    boolean not null default false,     -- operators may type a quantity instead of scanning each unit
  assigned_to  uuid references public.profiles (id),
  assigned_at  timestamptz,
  started_at   timestamptz,
  short_at     timestamptz,
  finished_at  timestamptz,
  finished_by  uuid references public.profiles (id),
  closed_note  text,                               -- reason for release or cancel
  closed_by    uuid references public.profiles (id),
  closed_at    timestamptz,
  created_by   uuid references public.profiles (id) default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists qc_orders_live_idx on public.qc_orders (upper(storer), upper(order_no)) where status <> 'cancelled';
create index if not exists qc_orders_status_idx on public.qc_orders (status, created_at desc);
create index if not exists qc_orders_no_idx on public.qc_orders (upper(order_no));
create index if not exists qc_orders_ref_idx on public.qc_orders (upper(reference));
drop trigger if exists qc_orders_touch on public.qc_orders;
create trigger qc_orders_touch before update on public.qc_orders for each row execute function public.touch_updated_at();

create table if not exists public.qc_lines (
  id            bigint generated always as identity primary key,
  order_id      uuid not null references public.qc_orders (id) on delete cascade,
  line_no       integer not null,
  sku           text not null,
  barcode       text not null default '',
  description   text not null default '',
  uom           text not null default '',
  batch         text not null default '',
  expected_qty  numeric(14,3) not null check (expected_qty > 0),
  scanned_qty   numeric(14,3) not null default 0,
  over_qty      numeric(14,3) not null default 0 check (over_qty >= 0),
  updated_at    timestamptz not null default now(),
  constraint qc_lines_scanned_range check (scanned_qty >= 0 and scanned_qty <= expected_qty)
);
create unique index if not exists qc_lines_sku_idx on public.qc_lines (order_id, upper(sku));
create index if not exists qc_lines_barcode_idx on public.qc_lines (order_id, barcode);
create index if not exists qc_lines_sku_all_idx on public.qc_lines (upper(sku));
drop trigger if exists qc_lines_touch on public.qc_lines;
create trigger qc_lines_touch before update on public.qc_lines for each row execute function public.touch_updated_at();

create table if not exists public.qc_events (
  id          bigint generated always as identity primary key,
  order_id    uuid not null references public.qc_orders (id) on delete cascade,
  line_id     bigint references public.qc_lines (id) on delete cascade,
  event       text not null check (event in ('import', 'start', 'resume', 'pause', 'scan', 'over', 'wrong_item', 'unknown', 'undo', 'tote',
                                             'finish', 'short', 'unlock', 'release', 'cancel', 'reset')),
  qty         numeric(14,3),
  code        text,
  tote        text,
  note        text,
  user_id     uuid references public.profiles (id) default auth.uid(),
  device      text,
  client_id   uuid unique,
  client_ts   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists qc_events_order_idx on public.qc_events (order_id, created_at);
create index if not exists qc_events_user_idx on public.qc_events (user_id, created_at);

alter table public.qc_orders enable row level security;
alter table public.qc_lines  enable row level security;
alter table public.qc_events enable row level security;
-- Supervisors read everything. Operators read only through the qc_mobile_* functions below.
-- Nobody writes these tables directly: every change goes through the functions, which also write the audit trail.
drop policy if exists qc_orders_read on public.qc_orders;
create policy qc_orders_read on public.qc_orders for select to authenticated using (public.is_staff());
drop policy if exists qc_lines_read on public.qc_lines;
create policy qc_lines_read on public.qc_lines for select to authenticated using (public.is_staff());
drop policy if exists qc_events_read on public.qc_events;
create policy qc_events_read on public.qc_events for select to authenticated using (public.is_staff() or user_id = auth.uid());

-- Upload orders from the console.
-- p_orders: [{ "order_no": "SO1", "reference": "", "storer": "TGD", "customer": "",
--              "lines": [{ "sku": "7000294", "barcode": "9345…", "description": "", "uom": "", "batch": "", "qty": 3 }] }]
create or replace function public.qc_import(p_orders jsonb, p_source_file text default null, p_tote_mode text default 'off', p_allow_qty boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o jsonb; l jsonb; v_id uuid; v_orders int := 0; v_lines int := 0; v_n int; v_dupes jsonb := '[]'::jsonb; v_no text; v_storer text; v_qty numeric;
begin
  if not public.is_staff() then raise exception 'Only supervisors can upload orders' using errcode = '42501'; end if;
  if coalesce(p_tote_mode, '') not in ('off', 'optional', 'required') then raise exception 'Tote scanning must be off, optional or required'; end if;
  for o in select * from jsonb_array_elements(p_orders) loop
    v_no := trim(coalesce(o ->> 'order_no', '')); v_storer := trim(coalesce(o ->> 'storer', ''));
    if v_no = '' then continue; end if;
    if exists (select 1 from qc_orders where upper(storer) = upper(v_storer) and upper(order_no) = upper(v_no) and status <> 'cancelled') then
      v_dupes := v_dupes || to_jsonb(v_no); continue;
    end if;
    insert into qc_orders (order_no, reference, storer, customer, source_file, tote_mode, allow_qty)
    values (v_no, trim(coalesce(o ->> 'reference', '')), v_storer, trim(coalesce(o ->> 'customer', '')), p_source_file, p_tote_mode, coalesce(p_allow_qty, false))
    returning id into v_id;
    v_n := 0;
    for l in select * from jsonb_array_elements(coalesce(o -> 'lines', '[]'::jsonb)) loop
      v_qty := (l ->> 'qty')::numeric;
      if coalesce(trim(l ->> 'sku'), '') = '' or v_qty is null or v_qty <= 0 then continue; end if;
      v_n := v_n + 1;
      insert into qc_lines (order_id, line_no, sku, barcode, description, uom, batch, expected_qty)
      values (v_id, v_n, trim(l ->> 'sku'), coalesce(trim(l ->> 'barcode'), ''), coalesce(l ->> 'description', ''), coalesce(l ->> 'uom', ''),
              coalesce(l ->> 'batch', ''), v_qty);
    end loop;
    if v_n = 0 then raise exception 'Order % has no lines with a SKU and a quantity above 0', v_no; end if;
    insert into qc_events (order_id, event, qty, note) values (v_id, 'import', v_n, p_source_file);
    v_orders := v_orders + 1; v_lines := v_lines + v_n;
  end loop;
  return jsonb_build_object('orders', v_orders, 'lines', v_lines, 'duplicates', v_dupes);
end $$;

-- Operator opens an order for QC (claims it). Also resumes a short order after the extra pick.
create or replace function public.qc_start(p_order uuid, p_device text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.qc_orders; v_name text;
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  select * into o from qc_orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status = 'passed' then raise exception 'Order % has already passed QC', o.order_no; end if;
  if o.status = 'released' then raise exception 'Order % was released short by a supervisor', o.order_no; end if;
  if o.status = 'cancelled' then raise exception 'Order % was cancelled', o.order_no; end if;
  if o.assigned_to is not null and o.assigned_to <> auth.uid() then
    select full_name into v_name from profiles where id = o.assigned_to;
    raise exception '% is checking order %. If they have stopped, ask a supervisor to unlock it.', coalesce(nullif(v_name, ''), 'Another user'), o.order_no;
  end if;
  update qc_orders set status = 'in_progress', assigned_to = auth.uid(), assigned_at = now(), started_at = coalesce(started_at, now()) where id = p_order;
  if o.assigned_to is null then
    insert into qc_events (order_id, event, device) values (p_order, case when o.status = 'short' then 'resume' when o.started_at is null then 'start' else 'resume' end, p_device);
  end if;
  return (select to_jsonb(x) from qc_orders x where x.id = p_order);
end $$;

-- Operator steps away: the order stays in progress (scans are kept) but anyone can pick it up.
create or replace function public.qc_pause(p_order uuid, p_device text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  update qc_orders set assigned_to = null, assigned_at = null where id = p_order and assigned_to = auth.uid() and status = 'in_progress';
  if found then insert into qc_events (order_id, event, device) values (p_order, 'pause', p_device); end if;
end $$;

-- Scans from the phone (one at a time, or a batch from the offline queue).
-- p_entries: [{ "kind": "scan"|"over"|"undo"|"wrong_item"|"unknown"|"tote", "line_id": 1, "qty": 1, "code": "…", "tote": "…",
--               "note": "…", "client_id": "uuid", "client_ts": "…" }]
-- A scan that would go above the order quantity is split: the part that fits is counted, the rest is logged as set aside.
create or replace function public.qc_submit(p_order uuid, p_entries jsonb, p_device text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.qc_orders; e jsonb; v_line public.qc_lines; v_cid uuid; v_qty numeric; v_fit numeric; v_kind text; v_ts timestamptz;
        v_saved int := 0; v_dupes int := 0; v_adjusted int := 0; v_skipped int := 0;
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  select * into o from qc_orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'in_progress' or o.assigned_to is distinct from auth.uid() then
    raise exception 'Order % is no longer assigned to you. A supervisor may have unlocked, reset or closed it.', o.order_no using errcode = 'P0001';
  end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    v_cid := nullif(e ->> 'client_id', '')::uuid;
    if v_cid is not null and exists (select 1 from qc_events where client_id = v_cid) then v_dupes := v_dupes + 1; continue; end if;
    v_kind := e ->> 'kind'; v_qty := coalesce((e ->> 'qty')::numeric, 1); v_ts := (e ->> 'client_ts')::timestamptz;
    if v_kind in ('scan', 'over', 'undo') then
      if v_qty <= 0 then v_skipped := v_skipped + 1; continue; end if;
      select * into v_line from qc_lines where id = (e ->> 'line_id')::bigint and order_id = p_order for update;
      if not found then v_skipped := v_skipped + 1; continue; end if;
    end if;
    if v_kind = 'scan' then
      v_fit := least(v_qty, v_line.expected_qty - v_line.scanned_qty);
      if v_fit > 0 then
        update qc_lines set scanned_qty = scanned_qty + v_fit where id = v_line.id;
        insert into qc_events (order_id, line_id, event, qty, code, tote, device, client_id, client_ts)
        values (p_order, v_line.id, 'scan', v_fit, e ->> 'code', nullif(e ->> 'tote', ''), p_device, v_cid, v_ts);
      end if;
      if v_fit < v_qty then
        update qc_lines set over_qty = over_qty + (v_qty - v_fit) where id = v_line.id;
        insert into qc_events (order_id, line_id, event, qty, code, tote, note, device, client_id, client_ts)
        values (p_order, v_line.id, 'over', v_qty - v_fit, e ->> 'code', nullif(e ->> 'tote', ''), 'More than the order quantity', p_device,
                case when v_fit > 0 then null else v_cid end, v_ts);
        v_adjusted := v_adjusted + 1;
      end if;
    elsif v_kind = 'over' then
      update qc_lines set over_qty = over_qty + v_qty where id = v_line.id;
      insert into qc_events (order_id, line_id, event, qty, code, tote, note, device, client_id, client_ts)
      values (p_order, v_line.id, 'over', v_qty, e ->> 'code', nullif(e ->> 'tote', ''), coalesce(e ->> 'note', 'More than the order quantity'), p_device, v_cid, v_ts);
    elsif v_kind = 'undo' then
      v_fit := least(v_qty, v_line.scanned_qty);
      update qc_lines set scanned_qty = scanned_qty - v_fit where id = v_line.id;
      insert into qc_events (order_id, line_id, event, qty, tote, note, device, client_id, client_ts)
      values (p_order, v_line.id, 'undo', v_fit, nullif(e ->> 'tote', ''), e ->> 'note', p_device, v_cid, v_ts);
    elsif v_kind in ('wrong_item', 'unknown', 'tote') then
      insert into qc_events (order_id, event, code, tote, note, device, client_id, client_ts)
      values (p_order, v_kind, e ->> 'code', nullif(e ->> 'tote', ''), e ->> 'note', p_device, v_cid, v_ts);
    else v_skipped := v_skipped + 1; continue;
    end if;
    v_saved := v_saved + 1;
  end loop;
  return jsonb_build_object('saved', v_saved, 'duplicates', v_dupes, 'adjusted', v_adjusted, 'skipped', v_skipped);
end $$;

-- Operator finishes. Complete: passed. Short: nothing changes unless p_confirm_short, then it waits for picking.
create or replace function public.qc_finish(p_order uuid, p_confirm_short boolean default false, p_device text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare o public.qc_orders; v_short numeric; v_lines int;
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  select * into o from qc_orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status <> 'in_progress' or o.assigned_to is distinct from auth.uid() then raise exception 'Order % is no longer assigned to you', o.order_no; end if;
  select coalesce(sum(expected_qty - scanned_qty), 0), count(*) filter (where scanned_qty < expected_qty) into v_short, v_lines
    from qc_lines where order_id = p_order;
  if v_short = 0 then
    update qc_orders set status = 'passed', finished_at = now(), finished_by = auth.uid(), assigned_to = null, assigned_at = null where id = p_order;
    insert into qc_events (order_id, event, device) values (p_order, 'finish', p_device);
    return jsonb_build_object('status', 'passed');
  end if;
  if not coalesce(p_confirm_short, false) then
    return jsonb_build_object('status', 'check', 'short_units', v_short, 'short_lines', v_lines);
  end if;
  update qc_orders set status = 'short', short_at = now(), assigned_to = null, assigned_at = null where id = p_order;
  insert into qc_events (order_id, event, qty, note, device) values (p_order, 'short', v_short, v_lines || case when v_lines = 1 then ' line short' else ' lines short' end, p_device);
  return jsonb_build_object('status', 'short', 'short_units', v_short, 'short_lines', v_lines);
end $$;

-- Supervisor actions. p_action: unlock | release | cancel | reset. Release, cancel and reset need a reason.
create or replace function public.qc_supervise(p_order uuid, p_action text, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare o public.qc_orders; v_note text := nullif(trim(coalesce(p_note, '')), '');
begin
  if not public.is_staff() then raise exception 'Only supervisors can do this' using errcode = '42501'; end if;
  select * into o from qc_orders where id = p_order for update;
  if not found then raise exception 'Order not found'; end if;
  if o.status in ('passed', 'released', 'cancelled') then raise exception 'Order % is closed and can''t be changed', o.order_no; end if;
  if p_action in ('release', 'cancel', 'reset') and v_note is null then raise exception 'Enter a reason'; end if;
  if p_action = 'unlock' then
    if o.assigned_to is null then raise exception 'Nobody is checking this order'; end if;
    update qc_orders set assigned_to = null, assigned_at = null where id = p_order;
  elsif p_action = 'release' then
    if o.status <> 'short' then raise exception 'Only a short order can be released'; end if;
    update qc_orders set status = 'released', closed_note = v_note, closed_by = auth.uid(), closed_at = now(), assigned_to = null, assigned_at = null where id = p_order;
  elsif p_action = 'cancel' then
    update qc_orders set status = 'cancelled', closed_note = v_note, closed_by = auth.uid(), closed_at = now(), assigned_to = null, assigned_at = null where id = p_order;
  elsif p_action = 'reset' then
    update qc_lines set scanned_qty = 0, over_qty = 0 where order_id = p_order;
    update qc_orders set status = 'pending', assigned_to = null, assigned_at = null, started_at = null, short_at = null where id = p_order;
  else raise exception 'Unknown action %', p_action;
  end if;
  insert into qc_events (order_id, event, note) values (p_order, p_action, v_note);
end $$;

-- Totals per order
drop view if exists public.qc_order_list, public.qc_line_v, public.qc_event_list;
drop view if exists public.qc_order_stats;
create view public.qc_order_stats with (security_invoker = true) as
select o.id as order_id,
       count(l.id)                                                      as lines_total,
       count(l.id) filter (where l.scanned_qty >= l.expected_qty)       as lines_done,
       coalesce(sum(l.expected_qty), 0)                                 as units_expected,
       coalesce(sum(l.scanned_qty), 0)                                  as units_scanned,
       coalesce(sum(l.expected_qty - l.scanned_qty), 0)                 as units_short,
       coalesce(sum(l.over_qty), 0)                                     as units_over
from public.qc_orders o left join public.qc_lines l on l.order_id = o.id
group by o.id;

create view public.qc_order_list with (security_invoker = true) as
select o.*, st.lines_total, st.lines_done, st.units_expected, st.units_scanned, st.units_short, st.units_over,
       a.full_name as assigned_name, c.full_name as created_by_name, f.full_name as finished_by_name, x.full_name as closed_by_name
from public.qc_orders o
join public.qc_order_stats st on st.order_id = o.id
left join public.profiles a on a.id = o.assigned_to
left join public.profiles c on c.id = o.created_by
left join public.profiles f on f.id = o.finished_by
left join public.profiles x on x.id = o.closed_by;

create view public.qc_line_v with (security_invoker = true) as
select l.*, (l.expected_qty - l.scanned_qty) as short_qty, o.order_no, o.reference, o.storer, o.customer, o.status as order_status, o.created_at as order_created_at
from public.qc_lines l join public.qc_orders o on o.id = l.order_id;

create view public.qc_event_list with (security_invoker = true) as
select e.*, p.full_name as user_name, l.sku, o.order_no
from public.qc_events e
join public.qc_orders o on o.id = e.order_id
left join public.profiles p on p.id = e.user_id
left join public.qc_lines l on l.id = e.line_id;

-- Feeds for the mobile app. With p_search (a scanned order or reference number) it returns that order whatever its status,
-- so the phone can say "already passed" instead of "not found".
drop function if exists public.qc_mobile_orders(text);
create or replace function public.qc_mobile_orders(p_search text default null)
returns table (id uuid, order_no text, reference text, storer text, customer text, status text, tote_mode text, allow_qty boolean,
               assigned_to uuid, assigned_name text, lines_total bigint, lines_done bigint, units_expected numeric, units_scanned numeric,
               units_over numeric, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select o.id, o.order_no, o.reference, o.storer, o.customer, o.status, o.tote_mode, o.allow_qty, o.assigned_to, a.full_name,
         st.lines_total, st.lines_done, st.units_expected, st.units_scanned, st.units_over, o.created_at
  from qc_orders o join qc_order_stats st on st.order_id = o.id left join profiles a on a.id = o.assigned_to
  where public.my_role() is not null
    and (case when nullif(trim(coalesce(p_search, '')), '') is null then o.status in ('pending', 'in_progress', 'short')
              else upper(o.order_no) = upper(trim(p_search)) or (o.reference <> '' and upper(o.reference) = upper(trim(p_search))) end)
  order by (o.assigned_to = auth.uid()) desc nulls last, o.created_at
  limit 500
$$;

create or replace function public.qc_mobile_lines(p_order uuid)
returns table (id bigint, line_no int, sku text, barcode text, description text, uom text, batch text,
               expected_qty numeric, scanned_qty numeric, over_qty numeric, updated_at timestamptz)
language sql stable security definer set search_path = public as $$
  select l.id, l.line_no, l.sku, l.barcode, l.description, l.uom, l.batch, l.expected_qty, l.scanned_qty, l.over_qty, l.updated_at
  from qc_lines l where l.order_id = p_order and public.my_role() is not null order by l.line_no
$$;

revoke all on function public.qc_import(jsonb, text, text, boolean), public.qc_start(uuid, text), public.qc_pause(uuid, text),
  public.qc_submit(uuid, jsonb, text), public.qc_finish(uuid, boolean, text), public.qc_supervise(uuid, text, text),
  public.qc_mobile_orders(text), public.qc_mobile_lines(uuid) from public, anon;
grant execute on function public.qc_import(jsonb, text, text, boolean), public.qc_start(uuid, text), public.qc_pause(uuid, text),
  public.qc_submit(uuid, jsonb, text), public.qc_finish(uuid, boolean, text), public.qc_supervise(uuid, text, text),
  public.qc_mobile_orders(text), public.qc_mobile_lines(uuid) to authenticated;
grant select on public.qc_orders, public.qc_lines, public.qc_events to authenticated;
grant select on public.qc_order_stats, public.qc_order_list, public.qc_line_v, public.qc_event_list to authenticated;
revoke all on public.qc_orders, public.qc_lines, public.qc_events from anon;


-- =====================================================================
-- PHOTOS (version 4): damaged stock and reported items. Private bucket.
-- Phones upload their own photos; supervisors and admins can view all of them.
-- Photos are compressed on the phone to about 150 KB each.
-- =====================================================================
insert into storage.buckets (id, name, public) values ('stowra-photos', 'stowra-photos', false) on conflict (id) do nothing;
drop policy if exists stowra_photos_upload on storage.objects;
create policy stowra_photos_upload on storage.objects for insert to authenticated
  with check (bucket_id = 'stowra-photos' and public.my_role() is not null);
drop policy if exists stowra_photos_read on storage.objects;
create policy stowra_photos_read on storage.objects for select to authenticated
  using (bucket_id = 'stowra-photos' and (public.is_staff() or owner = auth.uid()));


-- =====================================================================
-- ORGANISATION, SITES AND DOCKS (version 5)
-- The company name lives in ONE place. Screens, gate passes, checklists and reports read it from here,
-- so changing it here changes it everywhere.
-- =====================================================================
create table if not exists public.org_settings (
  id                 int primary key default 1 check (id = 1),
  company_name       text not null default '',   -- optional: leave empty until the name is decided; nothing shows it then
  pass_base_url      text not null default '',        -- web address of the gate pass page, e.g. https://you.github.io/stowra/pass/
  yard_alert_minutes int  not null default 120 check (yard_alert_minutes > 0),
  updated_at         timestamptz not null default now()
);
insert into public.org_settings (id) values (1) on conflict (id) do nothing;
alter table public.org_settings alter column company_name set default '';
update public.org_settings set company_name = '' where company_name = 'Your company';

create table if not exists public.sites (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  code        text not null default '',
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);
create unique index if not exists sites_name_idx on public.sites (upper(name));

create table if not exists public.docks (
  id          uuid primary key default gen_random_uuid(),
  site_id     uuid not null references public.sites (id) on delete cascade,
  name        text not null,
  kind        text not null default 'both' check (kind in ('inbound', 'outbound', 'both')),
  active      boolean not null default true,
  sort        int not null default 0
);
create unique index if not exists docks_name_idx on public.docks (site_id, upper(name));

alter table public.org_settings enable row level security;
alter table public.sites enable row level security;
alter table public.docks enable row level security;
drop policy if exists org_read on public.org_settings;
create policy org_read on public.org_settings for select to authenticated using (true);
drop policy if exists org_write on public.org_settings;
create policy org_write on public.org_settings for update to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists sites_read on public.sites;
create policy sites_read on public.sites for select to authenticated using (true);
drop policy if exists sites_write on public.sites;
create policy sites_write on public.sites for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists docks_read on public.docks;
create policy docks_read on public.docks for select to authenticated using (true);
drop policy if exists docks_write on public.docks;
create policy docks_write on public.docks for all to authenticated using (public.is_admin()) with check (public.is_admin());
grant select, update on public.org_settings to authenticated;
grant select, insert, update, delete on public.sites, public.docks to authenticated;

-- =====================================================================
-- GATE PASS (version 5): gate in -> (yard) -> dock in -> dock out -> gate out
--
--   in_yard ──> at_dock ──> dock_done ──> out        (inbound and outbound)
--   in_yard ─────────────────────────────> out        (visits that don't use a dock)
--   gate in with an expired document or without PPE ──> rejected (recorded, never enters)
--
-- Rules the database enforces:
--   * Gate in needs a valid (not expired) Emirates ID, driving licence and Mulkiya, and PPE confirmed.
--   * Inbound visits carry the ASN/PO numbers; outbound visits carry the order numbers.
--   * One vehicle per dock at a time. A dock must belong to the visit's site.
--   * Gate out only after dock out (for inbound and outbound visits).
--   * Every step is kept in gate_events with who did it and when.
-- =====================================================================
create table if not exists public.gate_visits (
  id               uuid primary key default gen_random_uuid(),
  pass_code        text not null unique,
  site_id          uuid not null references public.sites (id),
  purpose          text not null check (purpose in ('inbound', 'outbound', 'other')),
  storer           text not null default '',
  refs             text[] not null default '{}',     -- inbound: ASN / PO numbers; outbound: order numbers
  vehicle_plate    text not null,
  vehicle_type     text not null default '',
  transporter      text not null default '',
  driver_name      text not null,
  driver_mobile    text not null default '',
  eid_number       text not null default '',
  eid_expiry       date,
  licence_number   text not null default '',
  licence_expiry   date,
  mulkiya_number   text not null default '',
  mulkiya_expiry   date,
  ppe_ok           boolean not null default false,
  status           text not null default 'in_yard' check (status in ('in_yard', 'at_dock', 'dock_done', 'out', 'rejected')),
  reject_reason    text,
  notes            text,
  gate_in_at       timestamptz not null default now(),
  gate_in_by       uuid references public.profiles (id) default auth.uid(),
  dock_id          uuid references public.docks (id),
  dock_in_at       timestamptz,
  dock_in_by       uuid references public.profiles (id),
  dock_out_at      timestamptz,
  dock_out_by      uuid references public.profiles (id),
  seal_in          text,                               -- seal number on arrival (inbound)
  seal_out         text,                               -- seal applied before leaving (outbound)
  gate_out_at      timestamptz,
  gate_out_by      uuid references public.profiles (id),
  updated_at       timestamptz not null default now()
);
create index if not exists gate_visits_status_idx on public.gate_visits (site_id, status, gate_in_at);
create index if not exists gate_visits_plate_idx on public.gate_visits (upper(vehicle_plate), gate_in_at desc);
create unique index if not exists gate_visits_dock_busy_idx on public.gate_visits (dock_id) where status = 'at_dock';
drop trigger if exists gate_visits_touch on public.gate_visits;
create trigger gate_visits_touch before update on public.gate_visits for each row execute function public.touch_updated_at();

create table if not exists public.gate_events (
  id          bigint generated always as identity primary key,
  visit_id    uuid not null references public.gate_visits (id) on delete cascade,
  event       text not null check (event in ('gate_in', 'rejected', 'dock_in', 'dock_out', 'gate_out', 'note', 'cancel')),
  dock_id     uuid references public.docks (id),
  note        text,
  user_id     uuid references public.profiles (id) default auth.uid(),
  device      text,
  created_at  timestamptz not null default now()
);
create index if not exists gate_events_visit_idx on public.gate_events (visit_id, created_at);

alter table public.gate_visits enable row level security;
alter table public.gate_events enable row level security;
drop policy if exists gate_visits_read on public.gate_visits;
create policy gate_visits_read on public.gate_visits for select to authenticated using (public.my_role() is not null);
drop policy if exists gate_events_read on public.gate_events;
create policy gate_events_read on public.gate_events for select to authenticated using (public.my_role() is not null);
grant select on public.gate_visits, public.gate_events to authenticated;
revoke all on public.gate_visits, public.gate_events from anon;

create or replace function public.my_job() returns text language sql stable security definer set search_path = public as $$
  select job from profiles where id = auth.uid() and active
$$;

-- Checklist tables (the checklist section further down explains them). Created here because dock out checks them.
create table if not exists public.checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  kind        text not null default 'vehicle' check (kind in ('vehicle', 'general')),
  purpose     text check (purpose in ('inbound', 'outbound')),
  stage       text check (stage in ('before', 'after')),
  storer      text not null default '',
  items       jsonb not null default '[]'::jsonb,
  active      boolean not null default true,
  version     int not null default 1,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references public.profiles (id) default auth.uid()
);
create unique index if not exists checklist_templates_slot_idx on public.checklist_templates (kind, coalesce(purpose, ''), coalesce(stage, ''), upper(storer)) where active;

create table if not exists public.checklist_runs (
  id             uuid primary key default gen_random_uuid(),
  template_id    uuid references public.checklist_templates (id) on delete set null,
  template_name  text not null,
  template_version int not null default 1,
  items          jsonb not null,
  visit_id       uuid references public.gate_visits (id) on delete cascade,
  stage          text,
  answers        jsonb not null default '{}'::jsonb,
  result         text not null check (result in ('pass', 'fail', 'accepted', 'rejected')),
  failed         text[] not null default '{}',     -- critical items that failed
  issues         text[] not null default '{}',     -- non-critical items answered No / out of range
  photos         text[] not null default '{}',
  submitted_by   uuid references public.profiles (id) default auth.uid(),
  submitted_at   timestamptz not null default now(),
  decided_by     uuid references public.profiles (id),
  decided_at     timestamptz,
  decision_note  text,
  device         text,
  client_id      uuid unique
);
create index if not exists checklist_runs_visit_idx on public.checklist_runs (visit_id, stage, submitted_at desc);

alter table public.checklist_templates enable row level security;
alter table public.checklist_runs enable row level security;
drop policy if exists ck_templates_read on public.checklist_templates;
create policy ck_templates_read on public.checklist_templates for select to authenticated using (public.my_role() is not null);
drop policy if exists ck_templates_write on public.checklist_templates;
create policy ck_templates_write on public.checklist_templates for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists ck_runs_read on public.checklist_runs;
create policy ck_runs_read on public.checklist_runs for select to authenticated using (public.my_role() is not null);
grant select, insert, update, delete on public.checklist_templates to authenticated;
grant select on public.checklist_runs to authenticated;
revoke all on public.checklist_templates, public.checklist_runs from anon;

-- The vehicle template that applies (client-specific first, then the general one).
create or replace function public.checklist_template_for(p_purpose text, p_storer text, p_stage text)
returns public.checklist_templates language sql stable security definer set search_path = public as $$
  select t.* from checklist_templates t
  where t.active and t.kind = 'vehicle' and t.purpose = p_purpose and t.stage = p_stage
    and (t.storer = '' or upper(t.storer) = upper(coalesce(p_storer, '')))
  order by (t.storer <> '') desc limit 1
$$;
create or replace function public.checklist_latest(p_visit uuid, p_stage text)
returns public.checklist_runs language sql stable security definer set search_path = public as $$
  select r.* from checklist_runs r where r.visit_id = p_visit and r.stage = p_stage order by r.submitted_at desc limit 1
$$;

-- Gate in (security). p: { site_id, purpose, storer, refs:[…], vehicle_plate, vehicle_type, transporter, driver_name, driver_mobile,
--   eid_number, eid_expiry, licence_number, licence_expiry, mulkiya_number, mulkiya_expiry, ppe_ok, seal_in, notes }
-- Expired documents or no PPE: the visit is recorded as rejected and the vehicle doesn't enter.
create or replace function public.gate_in(p jsonb, p_device text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.gate_visits; v_code text; v_problems text[] := '{}'; v_today date := (now() at time zone 'Asia/Dubai')::date; v_refs text[];
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  if not exists (select 1 from sites where id = (p ->> 'site_id')::uuid and active) then raise exception 'Choose the site'; end if;
  if coalesce(p ->> 'purpose', '') not in ('inbound', 'outbound', 'other') then raise exception 'Choose inbound, outbound or other'; end if;
  if nullif(trim(coalesce(p ->> 'vehicle_plate', '')), '') is null then raise exception 'Enter the vehicle plate'; end if;
  if nullif(trim(coalesce(p ->> 'driver_name', '')), '') is null then raise exception 'Enter the driver''s name'; end if;
  v_refs := coalesce(array(select upper(trim(x)) from jsonb_array_elements_text(coalesce(p -> 'refs', '[]'::jsonb)) x where trim(x) <> ''), '{}');
  if p ->> 'purpose' = 'inbound' and cardinality(v_refs) = 0 then raise exception 'Enter at least one ASN or PO number'; end if;
  -- Outbound order numbers are usually not known at the gate: the warehouse adds them at dock in.
  if exists (select 1 from gate_visits where upper(vehicle_plate) = upper(trim(p ->> 'vehicle_plate')) and status in ('in_yard', 'at_dock', 'dock_done')) then
    raise exception 'Vehicle % is already inside. Gate it out first.', upper(trim(p ->> 'vehicle_plate'));
  end if;
  if (p ->> 'eid_expiry') is null then v_problems := v_problems || 'Emirates ID expiry missing'::text;
  elsif (p ->> 'eid_expiry')::date < v_today then v_problems := v_problems || ('Emirates ID expired on ' || (p ->> 'eid_expiry')); end if;
  if (p ->> 'licence_expiry') is null then v_problems := v_problems || 'Driving licence expiry missing'::text;
  elsif (p ->> 'licence_expiry')::date < v_today then v_problems := v_problems || ('Driving licence expired on ' || (p ->> 'licence_expiry')); end if;
  if (p ->> 'mulkiya_expiry') is null then v_problems := v_problems || 'Mulkiya expiry missing'::text;
  elsif (p ->> 'mulkiya_expiry')::date < v_today then v_problems := v_problems || ('Mulkiya expired on ' || (p ->> 'mulkiya_expiry')); end if;
  if not coalesce((p ->> 'ppe_ok')::boolean, false) then v_problems := v_problems || 'Driver without PPE'::text; end if;
  loop
    v_code := upper(substr(translate(md5(random()::text || clock_timestamp()::text), '01', ''), 1, 8));
    exit when length(v_code) = 8 and not exists (select 1 from gate_visits where pass_code = v_code);
  end loop;
  insert into gate_visits (pass_code, site_id, purpose, storer, refs, vehicle_plate, vehicle_type, transporter, driver_name, driver_mobile,
                           eid_number, eid_expiry, licence_number, licence_expiry, mulkiya_number, mulkiya_expiry, ppe_ok, seal_in, notes,
                           status, reject_reason)
  values (v_code, (p ->> 'site_id')::uuid, p ->> 'purpose', trim(coalesce(p ->> 'storer', '')), v_refs, upper(trim(p ->> 'vehicle_plate')),
          trim(coalesce(p ->> 'vehicle_type', '')), trim(coalesce(p ->> 'transporter', '')), trim(p ->> 'driver_name'), regexp_replace(coalesce(p ->> 'driver_mobile', ''), '[^0-9+]', '', 'g'),
          trim(coalesce(p ->> 'eid_number', '')), (p ->> 'eid_expiry')::date, trim(coalesce(p ->> 'licence_number', '')), (p ->> 'licence_expiry')::date,
          trim(coalesce(p ->> 'mulkiya_number', '')), (p ->> 'mulkiya_expiry')::date, coalesce((p ->> 'ppe_ok')::boolean, false),
          nullif(trim(coalesce(p ->> 'seal_in', '')), ''), nullif(trim(coalesce(p ->> 'notes', '')), ''),
          case when cardinality(v_problems) > 0 then 'rejected' else 'in_yard' end, nullif(array_to_string(v_problems, '; '), ''))
  returning * into v;
  insert into gate_events (visit_id, event, note, device) values (v.id, case when v.status = 'rejected' then 'rejected' else 'gate_in' end, v.reject_reason, p_device);
  return to_jsonb(v);
end $$;

-- Dock in / dock out / gate out, by pass code (scanned from the driver's phone or the printed pass).
drop function if exists public.gate_step(text, text, uuid, text, text);
create or replace function public.gate_step(p_code text, p_step text, p_dock uuid default null, p_seal text default null, p_device text default null, p_refs text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.gate_visits; d public.docks; v_busy text; v_refs text[]; v_new text[]; v_before public.checklist_runs; v_after public.checklist_runs; v_rej boolean;
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  select * into v from gate_visits where pass_code = upper(trim(p_code)) for update;
  if not found then raise exception 'Gate pass % not found', upper(trim(p_code)); end if;
  if v.status = 'rejected' then raise exception 'This vehicle was refused at the gate: %', v.reject_reason; end if;
  if v.status = 'out' then raise exception 'Vehicle % already left on %', v.vehicle_plate, to_char(v.gate_out_at at time zone 'Asia/Dubai', 'DD Mon HH24:MI'); end if;
  if p_step = 'dock_in' then
    if public.my_job() = 'security' and not public.is_staff() then raise exception 'Dock in is done by the warehouse team'; end if;
    if v.status <> 'in_yard' then raise exception 'Vehicle % is not waiting in the yard', v.vehicle_plate; end if;
    if v.purpose = 'other' then raise exception 'This visit doesn''t use a dock'; end if;
    select * into d from docks where id = p_dock and active;
    if not found then raise exception 'Choose a dock'; end if;
    if d.site_id <> v.site_id then raise exception '% is not at this vehicle''s site', d.name; end if;
    select g.vehicle_plate into v_busy from gate_visits g where g.dock_id = d.id and g.status = 'at_dock';
    if v_busy is not null then raise exception '% is in use by %', d.name, v_busy; end if;
    -- Order numbers (outbound) or extra ASN/PO numbers entered at dock in are added to the visit.
    v_new := coalesce(array(select distinct upper(trim(x)) from unnest(coalesce(p_refs, '{}')) x where trim(x) <> '' and upper(trim(x)) <> all (v.refs)), '{}');
    v_refs := v.refs || v_new;
    if v.purpose = 'outbound' and cardinality(v_refs) = 0 then raise exception 'Enter at least one order number for this vehicle'; end if;
    update gate_visits set status = 'at_dock', dock_id = d.id, dock_in_at = now(), dock_in_by = auth.uid(), refs = v_refs where id = v.id returning * into v;
    insert into gate_events (visit_id, event, dock_id, note, device) values (v.id, 'dock_in', d.id,
      case when cardinality(v_new) > 0 then case v.purpose when 'outbound' then 'Orders ' else 'Added ' end || array_to_string(v_new, ', ') end, p_device);
  elsif p_step = 'dock_out' then
    if public.my_job() = 'security' and not public.is_staff() then raise exception 'Dock out is done by the warehouse team'; end if;
    if v.status <> 'at_dock' then raise exception 'Vehicle % is not at a dock', v.vehicle_plate; end if;
    -- Vehicle checklists: the "before" checklist (before loading/unloading) and the "after" checklist (before dock out)
    -- must be passed, or accepted by a supervisor. A vehicle rejected at the dock may dock out without loading or a seal.
    v_before := public.checklist_latest(v.id, 'before'); v_after := public.checklist_latest(v.id, 'after');
    v_rej := coalesce(v_before.result, '') = 'rejected' or coalesce(v_after.result, '') = 'rejected';
    if not v_rej then
      if (public.checklist_template_for(v.purpose, v.storer, 'before')).id is not null and coalesce(v_before.result, '') not in ('pass', 'accepted') then
        raise exception '%', case when v_before.result = 'fail' then 'The before-' || case v.purpose when 'inbound' then 'unloading' else 'loading' end || ' checklist failed. A supervisor must accept or reject the vehicle first.'
                                  else 'Complete the before-' || case v.purpose when 'inbound' then 'unloading' else 'loading' end || ' checklist first.' end;
      end if;
      if (public.checklist_template_for(v.purpose, v.storer, 'after')).id is not null and coalesce(v_after.result, '') not in ('pass', 'accepted') then
        raise exception '%', case when v_after.result = 'fail' then 'The dock-out checklist failed. A supervisor must accept or reject it first.' else 'Complete the dock-out checklist first.' end;
      end if;
      if v.purpose = 'outbound' and nullif(trim(coalesce(p_seal, '')), '') is null then raise exception 'Enter the seal number applied to the vehicle'; end if;
    end if;
    update gate_visits set status = 'dock_done', dock_out_at = now(), dock_out_by = auth.uid(), seal_out = nullif(trim(coalesce(p_seal, '')), '') where id = v.id returning * into v;
    insert into gate_events (visit_id, event, dock_id, note, device) values (v.id, 'dock_out', v.dock_id,
      nullif(concat_ws(' · ', case when v_rej then 'Rejected at dock, not ' || case v.purpose when 'inbound' then 'unloaded' else 'loaded' end end, case when v.seal_out is not null then 'Seal ' || v.seal_out end), ''), p_device);
  elsif p_step = 'gate_out' then
    if v.purpose <> 'other' and v.status <> 'dock_done' then
      raise exception 'Vehicle % can''t leave yet: %', v.vehicle_plate, case v.status when 'in_yard' then 'it hasn''t been to a dock' else 'it hasn''t been docked out' end;
    end if;
    update gate_visits set status = 'out', gate_out_at = now(), gate_out_by = auth.uid() where id = v.id returning * into v;
    insert into gate_events (visit_id, event, device) values (v.id, 'gate_out', p_device);
  else raise exception 'Unknown step %', p_step;
  end if;
  return to_jsonb(v);
end $$;

-- Supervisor: cancel a visit entered by mistake (with a reason). It is kept for the record.
create or replace function public.gate_cancel(p_visit uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'Only supervisors can do this' using errcode = '42501'; end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Enter a reason'; end if;
  update gate_visits set status = 'out', gate_out_at = coalesce(gate_out_at, now()), gate_out_by = coalesce(gate_out_by, auth.uid()), notes = concat_ws(' | ', notes, 'Cancelled: ' || trim(p_note))
   where id = p_visit and status in ('in_yard', 'at_dock', 'dock_done');
  if not found then raise exception 'This visit is already closed'; end if;
  insert into gate_events (visit_id, event, note) values (p_visit, 'cancel', trim(p_note));
end $$;

-- (gate_visit_list view: defined after the checklist section below)

revoke all on function public.gate_in(jsonb, text), public.gate_step(text, text, uuid, text, text, text[]), public.gate_cancel(uuid, text), public.my_job() from public, anon;
grant execute on function public.gate_in(jsonb, text), public.gate_step(text, text, uuid, text, text, text[]), public.gate_cancel(uuid, text), public.my_job() to authenticated;


-- =====================================================================
-- CHECKLISTS (version 6)
-- One engine for every checklist: vehicle checks now, HSSEQ inspections later.
-- A template is a list of items; each completed checklist ("run") keeps a copy of the items as they were,
-- so later edits to a template never change past records.
--
-- Item: { "id": "i1", "text": "…", "type": "yesno" | "number" | "text" | "photo",
--         "critical": true/false, "na": true/false (N/A allowed), "photo_on_no": true/false,
--         "min": n, "max": n, "unit": "°C", "required": true/false (default true) }
-- Answer (per item id): { "value": "yes" | "no" | "na" | number | text, "photos": ["path"], "note": "…" }
-- Result: "fail" if a critical item is No or a critical number is out of range; otherwise "pass".
-- A failed checklist waits for a supervisor: "accepted" (continue) or "rejected" (send the vehicle away).
--
-- Vehicle checklists: one template per purpose (inbound / outbound) and stage:
--   before = after dock in, before loading/unloading;  after = before dock out.
-- A template for one storer/client replaces the general one for that client. No active template = no checklist needed.
-- =====================================================================
-- What the phone needs for one visit: the templates that apply and the latest result of each.
create or replace function public.checklist_status(p_visit uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v public.gate_visits; out jsonb := '[]'::jsonb; st text; t public.checklist_templates; r public.checklist_runs;
begin
  if public.my_role() is null then return out; end if;
  select * into v from gate_visits where id = p_visit; if not found or v.purpose = 'other' then return out; end if;
  foreach st in array array['before', 'after'] loop
    t := public.checklist_template_for(v.purpose, v.storer, st);
    r := public.checklist_latest(v.id, st);
    if t.id is not null or r.id is not null then
      out := out || jsonb_build_object('stage', st,
        'template', case when t.id is not null then jsonb_build_object('id', t.id, 'name', t.name, 'items', t.items, 'version', t.version) end,
        'run', case when r.id is not null then jsonb_build_object('id', r.id, 'result', r.result, 'failed', r.failed, 'issues', r.issues, 'submitted_at', r.submitted_at,
               'submitted_by_name', (select full_name from profiles where id = r.submitted_by), 'decision_note', r.decision_note,
               'decided_by_name', (select full_name from profiles where id = r.decided_by)) end);
    end if;
  end loop;
  return out;
end $$;

-- Submit a vehicle checklist (Docks screen). The database checks every answer against the template.
create or replace function public.checklist_submit(p_visit uuid, p_stage text, p_answers jsonb, p_device text default null, p_client_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.gate_visits; t public.checklist_templates; prev public.checklist_runs; b public.checklist_runs; it jsonb; a jsonb; val text; num numeric;
        v_failed text[] := '{}'; v_issues text[] := '{}'; v_photos text[] := '{}'; v_missing text[] := '{}'; ph text[]; v_bad boolean; v_run public.checklist_runs;
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  if p_client_id is not null and exists (select 1 from checklist_runs where client_id = p_client_id) then
    select * into v_run from checklist_runs where client_id = p_client_id; return to_jsonb(v_run);
  end if;
  if p_stage not in ('before', 'after') then raise exception 'Unknown checklist stage'; end if;
  select * into v from gate_visits where id = p_visit for update;
  if not found then raise exception 'Visit not found'; end if;
  if v.status <> 'at_dock' then raise exception 'Vehicle % is not at a dock', v.vehicle_plate; end if;
  t := public.checklist_template_for(v.purpose, v.storer, p_stage);
  if t.id is null then raise exception 'No checklist is set up for this'; end if;
  prev := public.checklist_latest(v.id, p_stage);
  if prev.result in ('pass', 'accepted') then raise exception 'This checklist is already done'; end if;
  if prev.result = 'rejected' then raise exception 'The vehicle was rejected at the dock'; end if;
  if p_stage = 'after' and (public.checklist_template_for(v.purpose, v.storer, 'before')).id is not null then
    b := public.checklist_latest(v.id, 'before');
    if coalesce(b.result, '') not in ('pass', 'accepted') then raise exception 'Complete the first checklist before this one'; end if;
  end if;
  for it in select * from jsonb_array_elements(t.items) loop
    a := coalesce(p_answers -> (it ->> 'id'), '{}'::jsonb);
    val := nullif(trim(coalesce(a ->> 'value', '')), '');
    ph := coalesce(array(select jsonb_array_elements_text(coalesce(a -> 'photos', '[]'::jsonb))), '{}');
    v_photos := v_photos || ph; v_bad := false;
    if it ->> 'type' = 'photo' then
      if cardinality(ph) = 0 and coalesce((it ->> 'required')::boolean, true) then v_missing := v_missing || (it ->> 'text'); end if;
      continue;
    end if;
    if val is null then
      if coalesce((it ->> 'required')::boolean, true) then v_missing := v_missing || (it ->> 'text'); end if;
      continue;
    end if;
    if val = 'na' then
      if not coalesce((it ->> 'na')::boolean, false) then v_missing := v_missing || (it ->> 'text'); end if;
      continue;
    end if;
    if it ->> 'type' = 'yesno' then
      if val not in ('yes', 'no') then v_missing := v_missing || (it ->> 'text'); continue; end if;
      v_bad := val = 'no';
      if v_bad and coalesce((it ->> 'photo_on_no')::boolean, false) and cardinality(ph) = 0 then raise exception 'Take a photo for: %', it ->> 'text'; end if;
    elsif it ->> 'type' = 'number' then
      begin num := val::numeric; exception when others then raise exception 'Enter a number for: %', it ->> 'text'; end;
      v_bad := (it ? 'min' and it ->> 'min' <> '' and num < (it ->> 'min')::numeric) or (it ? 'max' and it ->> 'max' <> '' and num > (it ->> 'max')::numeric);
    end if;
    if v_bad then
      if coalesce((it ->> 'critical')::boolean, false) then v_failed := v_failed || (it ->> 'text'); else v_issues := v_issues || (it ->> 'text'); end if;
    end if;
  end loop;
  if cardinality(v_missing) > 0 then raise exception 'Answer: %', array_to_string(v_missing, '; '); end if;
  insert into checklist_runs (template_id, template_name, template_version, items, visit_id, stage, answers, result, failed, issues, photos, device, client_id)
  values (t.id, t.name, t.version, t.items, v.id, p_stage, coalesce(p_answers, '{}'::jsonb), case when cardinality(v_failed) > 0 then 'fail' else 'pass' end,
          v_failed, v_issues, v_photos, p_device, p_client_id)
  returning * into v_run;
  insert into gate_events (visit_id, event, note, device)
  values (v.id, 'checklist', t.name || ': ' || case when cardinality(v_failed) > 0 then 'FAILED (' || array_to_string(v_failed, '; ') || ')' else 'passed' end
          || case when cardinality(v_issues) > 0 then ' · issues: ' || array_to_string(v_issues, '; ') else '' end, p_device);
  return to_jsonb(v_run);
end $$;

-- Supervisor decision on a failed checklist: accept (continue) or reject (the vehicle leaves without loading/unloading).
create or replace function public.checklist_decide(p_run uuid, p_decision text, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.checklist_runs; v public.gate_visits;
begin
  if not public.is_staff() then raise exception 'Only supervisors can do this' using errcode = '42501'; end if;
  if p_decision not in ('accept', 'reject') then raise exception 'Choose accept or reject'; end if;
  if nullif(trim(coalesce(p_note, '')), '') is null then raise exception 'Enter a reason'; end if;
  select * into r from checklist_runs where id = p_run for update;
  if not found then raise exception 'Checklist not found'; end if;
  if r.result <> 'fail' then raise exception 'This checklist doesn''t need a decision'; end if;
  if (public.checklist_latest(r.visit_id, r.stage)).id <> r.id then raise exception 'A newer checklist exists for this vehicle'; end if;
  select * into v from gate_visits where id = r.visit_id;
  if v.status <> 'at_dock' then raise exception 'The vehicle is no longer at the dock'; end if;
  update checklist_runs set result = case p_decision when 'accept' then 'accepted' else 'rejected' end, decided_by = auth.uid(), decided_at = now(), decision_note = trim(p_note) where id = r.id;
  insert into gate_events (visit_id, event, note) values (r.visit_id, 'checklist', r.template_name || ': ' || case p_decision when 'accept' then 'accepted by supervisor' else 'vehicle REJECTED' end || ' · ' || trim(p_note));
end $$;

alter table public.gate_events drop constraint if exists gate_events_event_check;
alter table public.gate_events add constraint gate_events_event_check check (event in ('gate_in', 'rejected', 'dock_in', 'dock_out', 'gate_out', 'note', 'cancel', 'checklist'));

revoke all on function public.checklist_template_for(text, text, text), public.checklist_latest(uuid, text), public.checklist_status(uuid),
  public.checklist_submit(uuid, text, jsonb, text, uuid), public.checklist_decide(uuid, text, text) from public, anon;
grant execute on function public.checklist_template_for(text, text, text), public.checklist_latest(uuid, text), public.checklist_status(uuid),
  public.checklist_submit(uuid, text, jsonb, text, uuid), public.checklist_decide(uuid, text, text) to authenticated;

-- Standard vehicle checklists, added once (edit them on the console under Checklists). PPE is checked at the gate, so it isn't here.
insert into public.checklist_templates (name, kind, purpose, stage, items)
select x.name, 'vehicle', x.purpose, x.stage, x.items::jsonb from (values
  ('Inbound: before unloading', 'inbound', 'before', '[
    {"id":"i1","text":"Seal number matches the delivery documents","type":"yesno","critical":true,"photo_on_no":true},
    {"id":"i2","text":"Seal intact, not broken or tampered","type":"yesno","critical":true,"photo_on_no":true},
    {"id":"i3","text":"Delivery documents received (delivery note, packing list)","type":"yesno","critical":true},
    {"id":"i4","text":"Vehicle body free of holes, leaks and damage","type":"yesno","photo_on_no":true},
    {"id":"i5","text":"Cargo free of visible damage when doors opened","type":"yesno","photo_on_no":true},
    {"id":"i6","text":"No pests, bad smell or contamination","type":"yesno","critical":true,"photo_on_no":true},
    {"id":"i7","text":"Reefer temperature","type":"number","unit":"°C","na":true},
    {"id":"i8","text":"Engine off, keys handed over","type":"yesno","critical":true},
    {"id":"i9","text":"Wheel chocks in place","type":"yesno","critical":true},
    {"id":"i10","text":"Dock leveller positioned safely","type":"yesno","critical":true}]'),
  ('Inbound: before dock out', 'inbound', 'after', '[
    {"id":"i1","text":"Vehicle fully unloaded","type":"yesno","critical":true},
    {"id":"i2","text":"Shortages, excess or damages reported to the supervisor","type":"yesno","na":true},
    {"id":"i3","text":"Dock area clear and safe","type":"yesno"},
    {"id":"i4","text":"Wheel chocks removed, dock leveller raised","type":"yesno","critical":true}]'),
  ('Outbound: before loading', 'outbound', 'before', '[
    {"id":"i1","text":"Floor, walls and roof clean and dry","type":"yesno","critical":true,"photo_on_no":true},
    {"id":"i2","text":"No holes, leaks or damage","type":"yesno","critical":true,"photo_on_no":true},
    {"id":"i3","text":"No pests or bad smell","type":"yesno","critical":true,"photo_on_no":true},
    {"id":"i4","text":"Reefer pre-cooled: temperature","type":"number","unit":"°C","na":true},
    {"id":"i5","text":"Tyres and lights in good condition","type":"yesno"},
    {"id":"i6","text":"Engine off, keys handed over","type":"yesno","critical":true},
    {"id":"i7","text":"Wheel chocks in place","type":"yesno","critical":true},
    {"id":"i8","text":"Dock leveller positioned safely","type":"yesno","critical":true}]'),
  ('Outbound: before dock out', 'outbound', 'after', '[
    {"id":"i1","text":"All orders loaded as per the loading list","type":"yesno","critical":true},
    {"id":"i2","text":"Load secured with straps or bars","type":"yesno","critical":true,"photo_on_no":true},
    {"id":"i3","text":"Photo of the loaded vehicle before closing the doors","type":"photo"},
    {"id":"i4","text":"Doors closed and seal applied","type":"yesno","critical":true},
    {"id":"i5","text":"Wheel chocks removed, dock leveller raised","type":"yesno","critical":true}]')
) as x(name, purpose, stage, items)
where not exists (select 1 from public.checklist_templates t where t.kind = 'vehicle' and t.purpose = x.purpose and t.stage = x.stage);

drop view if exists public.gate_visit_list;
create view public.gate_visit_list with (security_invoker = true) as
select v.*, s.name as site_name, d.name as dock_name,
       gi.full_name as gate_in_name, di.full_name as dock_in_name, do_.full_name as dock_out_name, go.full_name as gate_out_name,
       round(extract(epoch from (coalesce(v.dock_in_at, v.gate_out_at, now()) - v.gate_in_at)) / 60) as wait_minutes,
       round(extract(epoch from (coalesce(v.dock_out_at, now()) - v.dock_in_at)) / 60)              as dock_minutes,
       round(extract(epoch from (coalesce(v.gate_out_at, now()) - v.gate_in_at)) / 60)              as total_minutes,
       (public.checklist_template_for(v.purpose, v.storer, 'before')).id is not null as ck_before_needed,
       (public.checklist_template_for(v.purpose, v.storer, 'after')).id is not null  as ck_after_needed,
       (public.checklist_latest(v.id, 'before')).result as ck_before,
       (public.checklist_latest(v.id, 'after')).result  as ck_after
from public.gate_visits v
join public.sites s on s.id = v.site_id
left join public.docks d on d.id = v.dock_id
left join public.profiles gi on gi.id = v.gate_in_by
left join public.profiles di on di.id = v.dock_in_by
left join public.profiles do_ on do_.id = v.dock_out_by
left join public.profiles go on go.id = v.gate_out_by;
grant select on public.gate_visit_list to authenticated;

-- =====================================================================
-- Version 7: clients, items, locations and Stowra's own stock record.
--   Stock can be loaded from your WMS stock report (one row per pallet / LPN).
--   Every change is written to stock_moves, so each item has a full history.
-- =====================================================================

-- Clients (storers) and their rules
create table if not exists public.clients (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,            -- storer key, stored in capitals (e.g. FIXPRICE, TGD)
  name                  text not null default '',
  active                boolean not null default true,
  track_batch           text not null default 'optional' check (track_batch in ('off', 'optional', 'required')),
  track_expiry          text not null default 'optional' check (track_expiry in ('off', 'optional', 'required')),
  track_mfg             text not null default 'optional' check (track_mfg in ('off', 'optional', 'required')),
  batch_label           text not null default 'Batch',   -- what the batch field means for this client (e.g. "Container no.")
  ref2_label            text not null default 'Lot ref 2',
  allocation            text not null default 'FEFO' check (allocation in ('FEFO', 'FIFO')),
  min_life_receive_pct  numeric not null default 0 check (min_life_receive_pct between 0 and 100),  -- refuse receipts with less shelf life left
  min_life_ship_days    integer not null default 0 check (min_life_ship_days >= 0),                 -- don't pick stock expiring sooner than this
  near_expiry_days      integer not null default 90 check (near_expiry_days >= 0),
  auto_hold_expired     boolean not null default true,
  notes                 text not null default '',
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

-- Item master (one row per client + SKU)
create table if not exists public.items (
  id               bigserial primary key,
  client_id        uuid not null references public.clients (id) on delete cascade,
  sku              text not null,                        -- stored in capitals
  description      text not null default '',
  barcode          text not null default '',
  base_uom         text not null default 'Each',
  case_qty         numeric not null default 1 check (case_qty > 0),
  case_uom         text not null default 'Case',
  item_group       text not null default '',
  item_group2      text not null default '',
  shelf_life_days  integer not null default 0 check (shelf_life_days >= 0),
  unit_cost        numeric not null default 0,
  active           boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (client_id, sku)
);
create index if not exists items_barcode_idx on public.items (barcode) where barcode <> '';
create index if not exists items_sku_idx on public.items (sku);

-- Locations
create table if not exists public.locations (
  id             bigserial primary key,
  code           text not null unique,                   -- stored in capitals
  site_id        uuid references public.sites (id) on delete set null,
  zone           text not null default '',
  kind           text not null default 'storage' check (kind in ('storage', 'pick', 'staging', 'outbound', 'dock', 'damage', 'short', 'quarantine')),
  hold           boolean not null default false,         -- stock here is not available (damage, short, quarantine)
  mixed_allowed  boolean not null default true,          -- more than one SKU may be stored here
  active         boolean not null default true,
  notes          text not null default '',
  created_at     timestamptz not null default now()
);

-- Stock: one row per pallet (LPN) / batch / location
create table if not exists public.inventory (
  id             bigserial primary key,
  client_id      uuid not null references public.clients (id) on delete cascade,
  item_id        bigint not null references public.items (id) on delete cascade,
  location_id    bigint not null references public.locations (id),
  lpn            text not null default '',
  batch          text not null default '',
  ref2           text not null default '',
  mfg_date       date,
  expiry_date    date,
  received_at    timestamptz,
  asn            text not null default '',
  ext_ref        text not null default '',
  qty            numeric not null default 0 check (qty >= 0),
  allocated_qty  numeric not null default 0 check (allocated_qty >= 0),
  picked_qty     numeric not null default 0 check (picked_qty >= 0),
  status         text not null default 'ok' check (status in ('ok', 'hold')),
  hold_reason    text not null default '',
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles (id)
);
create index if not exists inventory_item_idx on public.inventory (item_id);
create index if not exists inventory_loc_idx on public.inventory (location_id);
create index if not exists inventory_lpn_idx on public.inventory (lpn) where lpn <> '';
create index if not exists inventory_client_idx on public.inventory (client_id);

-- Stock history: every import change, move, hold, release and adjustment
create table if not exists public.stock_moves (
  id           bigserial primary key,
  created_at   timestamptz not null default now(),
  user_id      uuid references public.profiles (id),
  kind         text not null check (kind in ('import', 'move', 'adjust', 'hold', 'release', 'receive', 'pick', 'ship')),
  client_id    uuid references public.clients (id) on delete cascade,
  item_id      bigint references public.items (id) on delete cascade,
  inventory_id bigint,
  from_loc     text not null default '',
  to_loc       text not null default '',
  lpn          text not null default '',
  batch        text not null default '',
  expiry_date  date,
  qty          numeric,                                  -- quantity moved, or the change (+/-) for imports and adjustments
  qty_before   numeric,
  qty_after    numeric,
  reason       text not null default '',
  note         text not null default '',
  ref          text not null default '',
  device       text,
  client_uuid  uuid unique                               -- the phone's id for this action (stops double saves)
);
create index if not exists stock_moves_item_idx on public.stock_moves (item_id, created_at desc);
create index if not exists stock_moves_time_idx on public.stock_moves (created_at desc);

-- Stock file imports (rows are staged, then applied in one go)
create table if not exists public.stock_imports (
  id          uuid primary key default gen_random_uuid(),
  file_name   text not null default '',
  status      text not null default 'staging' check (status in ('staging', 'done')),
  summary     jsonb not null default '{}',
  created_by  uuid references public.profiles (id) default auth.uid(),
  created_at  timestamptz not null default now(),
  finished_at timestamptz
);
create table if not exists public.stock_import_rows (
  import_id  uuid not null references public.stock_imports (id) on delete cascade,
  row_no     integer not null,
  data       jsonb not null,
  primary key (import_id, row_no)
);

alter table public.clients enable row level security;
alter table public.items enable row level security;
alter table public.locations enable row level security;
alter table public.inventory enable row level security;
alter table public.stock_moves enable row level security;
alter table public.stock_imports enable row level security;
alter table public.stock_import_rows enable row level security;

drop policy if exists clients_read on public.clients;
create policy clients_read on public.clients for select to authenticated using (public.my_role() is not null);
drop policy if exists clients_write on public.clients;
create policy clients_write on public.clients for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists items_read on public.items;
create policy items_read on public.items for select to authenticated using (public.my_role() is not null);
drop policy if exists items_write on public.items;
create policy items_write on public.items for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists locations_read on public.locations;
create policy locations_read on public.locations for select to authenticated using (public.my_role() is not null);
drop policy if exists locations_write on public.locations;
create policy locations_write on public.locations for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists inventory_read on public.inventory;
create policy inventory_read on public.inventory for select to authenticated using (public.my_role() is not null);
drop policy if exists stock_moves_read on public.stock_moves;
create policy stock_moves_read on public.stock_moves for select to authenticated using (public.my_role() is not null);
drop policy if exists stock_imports_staff on public.stock_imports;
create policy stock_imports_staff on public.stock_imports for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists stock_import_rows_staff on public.stock_import_rows;
create policy stock_import_rows_staff on public.stock_import_rows for all to authenticated using (public.is_staff()) with check (public.is_staff());

grant select, insert, update, delete on public.clients, public.items, public.locations, public.stock_imports, public.stock_import_rows to authenticated;
grant select on public.inventory, public.stock_moves to authenticated;
grant usage, select on sequence public.items_id_seq, public.locations_id_seq to authenticated;

-- Today in the UAE (expiry is judged by local date)
create or replace function public.uae_today()
returns date language sql stable as $$ select (now() at time zone 'Asia/Dubai')::date $$;

-- Guess what a location is from its code (used when new locations arrive in a stock file)
create or replace function public.guess_location_kind(p_code text)
returns text language sql immutable as $$
  select case
    when upper(p_code) ~ 'DAMAGE|DMG' then 'damage'
    when upper(p_code) ~ '^SHORT' then 'short'
    when upper(p_code) ~ 'QUAR|QRT' then 'quarantine'
    when upper(p_code) ~ '^OUT|DISPATCH|SHIP' then 'outbound'
    when upper(p_code) ~ '^STAGE|^STG|^RECV|^REC-|INBOUND' then 'staging'
    when upper(p_code) ~ '^DOCK' then 'dock'
    else 'storage' end
$$;

-- Put expired stock on hold (for clients with that rule). Returns how many rows were held.
create or replace function public.stock_hold_expired()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if public.my_role() is null then return 0; end if;
  with h as (
    update inventory i set status = 'hold', hold_reason = 'Expired', updated_at = now()
      from clients c
     where c.id = i.client_id and c.auto_hold_expired and i.status = 'ok' and i.expiry_date is not null and i.expiry_date < public.uae_today()
    returning i.*)
  insert into stock_moves (kind, client_id, item_id, inventory_id, from_loc, lpn, batch, expiry_date, qty, qty_before, qty_after, reason, user_id)
  select 'hold', h.client_id, h.item_id, h.id, l.code, h.lpn, h.batch, h.expiry_date, h.qty, h.qty, h.qty, 'Expired (automatic)', auth.uid()
    from h join locations l on l.id = h.location_id;
  get diagnostics n = row_count;
  return n;
end $$;

-- Apply a staged stock file: it replaces Stowra's stock for every client in the file.
create or replace function public.stock_import_finish(p_import uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare imp public.stock_imports; v_clients uuid[]; v_new_items int; v_new_locs int; v_rows int; v_qty numeric; v_changed int; v_held int; v_today date := public.uae_today();
begin
  if not public.is_staff() then raise exception 'Only supervisors can load stock files' using errcode = '42501'; end if;
  select * into imp from stock_imports where id = p_import for update;
  if not found then raise exception 'Import not found'; end if;
  if imp.status <> 'staging' then raise exception 'This file has already been loaded'; end if;
  if not exists (select 1 from stock_import_rows where import_id = p_import) then raise exception 'The file has no stock rows'; end if;

  create temp table _r on commit drop as
  select row_no,
         upper(trim(coalesce(data ->> 'client', '')))  as client,
         trim(coalesce(data ->> 'client_name', ''))     as client_name,
         upper(trim(coalesce(data ->> 'sku', '')))     as sku,
         trim(coalesce(data ->> 'descr', ''))          as descr,
         upper(trim(coalesce(data ->> 'loc', '')))     as loc,
         trim(coalesce(data ->> 'zone', ''))           as zone,
         trim(coalesce(data ->> 'lpn', ''))            as lpn,
         trim(coalesce(data ->> 'batch', ''))          as batch,
         trim(coalesce(data ->> 'ref2', ''))           as ref2,
         nullif(data ->> 'mfg', '')::date              as mfg,
         nullif(data ->> 'exp', '')::date              as exp,
         nullif(data ->> 'in_date', '')::timestamptz   as in_date,
         coalesce(nullif(data ->> 'qty', '')::numeric, 0)    as qty,
         coalesce(nullif(data ->> 'alloc', '')::numeric, 0)  as alloc,
         coalesce(nullif(data ->> 'picked', '')::numeric, 0) as picked,
         case when upper(coalesce(data ->> 'status', 'OK')) in ('HOLD', 'H', 'BLOCKED', 'QC') then 'hold' else 'ok' end as status,
         trim(coalesce(data ->> 'asn', ''))            as asn,
         trim(coalesce(data ->> 'ext_ref', ''))        as ext_ref,
         greatest(coalesce(nullif(data ->> 'case_qty', '')::numeric, 1), 1) as case_qty,
         coalesce(nullif(trim(data ->> 'uom'), ''), 'Each') as uom,
         coalesce(nullif(trim(data ->> 'case_uom'), ''), 'Case') as case_uom,
         trim(coalesce(data ->> 'group1', ''))         as group1,
         trim(coalesce(data ->> 'group2', ''))         as group2,
         coalesce(nullif(data ->> 'shelf_life', '')::int, 0) as shelf_life,
         trim(coalesce(data ->> 'barcode', ''))        as barcode
    from stock_import_rows where import_id = p_import;
  if exists (select 1 from _r where client = '' or sku = '' or loc = '') then raise exception 'Every row needs a client, a SKU and a location'; end if;
  if exists (select 1 from _r where qty < 0 or alloc < 0 or picked < 0) then raise exception 'Quantities can''t be negative'; end if;

  -- clients
  insert into clients (code, name)
  select client, max(client_name) from _r group by client
  on conflict (code) do update set name = case when excluded.name <> '' then excluded.name else clients.name end, updated_at = now();
  select array_agg(id) into v_clients from clients where code in (select distinct client from _r);

  -- items (new ones are added; descriptions and pack sizes are refreshed)
  select count(*) into v_new_items from (select distinct client, sku from _r) x
   where not exists (select 1 from items i join clients c on c.id = i.client_id where c.code = x.client and i.sku = x.sku);
  insert into items (client_id, sku, description, base_uom, case_qty, case_uom, item_group, item_group2, shelf_life_days, barcode)
  select distinct on (c.id, r.sku) c.id, r.sku, r.descr, r.uom, r.case_qty, r.case_uom, r.group1, r.group2, r.shelf_life, r.barcode
    from _r r join clients c on c.code = r.client
   order by c.id, r.sku, (r.barcode <> '') desc, r.row_no
  on conflict (client_id, sku) do update set
    description = case when excluded.description <> '' then excluded.description else items.description end,
    case_qty = excluded.case_qty, base_uom = excluded.base_uom, case_uom = excluded.case_uom,
    item_group = case when excluded.item_group <> '' then excluded.item_group else items.item_group end,
    item_group2 = case when excluded.item_group2 <> '' then excluded.item_group2 else items.item_group2 end,
    shelf_life_days = case when excluded.shelf_life_days > 0 then excluded.shelf_life_days else items.shelf_life_days end,
    barcode = case when items.barcode = '' then excluded.barcode else items.barcode end,
    updated_at = now();

  -- locations (new ones are added with a guessed type; existing settings are kept)
  select count(*) into v_new_locs from (select distinct loc from _r) x where not exists (select 1 from locations l where l.code = x.loc);
  insert into locations (code, zone, kind, hold)
  select loc, max(zone), public.guess_location_kind(loc), public.guess_location_kind(loc) in ('damage', 'short', 'quarantine') from _r group by loc
  on conflict (code) do update set zone = case when locations.zone = '' then excluded.zone else locations.zone end;

  -- totals before, per item
  create temp table _before on commit drop as
  select item_id, sum(qty) as qty from inventory where client_id = any (v_clients) group by item_id;

  delete from inventory where client_id = any (v_clients);
  insert into inventory (client_id, item_id, location_id, lpn, batch, ref2, mfg_date, expiry_date, received_at, asn, ext_ref, qty, allocated_qty, picked_qty, status, hold_reason, updated_by)
  select c.id, i.id, l.id, r.lpn, r.batch, r.ref2, r.mfg, r.exp, r.in_date, r.asn, r.ext_ref, r.qty, least(r.alloc, r.qty), least(r.picked, r.qty),
         case when r.status = 'hold' or l.hold then 'hold' else 'ok' end,
         case when r.status = 'hold' then 'On hold in the WMS' when l.hold then 'In ' || l.code else '' end, auth.uid()
    from _r r join clients c on c.code = r.client join items i on i.client_id = c.id and i.sku = r.sku join locations l on l.code = r.loc
   where r.qty > 0;
  get diagnostics v_rows = row_count;
  select coalesce(sum(qty), 0) into v_qty from inventory where client_id = any (v_clients);

  -- one history line per item whose total changed (refreshes only)
  insert into stock_moves (kind, client_id, item_id, qty, qty_before, qty_after, reason, ref, user_id)
  select 'import', it.client_id, it.id, coalesce(a.qty, 0) - coalesce(b.qty, 0), coalesce(b.qty, 0), coalesce(a.qty, 0), 'Stock file loaded', imp.file_name, auth.uid()
    from items it
    left join _before b on b.item_id = it.id
    left join (select item_id, sum(qty) as qty from inventory where client_id = any (v_clients) group by item_id) a on a.item_id = it.id
   where it.client_id = any (v_clients) and coalesce(a.qty, 0) <> coalesce(b.qty, 0)
     -- the first load of a client is its opening stock: no history line per item
     and it.client_id in (select distinct i2.client_id from _before b2 join items i2 on i2.id = b2.item_id);
  get diagnostics v_changed = row_count;

  v_held := public.stock_hold_expired();

  update stock_imports set status = 'done', finished_at = now(), summary = jsonb_build_object(
    'clients', (select jsonb_agg(code order by code) from clients where id = any (v_clients)),
    'rows', v_rows, 'qty', v_qty, 'new_items', v_new_items, 'new_locations', v_new_locs, 'changed_items', v_changed, 'expired_held', v_held,
    'hold_rows', (select count(*) from inventory where client_id = any (v_clients) and status = 'hold'))
   where id = p_import returning summary into imp.summary;
  delete from stock_import_rows where import_id = p_import;
  return imp.summary;
end $$;

-- Stock with everything needed to show it (client, item, location, expiry state, available quantity)
drop view if exists public.inventory_v;
create view public.inventory_v with (security_invoker = true) as
select i.*, c.code as client_code, c.name as client_name, c.batch_label, c.ref2_label, c.near_expiry_days,
       it.sku, it.description, it.barcode, it.base_uom, it.case_qty, it.case_uom, it.item_group, it.item_group2, it.shelf_life_days,
       l.code as location, l.zone, l.kind as location_kind, l.hold as location_hold,
       case when i.expiry_date is null then null else i.expiry_date - public.uae_today() end as days_to_expiry,
       case when i.expiry_date is null or it.shelf_life_days = 0 then null
            else round(greatest(i.expiry_date - public.uae_today(), 0)::numeric / it.shelf_life_days * 100) end as life_left_pct,
       case when i.expiry_date is null then 'none'
            when i.expiry_date < public.uae_today() then 'expired'
            when i.expiry_date - public.uae_today() <= c.near_expiry_days then 'near'
            else 'ok' end as expiry_state,
       case when i.status = 'ok' and not l.hold and not (c.auto_hold_expired and i.expiry_date is not null and i.expiry_date < public.uae_today())
            then greatest(i.qty - i.allocated_qty - i.picked_qty, 0) else 0 end as available_qty,
       p.full_name as updated_by_name
from public.inventory i
join public.clients c on c.id = i.client_id
join public.items it on it.id = i.item_id
join public.locations l on l.id = i.location_id
left join public.profiles p on p.id = i.updated_by;
grant select on public.inventory_v to authenticated;

drop view if exists public.stock_move_list;
create view public.stock_move_list with (security_invoker = true) as
select m.*, c.code as client_code, it.sku, it.description, p.full_name as user_name
from public.stock_moves m
left join public.clients c on c.id = m.client_id
left join public.items it on it.id = m.item_id
left join public.profiles p on p.id = m.user_id;
grant select on public.stock_move_list to authenticated;

-- Item totals per client (stock overview)
drop view if exists public.item_stock_v;
create view public.item_stock_v with (security_invoker = true) as
select it.id as item_id, it.client_id, c.code as client_code, it.sku, it.description, it.barcode, it.base_uom, it.case_qty, it.case_uom, it.item_group, it.item_group2, it.shelf_life_days, it.unit_cost, it.active,
       coalesce(sum(v.qty), 0) as qty, coalesce(sum(v.allocated_qty), 0) as allocated_qty, coalesce(sum(v.picked_qty), 0) as picked_qty,
       coalesce(sum(v.available_qty), 0) as available_qty,
       coalesce(sum(v.qty) filter (where v.status = 'hold' or v.location_hold), 0) as hold_qty,
       count(v.id) as stock_rows, count(distinct v.location_id) as locations, min(v.expiry_date) filter (where v.qty > 0) as first_expiry
from public.items it
join public.clients c on c.id = it.client_id
left join public.inventory_v v on v.item_id = it.id
group by it.id, c.code;
grant select on public.item_stock_v to authenticated;

-- Find stock by a scanned code: LPN, location, SKU or item barcode
create or replace function public.stock_lookup(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare v text := upper(trim(coalesce(p_code, ''))); r jsonb; k text; lbl text;
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  if v = '' then return jsonb_build_object('kind', 'none', 'rows', '[]'::jsonb); end if;
  if exists (select 1 from inventory where upper(lpn) = v) then k := 'lpn'; lbl := v;
    select jsonb_agg(to_jsonb(x) order by x.location) into r from inventory_v x where upper(x.lpn) = v;
  elsif exists (select 1 from locations where code = v) then k := 'location'; lbl := v;
    select coalesce(jsonb_agg(to_jsonb(x) order by x.sku, x.expiry_date nulls last), '[]'::jsonb) into r from inventory_v x where x.location = v;
  elsif exists (select 1 from items where sku = v or (barcode <> '' and upper(barcode) = v)) then k := 'item';
    select string_agg(distinct sku, ', ') into lbl from items where sku = v or (barcode <> '' and upper(barcode) = v);
    select coalesce(jsonb_agg(to_jsonb(x) order by x.expiry_date nulls last, x.location), '[]'::jsonb) into r from inventory_v x
     where x.item_id in (select id from items where sku = v or (barcode <> '' and upper(barcode) = v));
  else return jsonb_build_object('kind', 'none', 'label', v, 'rows', '[]'::jsonb);
  end if;
  return jsonb_build_object('kind', k, 'label', lbl, 'rows', coalesce(r, '[]'::jsonb),
    'location', case when k = 'location' then (select to_jsonb(l) from locations l where code = v) end);
end $$;

-- Move a pallet, or part of it, to another location (operators and supervisors)
create or replace function public.stock_move(p_inv bigint, p_to text, p_qty numeric default null, p_device text default null, p_client_id uuid default null, p_lpn text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.inventory; f public.locations; t public.locations; q numeric; free numeric; n public.inventory; v_status text; v_reason text; it public.items;
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  if p_client_id is not null and exists (select 1 from stock_moves where client_uuid = p_client_id) then
    return (select jsonb_build_object('ok', true, 'repeat', true, 'inventory_id', inventory_id) from stock_moves where client_uuid = p_client_id);
  end if;
  select * into s from inventory where id = p_inv for update;
  if not found then raise exception 'This stock is no longer there. Refresh and scan again.'; end if;
  select * into f from locations where id = s.location_id;
  select * into t from locations where code = upper(trim(coalesce(p_to, '')));
  if not found then raise exception 'Location % doesn''t exist', upper(trim(coalesce(p_to, ''))); end if;
  if not t.active then raise exception 'Location % is turned off', t.code; end if;
  if t.id = s.location_id then raise exception 'The stock is already in %', t.code; end if;
  q := coalesce(p_qty, s.qty);
  if q <= 0 then raise exception 'Enter a quantity above 0'; end if;
  free := s.qty - s.allocated_qty - s.picked_qty;
  if q > free then raise exception 'Only % can be moved: % is allocated or picked for orders', free, s.allocated_qty + s.picked_qty; end if;
  if not t.mixed_allowed and exists (select 1 from inventory x where x.location_id = t.id and x.item_id <> s.item_id and x.qty > 0) then
    raise exception '% holds another SKU and doesn''t allow mixed stock', t.code;
  end if;
  v_status := case when t.hold then 'hold' else s.status end;
  v_reason := case when t.hold and s.status = 'ok' then 'In ' || t.code else s.hold_reason end;
  if q = s.qty then
    update inventory set location_id = t.id, status = v_status, hold_reason = v_reason, lpn = coalesce(nullif(trim(p_lpn), ''), lpn), updated_at = now(), updated_by = auth.uid()
     where id = s.id returning * into n;
  else
    update inventory set qty = qty - q, updated_at = now(), updated_by = auth.uid() where id = s.id;
    insert into inventory (client_id, item_id, location_id, lpn, batch, ref2, mfg_date, expiry_date, received_at, asn, ext_ref, qty, status, hold_reason, updated_by)
    values (s.client_id, s.item_id, t.id, coalesce(nullif(trim(p_lpn), ''), ''), s.batch, s.ref2, s.mfg_date, s.expiry_date, s.received_at, s.asn, s.ext_ref, q, v_status, v_reason, auth.uid())
    returning * into n;
  end if;
  insert into stock_moves (kind, client_id, item_id, inventory_id, from_loc, to_loc, lpn, batch, expiry_date, qty, qty_before, qty_after, note, device, client_uuid, user_id)
  values ('move', s.client_id, s.item_id, n.id, f.code, t.code, coalesce(nullif(n.lpn, ''), s.lpn), s.batch, s.expiry_date, q, s.qty, s.qty - q,
          case when q < s.qty then 'Part of the pallet' else '' end || case when t.hold and s.status = 'ok' then ' Put on hold (' || t.kind || ' location)' else '' end, p_device, p_client_id, auth.uid());
  return jsonb_build_object('ok', true, 'inventory_id', n.id, 'to', t.code, 'qty', q, 'status', n.status);
end $$;

-- Hold or release stock (supervisors). A reason is required.
create or replace function public.stock_set_status(p_ids bigint[], p_status text, p_reason text)
returns integer language plpgsql security definer set search_path = public as $$
declare r record; n integer := 0;
begin
  if not public.is_staff() then raise exception 'Only supervisors can hold or release stock' using errcode = '42501'; end if;
  if p_status not in ('ok', 'hold') then raise exception 'Unknown status'; end if;
  if nullif(trim(coalesce(p_reason, '')), '') is null then raise exception 'Enter a reason'; end if;
  for r in select i.*, l.code as loc, l.hold as loc_hold, l.kind as loc_kind, c.auto_hold_expired from inventory i join locations l on l.id = i.location_id join clients c on c.id = i.client_id
            where i.id = any (p_ids) for update of i loop
    if r.status = p_status then continue; end if;
    if p_status = 'ok' and r.loc_hold then raise exception 'Stock in % (% location) can''t be released. Move it to a normal location first.', r.loc, r.loc_kind; end if;
    if p_status = 'ok' and r.auto_hold_expired and r.expiry_date is not null and r.expiry_date < public.uae_today() then
      raise exception 'Expired stock can''t be released (% in %, expired %)', coalesce(nullif(r.batch, ''), 'no batch'), r.loc, to_char(r.expiry_date, 'DD Mon YYYY');
    end if;
    update inventory set status = p_status, hold_reason = case when p_status = 'hold' then trim(p_reason) else '' end, updated_at = now(), updated_by = auth.uid() where id = r.id;
    insert into stock_moves (kind, client_id, item_id, inventory_id, from_loc, lpn, batch, expiry_date, qty, qty_before, qty_after, reason, user_id)
    values (case when p_status = 'hold' then 'hold' else 'release' end, r.client_id, r.item_id, r.id, r.loc, r.lpn, r.batch, r.expiry_date, r.qty, r.qty, r.qty, trim(p_reason), auth.uid());
    n := n + 1;
  end loop;
  return n;
end $$;

-- Adjust a stock quantity, or add stock found in a location (supervisors). A reason is required.
-- p: { inventory_id, qty (new quantity), reason, note }  or, to add:  { client, sku, location, lpn, batch, mfg_date, expiry_date, qty, reason, note }
create or replace function public.stock_adjust(p jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare s public.inventory; c public.clients; it public.items; l public.locations; v_new numeric := (p ->> 'qty')::numeric; v_reason text := trim(coalesce(p ->> 'reason', '')); n public.inventory;
begin
  if not public.is_staff() then raise exception 'Only supervisors can adjust stock' using errcode = '42501'; end if;
  if v_reason = '' then raise exception 'Choose a reason'; end if;
  if v_new is null or v_new < 0 then raise exception 'Enter the new quantity (0 or more)'; end if;
  if nullif(p ->> 'inventory_id', '') is not null then
    select * into s from inventory where id = (p ->> 'inventory_id')::bigint for update;
    if not found then raise exception 'This stock is no longer there. Refresh the page.'; end if;
    if v_new = s.qty then raise exception 'The quantity is unchanged'; end if;
    if v_new < s.allocated_qty + s.picked_qty then raise exception 'At least % is allocated or picked for orders', s.allocated_qty + s.picked_qty; end if;
    select * into l from locations where id = s.location_id;
    if v_new = 0 then delete from inventory where id = s.id;
    else update inventory set qty = v_new, updated_at = now(), updated_by = auth.uid() where id = s.id; end if;
    insert into stock_moves (kind, client_id, item_id, inventory_id, from_loc, lpn, batch, expiry_date, qty, qty_before, qty_after, reason, note, user_id)
    values ('adjust', s.client_id, s.item_id, s.id, l.code, s.lpn, s.batch, s.expiry_date, v_new - s.qty, s.qty, v_new, v_reason, trim(coalesce(p ->> 'note', '')), auth.uid());
    return jsonb_build_object('ok', true, 'inventory_id', s.id, 'qty', v_new);
  end if;
  -- found stock
  select * into c from clients where code = upper(trim(coalesce(p ->> 'client', '')));
  if not found then raise exception 'Choose the client'; end if;
  select * into it from items where client_id = c.id and sku = upper(trim(coalesce(p ->> 'sku', '')));
  if not found then raise exception 'SKU % isn''t in the item master for %', upper(trim(coalesce(p ->> 'sku', ''))), c.code; end if;
  select * into l from locations where code = upper(trim(coalesce(p ->> 'location', '')));
  if not found then raise exception 'Location % doesn''t exist', upper(trim(coalesce(p ->> 'location', ''))); end if;
  if v_new <= 0 then raise exception 'Enter a quantity above 0'; end if;
  if c.track_batch = 'required' and nullif(trim(coalesce(p ->> 'batch', '')), '') is null then raise exception '% is required for %', c.batch_label, c.code; end if;
  if c.track_expiry = 'required' and nullif(p ->> 'expiry_date', '') is null then raise exception 'The expiry date is required for %', c.code; end if;
  insert into inventory (client_id, item_id, location_id, lpn, batch, mfg_date, expiry_date, received_at, qty, status, hold_reason, updated_by)
  values (c.id, it.id, l.id, trim(coalesce(p ->> 'lpn', '')), trim(coalesce(p ->> 'batch', '')), nullif(p ->> 'mfg_date', '')::date, nullif(p ->> 'expiry_date', '')::date, now(), v_new,
          case when l.hold then 'hold' else 'ok' end, case when l.hold then 'In ' || l.code else '' end, auth.uid())
  returning * into n;
  insert into stock_moves (kind, client_id, item_id, inventory_id, to_loc, lpn, batch, expiry_date, qty, qty_before, qty_after, reason, note, user_id)
  values ('adjust', c.id, it.id, n.id, l.code, n.lpn, n.batch, n.expiry_date, v_new, 0, v_new, v_reason, trim(coalesce(p ->> 'note', '')), auth.uid());
  return jsonb_build_object('ok', true, 'inventory_id', n.id, 'qty', v_new);
end $$;

revoke all on function public.stock_hold_expired(), public.stock_import_finish(uuid), public.stock_lookup(text), public.stock_move(bigint, text, numeric, text, uuid, text),
  public.stock_set_status(bigint[], text, text), public.stock_adjust(jsonb) from public, anon;
grant execute on function public.stock_hold_expired(), public.stock_import_finish(uuid), public.stock_lookup(text), public.stock_move(bigint, text, numeric, text, uuid, text),
  public.stock_set_status(bigint[], text, text), public.stock_adjust(jsonb), public.uae_today(), public.guess_location_kind(text) to authenticated;

-- Totals for the stock page (all clients, or one client code)
create or replace function public.stock_summary(p_client text default null)
returns jsonb language sql stable security definer set search_path = public as $$
  select case when public.my_role() is null then null else jsonb_build_object(
    'rows', count(*), 'qty', coalesce(sum(qty), 0), 'available', coalesce(sum(available_qty), 0),
    'allocated', coalesce(sum(allocated_qty), 0), 'picked', coalesce(sum(picked_qty), 0),
    'hold_qty', coalesce(sum(qty) filter (where status = 'hold' or location_hold), 0), 'hold_rows', count(*) filter (where status = 'hold' or location_hold),
    'expired_rows', count(*) filter (where expiry_state = 'expired'), 'expired_qty', coalesce(sum(qty) filter (where expiry_state = 'expired'), 0),
    'near_rows', count(*) filter (where expiry_state = 'near'), 'near_qty', coalesce(sum(qty) filter (where expiry_state = 'near'), 0),
    'items', count(distinct item_id), 'locations', count(distinct location_id), 'clients', count(distinct client_id)) end
  from public.inventory_v where p_client is null or p_client = '' or client_code = upper(p_client)
$$;
revoke all on function public.stock_summary(text) from public, anon;
grant execute on function public.stock_summary(text) to authenticated;
