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
  company_name       text not null default 'Your company',
  pass_base_url      text not null default '',        -- web address of the gate pass page, e.g. https://you.github.io/stowra/pass/
  yard_alert_minutes int  not null default 120 check (yard_alert_minutes > 0),
  updated_at         timestamptz not null default now()
);
insert into public.org_settings (id) values (1) on conflict (id) do nothing;

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
  if p ->> 'purpose' = 'outbound' and cardinality(v_refs) = 0 then raise exception 'Enter at least one order number'; end if;
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
create or replace function public.gate_step(p_code text, p_step text, p_dock uuid default null, p_seal text default null, p_device text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v public.gate_visits; d public.docks; v_busy text;
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
    update gate_visits set status = 'at_dock', dock_id = d.id, dock_in_at = now(), dock_in_by = auth.uid() where id = v.id returning * into v;
    insert into gate_events (visit_id, event, dock_id, device) values (v.id, 'dock_in', d.id, p_device);
  elsif p_step = 'dock_out' then
    if public.my_job() = 'security' and not public.is_staff() then raise exception 'Dock out is done by the warehouse team'; end if;
    if v.status <> 'at_dock' then raise exception 'Vehicle % is not at a dock', v.vehicle_plate; end if;
    if v.purpose = 'outbound' and nullif(trim(coalesce(p_seal, '')), '') is null then raise exception 'Enter the seal number applied to the vehicle'; end if;
    update gate_visits set status = 'dock_done', dock_out_at = now(), dock_out_by = auth.uid(), seal_out = nullif(trim(coalesce(p_seal, '')), '') where id = v.id returning * into v;
    insert into gate_events (visit_id, event, dock_id, note, device) values (v.id, 'dock_out', v.dock_id, case when v.seal_out is not null then 'Seal ' || v.seal_out end, p_device);
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

drop view if exists public.gate_visit_list;
create view public.gate_visit_list with (security_invoker = true) as
select v.*, s.name as site_name, d.name as dock_name,
       gi.full_name as gate_in_name, di.full_name as dock_in_name, do_.full_name as dock_out_name, go.full_name as gate_out_name,
       round(extract(epoch from (coalesce(v.dock_in_at, v.gate_out_at, now()) - v.gate_in_at)) / 60) as wait_minutes,
       round(extract(epoch from (coalesce(v.dock_out_at, now()) - v.dock_in_at)) / 60)              as dock_minutes,
       round(extract(epoch from (coalesce(v.gate_out_at, now()) - v.gate_in_at)) / 60)              as total_minutes
from public.gate_visits v
join public.sites s on s.id = v.site_id
left join public.docks d on d.id = v.dock_id
left join public.profiles gi on gi.id = v.gate_in_by
left join public.profiles di on di.id = v.dock_in_by
left join public.profiles do_ on do_.id = v.dock_out_by
left join public.profiles go on go.id = v.gate_out_by;
grant select on public.gate_visit_list to authenticated;

revoke all on function public.gate_in(jsonb, text), public.gate_step(text, text, uuid, text, text), public.gate_cancel(uuid, text), public.my_job() from public, anon;
grant execute on function public.gate_in(jsonb, text), public.gate_step(text, text, uuid, text, text), public.gate_cancel(uuid, text), public.my_job() to authenticated;
