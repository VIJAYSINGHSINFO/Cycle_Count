/* Demo mode: an in-memory stand-in for the Supabase database, used for previews and training.
   It turns on automatically when config.js still has the placeholder URL, or when CONFIG.DEMO is true.
   Nothing is saved; reloading the page resets the sample data. */
(() => {
"use strict";
const onReady = f => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", f) : setTimeout(f);
const C = window.CONFIG || (window.CONFIG = {});
if (!C.DEMO) return;
C.DEMO = true;

const host = (() => { try { if (window.parent && window.parent !== window && window.parent.__CC_DEMO) return window.parent; } catch {} return window; })();
const store = host.__CC_DEMO_STORE || (host.__CC_DEMO_STORE = seed());

function seed() {
  let clock = Date.parse("2026-09-30T06:00:00Z");
  const now = () => new Date(clock += 1000).toISOString();
  const users = [
    {id: "u-admin", full_name: "Sara Ahmed", email: "sara@demo.local", role: "admin", site: "DXB Warehouse", active: true},
    {id: "u-sup", full_name: "Omar Khalid", email: "omar@demo.local", role: "supervisor", site: "DXB Warehouse", active: true},
    {id: "u-ali", full_name: "Ali Hassan", email: "ali@demo.local", role: "counter", site: "DXB Warehouse", active: true},
    {id: "u-priya", full_name: "Priya Nair", email: "priya@demo.local", role: "counter", site: "DXB Warehouse", active: true},
    {id: "u-new", full_name: "Yusuf Rahman", email: "yusuf@demo.local", role: "counter", site: "", active: false}
  ].map(u => ({...u, created_at: "2026-09-01T08:00:00Z"}));
  const products = [
    ["FMC-10231", "6291041500213", "Basmati rice 5 kg", "BAG", 38.5], ["FMC-10877", "6291003001452", "Sunflower oil 1.8 L", "BTL", 14.25],
    ["FMC-20411", "6294003570021", "Laundry detergent 3 kg", "BOX", 29.9], ["FMC-20566", "6291100250437", "Dishwashing liquid 1 L", "BTL", 7.8],
    ["PHC-30112", "6297000331189", "Paracetamol 500 mg, 24 tabs", "PK", 6.5], ["PHC-30458", "6297000331523", "Hand sanitiser 500 ml", "BTL", 11.0],
    ["FMC-40090", "6291056300098", "Medjool dates 1 kg", "BOX", 42.0], ["FMC-40317", "6291056300715", "Natural honey 500 g", "JAR", 24.75],
    ["PHC-50221", "6297001102290", "Baby wipes, 80 pcs", "PK", 9.4], ["FMC-60118", "6291018000186", "Mineral water 1.5 L x 6", "PK", 8.2],
    ["PHC-70503", "6297002205031", "Toothpaste 100 ml", "TUBE", 5.9], ["FMC-80044", "6291071800447", "Green tea, 100 bags", "BOX", 16.3]
  ];
  const sessions = [
    {id: "s-open", name: "Weekly cycle count, Aisle A01", site: "DXB Warehouse", zone: "Aisle A01", tolerance_pct: 2, blind: true, confirm_location: true, rack_grouping: "last_segment", excess_batch: "optional", excess_mfg: "optional", excess_expiry: "required", status: "open", source_file: "WMS_onhand_A01_2026-09-30.xlsx", created_by: "u-sup", created_at: "2026-09-30T05:30:00Z", opened_at: "2026-09-30T06:00:00Z", closed_at: null, closed_by: null},
    {id: "s-rec", name: "Cycle count, Aisle B02", site: "DXB Warehouse", zone: "Aisle B02", tolerance_pct: 2, blind: true, confirm_location: true, rack_grouping: "last_segment", excess_batch: "optional", excess_mfg: "optional", excess_expiry: "required", status: "reconciled", source_file: "WMS_onhand_B02_2026-09-16.xlsx", created_by: "u-sup", created_at: "2026-09-16T05:00:00Z", opened_at: "2026-09-16T05:30:00Z", closed_at: "2026-09-16T13:10:00Z", closed_by: "u-sup"},
    {id: "s-draft", name: "Cold room, monthly count", site: "DXB Warehouse", zone: "Cold room", tolerance_pct: 1, blind: true, confirm_location: true, rack_grouping: "none", excess_batch: "required", excess_mfg: "required", excess_expiry: "required", status: "draft", source_file: null, created_by: "u-admin", created_at: "2026-09-29T10:00:00Z", opened_at: null, closed_at: null, closed_by: null}
  ];
  const lines = []; let id = 0, seq = 0;
  const exp = k => `202${7 + (k % 2)}-${String(1 + (k * 5) % 12).padStart(2, "0")}-${String(1 + (k * 7) % 27).padStart(2, "0")}`;
  const add = (sid, loc, p, batch, sys, extra = {}) => lines.push({id: ++id, session_id: sid, seq: ++seq, location: loc, sku: p[0], barcode: p[1], batch, mfg_date: null, expiry_date: exp(id), description: p[2], uom: p[3], system_qty: sys, unit_cost: p[4], counted_qty: null, counted_by: null, counted_at: null, count_round: 0, recount_requested: false, accepted: false, accepted_by: null, accepted_at: null, is_found: false, expected_location: null, remarks: null, updated_at: now(), ...extra});
  let k = 0;
  for (let bay = 1; bay <= 8; bay++) for (const lv of ["A", "B", "C"]) {
    const loc = `A01-${String(bay).padStart(2, "0")}-${lv}`, n = 1 + ((bay + lv.charCodeAt(0)) % 3);
    for (let j = 0; j < n; j++) { const p = products[(k++ * 5 + bay) % products.length]; add("s-open", loc, p, `B${26000 + k * 37}`, 6 + (k * 13) % 48); }
    if (bay === 2 && lv === "B") { const p = products[4]; add("s-open", loc, p, "B26902", 10); add("s-open", loc, p, "B27115", 14); }
  }
  // part of the zone already counted by Priya this morning
  lines.filter(l => l.session_id === "s-open" && /^A01-0[67]-/.test(l.location)).forEach((l, i) => Object.assign(l, {counted_qty: i % 4 === 1 ? l.system_qty - 3 : i % 5 === 2 ? l.system_qty + 1 : l.system_qty, counted_by: "u-priya", counted_at: "2026-09-30T06:40:00Z", count_round: 1, updated_at: now()}));
  // last month's reconciled count
  for (let bay = 1; bay <= 6; bay++) for (const lv of ["A", "B"]) { const p = products[(bay * 3 + lv.charCodeAt(0)) % products.length]; add("s-rec", `B02-0${bay}-${lv}`, p, `B25${bay}${lv.charCodeAt(0)}`, 20 + bay, {counted_qty: 20 + bay - (bay === 3 ? 2 : 0), counted_by: "u-ali", counted_at: "2026-09-16T09:00:00Z", count_round: 1, accepted: bay === 3, accepted_by: bay === 3 ? "u-sup" : null}); }
  const events = [{id: 1, session_id: "s-open", line_id: null, event: "import", qty: lines.filter(l => l.session_id === "s-open").length, prev_qty: null, note: "WMS_onhand_A01_2026-09-30.xlsx", user_id: "u-sup", device: null, client_id: null, created_at: "2026-09-30T05:31:00Z"},
                  {id: 2, session_id: "s-open", line_id: null, event: "status", note: "draft -> open", user_id: "u-sup", created_at: "2026-09-30T06:00:00Z"}];
  const reconciliations = [{id: "r1", session_id: "s-rec", lines_total: 12, lines_counted: 12, lines_within: 11, lines_out: 0, lines_accepted: 2, found_lines: 0, accuracy_pct: 91.67, net_units: -4, net_value: -118.4, abs_value: 118.4, wms_reference: "ADJ-2026-0917", notes: "Two bays short on paracetamol; damaged cartons written off.", approved_by: "u-sup", approved_at: "2026-09-16T14:02:00Z"}];
  const presence = {"walk-s-open": {"u-priya:demo": [{loc: "A01-04-A", name: "Priya Nair"}]}};
  return {users, sessions, lines, events, reconciliations, presence, id, evId: 10, clock, channels: [], sessionFor: {}};
}

/* ---------- derived views ---------- */
const S = store;
const tick = () => new Date(S.clock = Math.max(S.clock + 1000, Date.now())).toISOString();
const uname = id => (S.users.find(u => u.id === id) || {}).full_name || null;
function lineStatus(l, tol) {
  if (l.counted_qty == null) return l.recount_requested ? "recount" : "uncounted";
  if (+l.counted_qty === +l.system_qty) return "match";
  const pct = +l.system_qty === 0 ? 100 : Math.abs(l.counted_qty - l.system_qty) / Math.abs(l.system_qty) * 100;
  if (pct <= tol) return "within";
  return l.accepted ? "accepted" : "out";
}
function stats(s) {
  const L = S.lines.filter(l => l.session_id === s.id), tol = +s.tolerance_pct, c = L.filter(l => l.counted_qty != null);
  const st = L.map(l => lineStatus(l, tol)), locs = new Set(L.map(l => l.location)), open = new Set(L.filter(l => l.counted_qty == null).map(l => l.location));
  return {lines_total: L.length, lines_counted: c.length, locations_total: locs.size, locations_open: open.size,
    lines_within: st.filter(x => x === "match" || x === "within").length, lines_out: st.filter(x => x === "out").length,
    lines_accepted: L.filter(l => l.accepted && l.counted_qty != null).length, lines_recount: st.filter(x => x === "recount").length,
    found_lines: L.filter(l => l.is_found).length, net_units: c.reduce((a, l) => a + (l.counted_qty - l.system_qty), 0),
    net_value: c.reduce((a, l) => a + (l.counted_qty - l.system_qty) * l.unit_cost, 0), abs_value: c.reduce((a, l) => a + Math.abs(l.counted_qty - l.system_qty) * l.unit_cost, 0)};
}
const views = {
  profiles: () => S.users,
  count_sessions: () => S.sessions,
  count_lines: () => S.lines,
  session_list: () => S.sessions.map(s => ({...s, ...stats(s), created_by_name: uname(s.created_by), closed_by_name: uname(s.closed_by)})),
  count_lines_v: () => S.lines.map(l => { const s = S.sessions.find(x => x.id === l.session_id), v = l.counted_qty == null ? null : l.counted_qty - l.system_qty;
    return {...l, status: lineStatus(l, +s.tolerance_pct), variance: v, variance_pct: v == null ? null : +l.system_qty === 0 ? (l.counted_qty ? 100 : 0) : Math.round(v / Math.abs(l.system_qty) * 10000) / 100,
      variance_value: v == null ? null : v * l.unit_cost, sort_weight: Math.abs(v || 0) * Math.max(l.unit_cost, 0.0001), counted_by_name: uname(l.counted_by), session_name: s.name, session_site: s.site, session_status: s.status, session_created_at: s.created_at}; }),
  reconciliation_list: () => S.reconciliations.map(r => { const s = S.sessions.find(x => x.id === r.session_id); return {...r, session_name: s.name, site: s.site, zone: s.zone, source_file: s.source_file, session_created_at: s.created_at, closed_at: s.closed_at, approved_by_name: uname(r.approved_by)}; }),
  event_list: () => S.events.map(e => { const l = S.lines.find(x => x.id === e.line_id); return {...e, user_name: uname(e.user_id), location: l ? l.location : null, sku: l ? l.sku : null}; })
};

/* ---------- query builder (the small part of supabase-js the apps use) ---------- */
const reEsc = c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const like = p => { const t = String(p); let out = ""; for (let i = 0; i < t.length; i++) { const c = t[i]; if (c === "\\" && i + 1 < t.length) out += reEsc(t[++i]); else if (c === "%") out += ".*"; else if (c === "_") out += "."; else out += reEsc(c); } return new RegExp("^" + out + "$", "i"); };
function builder(table, me) {
  const st = {filters: [], order: [], range: null, limit: null, single: false, count: false, op: "select", payload: null, returning: false};
  const api = {
    select(cols, opts) { if (st.op === "select") st.op = "select"; else st.returning = true; if (opts && opts.count) st.count = true; return api; },
    insert(rows) { st.op = "insert"; st.payload = Array.isArray(rows) ? rows : [rows]; return api; },
    update(p) { st.op = "update"; st.payload = p; return api; },
    delete() { st.op = "delete"; return api; },
    eq(c, v) { st.filters.push(r => r[c] === v); return api; },
    neq(c, v) { st.filters.push(r => r[c] !== v); return api; },
    in(c, vs) { st.filters.push(r => vs.includes(r[c])); return api; },
    is(c, v) { st.filters.push(r => v === null ? r[c] == null : r[c] === v); return api; },
    not(c, op, v) { st.filters.push(r => op === "is" && v === null ? r[c] != null : r[c] !== v); return api; },
    ilike(c, p) { const re = like(p); st.filters.push(r => re.test(String(r[c] ?? ""))); return api; },
    or(expr) { const parts = expr.split(",").map(x => { const [c, op, ...rest] = x.split("."); const re = like(rest.join(".")); return r => op === "ilike" && re.test(String(r[c] ?? "")); }); st.filters.push(r => parts.some(f => f(r))); return api; },
    order(c, o) { st.order.push([c, !o || o.ascending !== false]); return api; },
    range(a, b) { st.range = [a, b]; return api; },
    limit(n) { st.limit = n; return api; },
    single() { st.single = true; return api; },
    then(res, rej) { return Promise.resolve().then(run).then(res, rej); }
  };
  function run() {
    const staff = me && ["admin", "supervisor"].includes(me.role) && me.active;
    if (!me) return {data: null, error: {message: "Not signed in", code: "42501"}, count: null};
    if (st.op === "insert") {
      if (!staff) return {data: null, error: {message: "Permission denied", code: "42501"}};
      const out = st.payload.map(r => {
        if (table === "count_sessions") { const s = {id: "s-" + Math.random().toString(36).slice(2, 8), site: "", zone: "", tolerance_pct: 2, blind: true, confirm_location: true, rack_grouping: "last_segment", excess_batch: "optional", excess_mfg: "optional", excess_expiry: "required", status: "draft", source_file: null, created_by: me.id, created_at: tick(), opened_at: null, closed_at: null, closed_by: null, ...r}; S.sessions.push(s); return s; }
        if (table === "count_lines") { const l = {id: ++S.id, barcode: "", batch: "", units_per_case: 1, mfg_date: null, expiry_date: null, description: "", uom: "", unit_cost: 0, counted_qty: null, counted_by: null, counted_at: null, count_round: 0, recount_requested: false, accepted: false, accepted_by: null, accepted_at: null, is_found: false, expected_location: null, remarks: null, updated_at: tick(), ...r}; S.lines.push(l); return l; }
        return r;
      });
      return {data: st.single ? out[0] : st.returning ? out : null, error: null};
    }
    const src = st.op === "select" ? (views[table] ? views[table]() : []) : (table === "count_sessions" ? S.sessions : table === "count_lines" ? S.lines : table === "profiles" ? S.users : []);
    let rows = src.filter(r => st.filters.every(f => f(r)));
    if (st.op === "update") { if (!staff && table !== "profiles") return {data: null, error: {message: "Permission denied", code: "42501"}}; rows.forEach(r => Object.assign(r, st.payload, table === "count_lines" ? {updated_at: tick()} : {})); return {data: null, error: null}; }
    if (st.op === "delete") {
      if (!staff) return {data: null, error: {message: "Permission denied", code: "42501"}};
      const ids = new Set(rows.map(r => r.id));
      if (table === "count_lines") S.lines = S.lines.filter(r => !ids.has(r.id));
      if (table === "count_sessions") { S.sessions = S.sessions.filter(r => !ids.has(r.id)); S.lines = S.lines.filter(l => !ids.has(l.session_id)); }
      return {data: null, error: null};
    }
    const total = rows.length;
    if (st.order.length) rows = rows.slice().sort((a, b) => { for (const [c, asc] of st.order) { const x = a[c], y = b[c]; if (x === y) continue; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : 1) * (asc ? 1 : -1); } return 0; });
    if (st.range) rows = rows.slice(st.range[0], st.range[1] + 1);
    if (st.limit) rows = rows.slice(0, st.limit);
    rows = rows.map(r => ({...r}));
    if (st.single) return rows.length ? {data: rows[0], error: null} : {data: null, error: {message: "Not found", code: "PGRST116"}};
    return {data: rows, error: null, count: st.count ? total : null};
  }
  return api;
}

/* ---------- server functions ---------- */
const E = m => ({data: null, error: {message: m, code: "P0001"}});
function rpc(name, a, me) {
  const staff = me && ["admin", "supervisor"].includes(me.role) && me.active;
  const sess = id => S.sessions.find(s => s.id === id);
  const ev = (sid, line_id, event, extra = {}) => S.events.push({id: (S.evPrefix || "") + (++S.evId), session_id: sid, line_id, event, user_id: me.id, created_at: tick(), ...extra});
  switch (name) {
    case "whoami": return {data: me ? [me] : [], error: null};
    case "mobile_sessions": if (!me || !me.active) return {data: [], error: null};
      return {data: S.sessions.filter(s => s.status === "open").map(s => ({...s, ...stats(s)})), error: null};
    case "mobile_lines": {
      const s = sess(a.p_session); if (!me || !me.active || !s || (s.status !== "open" && !staff)) return {data: [], error: null};
      const show = !s.blind || staff;
      const rows = S.lines.filter(l => l.session_id === s.id && l.id > (a.p_after_id || 0) && (!a.p_since || l.updated_at > a.p_since)).sort((x, y) => x.id - y.id).slice(0, a.p_limit || 1000)
        .map(l => ({id: l.id, seq: l.seq, location: l.location, sku: l.sku, barcode: l.barcode, batch: l.batch, description: l.description, uom: l.uom, units_per_case: l.units_per_case || 1, system_qty: show ? l.system_qty : null, counted_qty: l.counted_qty, counted_by_name: uname(l.counted_by), counted_at: l.counted_at, recount_requested: l.recount_requested, is_found: l.is_found, updated_at: l.updated_at}));
      return {data: rows, error: null};
    }
    case "submit_counts": {
      const s = sess(a.p_session); if (!s || s.status !== "open") return E("This count is not open for counting");
      let saved = 0, dup = 0;
      for (const e of a.p_entries) { if (e.client_id && S.events.some(x => x.client_id === e.client_id)) { dup++; continue; } const l = S.lines.find(x => x.id === e.line_id && x.session_id === s.id); if (!l) continue;
        ev(s.id, l.id, "count", {qty: e.qty, prev_qty: l.counted_qty, device: a.p_device, client_id: e.client_id});
        Object.assign(l, {counted_qty: +e.qty, counted_by: me.id, counted_at: e.client_ts || tick(), count_round: l.count_round + 1, recount_requested: false, accepted: false, updated_at: tick()}); saved++; }
      return {data: {saved, duplicates: dup, skipped: 0}, error: null};
    }
    case "add_excess": {
      const s = sess(a.p_session); if (!s || s.status !== "open") return E("This count is not open for counting");
      if (a.p_client_id && S.events.some(x => x.client_id === a.p_client_id)) return {data: S.events.find(x => x.client_id === a.p_client_id).line_id, error: null};
      if (s.excess_expiry === "required" && !a.p_expiry_date) return E("Expiry date is required for excess stock");
      if (s.excess_batch === "required" && !a.p_batch) return E("Batch number is required for excess stock");
      if (s.excess_mfg === "required" && !a.p_mfg_date) return E("Manufacturing date is required for excess stock");
      const U = x => String(x || "").toUpperCase();
      let l = S.lines.find(x => x.session_id === s.id && U(x.location) === U(a.p_location) && U(x.sku) === U(a.p_sku) && U(x.batch) === U(a.p_batch));
      const prev = l ? l.counted_qty : null;
      if (!l) { l = {id: S.nextExcessId ? S.nextExcessId() : ++S.id, session_id: s.id, seq: Math.max(0, ...S.lines.filter(x => x.session_id === s.id).map(x => x.seq)) + 1, location: a.p_location, sku: a.p_sku, barcode: a.p_barcode || "", batch: a.p_batch || "", mfg_date: a.p_mfg_date, expiry_date: a.p_expiry_date, description: a.p_description || "", uom: a.p_uom || "", system_qty: 0, unit_cost: 0, count_round: 0, recount_requested: false, accepted: false, is_found: true, expected_location: a.p_expected_location, remarks: a.p_remarks}; S.lines.push(l); }
      Object.assign(l, {counted_qty: +a.p_qty, counted_by: me.id, counted_at: tick(), count_round: l.count_round + 1, updated_at: tick()});
      ev(s.id, l.id, "found", {qty: a.p_qty, prev_qty: prev, device: a.p_device, client_id: a.p_client_id, note: a.p_expected_location});
      return {data: l.id, error: null};
    }
    case "request_recount": { if (!staff) return E("Only supervisors can request recounts"); let n = 0;
      S.lines.filter(l => l.session_id === a.p_session && a.p_line_ids.includes(l.id) && l.counted_qty != null).forEach(l => { ev(a.p_session, l.id, "recount_request", {prev_qty: l.counted_qty}); Object.assign(l, {counted_qty: null, counted_by: null, counted_at: null, recount_requested: true, accepted: false, updated_at: tick()}); n++; });
      return {data: n, error: null}; }
    case "set_accepted": { if (!staff) return E("Only supervisors can accept variances"); let n = 0;
      S.lines.filter(l => l.session_id === a.p_session && a.p_line_ids.includes(l.id) && l.counted_qty != null).forEach(l => { Object.assign(l, {accepted: a.p_accepted, accepted_by: a.p_accepted ? me.id : null, updated_at: tick()}); ev(a.p_session, l.id, a.p_accepted ? "accept" : "unaccept"); n++; });
      return {data: n, error: null}; }
    case "finish_import": { const s = sess(a.p_session), L = S.lines.filter(l => l.session_id === s.id); s.source_file = a.p_source_file; ev(s.id, null, "import", {qty: L.length, note: a.p_source_file}); return {data: {lines: L.length, locations: new Set(L.map(l => l.location.toUpperCase())).size}, error: null}; }
    case "set_session_status": { const s = sess(a.p_session), cur = s.status, to = a.p_status;
      if (!((cur === "draft" && to === "open") || (cur === "open" && to === "closed") || (cur === "closed" && to === "open"))) return E(`A ${cur} count can't be changed to ${to}`);
      if (to === "open" && !S.lines.some(l => l.session_id === s.id)) return E("Upload lines before opening the count");
      Object.assign(s, {status: to, opened_at: s.opened_at || (to === "open" ? tick() : null), closed_at: to === "closed" ? tick() : null, closed_by: to === "closed" ? me.id : null}); ev(s.id, null, "status", {note: `${cur} -> ${to}`}); return {data: null, error: null}; }
    case "reconcile_session": { const s = sess(a.p_session); if (s.status !== "closed") return E("Close the count before reconciling it"); const t = stats(s);
      if (t.lines_out) return E(`${t.lines_out} lines are still out of tolerance. Recount or accept them first.`);
      S.reconciliations.push({id: "r" + (S.reconciliations.length + 1), session_id: s.id, ...t, accuracy_pct: t.lines_counted ? Math.round(t.lines_within / t.lines_counted * 10000) / 100 : null, wms_reference: a.p_wms_reference, notes: a.p_notes, approved_by: me.id, approved_at: tick()});
      s.status = "reconciled"; ev(s.id, null, "reconcile", {note: a.p_wms_reference}); return {data: "r", error: null}; }
  }
  return E("Unknown function " + name);
}

/* ---------- client ---------- */
function createClient() {
  const role = C.DEMO_ROLE || (window.CC_APP === "mobile" ? "counter" : "admin");
  const key = "as-" + role;
  if (!(key in S.sessionFor)) S.sessionFor[key] = role === "counter" ? "u-ali" : "u-admin";
  const listeners = [];
  const me = () => S.users.find(u => u.id === S.sessionFor[key]) || null;
  const session = () => me() ? {user: {id: me().id, email: me().email}} : null;
  const emit = ev => listeners.forEach(f => f(ev, session()));
  return {
    auth: {
      getSession: async () => ({data: {session: session()}}),
      onAuthStateChange: f => { listeners.push(f); return {data: {subscription: {unsubscribe() {}}}}; },
      signInWithPassword: async ({email}) => { const u = S.users.find(x => x.email.toLowerCase() === String(email).toLowerCase()); if (!u) return {error: {message: "Demo accounts: sara@, omar@, ali@ or priya@demo.local (any password)"}}; S.sessionFor[key] = u.id; setTimeout(() => emit("SIGNED_IN")); return {data: {session: session()}, error: null}; },
      signUp: async ({email, options}) => { const u = {id: "u-" + Date.now(), full_name: (options && options.data && options.data.full_name) || email.split("@")[0], email, role: "counter", site: "", active: false, created_at: tick()}; S.users.push(u); S.sessionFor[key] = u.id; setTimeout(() => emit("SIGNED_IN")); return {data: {session: session()}, error: null}; },
      signOut: async () => { S.sessionFor[key] = null; setTimeout(() => emit("SIGNED_OUT")); return {error: null}; }
    },
    from: t => builder(t, me()),
    rpc: async (n, a) => { await new Promise(r => setTimeout(r, 60)); if (host.__CC_DEMO_OFFLINE && role === "counter") return {data: null, error: {message: "Failed to fetch", code: ""}}; return rpc(n, a || {}, me()); },
    channel(name, opts) {
      const pkey = opts && opts.config && opts.config.presence && opts.config.presence.key || "anon";
      const ch = {name, cbs: [], on(type, filter, cb) { this.cbs.push(cb); return this; }, subscribe(cb) { S.channels.push(this); setTimeout(() => { cb && cb("SUBSCRIBED"); this.cbs.forEach(f => f()); }); return this; },
        async track(v) { (S.presence[name] || (S.presence[name] = {}))[pkey] = [v]; S.channels.filter(c => c.name === name).forEach(c => c.cbs.forEach(f => f())); },
        presenceState() { return S.presence[name] || {}; }};
      return ch;
    },
    removeChannel(ch) { S.channels = S.channels.filter(c => c !== ch); }
  };
}
window.supabase = {createClient};
window.__CC_DEMO_API = {store: S};
window.__ccOffline = () => !!host.__CC_DEMO_OFFLINE;
window.__ccSetOffline = v => { host.__CC_DEMO_OFFLINE = !!v; };
onReady(() => {
  if (host !== window || C.DEMO_BANNER === false) return;
  const b = document.createElement("div");
  b.innerHTML = "Demo mode: sample data. Nothing is saved, and reloading resets it." + (C.DEMO_FROM_DEVICE ? ' <a href="#" id="cc-exit-demo" style="color:inherit;margin-left:8px">Exit demo</a>' : "");
  b.addEventListener("click", e => { if (e.target.id === "cc-exit-demo") { e.preventDefault(); window.CC_resetConnection && window.CC_resetConnection(); } });
  b.style.cssText = "background:#F2A900;color:#161100;font:600 12px/1.2 system-ui,sans-serif;padding:5px 12px;text-align:center;position:relative;z-index:30";
  document.body.prepend(b);
});
})();

/* ---------- test scanner panel (mobile demo only) ---------- */
(() => {
if (!(window.CONFIG && window.CONFIG.DEMO) || window.CC_APP !== "mobile") return;
const onReady = f => document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", f) : setTimeout(f);
const h = (s) => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const css = `.tsx{position:fixed;z-index:40;background:var(--surface);color:var(--ink);border:1px solid var(--line);border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.18);font-size:.88rem}
.tsx h4{margin:0;font:700 1.1rem/1.1 var(--cond);display:flex;justify-content:space-between;align-items:center}
.tsx .sec{margin-top:12px}.tsx .sec b{display:block;font-size:.74rem;color:var(--muted);font-weight:600;margin-bottom:5px}
.tsx button.code{display:flex;justify-content:space-between;gap:8px;width:100%;text-align:left;border:1px solid var(--line);background:var(--surface-2);border-radius:6px;padding:7px 9px;margin-bottom:5px;cursor:pointer;color:var(--ink)}
.tsx button.code:hover{border-color:var(--ink)} .tsx button.code span{color:var(--muted);font-size:.78rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.tsx button.code.loc{background:var(--amber);color:var(--amber-ink);border-color:var(--amber);font:700 1rem/1 var(--cond)} .tsx button.code.loc span{color:var(--amber-ink)}
.tsx button.code.bad{border-left:4px solid var(--bad)} .tsx button.code.warn{border-left:4px solid var(--warn)}
.tsx-body{padding:14px;max-height:calc(100vh - 140px);overflow:auto}
@media (min-width:1100px){.tsx{left:16px;top:70px;width:300px}.tsx-toggle{display:none}}
@media (max-width:1099px){.tsx{left:10px;right:10px;bottom:calc(150px + env(safe-area-inset-bottom,0px));max-height:55vh;display:none}.tsx.open{display:block}.tsx-body{max-height:50vh}
 .tsx-toggle{position:fixed;right:12px;bottom:calc(140px + env(safe-area-inset-bottom,0px));z-index:41;background:var(--amber);color:var(--amber-ink);border:0;border-radius:99px;padding:8px 14px;font-weight:600;box-shadow:0 4px 14px rgba(0,0,0,.2)}}
@media (min-width:700px){.wrap,.dock{max-width:560px;margin-left:auto;margin-right:auto}.dock{left:0;right:0}}`;
const st = document.createElement("style"); st.textContent = css;
onReady(() => {
  document.head.appendChild(st);
  const p = document.createElement("aside"); p.className = "tsx"; p.setAttribute("aria-label", "Test scanner");
  const t = document.createElement("button"); t.className = "tsx-toggle"; t.textContent = "Test scanner"; t.onclick = () => p.classList.toggle("open");
  document.body.append(p, t);
  let last = "";
  const S = window.__CC_DEMO_API.store;
  function render() {
    const s = window.__demoState ? window.__demoState() : {};
    let body = `<h4>Test scanner <span class="small muted" style="font-family:var(--sans);font-weight:400">demo</span></h4><p class="small muted" style="margin:6px 0 0">Tap a label to scan it, the way a handheld scanner would.</p>`;
    if (!s.session) body += `<div class="sec"><b>START</b>Open the count "Weekly cycle count, Aisle A01".</div>`;
    else {
      const L = S.lines.filter(l => l.session_id === s.session), here = s.loc ? L.filter(l => l.location.toUpperCase() === s.loc.toUpperCase() && !l.is_found) : [];
      const codesHere = new Set(here.map(l => l.barcode)), rackCodes = new Set(L.filter(l => s.rack && l.location.toUpperCase().startsWith(s.rack)).map(l => l.barcode));
      const btn = (v, label, cls = "") => `<button class="code ${cls}" data-v="${h(v)}">${h(label)}<span>${h(v)}</span></button>`;
      if (s.phase === "arrive") {
        body += `<div class="sec"><b>LOCATION LABEL</b>${btn(s.loc, s.loc, "loc")}</div>`;
        const other = [...new Set(L.map(l => l.location))].filter(x => x !== s.loc).slice(3, 5);
        body += `<div class="sec"><b>WRONG LOCATION LABEL</b>${other.map(o => btn(o, o, "loc")).join("")}</div>`;
        if (here[0]) body += `<div class="sec"><b>PRODUCT (BEFORE SCANNING THE LOCATION)</b>${btn(here[0].barcode, here[0].sku, "bad")}</div>`;
      } else if (s.phase === "count") {
        const seen = new Set();
        body += `<div class="sec"><b>PRODUCTS ON THIS SHELF</b>${here.filter(l => !seen.has(l.barcode) && seen.add(l.barcode)).map(l => btn(l.barcode, `${l.sku} ${l.description}`)).join("") || '<span class="muted">None expected: try excess below.</span>'}</div>`;
        const same = L.find(l => s.rack && l.location.toUpperCase().startsWith(s.rack) && l.location !== s.loc && !codesHere.has(l.barcode));
        if (same) body += `<div class="sec"><b>PRODUCT FROM ANOTHER LEVEL OF THIS RACK</b>${btn(same.barcode, `${same.sku} (belongs to ${same.location})`, "warn")}</div>`;
        const far = L.find(l => !rackCodes.has(l.barcode));
        if (far) body += `<div class="sec"><b>PRODUCT FROM ANOTHER RACK</b>${btn(far.barcode, `${far.sku} (belongs to ${far.location})`, "bad")}</div>`;
        body += `<div class="sec"><b>PRODUCT NOT IN THE STOCK FILE</b>${btn("6291999000017", "Unknown barcode", "bad")}</div>`;
        if (s.session === "s-open") body += `<div class="sec"><b>TRY THIS</b><span class="small">A01-02-B has one product in three batches.</span>${btn("A01-02-B", "A01-02-B", "loc")}</div>`;
      } else if (s.phase === "batch") {
        const b = [...document.querySelectorAll('[data-act="pick-batch"]')].map(x => x.textContent);
        body += `<div class="sec"><b>BATCH LABELS</b>${b.map(x => `<button class="code" data-batch="${h(x)}">Batch ${h(x)}</button>`).join("")}<button class="code bad" data-batch="B99999">Batch B99999 (not expected)</button></div>`;
      } else if (s.phase === "qty") body += `<div class="sec"><b>NEXT</b>Type the quantity in the app and save.</div>`;
      else if (s.phase === "excess") body += `<div class="sec"><b>NEXT</b>Fill in the details. Expiry date is required for this count.</div>`;
      else body += `<div class="sec"><b>DONE</b>All locations are counted.</div>`;
    }
    body += `<div class="sec"><label class="check small"><input type="checkbox" id="tsx-off" ${window.__ccOffline() ? "checked" : ""}> Simulate no network</label><span class="small muted">Counts wait on the phone and sync when you untick it.</span></div>`;
    if (body !== last) { last = body; p.innerHTML = `<div class="tsx-body">${body}</div>`; }
  }
  p.addEventListener("click", e => {
    const b = e.target.closest("button.code"); if (!b) return;
    if (b.dataset.batch) { const i = document.getElementById("batchin"); if (i) { i.value = b.dataset.batch; i.dispatchEvent(new KeyboardEvent("keydown", {key: "Enter", bubbles: true})); } }
    else if (window.__demoScan) window.__demoScan(b.dataset.v);
    if (window.innerWidth < 1100) p.classList.remove("open");
  });
  p.addEventListener("change", e => { if (e.target.id === "tsx-off") { window.__ccSetOffline(e.target.checked); window.dispatchEvent(new Event(e.target.checked ? "offline" : "online")); } });
  setInterval(render, 500); render();
});
})();
