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
       coalesce(sum(abs(l.counted_qty - l.system_qty) * l.unit_cost) filter (where l.counted_qty is not null), 0) as abs_value
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
-- p_entries: [{ "line_id": 123, "qty": 10, "client_id": "uuid", "client_ts": "2026-09-30T10:00:00Z" }, ...]
create or replace function public.submit_counts(p_session uuid, p_entries jsonb, p_device text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e jsonb; v_line public.count_lines; v_saved int := 0; v_dupes int := 0; v_skipped int := 0; v_qty numeric; v_cid uuid;
begin
  if public.my_role() is null then raise exception 'Your user is not active' using errcode = '42501'; end if;
  if not exists (select 1 from count_sessions where id = p_session and status = 'open') then
    raise exception 'This count is not open for counting' using errcode = 'P0001';
  end if;
  for e in select * from jsonb_array_elements(p_entries) loop
    v_cid := nullif(e ->> 'client_id', '')::uuid;
    if v_cid is not null and exists (select 1 from count_events where client_id = v_cid) then v_dupes := v_dupes + 1; continue; end if;
    v_qty := (e ->> 'qty')::numeric;
    if v_qty is null or v_qty < 0 then v_skipped := v_skipped + 1; continue; end if;
    select * into v_line from count_lines where id = (e ->> 'line_id')::bigint and session_id = p_session for update;
    if not found then v_skipped := v_skipped + 1; continue; end if;
    update count_lines set counted_qty = v_qty, counted_by = auth.uid(),
           counted_at = coalesce((e ->> 'client_ts')::timestamptz, now()),
           count_round = count_round + 1, recount_requested = false, accepted = false, accepted_by = null, accepted_at = null
     where id = v_line.id;
    insert into count_events (session_id, line_id, event, qty, prev_qty, device, client_id, client_ts)
    values (p_session, v_line.id, 'count', v_qty, v_line.counted_qty, p_device, v_cid, (e ->> 'client_ts')::timestamptz);
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
  update count_lines set counted_qty = null, counted_by = null, counted_at = null, recount_requested = true, accepted = false, accepted_by = null, accepted_at = null
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
       st.lines_accepted, st.lines_recount, st.found_lines, st.net_units, st.net_value, st.abs_value
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
select e.*, p.full_name as user_name, l.location, l.sku
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
               lines_total bigint, lines_counted bigint, locations_total bigint, locations_open bigint)
language sql stable security definer set search_path = public as $$
  select s.id, s.name, s.site, s.zone, s.tolerance_pct, s.blind, s.confirm_location,
         s.rack_grouping, s.excess_batch, s.excess_mfg, s.excess_expiry,
         st.lines_total, st.lines_counted, st.locations_total, st.locations_open
  from count_sessions s join session_stats st on st.session_id = s.id
  where s.status = 'open' and public.my_role() is not null
  order by s.opened_at desc nulls last
$$;

-- Lines for counting. Page with p_after_id (the last id you received); pass p_since to fetch only changes.
drop function if exists public.mobile_lines(uuid, timestamptz, int, int);
drop function if exists public.mobile_lines(uuid, timestamptz, bigint, int);
create or replace function public.mobile_lines(p_session uuid, p_since timestamptz default null, p_after_id bigint default 0, p_limit int default 1000)
returns table (id bigint, seq int, location text, sku text, barcode text, batch text, description text, uom text, units_per_case numeric, system_qty numeric,
               counted_qty numeric, counted_by_name text, counted_at timestamptz, recount_requested boolean, is_found boolean, updated_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare v_role app_role := public.my_role(); v_show_sys boolean;
begin
  if v_role is null then return; end if;
  select (not s.blind) or v_role in ('admin', 'supervisor') into v_show_sys
    from count_sessions s where s.id = p_session and (s.status = 'open' or v_role in ('admin', 'supervisor'));
  if v_show_sys is null then return; end if;
  return query
  select l.id, l.seq, l.location, l.sku, l.barcode, l.batch, l.description, l.uom, l.units_per_case,
         case when v_show_sys then l.system_qty end,
         l.counted_qty, p.full_name, l.counted_at, l.recount_requested, l.is_found, l.updated_at
  from count_lines l
  left join profiles p on p.id = l.counted_by
  where l.session_id = p_session and l.id > coalesce(p_after_id, 0)
    and (p_since is null or l.updated_at > p_since)
  order by l.id
  limit least(greatest(p_limit, 1), 1000);
end $$;

create or replace function public.whoami()
returns table (id uuid, full_name text, email text, role app_role, site text, active boolean)
language sql stable security definer set search_path = public as $$
  select id, full_name, email, role, site, active from profiles where id = auth.uid()
$$;

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
