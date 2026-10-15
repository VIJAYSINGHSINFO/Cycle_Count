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
  // two variances at A01-07 sent back for recount (Priya counted them first)
  let evn = 2;
  lines.filter(l => l.session_id === "s-open" && /^A01-07-/.test(l.location) && l.counted_qty != null && l.counted_qty !== l.system_qty).slice(0, 2).forEach(l => {
    events.push({id: ++evn, session_id: "s-open", line_id: l.id, event: "recount_request", prev_qty: l.counted_qty, user_id: "u-sup", created_at: "2026-09-30T08:10:00Z"});
    Object.assign(l, {first_counted_by: l.counted_by, counted_qty: null, counted_by: null, counted_at: null, recount_requested: true}); });
  lines.forEach(l => { l.damaged_qty = l.damaged_qty || 0; l.damage_photos = l.damage_photos || []; });
  sessions.forEach(x => { x.recount_other = false; x.recheck_pct = 5; });
  const presence = {"walk-s-open": {"u-priya:demo": [{loc: "A01-04-A", name: "Priya Nair"}]}};
  return {users, sessions, lines, events, reconciliations, presence, id, evId: 10, clock, channels: [], sessionFor: {}, photos: {}};
}

/* ---------- derived views ---------- */
const S = store;
const tick = () => new Date(S.clock = Math.max(S.clock + 1000, Date.now())).toISOString();
const uname = id => (S.users.find(u => u.id === id) || {}).full_name || null;

/* ---------- Order QC (demo) ---------- */
if (!S.qcOrders) seedQc(S);
/* ---------- Gate pass (demo) ---------- */
if (!S.gateVisits) seedGate(S);
/* ---------- Checklists (demo) ---------- */
if (!S.ckTemplates) seedCk(S);
function seedCk(S) {
  const t = (id, name, purpose, stage, items) => ({id, name, kind: "vehicle", purpose, stage, storer: "", items, active: true, version: 1, updated_at: "2026-10-01T06:00:00Z", updated_by: "u-admin"});
  const yn = (id, text, o = {}) => ({id, text, type: "yesno", ...o});
  S.ckTemplates = [
    t("ckt-ib", "Inbound: before unloading", "inbound", "before", [yn("i1", "Seal number matches the delivery documents", {critical: true, photo_on_no: true}), yn("i2", "Seal intact, not broken or tampered", {critical: true, photo_on_no: true}),
      yn("i3", "Delivery documents received (delivery note, packing list)", {critical: true}), yn("i4", "Vehicle body free of holes, leaks and damage", {photo_on_no: true}), yn("i5", "Cargo free of visible damage when doors opened", {photo_on_no: true}),
      yn("i6", "No pests, bad smell or contamination", {critical: true, photo_on_no: true}), {id: "i7", text: "Reefer temperature", type: "number", unit: "°C", na: true}, yn("i8", "Engine off, keys handed over", {critical: true}),
      yn("i9", "Wheel chocks in place", {critical: true}), yn("i10", "Dock leveller positioned safely", {critical: true})]),
    t("ckt-ia", "Inbound: before dock out", "inbound", "after", [yn("i1", "Vehicle fully unloaded", {critical: true}), yn("i2", "Shortages, excess or damages reported to the supervisor", {na: true}), yn("i3", "Dock area clear and safe"), yn("i4", "Wheel chocks removed, dock leveller raised", {critical: true})]),
    t("ckt-ob", "Outbound: before loading", "outbound", "before", [yn("i1", "Floor, walls and roof clean and dry", {critical: true, photo_on_no: true}), yn("i2", "No holes, leaks or damage", {critical: true, photo_on_no: true}), yn("i3", "No pests or bad smell", {critical: true, photo_on_no: true}),
      {id: "i4", text: "Reefer pre-cooled: temperature", type: "number", unit: "°C", na: true}, yn("i5", "Tyres and lights in good condition"), yn("i6", "Engine off, keys handed over", {critical: true}), yn("i7", "Wheel chocks in place", {critical: true}), yn("i8", "Dock leveller positioned safely", {critical: true})]),
    t("ckt-oa", "Outbound: before dock out", "outbound", "after", [yn("i1", "All orders loaded as per the loading list", {critical: true}), yn("i2", "Load secured with straps or bars", {critical: true, photo_on_no: true}),
      {id: "i3", text: "Photo of the loaded vehicle before closing the doors", type: "photo"}, yn("i4", "Doors closed and seal applied", {critical: true}), yn("i5", "Wheel chocks removed, dock leveller raised", {critical: true})])
  ];
  // the two vehicles already past their checklists in the sample yard
  const ago = m => new Date(Date.now() - m * 60000).toISOString();
  const pass = (visit, tid, stage, m) => { const tp = S.ckTemplates.find(x => x.id === tid), answers = {}; tp.items.forEach(it => { answers[it.id] = {value: it.type === "number" ? "na" : "yes", photos: []}; });
    return {id: "ckr-" + visit + stage, template_id: tid, template_name: tp.name, template_version: 1, items: tp.items, visit_id: visit, stage, answers, result: "pass", failed: [], issues: [], photos: [], submitted_by: "u-ali", submitted_at: ago(m), decided_by: null, decided_at: null, decision_note: null}; };
  S.ckRuns = [pass("gv-3", "ckt-ib", "before", 45), pass("gv-4", "ckt-ob", "before", 65)];
  const r4 = pass("gv-4", "ckt-oa", "after", 12); r4.items = S.ckTemplates.find(x => x.id === "ckt-oa").items; r4.answers.i3 = {photos: []}; S.ckRuns.push(r4);
}
const ckTemplateFor = (purpose, storer, stage) => S.ckTemplates.filter(t => t.active && t.kind === "vehicle" && t.purpose === purpose && t.stage === stage && (t.storer === "" || t.storer.toUpperCase() === String(storer || "").toUpperCase()))
  .sort((a, b) => (b.storer !== "") - (a.storer !== ""))[0] || null;
const ckLatest = (visit, stage) => S.ckRuns.filter(r => r.visit_id === visit && r.stage === stage).sort((a, b) => a.submitted_at < b.submitted_at ? 1 : -1)[0] || null;
const ckWord = p => p === "inbound" ? "unloading" : "loading";
function ckDockOutCheck(v, seal) {
  const b = ckLatest(v.id, "before"), af = ckLatest(v.id, "after"), rej = (b && b.result === "rejected") || (af && af.result === "rejected");
  if (rej) return {rej: true};
  if (ckTemplateFor(v.purpose, v.storer, "before") && !(b && ["pass", "accepted"].includes(b.result))) return {err: b && b.result === "fail" ? `The before-${ckWord(v.purpose)} checklist failed. A supervisor must accept or reject the vehicle first.` : `Complete the before-${ckWord(v.purpose)} checklist first.`};
  if (ckTemplateFor(v.purpose, v.storer, "after") && !(af && ["pass", "accepted"].includes(af.result))) return {err: af && af.result === "fail" ? "The dock-out checklist failed. A supervisor must accept or reject it first." : "Complete the dock-out checklist first."};
  if (v.purpose === "outbound" && !seal) return {err: "Enter the seal number applied to the vehicle"};
  return {rej: false};
}
function ckRpc(name, a, me, staff) {
  if (!me || !me.active) return E("Your user is not active");
  const gev = (visit, note, device) => S.gateEvents.push({id: "ge" + Date.now() + Math.random().toString(36).slice(2, 6), visit_id: visit, event: "checklist", note, device: device || null, user_id: me.id, created_at: tick()});
  if (name === "checklist_status") {
    const v = S.gateVisits.find(x => x.id === a.p_visit); if (!v || v.purpose === "other") return {data: [], error: null};
    return {data: ["before", "after"].map(stage => { const t = ckTemplateFor(v.purpose, v.storer, stage), r = ckLatest(v.id, stage); if (!t && !r) return null;
      return {stage, template: t ? {id: t.id, name: t.name, items: t.items, version: t.version} : null,
        run: r ? {id: r.id, result: r.result, failed: r.failed, issues: r.issues, submitted_at: r.submitted_at, submitted_by_name: uname(r.submitted_by), decision_note: r.decision_note, decided_by_name: uname(r.decided_by)} : null}; }).filter(Boolean), error: null};
  }
  if (name === "checklist_submit") {
    if (a.p_client_id) { const d = S.ckRuns.find(r => r.client_id === a.p_client_id); if (d) return {data: {...d}, error: null}; }
    const v = S.gateVisits.find(x => x.id === a.p_visit); if (!v) return E("Visit not found");
    if (v.status !== "at_dock") return E(`Vehicle ${v.vehicle_plate} is not at a dock`);
    const t = ckTemplateFor(v.purpose, v.storer, a.p_stage); if (!t) return E("No checklist is set up for this");
    const prev = ckLatest(v.id, a.p_stage);
    if (prev && ["pass", "accepted"].includes(prev.result)) return E("This checklist is already done");
    if (prev && prev.result === "rejected") return E("The vehicle was rejected at the dock");
    if (a.p_stage === "after" && ckTemplateFor(v.purpose, v.storer, "before")) { const b = ckLatest(v.id, "before"); if (!b || !["pass", "accepted"].includes(b.result)) return E("Complete the first checklist before this one"); }
    const failed = [], issues = [], missing = [], photos = [], ans = a.p_answers || {};
    for (const it of t.items) {
      const x = ans[it.id] || {}, val = x.value == null ? "" : String(x.value).trim(), ph = x.photos || [], req = it.required !== false; photos.push(...ph);
      if (it.type === "photo") { if (!ph.length && req) missing.push(it.text); continue; }
      if (!val) { if (req) missing.push(it.text); continue; }
      if (val === "na") { if (!it.na) missing.push(it.text); continue; }
      let bad = false;
      if (it.type === "yesno") { if (!["yes", "no"].includes(val)) { missing.push(it.text); continue; } bad = val === "no"; if (bad && it.photo_on_no && !ph.length) return E("Take a photo for: " + it.text); }
      else if (it.type === "number") { const n = Number(val); if (!isFinite(n)) return E("Enter a number for: " + it.text); bad = (it.min !== undefined && it.min !== "" && n < +it.min) || (it.max !== undefined && it.max !== "" && n > +it.max); }
      if (bad) (it.critical ? failed : issues).push(it.text);
    }
    if (missing.length) return E("Answer: " + missing.join("; "));
    const r = {id: "ckr-" + Math.random().toString(36).slice(2, 10), template_id: t.id, template_name: t.name, template_version: t.version, items: JSON.parse(JSON.stringify(t.items)), visit_id: v.id, stage: a.p_stage, answers: ans,
      result: failed.length ? "fail" : "pass", failed, issues, photos, submitted_by: me.id, submitted_at: tick(), decided_by: null, decided_at: null, decision_note: null, device: a.p_device || null, client_id: a.p_client_id || null};
    S.ckRuns.push(r); gev(v.id, `${t.name}: ${failed.length ? `FAILED (${failed.join("; ")})` : "passed"}${issues.length ? ` · issues: ${issues.join("; ")}` : ""}`, a.p_device);
    return {data: {...r}, error: null};
  }
  if (name === "checklist_decide") {
    if (!staff) return E("Only supervisors can do this");
    if (!["accept", "reject"].includes(a.p_decision)) return E("Choose accept or reject");
    const note = String(a.p_note || "").trim(); if (!note) return E("Enter a reason");
    const r = S.ckRuns.find(x => x.id === a.p_run); if (!r) return E("Checklist not found");
    if (r.result !== "fail") return E("This checklist doesn't need a decision");
    if (ckLatest(r.visit_id, r.stage).id !== r.id) return E("A newer checklist exists for this vehicle");
    const v = S.gateVisits.find(x => x.id === r.visit_id); if (!v || v.status !== "at_dock") return E("The vehicle is no longer at the dock");
    Object.assign(r, {result: a.p_decision === "accept" ? "accepted" : "rejected", decided_by: me.id, decided_at: tick(), decision_note: note});
    gev(r.visit_id, `${r.template_name}: ${a.p_decision === "accept" ? "accepted by supervisor" : "vehicle REJECTED"} · ${note}`);
    return {data: null, error: null};
  }
  return E("Unknown function " + name);
}

function seedGate(S) {
  if (!S.users.some(u => u.id === "u-sec")) S.users.push({id: "u-sec", full_name: "Rashid Khan", email: "rashid@demo.local", role: "counter", job: "security", site: "DXB Warehouse", active: true});
  S.users.forEach(u => { if (!u.job) u.job = "operator"; });
  S.org = [{id: 1, company_name: "", pass_base_url: "", yard_alert_minutes: 120, updated_at: "2026-10-01T06:00:00Z"}];
  S.sites = [{id: "site-dxb", name: "DXB Warehouse", code: "DXB", active: true, created_at: "2026-10-01T06:00:00Z"}, {id: "site-auh", name: "AUH Warehouse", code: "AUH", active: true, created_at: "2026-10-01T06:00:00Z"}];
  S.docks = [];
  for (let i = 1; i <= 40; i++) S.docks.push({id: "dk-dxb-" + i, site_id: "site-dxb", name: "Dock " + String(i).padStart(2, "0"), kind: i <= 20 ? "inbound" : "outbound", active: true, sort: i});
  for (let i = 1; i <= 30; i++) S.docks.push({id: "dk-auh-" + i, site_id: "site-auh", name: "Dock " + String(i).padStart(2, "0"), kind: "both", active: true, sort: i});
  const ago = m => new Date(Date.now() - m * 60000).toISOString(), soon = d => new Date(Date.now() + d * 864e5).toISOString().slice(0, 10);
  const base = {site_id: "site-dxb", storer: "", refs: [], vehicle_type: "Truck", transporter: "", driver_mobile: "", eid_number: "784-1985-1234567-1", eid_expiry: soon(400), licence_number: "2345678", licence_expiry: soon(300),
    mulkiya_number: "TF 10293847", mulkiya_expiry: soon(200), ppe_ok: true, status: "in_yard", reject_reason: null, notes: null, gate_in_by: "u-sec", dock_id: null, dock_in_at: null, dock_in_by: null, dock_out_at: null, dock_out_by: null,
    seal_in: null, seal_out: null, gate_out_at: null, gate_out_by: null};
  S.gateVisits = [
    {...base, id: "gv-1", pass_code: "K7Q2M9TX", purpose: "inbound", storer: "TGD", refs: ["ASN-55120"], vehicle_plate: "DXB K 48213", transporter: "Al Futtaim Logistics", driver_name: "Imran Shah", driver_mobile: "971501234567", seal_in: "SL-778812", gate_in_at: ago(150)},
    {...base, id: "gv-2", pass_code: "B4N8W2PZ", purpose: "outbound", storer: "DEMO", refs: [], vehicle_plate: "SHJ 3 55102", transporter: "Fast Move", driver_name: "Rahul Nair", driver_mobile: "971552223344", gate_in_at: ago(35)},
    {...base, id: "gv-3", pass_code: "H3R6C8VD", purpose: "inbound", storer: "TGD", refs: ["PO-77120", "PO-77121"], vehicle_plate: "DXB P 90311", vehicle_type: "Container 40ft", transporter: "Gulf Hauliers", driver_name: "Muhammad Asif", status: "at_dock", dock_id: "dk-dxb-3", dock_in_at: ago(50), dock_in_by: "u-ali", gate_in_at: ago(80), seal_in: "SL-990021"},
    {...base, id: "gv-4", pass_code: "M2X9K4QW", purpose: "outbound", storer: "DEMO", refs: ["SO-2609299"], vehicle_plate: "AJM B 12045", vehicle_type: "Van", transporter: "City Couriers", driver_name: "Sanjay Kumar", status: "dock_done", dock_id: "dk-dxb-22", dock_in_at: ago(70), dock_in_by: "u-ali", dock_out_at: ago(10), dock_out_by: "u-ali", seal_out: "OUT-445120", gate_in_at: ago(95)},
    {...base, id: "gv-5", pass_code: "T8P3Z6NB", purpose: "other", storer: "", refs: [], vehicle_plate: "DXB A 7741", vehicle_type: "Car", driver_name: "Ahmed Saleh", notes: "Maintenance contractor", status: "out", gate_in_at: ago(240), gate_out_at: ago(180), gate_out_by: "u-sec"},
    {...base, id: "gv-6", pass_code: "R5V7J2CQ", purpose: "inbound", storer: "TGD", refs: ["ASN-55131"], vehicle_plate: "RAK C 33190", driver_name: "Ali Raza", licence_expiry: soon(-12), status: "rejected", reject_reason: "Driving licence expired on " + soon(-12), gate_in_at: ago(60)}
  ].map(v => ({...v, updated_at: v.gate_out_at || v.dock_out_at || v.dock_in_at || v.gate_in_at}));
  S.gateEvents = [];
  let n = 0;
  S.gateVisits.forEach(v => {
    S.gateEvents.push({id: "ge" + (++n), visit_id: v.id, event: v.status === "rejected" ? "rejected" : "gate_in", note: v.reject_reason, user_id: "u-sec", created_at: v.gate_in_at});
    if (v.dock_in_at) S.gateEvents.push({id: "ge" + (++n), visit_id: v.id, event: "dock_in", dock_id: v.dock_id, user_id: v.dock_in_by, created_at: v.dock_in_at});
    if (v.dock_out_at) S.gateEvents.push({id: "ge" + (++n), visit_id: v.id, event: "dock_out", dock_id: v.dock_id, note: v.seal_out ? "Seal " + v.seal_out : null, user_id: v.dock_out_by, created_at: v.dock_out_at});
    if (v.gate_out_at) S.gateEvents.push({id: "ge" + (++n), visit_id: v.id, event: "gate_out", user_id: v.gate_out_by, created_at: v.gate_out_at});
  });
}
const gateList = () => S.gateVisits.map(v => { const s = S.sites.find(x => x.id === v.site_id) || {}, d = S.docks.find(x => x.id === v.dock_id) || {}, mins = (a, b) => a ? Math.round(((b ? Date.parse(b) : Date.now()) - Date.parse(a)) / 60000) : null;
  return {...v, site_name: s.name, dock_name: d.name || null, gate_in_name: uname(v.gate_in_by), dock_in_name: uname(v.dock_in_by), dock_out_name: uname(v.dock_out_by), gate_out_name: uname(v.gate_out_by),
    wait_minutes: mins(v.gate_in_at, v.dock_in_at || v.gate_out_at), dock_minutes: mins(v.dock_in_at, v.dock_out_at), total_minutes: mins(v.gate_in_at, v.gate_out_at),
    ck_before_needed: !!(S.ckTemplates && ckTemplateFor(v.purpose, v.storer, "before")), ck_after_needed: !!(S.ckTemplates && ckTemplateFor(v.purpose, v.storer, "after")),
    ck_before: S.ckRuns ? (ckLatest(v.id, "before") || {}).result || null : null, ck_after: S.ckRuns ? (ckLatest(v.id, "after") || {}).result || null : null}; });
function gateRpc(name, a, me, staff) {
  if (!me || !me.active) return E("Your user is not active");
  const gev = (v, event, x = {}) => S.gateEvents.push({id: "ge" + Date.now() + Math.random().toString(36).slice(2, 6), visit_id: v.id, event, user_id: me.id, created_at: tick(), ...x});
  const today = new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10);
  if (name === "gate_in") {
    const p = a.p || {};
    if (!S.sites.some(s => s.id === p.site_id && s.active)) return E("Choose the site");
    if (!["inbound", "outbound", "other"].includes(p.purpose)) return E("Choose inbound, outbound or other");
    const plate = String(p.vehicle_plate || "").trim().toUpperCase(); if (!plate) return E("Enter the vehicle plate");
    if (!String(p.driver_name || "").trim()) return E("Enter the driver's name");
    const refs = (p.refs || []).map(x => String(x).trim().toUpperCase()).filter(Boolean);
    if (p.purpose === "inbound" && !refs.length) return E("Enter at least one ASN or PO number");
    if (S.gateVisits.some(v => v.vehicle_plate.toUpperCase() === plate && ["in_yard", "at_dock", "dock_done"].includes(v.status))) return E(`Vehicle ${plate} is already inside. Gate it out first.`);
    const prob = [];
    [["eid_expiry", "Emirates ID"], ["licence_expiry", "Driving licence"], ["mulkiya_expiry", "Mulkiya"]].forEach(([k, l]) => { if (!p[k]) prob.push(l + " expiry missing"); else if (p[k] < today) prob.push(`${l} expired on ${p[k]}`); });
    if (!p.ppe_ok) prob.push("Driver without PPE");
    let code; do { code = Math.random().toString(16).slice(2).replace(/[01]/g, "").slice(0, 8).toUpperCase(); } while (code.length < 8 || S.gateVisits.some(v => v.pass_code === code));
    const v = {id: "gv-" + Math.random().toString(36).slice(2, 9), pass_code: code, site_id: p.site_id, purpose: p.purpose, storer: String(p.storer || "").trim(), refs, vehicle_plate: plate, vehicle_type: p.vehicle_type || "", transporter: String(p.transporter || "").trim(),
      driver_name: String(p.driver_name).trim(), driver_mobile: String(p.driver_mobile || "").replace(/[^0-9+]/g, ""), eid_number: p.eid_number || "", eid_expiry: p.eid_expiry || null, licence_number: p.licence_number || "", licence_expiry: p.licence_expiry || null,
      mulkiya_number: p.mulkiya_number || "", mulkiya_expiry: p.mulkiya_expiry || null, ppe_ok: !!p.ppe_ok, status: prob.length ? "rejected" : "in_yard", reject_reason: prob.join("; ") || null, notes: p.notes || null, seal_in: p.seal_in || null, seal_out: null,
      gate_in_at: tick(), gate_in_by: me.id, dock_id: null, dock_in_at: null, dock_in_by: null, dock_out_at: null, dock_out_by: null, gate_out_at: null, gate_out_by: null, updated_at: tick()};
    S.gateVisits.push(v); gev(v, prob.length ? "rejected" : "gate_in", {note: v.reject_reason, device: a.p_device});
    return {data: {...v}, error: null};
  }
  if (name === "gate_step") {
    const v = S.gateVisits.find(x => x.pass_code === String(a.p_code || "").trim().toUpperCase());
    if (!v) return E(`Gate pass ${String(a.p_code || "").trim().toUpperCase()} not found`);
    if (v.status === "rejected") return E("This vehicle was refused at the gate: " + v.reject_reason);
    if (v.status === "out") return E(`Vehicle ${v.vehicle_plate} already left`);
    const sec = me.job === "security" && !staff;
    if (a.p_step === "dock_in") {
      if (sec) return E("Dock in is done by the warehouse team");
      if (v.status !== "in_yard") return E(`Vehicle ${v.vehicle_plate} is not waiting in the yard`);
      if (v.purpose === "other") return E("This visit doesn't use a dock");
      const d = S.docks.find(x => x.id === a.p_dock && x.active); if (!d) return E("Choose a dock");
      if (d.site_id !== v.site_id) return E(`${d.name} is not at this vehicle's site`);
      const busy = S.gateVisits.find(x => x.dock_id === d.id && x.status === "at_dock"); if (busy) return E(`${d.name} is in use by ${busy.vehicle_plate}`);
      const add = [...new Set((a.p_refs || []).map(x => String(x).trim().toUpperCase()).filter(Boolean))].filter(x => !(v.refs || []).includes(x));
      if (v.purpose === "outbound" && !(v.refs || []).length && !add.length) return E("Enter at least one order number for this vehicle");
      Object.assign(v, {status: "at_dock", dock_id: d.id, dock_in_at: tick(), dock_in_by: me.id, refs: [...(v.refs || []), ...add], updated_at: tick()});
      gev(v, "dock_in", {dock_id: d.id, device: a.p_device, note: add.length ? (v.purpose === "outbound" ? "Orders " : "Added ") + add.join(", ") : null});
    } else if (a.p_step === "dock_out") {
      if (sec) return E("Dock out is done by the warehouse team");
      if (v.status !== "at_dock") return E(`Vehicle ${v.vehicle_plate} is not at a dock`);
      const seal = String(a.p_seal || "").trim(), chk = ckDockOutCheck(v, seal);
      if (chk.err) return E(chk.err);
      Object.assign(v, {status: "dock_done", dock_out_at: tick(), dock_out_by: me.id, seal_out: seal || null, updated_at: tick()});
      gev(v, "dock_out", {dock_id: v.dock_id, note: [chk.rej ? `Rejected at dock, not ${v.purpose === "inbound" ? "unloaded" : "loaded"}` : null, seal ? "Seal " + seal : null].filter(Boolean).join(" · ") || null, device: a.p_device});
    } else if (a.p_step === "gate_out") {
      if (v.purpose !== "other" && v.status !== "dock_done") return E(`Vehicle ${v.vehicle_plate} can't leave yet: ${v.status === "in_yard" ? "it hasn't been to a dock" : "it hasn't been docked out"}`);
      Object.assign(v, {status: "out", gate_out_at: tick(), gate_out_by: me.id, updated_at: tick()}); gev(v, "gate_out", {device: a.p_device});
    } else return E("Unknown step " + a.p_step);
    return {data: {...v}, error: null};
  }
  if (name === "gate_cancel") {
    if (!staff) return E("Only supervisors can do this");
    const v = S.gateVisits.find(x => x.id === a.p_visit), note = String(a.p_note || "").trim();
    if (!note) return E("Enter a reason");
    if (!v || !["in_yard", "at_dock", "dock_done"].includes(v.status)) return E("This visit is already closed");
    Object.assign(v, {status: "out", gate_out_at: v.gate_out_at || tick(), gate_out_by: v.gate_out_by || me.id, notes: [v.notes, "Cancelled: " + note].filter(Boolean).join(" | "), updated_at: tick()}); gev(v, "cancel", {note});
    return {data: null, error: null};
  }
  return E("Unknown function " + name);
}

function seedQc(S) {
  const P = {"PHC-30112": ["6297000331189", "Paracetamol 500 mg, 24 tabs", "PK"], "PHC-30458": ["6297000331523", "Hand sanitiser 500 ml", "BTL"], "PHC-50221": ["6297001102290", "Baby wipes, 80 pcs", "PK"],
    "PHC-70503": ["6297002205031", "Toothpaste 100 ml", "TUBE"], "FMC-10231": ["6291041500213", "Basmati rice 5 kg", "BAG"], "FMC-10877": ["6291003001452", "Sunflower oil 1.8 L", "BTL"],
    "FMC-60118": ["6291018000186", "Mineral water 1.5 L x 6", "PK"], "FMC-80044": ["6291071800447", "Green tea, 100 bags", "BOX"], "FMC-40090": ["6291056300098", "Medjool dates 1 kg", "BOX"],
    "FMC-40317": ["6291056300715", "Natural honey 500 g", "JAR"], "FMC-20411": ["6294003570021", "Laundry detergent 3 kg", "BOX"], "FMC-20566": ["6291100250437", "Dishwashing liquid 1 L", "BTL"]};
  const orders = [], lines = [], events = []; let n = 0, e = 0;
  const base = {reference: "", storer: "DEMO", customer: "", source_file: "Orders_2026-09-30.xlsx", status: "pending", tote_mode: "off", allow_qty: false, assigned_to: null, assigned_at: null, started_at: null,
    short_at: null, finished_at: null, finished_by: null, closed_note: null, closed_by: null, closed_at: null, created_by: "u-sup", created_at: "2026-09-30T06:50:00Z", updated_at: "2026-09-30T06:50:00Z"};
  const add = (o, ls) => { orders.push({...base, ...o}); ls.forEach(([sku, exp, scanned = 0, over = 0], i) => lines.push({id: "ql" + (++n), order_id: o.id, line_no: i + 1, sku, barcode: P[sku][0], description: P[sku][1], uom: P[sku][2], batch: "", expected_qty: exp, scanned_qty: scanned, over_qty: over, updated_at: o.updated_at || base.updated_at}));
    events.push({id: "qe" + (++e), order_id: o.id, line_id: null, event: "import", qty: ls.length, note: base.source_file, user_id: "u-sup", created_at: base.created_at}); };
  add({id: "q-1", order_no: "SO-2609301", reference: "PO-88412", customer: "Al Noor Pharmacy"}, [["PHC-30112", 4], ["PHC-30458", 2], ["PHC-50221", 3], ["PHC-70503", 6]]);
  add({id: "q-2", order_no: "SO-2609302", reference: "PO-88419", customer: "Green Valley Supermarket", tote_mode: "optional", allow_qty: true}, [["FMC-10231", 2], ["FMC-10877", 12], ["FMC-60118", 5], ["FMC-80044", 1]]);
  add({id: "q-3", order_no: "SO-2609303", reference: "PO-88423", customer: "Blue Line Café", tote_mode: "required"}, [["FMC-40090", 2], ["FMC-40317", 3], ["FMC-80044", 2]]);
  add({id: "q-4", order_no: "SO-2609297", reference: "PO-88390", customer: "City Mart", status: "short", started_at: "2026-09-30T07:20:00Z", short_at: "2026-09-30T07:34:00Z", updated_at: "2026-09-30T07:34:00Z"}, [["FMC-20411", 3, 3], ["FMC-20566", 4, 2], ["PHC-50221", 2, 2, 1]]);
  add({id: "q-5", order_no: "SO-2609290", reference: "PO-88377", customer: "Al Noor Pharmacy", status: "passed", started_at: "2026-09-30T07:00:00Z", finished_at: "2026-09-30T07:09:00Z", finished_by: "u-priya", updated_at: "2026-09-30T07:09:00Z"}, [["PHC-30112", 6, 6, 1], ["PHC-70503", 4, 4]]);
  add({id: "q-6", order_no: "SO-2609299", reference: "PO-88402", customer: "Sunrise Grocery", status: "in_progress", assigned_to: "u-priya", assigned_at: "2026-09-30T07:40:00Z", started_at: "2026-09-30T07:40:00Z"}, [["FMC-10231", 3, 1], ["FMC-60118", 2]]);
  events.push({id: "qe" + (++e), order_id: "q-4", line_id: null, event: "short", qty: 2, note: "1 line short", user_id: "u-priya", created_at: "2026-09-30T07:34:00Z"},
              {id: "qe" + (++e), order_id: "q-4", line_id: "ql14", event: "over", qty: 1, code: "6297001102290", note: "More than the order quantity", user_id: "u-priya", created_at: "2026-09-30T07:31:00Z"},
              {id: "qe" + (++e), order_id: "q-5", line_id: null, event: "finish", user_id: "u-priya", created_at: "2026-09-30T07:09:00Z"});
  Object.assign(S, {qcOrders: orders, qcLines: lines, qcEvents: events});
}
const qcStats = o => { const L = S.qcLines.filter(l => l.order_id === o.id);
  return {lines_total: L.length, lines_done: L.filter(l => +l.scanned_qty >= +l.expected_qty).length, units_expected: L.reduce((a, l) => a + +l.expected_qty, 0), units_scanned: L.reduce((a, l) => a + +l.scanned_qty, 0),
    units_short: L.reduce((a, l) => a + (l.expected_qty - l.scanned_qty), 0), units_over: L.reduce((a, l) => a + +l.over_qty, 0)}; };
const qcList = () => S.qcOrders.map(o => ({...o, ...qcStats(o), assigned_name: uname(o.assigned_to), created_by_name: uname(o.created_by), finished_by_name: uname(o.finished_by), closed_by_name: uname(o.closed_by)}));
function qcRpc(name, a, me, staff) {
  const ord = id => S.qcOrders.find(o => o.id === id);
  const qev = (o, event, x = {}) => S.qcEvents.push({id: (S.evPrefix || "") + "q" + (++S.evId), order_id: o.id, line_id: null, event, qty: null, code: null, tote: null, note: null, user_id: me.id, device: null, client_id: null, created_at: tick(), ...x});
  const touch = o => { o.updated_at = tick(); };
  const active = me && me.active;
  if (!active) return E("Your user is not active");
  switch (name) {
    case "qc_mobile_orders": {
      const s = String(a.p_search || "").trim().toUpperCase();
      const rows = qcList().filter(o => s ? (o.order_no.toUpperCase() === s || (o.reference && o.reference.toUpperCase() === s)) : ["pending", "in_progress", "short"].includes(o.status))
        .sort((x, y) => (y.assigned_to === me.id) - (x.assigned_to === me.id) || (x.created_at < y.created_at ? -1 : 1));
      return {data: rows, error: null};
    }
    case "qc_mobile_lines": return {data: S.qcLines.filter(l => l.order_id === a.p_order).sort((x, y) => x.line_no - y.line_no).map(l => ({...l})), error: null};
    case "qc_import": {
      if (!staff) return E("Only supervisors can upload orders");
      let orders = 0, lines = 0; const dupes = [];
      for (const o of a.p_orders) {
        const no = String(o.order_no || "").trim(), storer = String(o.storer || "").trim(); if (!no) continue;
        if (S.qcOrders.some(x => x.status !== "cancelled" && x.order_no.toUpperCase() === no.toUpperCase() && x.storer.toUpperCase() === storer.toUpperCase())) { dupes.push(no); continue; }
        const rec = {id: "q-" + Math.random().toString(36).slice(2, 9), order_no: no, reference: String(o.reference || "").trim(), storer, customer: String(o.customer || "").trim(), source_file: a.p_source_file || null,
          status: "pending", tote_mode: a.p_tote_mode || "off", allow_qty: !!a.p_allow_qty, assigned_to: null, assigned_at: null, started_at: null, short_at: null, finished_at: null, finished_by: null,
          closed_note: null, closed_by: null, closed_at: null, created_by: me.id, created_at: tick(), updated_at: tick()};
        const ls = (o.lines || []).filter(l => String(l.sku || "").trim() && +l.qty > 0);
        if (!ls.length) return E(`Order ${no} has no lines with a SKU and a quantity above 0`);
        S.qcOrders.push(rec);
        ls.forEach((l, i) => S.qcLines.push({id: "ql" + Math.random().toString(36).slice(2, 10), order_id: rec.id, line_no: i + 1, sku: String(l.sku).trim(), barcode: String(l.barcode || "").trim(), description: l.description || "", uom: l.uom || "", batch: l.batch || "", expected_qty: +l.qty, scanned_qty: 0, over_qty: 0, updated_at: tick()}));
        qev(rec, "import", {qty: ls.length, note: a.p_source_file || null}); orders++; lines += ls.length;
      }
      return {data: {orders, lines, duplicates: dupes}, error: null};
    }
    case "qc_start": {
      const o = ord(a.p_order); if (!o) return E("Order not found");
      if (o.status === "passed") return E(`Order ${o.order_no} has already passed QC`);
      if (o.status === "released") return E(`Order ${o.order_no} was released short by a supervisor`);
      if (o.status === "cancelled") return E(`Order ${o.order_no} was cancelled`);
      if (o.assigned_to && o.assigned_to !== me.id) return E(`${uname(o.assigned_to) || "Another user"} is checking order ${o.order_no}. If they have stopped, ask a supervisor to unlock it.`);
      const was = o.assigned_to, prev = o.status, started = o.started_at;
      Object.assign(o, {status: "in_progress", assigned_to: me.id, assigned_at: tick(), started_at: o.started_at || tick()}); touch(o);
      if (!was) qev(o, prev === "short" || started ? "resume" : "start", {device: a.p_device});
      return {data: {...o}, error: null};
    }
    case "qc_pause": { const o = ord(a.p_order); if (o && o.assigned_to === me.id && o.status === "in_progress") { o.assigned_to = null; o.assigned_at = null; touch(o); qev(o, "pause", {device: a.p_device}); } return {data: null, error: null}; }
    case "qc_submit": {
      const o = ord(a.p_order); if (!o) return E("Order not found");
      if (o.status !== "in_progress" || o.assigned_to !== me.id) return E(`Order ${o.order_no} is no longer assigned to you. A supervisor may have unlocked, reset or closed it.`);
      let saved = 0, duplicates = 0, adjusted = 0, skipped = 0;
      for (const e of a.p_entries) {
        if (e.client_id && S.qcEvents.some(x => x.client_id === e.client_id)) { duplicates++; continue; }
        const q = e.qty == null ? 1 : +e.qty, base = {code: e.code || null, tote: e.tote || null, device: a.p_device, client_id: e.client_id || null, client_ts: e.client_ts || null};
        let l = null;
        if (["scan", "over", "undo"].includes(e.kind)) { if (!(q > 0)) { skipped++; continue; } l = S.qcLines.find(x => String(x.id) === String(e.line_id) && x.order_id === o.id); if (!l) { skipped++; continue; } }
        if (e.kind === "scan") {
          const fit = Math.min(q, l.expected_qty - l.scanned_qty);
          if (fit > 0) { l.scanned_qty += fit; qev(o, "scan", {...base, line_id: l.id, qty: fit}); }
          if (fit < q) { l.over_qty += q - fit; qev(o, "over", {...base, line_id: l.id, qty: q - fit, note: "More than the order quantity", client_id: fit > 0 ? null : base.client_id}); adjusted++; }
          l.updated_at = tick();
        } else if (e.kind === "over") { l.over_qty += q; l.updated_at = tick(); qev(o, "over", {...base, line_id: l.id, qty: q, note: e.note || "More than the order quantity"}); }
        else if (e.kind === "undo") { const fit = Math.min(q, l.scanned_qty); l.scanned_qty -= fit; l.updated_at = tick(); qev(o, "undo", {...base, line_id: l.id, qty: fit, note: e.note || null}); }
        else if (["wrong_item", "unknown", "tote"].includes(e.kind)) qev(o, e.kind, {...base, note: e.note || null});
        else { skipped++; continue; }
        saved++;
      }
      touch(o);
      return {data: {saved, duplicates, adjusted, skipped}, error: null};
    }
    case "qc_finish": {
      const o = ord(a.p_order); if (!o) return E("Order not found");
      if (o.status !== "in_progress" || o.assigned_to !== me.id) return E(`Order ${o.order_no} is no longer assigned to you`);
      const L = S.qcLines.filter(l => l.order_id === o.id), short = L.reduce((x, l) => x + (l.expected_qty - l.scanned_qty), 0), sl = L.filter(l => l.scanned_qty < l.expected_qty).length;
      if (!short) { Object.assign(o, {status: "passed", finished_at: tick(), finished_by: me.id, assigned_to: null, assigned_at: null}); touch(o); qev(o, "finish", {device: a.p_device}); return {data: {status: "passed"}, error: null}; }
      if (!a.p_confirm_short) return {data: {status: "check", short_units: short, short_lines: sl}, error: null};
      Object.assign(o, {status: "short", short_at: tick(), assigned_to: null, assigned_at: null}); touch(o); qev(o, "short", {qty: short, note: `${sl} line${sl === 1 ? "" : "s"} short`, device: a.p_device});
      return {data: {status: "short", short_units: short, short_lines: sl}, error: null};
    }
    case "qc_supervise": {
      if (!staff) return E("Only supervisors can do this");
      const o = ord(a.p_order), note = String(a.p_note || "").trim() || null; if (!o) return E("Order not found");
      if (["passed", "released", "cancelled"].includes(o.status)) return E(`Order ${o.order_no} is closed and can't be changed`);
      if (["release", "cancel", "reset"].includes(a.p_action) && !note) return E("Enter a reason");
      if (a.p_action === "unlock") { if (!o.assigned_to) return E("Nobody is checking this order"); Object.assign(o, {assigned_to: null, assigned_at: null}); }
      else if (a.p_action === "release") { if (o.status !== "short") return E("Only a short order can be released"); Object.assign(o, {status: "released", closed_note: note, closed_by: me.id, closed_at: tick(), assigned_to: null, assigned_at: null}); }
      else if (a.p_action === "cancel") Object.assign(o, {status: "cancelled", closed_note: note, closed_by: me.id, closed_at: tick(), assigned_to: null, assigned_at: null});
      else if (a.p_action === "reset") { S.qcLines.filter(l => l.order_id === o.id).forEach(l => { l.scanned_qty = 0; l.over_qty = 0; l.updated_at = tick(); }); Object.assign(o, {status: "pending", assigned_to: null, assigned_at: null, started_at: null, short_at: null}); }
      else return E("Unknown action " + a.p_action);
      touch(o); qev(o, a.p_action, {note}); return {data: null, error: null};
    }
  }
  return E("Unknown function " + name);
}
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
  return {damaged_units: c.reduce((x, l) => x + +(l.damaged_qty || 0), 0), reported_items: S.events.filter(e => e.session_id === s.id && e.event === "not_on_list").length,
    lines_total: L.length, lines_counted: c.length, locations_total: locs.size, locations_open: open.size,
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
  event_list: () => S.events.map(e => { const l = S.lines.find(x => x.id === e.line_id); return {...e, user_name: uname(e.user_id), location: l ? l.location : e.location || null, sku: l ? l.sku : e.code || null}; }),
  qc_orders: () => S.qcOrders, qc_lines: () => S.qcLines, qc_order_list: qcList,
  org_settings: () => S.org, sites: () => S.sites, docks: () => S.docks, checklist_templates: () => S.ckTemplates, checklist_runs: () => S.ckRuns.map(r => ({...r, submitted_by_name: uname(r.submitted_by), decided_by_name: uname(r.decided_by)})), gate_visits: () => S.gateVisits, gate_visit_list: gateList,
  gate_events: () => S.gateEvents.map(e => ({...e, user_name: uname(e.user_id), dock_name: (S.docks.find(d => d.id === e.dock_id) || {}).name || null})),
  qc_line_v: () => S.qcLines.map(l => { const o = S.qcOrders.find(x => x.id === l.order_id) || {}; return {...l, short_qty: l.expected_qty - l.scanned_qty, order_no: o.order_no, reference: o.reference, storer: o.storer, customer: o.customer, order_status: o.status, order_created_at: o.created_at}; }),
  qc_event_list: () => S.qcEvents.map(e => { const l = S.qcLines.find(x => x.id === e.line_id), o = S.qcOrders.find(x => x.id === e.order_id) || {}; return {...e, user_name: uname(e.user_id), sku: l ? l.sku : null, order_no: o.order_no}; })
};

/* ---------- Stock: clients, items, locations, inventory (demo) ---------- */
const STOCK_SAMPLE = [["FIXPRICE","5036492","Spice container, 220 ml, oKitchen","24","Each","DAMAGE","RACK","FXLPN000222","OOCU8758359","","","",24.0,0.0,0.0,"HOLD","2024-06-13","0000181862","PL M24UV02353","",0],["FIXPRICE","5036493","Spice container, 530 ml, oKitchen","24","Each","DAMAGE","RACK","FXLPN000273","OOCU8758359","","","",72.0,0.0,0.0,"HOLD","2024-06-13","0000181862","PL M24UV02353","",0],["FIXPRICE","9331004","Receipt tape thermo 80-70m-12 (50) 44-46","50","Each","W1MZA139","WA02-MZ","5FXP00001417","TCNU4457027","","2024-07-12","2026-07-12",1000.0,0.0,0.0,"HOLD","2024-08-03","0000184280","6204444546/6204467591/6204427085","RUSSIA DRY",730],["FIXPRICE","5321336","Candle pumpkin","24","Each","W1MZA146","WA02-MZ","5FXP00002944","","","2024-08-01","2027-08-01",288.0,0.0,0.0,"HOLD","2024-09-12","0000190032","WMS0000190032","LOCAL DROGERIE",1095],["FIXPRICE","9331001","Check tape thermo 80-70m-12 (50) 44-46","48","Each","W1MZA146","WA02-MZ","5FXP00001418","TCNU4457027","","2024-07-12","2026-07-12",960.0,0.0,0.0,"HOLD","2024-08-03","0000184280","6204444546/6204467591/6204427085","RUSSIA DRY",730],["FIXPRICE","5244931","Livefresh diffusor 50ml","12","Each","SHORT","GENERAL","P-FXP0008062","","","2025-06-15","2027-05-03",108.0,0.0,0.0,"HOLD","2026-01-24","0000252053","PO 6206648121","",687],["FIXPRICE","1530736","Coca-Cola 298ml PET","30","Each","OUT-WA05","GENERAL","USJWUSIIS","","","2026-08-11","2026-12-09",60.0,0.0,60.0,"OK","2026-09-24","0000279186","PO 6207626797","LOCAL DROGERIE",120],["FIXPRICE","1530738","Sprite 298ml PET","30","Each","OUT-WA05","GENERAL","JEJEJJS","","","2026-09-05","2027-01-03",30.0,0.0,30.0,"OK","2026-09-24","0000279186","PO 6207626797","LOCAL DROGERIE",120],["FIXPRICE","1530772","Soft drink Fanta 1,5L","6","Each","OUT-WA05","GENERAL","IEISIEIEI","","","2026-07-11","2027-01-07",12.0,0.0,12.0,"OK","2026-07-30","0000276646","PO 6207398339","",180],["FIXPRICE","1530772","Soft drink Fanta 1,5L","6","Each","OUT-WA05","GENERAL","USJSJDJD","","","2026-07-11","2027-01-07",6.0,0.0,6.0,"OK","2026-07-30","0000276646","PO 6207398339","",180],["FIXPRICE","1600858","Lays Stax Sour Cream Onion 170g","15","Each","OUT-WA05","GENERAL","USJEIED","","","2026-01-28","2026-12-27",15.0,0.0,15.0,"OK","2026-10-08","0000279853","PO 6207685087","LOCAL DROGERIE",333],["FIXPRICE","1530903","Coca Cola Light 330ml","24","Each","OUT-WA05","GENERAL","JSJWSJS","","","2026-09-10","2027-01-08",24.0,0.0,24.0,"OK","2026-09-14","0000278688","PO 6207592253","LOCAL DROGERIE",120],["FIXPRICE","1171083","Super Sun Canned Stewed Beef 490G","12","Each","OUT-WA05","GENERAL","JSHEJJD","","","2025-10-13","2028-10-13",12.0,0.0,12.0,"OK","2026-09-25","0000279236","PO 6207639352","LOCAL DROGERIE",1096],["FIXPRICE","1232099","Cod Liver Riga Gold 120g","12","Each","OUT-WA05","GENERAL","HSJSJSJ","","","2025-08-22","2030-08-22",36.0,0.0,36.0,"OK","2026-06-29","0000274817","PO 6207263609","",1826],["FIXPRICE","1232099","Cod Liver Riga Gold 120g","12","Each","OUT-WA05","GENERAL","JSDIIS","","","2025-08-22","2030-08-22",24.0,0.0,24.0,"OK","2026-06-29","0000274817","PO 6207263609","",1826],["FIXPRICE","1521141","Al Ain 500Ml","12","Each","OUT-WA05","GENERAL","ISJSISIS","","","2026-07-30","2027-07-29",240.0,0.0,240.0,"OK","2026-08-17","0000277440","PO 6207473504","",364],["FIXPRICE","1521131","Al Ain 1.5 Ltr","6","Each","OUT-WA05","GENERAL","UISISIS","","","2026-08-15","2027-08-14",60.0,0.0,60.0,"OK","2026-08-17","0000277440","PO 6207473504","",364],["FIXPRICE","1521160","Masafi Water 1,5L","12","Each","OUT-WA05","GENERAL","HWESUSS","","","2026-08-18","2027-08-17",120.0,0.0,120.0,"OK","2026-08-26","0000277874","PO 6207512199","LOCAL DROGERIE",364],["FIXPRICE","1521160","Masafi Water 1,5L","12","Each","OUT-WA05","GENERAL","JSJJDJD","","","2026-08-18","2027-08-17",48.0,0.0,48.0,"OK","2026-08-26","0000277874","PO 6207512199","LOCAL DROGERIE",364],["FIXPRICE","1521160","Masafi Water 1,5L","12","Each","OUT-WA05","GENERAL","DP-719","","","2026-02-09","2027-02-08",24.0,0.0,0.0,"OK","2026-03-02","0000255476","PO 6206736742","LOCAL DROGERIE",364],["FIXPRICE","1521131","Al Ain 1.5 Ltr","6","Each","W2C3H0520C","W2C3-HI-02","B-FXP0075631","","","2026-08-15","2027-08-14",450.0,0.0,0.0,"OK","2026-08-17","0000277440","PO 6207473504","",364],["FIXPRICE","1521141","Al Ain 500Ml","12","Each","W2C3H0740C","W2C3-HI-02","B-FXP0005470","","","2026-09-07","2027-09-06",1560.0,0.0,0.0,"OK","2026-09-23","0000279104","PO 6207616157","",364],["FIXPRICE","1521131","Al Ain 1.5 Ltr","6","Each","W2C3H0430C","W2C3-HI-02","B-FXP0005465","","","2026-09-15","2027-09-14",450.0,0.0,0.0,"OK","2026-09-23","0000279104","PO 6207616157","",364],["FIXPRICE","1521141","Al Ain 500Ml","12","Each","W2C3H0440A","W2C3-HI-02","B-FXP0005472","","","2026-09-07","2027-09-06",1560.0,0.0,0.0,"OK","2026-09-23","0000279104","PO 6207616157","",364],["FIXPRICE","5036951","JAR WITH DISPENSER, 600 ML, O KITCHEN","12","Each","W1AW0440A","WA02-AW","P-FXP0029062555","","","2026-07-08","2036-07-08",192.0,0.0,0.0,"OK","2026-07-02","0000275233","CHINA CONTAINER","",3653],["FIXPRICE","4030293","Activity book SAKHA Halloween","10","Each","W2C2C1202A","W2C2C","P-FXP0029062734","","","2026-07-02","2036-07-02",10.0,0.0,0.0,"OK","2026-07-06","0000275253","PO 6207287447","LOCAL DROGERIE",3653],["FIXPRICE","1530619","Fanta Citrus 330 ml can","24","Each","W2C3H2030B","W2C3-HI-01","B-FXP0075973","","","2026-07-31","2027-04-27",120.0,0.0,0.0,"OK","2026-09-01","0000278235","PO 6207530584","",270],["FIXPRICE","1521137","Al Bayan shrink 1.5l","6","Each","W2C3I1820C","W2C3-HI-01","P-FXP0029062092","","","2026-07-18","2027-07-17",360.0,0.0,0.0,"OK","2026-07-20","0000276103","PO 6207345626","WATER",364],["FIXPRICE","3118049","Bodyform Baby Wipes Pure Water 72pcs","24","Each","OUT-WA05","GENERAL","JSJWJSJSI","","","2026-02-02","2029-02-02",24.0,0.0,24.0,"OK","2026-10-07","0000279818","PO 6207515263","",1096],["FIXPRICE","5062148","Storage bag, 60x40x25 cm,HOME TIME","24","Each","W1MZA130","WA02-MZ","LPN0016645389","EISU9417211","","2026-07-01","2036-07-01",192.0,0.0,0.0,"OK","2024-03-24","0000179905","OX-UAETX0001","",3653],["FIXPRICE","5700799","Glitter gel pen set, 6pcs","24","Each","W1AX0420B","WA02-AX","B-FXP0010132","","","2025-10-01","2028-10-01",72.0,0.0,0.0,"OK","2025-12-22","0000248401","TD25UV09116","",1096],["FIXPRICE","5501114","Women\u2019s T-shirt","20","Each","W1MZA144","WA02-MZ","P-FXP0003423","","","2025-10-25","2035-10-25",60.0,0.0,0.0,"OK","2025-11-03","0000239267","Russian-25/10/2025","",3652],["FIXPRICE","1911043","BELYOV PASTILA CLASSIC NO ADDED SUGAR 180 g","22","Each","W2C3H1340A","W2C3-HI-01","B-FXP0005316","","","2026-09-14","2028-03-14",176.0,0.0,0.0,"OK","2026-10-07","0000279803","PO 6207685081","LOCAL DROGERIE",547],["FIXPRICE","5078071","BLANKET,160*200 CM","12","Each","W1AX1670A","WA02-AX","P-FXP0029062494","","","2026-07-08","2036-07-08",228.0,0.0,0.0,"OK","2026-07-02","0000275233","CHINA CONTAINER","",3653],["FIXPRICE","3131087","Kitchen Towels Metro 2ply*75 sheets","12","Each","OUT-WA05","GENERAL","ISISIISIE","","","2026-10-05","2031-10-05",12.0,0.0,12.0,"OK","2026-10-05","0000279683","PO 6207653363","",1826],["FIXPRICE","1530708","Frutesca Guava Can 300ml","24","Each","W2C3I1130B","W2C3-HI-01","B-FXP0071881","","","2026-07-29","2028-07-29",72.0,0.0,0.0,"OK","2026-09-23","0000279145","PO 6207630996","",731],["FIXPRICE","5040541","Disposable polyester cloth, 5 pcs, BonHome","24","Each","W1AV0930B","WA02-AV","5FXP00002703","","","2024-11-25","2034-11-25",840.0,0.0,0.0,"OK","2024-11-26","0000199092","WMS0000199092","LOCAL DROGERIE",3652],["FIXPRICE","1670057","Sindbad Al Safwa Sunfl Oil 500 Ml","12","Each","OUT-WA05","GENERAL","UEUEIDIID","","","2026-06-02","2028-06-01",12.0,0.0,12.0,"OK","2026-07-09","0000275423","PO 6207294213","",730],["FIXPRICE","5521164","WOMEN\u2019S FLIP-FLOPS","24","Each","W1MZA136","WA02-MZ","P-FXP0008121","","","2026-07-01","2036-07-01",24.0,0.0,0.0,"OK","2026-01-21","0000251944","WMS0000251944","",3653],["FIXPRICE","5024767","Tablecloth, 137*183 cm, oKitchen","24","Each","W1AX0120A","WA02-AX","LPN0016726937","HLBU1317740","","2024-06-01","2034-01-01",72.0,0.0,0.0,"OK","2024-05-20","0000179910","Q24UV03217","",3501],["FIXPRICE","5610226","DIY MOSAIC KIT","24","Each","W1AW1330C","WA02-AW","5FXP00002749","","","2024-09-18","2034-09-18",96.0,0.0,0.0,"OK","2024-09-18","0000191337","China Container","LOCAL DROGERIE",3652],["FIXPRICE","5840344","Ring, 17 mm, INSTYLE","144","Each","W1MZA127","WA02-MZ","5FXP00002609","","","2024-11-25","2034-11-25",276.0,0.0,0.0,"OK","2024-11-26","0000199092","WMS0000199092","LOCAL DROGERIE",3652],["FIXPRICE","3120067","Colgate T/Brush Z/Zag Flex Med 1 Pcs","12","Each","W2C2C1802B","W2C2C","FRIO000000404","","","2025-06-13","2035-06-13",156.0,0.0,0.0,"OK","2026-06-11","0000273323","PO 6207190970","",3652],["FIXPRICE","5510958","MEN\u2019S SOCKS, MAN STYLE","20","Each","W1MZA140","WA02-MZ","P-FXP0009563","","","2026-07-01","2036-07-01",120.0,0.0,0.0,"OK","2026-01-21","0000251944","WMS0000251944","",3653],["FIXPRICE","5091669","MUG, 355 ML\uff0cO\u2018kitchen","12","Each","W1AX1460A","WA02-AX","5FXP00002805","","","2024-09-18","2034-09-18",26.0,0.0,0.0,"OK","2024-09-18","0000191337","China Container","LOCAL DROGERIE",3652],["FIXPRICE","5036935","STORAGE BASKET WITH HANDLE,oKitchen","12","Each","W1AW1270B","WA02-AW","P-FXP002250","","","2026-05-19","2029-05-19",144.0,0.0,0.0,"OK","2026-06-01","0000270605","WMS0000270605","",1096],["FIXPRICE","3216471","Elegant Sugar Scrub Manuka Honey 350ml","12","Each","OUT-WA05","GENERAL","JSJEUE","","","2025-09-01","2028-09-01",12.0,0.0,12.0,"OK","2026-06-27","0000274704","PO 6207215251","LOCAL DROGERIE",1096],["FIXPRICE","5601694","Play set","12","Each","W1AX1420B","WA02-AX","LPN0016726357","HLBU1317740","","2026-07-01","2036-07-01",60.0,0.0,0.0,"OK","2024-05-20","0000179910","Q24UV03217","",3653],["FIXPRICE","5032152","Faucet nozzle, Home Time","24","Each","W2C2C0802A","W2C2C","P-FXP0008487","00008","","2026-07-01","2036-07-01",24.0,0.0,0.0,"OK","2026-02-02","0000251004","WMS0000251004","",3653],["FIXPRICE","5300181","CAPE, HALLOWEEN","24","Each","W1AV0940B","WA02-AV","5FXP00002910","","","2024-08-01","2034-08-01",288.0,0.0,0.0,"OK","2024-09-12","0000190032","WMS0000190032","LOCAL DROGERIE",3652],["FIXPRICE","5704078","REFLECTIVE SHOE BAG, HUPPER DUPPER","24","Each","W1MZA107","WA02-MZ","LPN0016645288","EISU9007794","","2026-07-01","2036-07-01",216.0,0.0,0.0,"OK","2024-02-28","0000179904","Q23UV11255","",3653],["FIXPRICE","5006294","MAGNIFYING GLASS, MASTER HAND","24","Each","W1MZA103","WA02-MZ","5FXP00002923","","","2024-08-01","2034-08-01",672.0,0.0,0.0,"OK","2024-09-12","0000190032","WMS0000190032","LOCAL DROGERIE",3652],["FIXPRICE","5001351","Bicycle repair tool set, Top Race","24","Each","W1MZA104","WA02-MZ","LPN0016645388","EISU9417211","","2026-06-01","2036-06-01",264.0,0.0,0.0,"OK","2024-03-24","0000179905","OX-UAETX0001","",3653],["FIXPRICE","5950449","Foldable backpack,i!","24","Each","W1MZA012","WA02-MZ","P-FXP0009589","","","2026-01-22","2035-12-22",144.0,0.0,0.0,"OK","2026-01-21","0000251944","WMS0000251944","",3621],["FIXPRICE","5025217","Packing bags Bon Home 30 40 cm","16","Each","W1MZA029","WA02-MZ","5FXP00000954","","","2024-08-31","2034-08-31",192.0,0.0,0.0,"OK","2024-08-31","0000189318","HPCU4512757","RUSSIAN DRY",3652],["FIXPRICE","1724244","Curtis Black Tea 42.5g sachet Acc","12","Each","W2C3H1840B","W2C3-HI-01","P-FXP0010027","","","2025-09-26","2028-09-26",24.0,0.0,0.0,"OK","2026-03-03","0000252856","WMS0000252856","",1096],["FIXPRICE","3017087","Dettol Antib Floor Cleaner Lavender 0.9L","12","Each","OUT-WA05","GENERAL","JSSISIIS","","","2026-02-17","2029-02-16",12.0,0.0,12.0,"OK","2026-06-24","0000274425","PO 6207245307","",1095],["FIXPRICE","5036494","Ice-cream mold, oKitchen","24","Each","W1AV0710B","WA02-AV","LPN0016645050","FFAU4879626","","2026-07-01","2036-07-01",144.0,0.0,0.0,"OK","2024-05-01","0000179908","Q23UV11254","",3653],["FIXPRICE","1981131","Mentos Tuty Fruity Chewing Gum 54G 38Pc","6","Each","OUT-WA05","GENERAL","NAHSUSUS","","","2026-04-15","2027-10-15",12.0,0.0,12.0,"OK","2026-09-11","0000278567","PO 6207584426","LOCAL DROGERIE",548],["FIXPRICE","5246276","DECORATIVE TRAY LEAF","12","Each","W1AX1540A","WA02-AX","P-FXP0007179","","","2025-12-23","2035-12-23",48.0,0.0,0.0,"OK","2025-12-22","0000248401","TD25UV09116","",3652],["FIXPRICE","3000848","Ozone Power Laundry Detergent Gel 1L","12","Each","W2C2C1101A","W2C2C","B-FXP0071689","","","2025-05-18","2027-04-18",24.0,0.0,0.0,"OK","2026-10-02","0000279540","PO 6207653342","LOCAL DROGERIE",700],["FIXPRICE","1521141","Al Ain 500Ml","12","Each","W2C3H0620B","W2C3-HI-02","B-FXP0075615","","","2026-07-30","2027-07-29",1428.0,0.0,0.0,"OK","2026-08-17","0000277440","PO 6207473504","",364],["FIXPRICE","5880202","CARD-HOLDER WALLET,I!","6","Each","W1AW1160A","WA02-AW","P-FXP0029062502","","","2026-07-08","2036-07-08",288.0,0.0,0.0,"OK","2026-07-02","0000275233","CHINA CONTAINER","",3653],["FIXPRICE","3101249","Sen Comfort Pantyliner PREMIUM 20PCS/BOX","48","Each","W2C2C1202B","W2C2C","P-FXP0029062592","","","2025-10-24","2028-10-24",48.0,0.0,0.0,"OK","2026-07-17","0000275946","PO 6207339500","",1096],["FIXPRICE","5092555","Culinary brush, oKitchen","24","Each","W1AX1250B","WA02-AX","P-FXP0007114","123","","2026-07-01","2036-07-01",120.0,0.0,0.0,"OK","2025-12-22","0000248401","TD25UV09116","",3653],["FIXPRICE","5060507","Rope with 13 clips, 10 m ,HOME TIME","24","Each","W1MZA173","WA02-MZ","LPN0016645128","SEGU6637762","","2026-07-01","2036-07-01",264.0,0.0,0.0,"OK","2024-03-21","0000179906","OX-UAETX0003","",3653],["FIXPRICE","5055022","Shoe horn, 45 cm, Home Time","24","Each","W1MZA005","WA02-MZ","LPN0016645210","EISU9007794","","2026-07-01","2036-07-01",72.0,0.0,0.0,"OK","2024-02-28","0000179904","Q23UV11255","",3653],["FIXPRICE","5079151","Storage basket, Home time COUNTRY OF ORIGIN:PRC","24","Each","W1AW0350C","WA02-AW","P-FXP0029062539","08/07/2026","","2026-07-08","2036-07-08",120.0,0.0,0.0,"OK","2026-07-02","0000275233","CHINA CONTAINER","",3653],["FIXPRICE","5310373","Paper decoration, 2 pcs","24","Each","W1AX1620B","WA02-AX","5FXP00002878","","","2024-08-01","2034-08-01",336.0,0.0,0.0,"OK","2024-09-12","0000190032","WMS0000190032","LOCAL DROGERIE",3652],["FIXPRICE","5710396","Spiral manuscript book A4 square 96 sh.","4","Each","W1MZB019","WA02-MZ","","","","2024-01-01","2034-01-01",28.0,0.0,0.0,"OK","2024-06-14","0000181864","PO 6204645295","",3653],["TGD","7000004","9345156174450-Chemist Warehouse Pencil Case GWP","1","Each","SHORT","GENERAL","SMZ3112240001","","9345156236592","","2026-12-01",200.0,0.0,0.0,"HOLD","2024-12-31","0000200557","First Inbound","",0],["TGD","7000294","9345156233829-My Beauty Hair Brush Vent","6","Each","SHORT","GENERAL","5SM00000759","","9345156233829","2024-12-01","2026-12-01",1.0,0.0,0.0,"HOLD","2024-12-31","0000200557","First Inbound","LOCAL DROGERIE",730],["TGD","7000243","9345156055193-Natural Beauty Bamboo Bath Brush Massager With","6","Each","SHORT","GENERAL","LPN0016834699","42026003","9345156055193","","2027-07-31",12.0,0.0,0.0,"HOLD","2025-07-23","0000227616","AUMEL to AEJEA","LOCAL DROGERIE",0],["TGD","7000184","9345156234550-My Beauty Cosmetic Brush Cleansing Pad","6","Each","SHORT","GENERAL","5SM00000382","","9345156234550","2024-12-01","2026-12-01",1.0,0.0,0.0,"HOLD","2024-12-31","0000200557","First Inbound","LOCAL DROGERIE",730],["TGD","7000073","9345156154308-Health & Beauty Cotton Balls 400","18","Each","SHORT","GENERAL","5SM00000387","","9345156154308","2024-12-01","2026-12-01",1.0,0.0,0.0,"HOLD","2024-12-31","0000200557","First Inbound","LOCAL DROGERIE",730],["TGD","7000404","Shop Fitting Mesh 365x2000","12","Each","W1BA0330A","WA02-BA","LPNG20272940","","","2025-12-01","2025-12-31",12.0,0.0,0.0,"HOLD","2026-08-21","0000277614","ABU DHABI MALL","",30],["TGD","7000126","9345156080324-Health & Wellness Liquid Dropper 3.5ml","6","Each","W2C2M1402A","W2C2M","5SM00000464","","9345156080324","2024-12-01","2026-12-01",69.0,0.0,0.0,"OK","2024-12-31","0000200557","First Inbound","LOCAL DROGERIE",730],["TGD","7000136","9345156221222-My Beauty Silk Eye Mask Pink","6","Each","W2C2M1402A","W2C2M","5SM00000751","","9345156221222","2024-12-01","2026-12-01",12.0,0.0,0.0,"OK","2024-12-31","0000200557","First Inbound","LOCAL DROGERIE",730],["TGD","7015015","INC Water Bottle 2.2 Litre Flip Top Matte Black","12","Bottle","W2C2B1403B","W2C2B","LPNG25093625","2697097","9345156207462","2025-06-01","2027-06-30",228.0,0.0,0.0,"OK","2025-11-12","0000242232","China","",759],["TGD","7015015","INC Water Bottle 2.2 Litre Flip Top Matte Black","12","Bottle","W2C2B1403C","W2C2B","LPNG25093626","2697097","9345156207462","2025-06-01","2027-06-30",228.0,0.0,0.0,"OK","2025-11-12","0000242232","China","",759],["TGD","7015015","INC Water Bottle 2.2 Litre Flip Top Matte Black","12","Bottle","W2C2B1104C","W2C2B","LPNG25093622","2697097","9345156207462","2025-06-01","2027-06-30",18.0,0.0,0.0,"OK","2025-11-12","0000242232","China","",759],["TGD","7015015","INC Water Bottle 2.2 Litre Flip Top Matte Black","12","Bottle","W2C2B1205A","W2C2B","LPNG25093623","2697097","9345156207462","2025-06-01","2027-06-30",228.0,0.0,0.0,"OK","2025-11-12","0000242232","China","",759],["TGD","7015015","INC Water Bottle 2.2 Litre Flip Top Matte Black","12","Bottle","W2C2C1004A","W2C2C","LPNG25093627","2697097","9345156207462","2025-06-01","2027-06-30",228.0,0.0,0.0,"OK","2025-11-12","0000242232","China","",759],["TGD","7015015","INC Water Bottle 2.2 Litre Flip Top Matte Black","12","Bottle","W2C2C1004B","W2C2C","LPNG25093629","2697097","9345156207462","2025-06-01","2027-06-30",228.0,0.0,0.0,"OK","2025-11-12","0000242232","China","",759],["TGD","7015015","INC Water Bottle 2.2 Litre Flip Top Matte Black","12","Bottle","W2C2C1004C","W2C2C","LPNG25093628","2697097","9345156207462","2025-06-01","2027-06-30",228.0,0.0,0.0,"OK","2025-11-12","0000242232","China","",759],["TGD","7015015","INC Water Bottle 2.2 Litre Flip Top Matte Black","12","Bottle","W2C2D0506C","W2C2D","LPNG25093630","2697097","9345156207462","2025-06-01","2027-06-30",228.0,0.0,0.0,"OK","2025-11-12","0000242232","China","",759],["TGD","7038401","9345156260504-Chemist Warehouse Handle Bag (Small)","400","Each","W2C2M1806B","W2C2M","LPNG20275923","","","","",8000.0,0.0,0.0,"OK","2026-09-21","0000279073","PAPER BAG","",0],["TGD","7025696","9345156267572-Wagner Body Science Copper Infused Elbow Suppo","1","Each","W2C2M1202C","W2C2M","LPNG20270734","52027001","9345156267572","2026-06-20","2028-06-20",15.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","",731],["TGD","7000140","9345156243743-MyTravelPro Luggage Strap","6","Each","W2C2M1103A","W2C2M","5SM00000291","","9345156243743","2024-12-01","2026-12-01",33.0,0.0,0.0,"OK","2024-12-31","0000200557","First Inbound","",730],["TGD","7000215","9345156255319-My Beauty Body Exfoliating Puff","144","Each","W2C2M1302B","W2C2M","LPNG20271458","52028003","9345156255319","2026-06-20","2028-06-20",105.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","LOCAL DROGERIE",731],["TGD","7002602","Maybelline Lifter Lip Gloss With Hyaluronic Acid 04 Sil","1","Each","W2C2L0401A","W2C2L","103","","","","2028-12-20",12.0,0.0,0.0,"OK","2026-10-01","0000279811","WMS0000279811","",0],["TGD","7000313","9345156217270-Ultra Beauty Cosmetic Bag Black Small Oval Pou","10","Each","W2C2M0502C","W2C2M","LPNG20271381","52026051","9345156217270","2026-06-20","2028-06-20",40.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","LOCAL DROGERIE",731],["TGD","7025651","9345156268005-W H H Adjustable Walking Stick Black","1","Each","W2C2M0704A","W2C2M","LPNG20271679","52021170","9345156268005","2026-06-20","2028-06-20",9.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","",731],["TGD","7000294","9345156233829-My Beauty Hair Brush Vent","6","Each","W2C2M0103B","W2C2M","LPNG20271610","52021052","9345156233829","2026-06-20","2028-06-20",24.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","LOCAL DROGERIE",731],["TGD","7007638","9416967912682-Gel Heel Cushion Large","1","Each","W2C2M1101C","W2C2M","LPN0016834532","","9416967912682","","",216.0,0.0,0.0,"OK","2025-04-15","0000218742","NEATFEAT","",0],["TGD","7002223","Garnier Ultra Doux Hair Food Cocoa Mask 390ml","1","Each","W2C2C0101A","W2C2C","340","","","","2028-12-20",18.0,0.0,0.0,"OK","2026-10-01","0000279811","WMS0000279811","",0],["TGD","7021569","9416967911104-Maxi Foot Support Medium","1","Each","W2C2M1401C","W2C2M","LPN0016834540","","9416967911104","","",39.0,0.0,0.0,"OK","2025-04-15","0000218742","NEATFEAT","",0],["TGD","7030131","9331880038731-MCoBeauty XtendBrows Shape & Sculpt Pencil Lig","1","Each","W2C2L1801C","W2C2L","LPNG20269241","PC011","9331880038731","2026-05-01","2028-05-31",41.0,0.0,0.0,"OK","2026-05-02","0000268820","PO0004403","",761],["TGD","7026909","9400581048131-Wagner Vitamins Grape Seed 12,000 300 Capsules","1","Each","W2C2L2102C","W2C2L","LPNG20268385","209604","9400581048131","2025-09-08","2028-09-08",12.0,0.0,0.0,"OK","2026-06-02","0000272125","WMS0000272125","",1096],["TGD","7014930","9349254002080-Goat Body Wash with Lemon Myrtle 500ml","1","Each","W2C2L0703A","W2C2L","LPNG20271141","2507028","9349254002080","2025-07-01","2028-07-31",21.0,0.0,0.0,"OK","2026-07-01","0000275317","WMS0000275317","",1126],["TGD","7032852","9421908105559-Antipode Manuka+Orange Vol & Shine Condi 340ml","1","Each","W2C2M1801B","W2C2M","LPNG20271938","52547E","9421908105559","2024-01-01","2027-01-01",30.0,0.0,0.0,"OK","2026-06-13","0000273881","WMS0000273881","",1096],["TGD","7022454","9345156259270-N Beauty 2in1 Storage Cotton Rounds and Tips","1","Each","W2C2L1401B","W2C2L","LPNG20272816","52024051","9345156259270","2026-06-20","2028-06-20",24.0,0.0,0.0,"OK","2026-06-27","0000275280","WMS0000275280","",731],["TGD","7007641","9416967912668-Gel Line Toe Cap","1","Each","W2C2M1101B","W2C2M","LPN0016835597","","9416967912668","","",43.0,0.0,0.0,"OK","2025-04-15","0000218742","NEATFEAT","",0],["TGD","7002174","Garnier SkinActive Fast Bright Vitamin C Face Wash 100m","1","Each","W2C2L1301B","W2C2L","LPNG20275775","68A307","3061376204239","2026-03-01","2029-03-30",12.0,0.0,0.0,"OK","2026-09-19","0000279185","WMS0000279185","",1125],["TGD","7026791","9300807287354-B Odourless Fish Oil 1000mg 400 Capsules","12","Each","W2C2L0201B","W2C2L","LPNIB061225507","327355","9300807287354","","2028-08-21",21.0,0.0,0.0,"OK","2025-12-09","0000246415","PO00D365","",0],["TGD","7000396","Shop Fitting Shelf Bottom 370x900","6","Each","W2C2K2001A","W2C2K","LPN0016865400","","","2025-05-01","2027-05-31",216.0,0.0,0.0,"OK","2025-10-10","0000237991","WMS0000237991","",760],["TGD","7002772","Essie Gel Couture 40 Fairy Tailor 13.5ml","1","Each","W2C2C0101A","W2C2C","602","","","","2028-12-20",6.0,0.0,0.0,"OK","2026-10-01","0000279811","WMS0000279811","",0],["TGD","7002706","Essie Nail Polish 49 Wicked 13.5ml","1","Each","W2C2C0101A","W2C2C","412","","","","2028-12-20",6.0,0.0,0.0,"OK","2026-10-01","0000279811","WMS0000279811","",0],["TGD","7000056","9345156239203-My Beauty Hair No Crease Clips 6 Pack","6","Each","W2C2M1702C","W2C2M","LPNG20271582","42027003","9345156239203","2026-06-20","2028-06-20",36.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","LOCAL DROGERIE",731],["TGD","7015082","9345156081802-Wagner Body Science Thermal Support Knee Adjus","1","Each","W2C2M0402A","W2C2M","LPNG20271161","52020103","9345156081802","2026-06-20","2028-06-20",30.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","",731],["TGD","7000113","9345156026773-My Beauty Tools 10X Mag Mirror With Suction Cu","36","Each","W2C2M1201B","W2C2M","5SM00000619","","9345156026773","2024-12-01","2026-12-01",23.0,0.0,0.0,"OK","2024-12-31","0000200557","First Inbound","LOCAL DROGERIE",730],["TGD","7000241","9345156235779-My Beauty Cosmetic Organiser","8","Each","W2C2L0101A","W2C2L","LPNG20271762","2673396","9345156235779","2026-06-20","2028-06-20",9.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","LOCAL DROGERIE",731],["TGD","7033368","9360964000227-Sodii Everyday Hydration Salts Salty Mandarin","1","Each","W2C2L2003C","W2C2L","LPNG20271846","2025111006","9360964000227","","2027-11-10",72.0,0.0,0.0,"OK","2026-06-20","0000274389","PO0000209","",0],["TGD","7030045","9331880032654-MCo Liquid Lip Liner Luxe Pink","1","Each","W2C2L1802A","W2C2L","LPNG20269312","BN0924","9331880032654","2026-05-01","2028-05-31",5.0,0.0,0.0,"OK","2026-05-02","0000268820","PO0004403","",761],["TGD","7022440","9345156255234-My Beauty Body Dual Sided Magnifying Table Mir","1","Each","W2C2M2101A","W2C2M","LPNG20271771","2719395","9345156255234","2026-06-20","2028-06-20",6.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","",731],["TGD","7002375","Loreal Paris Excellence 9.1 Very Light Ash Blonde","1","Each","W2C2L1102A","W2C2L","LPNG20275808","68A407","3600520887593","2026-01-01","2028-01-31",6.0,0.0,0.0,"OK","2026-09-19","0000279185","WMS0000279185","",760],["TGD","7033600","L P H Tint Lip Stain Serum 420 Le Rouge Paris 5ml","1","Each","W2C2C0101A","W2C2C","404","","","","2028-12-20",3.0,0.0,0.0,"OK","2026-10-01","0000279811","WMS0000279811","",0],["TGD","7022437","9345156256576-My Beauty Body Dry Brush","1","Each","W2C2M0202A","W2C2M","LPNG20271143","52028003","9345156256576","2026-06-20","2028-06-20",12.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","",731],["TGD","7032259","9331880043506-MCoBeauty Baked Blush Rose Gold","1","Each","W2C2M0602C","W2C2M","LPNG20261418","4055","9331880043506","2025-12-01","2028-12-31",5.0,0.0,0.0,"OK","2026-02-06","0000254916","SO747596","",1126],["TGD","7029995","9331880041533-MCo Golden Glow Lip Oil Coconut Shimmer","1","Each","W2C2L1902C","W2C2L","LPNG20269292","2626","9331880041533","2026-05-01","2028-05-31",2.0,0.0,0.0,"OK","2026-05-02","0000268820","PO0004403","",761],["TGD","7015046","9345156082076-Wagner Body Science Flex Control Brace Right W","1","Each","W2C2L0703A","W2C2L","LPNG20271136","2662508","9345156082076","2026-06-20","2028-06-20",59.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","",731],["TGD","7002524","Maybelline Fit Me Concealer 30 Cafe","1","Each","W2C2C0101A","W2C2C","420","","","","2028-12-20",30.0,0.0,0.0,"OK","2026-10-01","0000279811","WMS0000279811","",0],["TGD","7002615","M Lifter Lip Liner With Hyaluronic Acid 10 Main Charact","1","Each","W2C2M2101B","W2C2M","LPNG20275596","MNY9003","3600531692100","2026-01-01","2028-01-31",9.0,0.0,0.0,"OK","2026-09-19","0000279185","WMS0000279185","",760],["TGD","7002263","Loreal Paris Casting Creme Gloss 426 Auburn","1","Each","W2C2C0101A","W2C2C","325","","","","2028-12-20",12.0,0.0,0.0,"OK","2026-10-01","0000279811","WMS0000279811","",0],["TGD","7030128","9331880007065-MCoBeauty Waterproof Full Lash Mascara","1","Each","W2C2L1703C","W2C2L","LPNG20269233","42772507","9331880007065","2026-05-01","2028-05-31",20.0,0.0,0.0,"OK","2026-05-02","0000268820","PO0004403","",761],["TGD","7028096","Loreal Paris Elvive Fall Resist Serum 102ml","1","Each","W2C2L0701B","W2C2L","LPNG20275832","10Z000","3600524079017","2026-01-01","2028-01-31",6.0,6.0,0.0,"OK","2026-09-19","0000279185","WMS0000279185","",760],["TGD","7015697","SHELF SHOP DIVIDER 300MM x 60MM","200","Each","W1BN0550A","WA02-BN","LPNG20272554","000853","9315340505735","2026-07-01","2028-07-01",4200.0,0.0,0.0,"OK","2026-07-29","0000276691","WMS0000276691","",731],["TGD","7002313","Loreal Paris Elvive Extraordinary Oil Normal Hair Shamp","1","Each","W2C2M0401A","W2C2M","LPNG20275627","68A502","3610340019982","2026-01-01","2028-01-31",3.0,0.0,0.0,"OK","2026-09-19","0000279185","WMS0000279185","",760],["TGD","7022432","9345156256040-Health & Wellness Adjustable Soft Arm Sling","1","Each","W2C2M0903C","W2C2M","LPNG20270732","52020103","9345156256040","2026-06-20","2028-06-20",27.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","",731],["TGD","7015017","Merchandising Paper Pink Fluoro 5 Reams Per Box","1","Each","W2C2M1104B","W2C2M","LPNG20271615","","2586360","2026-06-20","2029-06-20",50.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","",1096],["TGD","7040634","H Boost Iron  Vit C Berry 20 Effervescent Tablets","1","Each","W2C2M1706C","W2C2M","LPNG20275420","175554","94975802","2025-10-10","2027-10-09",228.0,0.0,0.0,"OK","2026-09-25","0000279238","WMS0000279238","",729],["TGD","7022420","9345156241398-Foster Grant Sunglasses Iron Man Sport","1","Each","W2C2M1802B","W2C2M","LPNG20271542","","9345156212589","2026-06-20","2028-06-20",6.0,0.0,0.0,"OK","2026-06-26","0000274714","WMS0000274714","",731],["TGD","7038402","9345156260498-Chemist Warehouse Handle Bag (Medium)","250","Each","W2C2N0750B","W2C2N","LPNG20273037","","","","",5250.0,0.0,0.0,"OK","2026-08-20","0000277552","PAPER BAG","",0],["TGD","7000015","9345156130524-Comfy Feet Cushion Callus 4 Pieces","12","Each","W2C2M1302B","W2C2M","5SM00000440","","9345156130524","2024-12-01","2026-12-01",54.0,0.0,0.0,"OK","2024-12-31","0000200557","First Inbound","",730],["TGD","7030004","9331880020866-Beauty Highlight & Glow Beauty Wand Champagne","1","Each","W2C2L1802A","W2C2L","LPNG20269316","240101701","9331880020866","2026-05-01","2028-05-31",17.0,0.0,0.0,"OK","2026-05-02","0000268820","PO0004403","",761]];
function uaeToday() { return new Date(Date.now() + 4 * 3600e3).toISOString().slice(0, 10); }
function guessKind(code) { const c = String(code).toUpperCase();
  return /DAMAGE|DMG/.test(c) ? "damage" : /^SHORT/.test(c) ? "short" : /QUAR|QRT/.test(c) ? "quarantine" : /^OUT|DISPATCH|SHIP/.test(c) ? "outbound" : /^STAGE|^STG|^RECV|^REC-|INBOUND/.test(c) ? "staging" : /^DOCK/.test(c) ? "dock" : "storage"; }
const sid = p => p + "-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
function newClient(code, name) { return {id: sid("cl"), code, name: name || "", active: true, track_batch: "optional", track_expiry: "optional", track_mfg: "optional", batch_label: "Batch", ref2_label: "Lot ref 2", allocation: "FEFO", min_life_receive_pct: 0, min_life_ship_days: 0, near_expiry_days: 90, auto_hold_expired: true, notes: "", created_at: tick(), updated_at: tick()}; }
function newItem(client_id, sku, x = {}) { return {id: sid("it"), client_id, sku, description: "", barcode: "", base_uom: "Each", case_qty: 1, case_uom: "Case", item_group: "", item_group2: "", shelf_life_days: 0, unit_cost: 0, active: true, created_at: tick(), updated_at: tick(), ...x}; }
function newLoc(code, zone) { const k = guessKind(code); return {id: sid("lc"), code, site_id: null, zone: zone || "", kind: k, hold: ["damage", "short", "quarantine"].includes(k), mixed_allowed: true, active: true, notes: "", created_at: tick()}; }
function seedStock(S) {
  S.clients = []; S.items = []; S.locations = []; S.inventory = []; S.stockMoves = []; S.stockImports = []; S.stockImportRows = [];
  const rows = STOCK_SAMPLE.map(r => ({client: r[0], sku: r[1], descr: r[2], case_qty: r[3], uom: r[4], loc: r[5], zone: r[6], lpn: r[7], batch: r[8], ref2: r[9], mfg: r[10], exp: r[11], qty: r[12], alloc: r[13], picked: r[14], status: r[15], in_date: r[16], asn: r[17], ext_ref: r[18], group2: r[19], shelf_life: r[20]}));
  rows.forEach(r => { r.client_name = r.client === "TGD" ? "TGD GLOBAL DISTRIBUTION TRADING L.L.C" : "FIX PRICE GENERAL TRADING L.L.C"; if (/^\d{8,14}$/.test(r.ref2)) r.barcode = r.ref2; });
  stockApply(S, rows, "Sample stock (from your WMS report)", null, true);
  const fx = S.clients.find(c => c.code === "FIXPRICE"); if (fx) Object.assign(fx, {batch_label: "Container no.", track_batch: "optional", track_expiry: "required", near_expiry_days: 90});
  const tg = S.clients.find(c => c.code === "TGD"); if (tg) Object.assign(tg, {batch_label: "Batch", ref2_label: "EAN / lot barcode", track_batch: "optional", track_expiry: "optional", min_life_ship_days: 60});
}
// Apply stock rows for the clients they mention (replaces those clients' stock), like stock_import_finish
function stockApply(S, rows, file, me, quiet) {
  const up = s => String(s || "").trim().toUpperCase();
  const codes = [...new Set(rows.map(r => up(r.client)))];
  codes.forEach(code => { let c = S.clients.find(x => x.code === code); const nm = (rows.find(r => up(r.client) === code && r.client_name) || {}).client_name || "";
    if (!c) S.clients.push(c = newClient(code, nm)); else if (nm) c.name = nm; });
  const cl = new Map(S.clients.map(c => [c.code, c])), ids = new Set(codes.map(c => cl.get(c).id));
  let newItems = 0, newLocs = 0;
  const itemKey = new Map(S.items.map(i => [i.client_id + "|" + i.sku, i]));
  const seen = new Set();
  rows.forEach(r => { const c = cl.get(up(r.client)), k = c.id + "|" + up(r.sku); let it = itemKey.get(k);
    if (!it) { it = newItem(c.id, up(r.sku)); S.items.push(it); itemKey.set(k, it); newItems++; }
    if (seen.has(k) && !r.barcode) return; seen.add(k);
    if (r.descr) it.description = r.descr; it.case_qty = Math.max(+r.case_qty || 1, 1); it.base_uom = r.uom || "Each"; it.case_uom = r.case_uom || it.case_uom;
    if (r.group1) it.item_group = r.group1; if (r.group2) it.item_group2 = r.group2; if (+r.shelf_life > 0) it.shelf_life_days = +r.shelf_life; if (!it.barcode && r.barcode) it.barcode = r.barcode; it.updated_at = tick(); });
  const locKey = new Map(S.locations.map(l => [l.code, l]));
  rows.forEach(r => { const code = up(r.loc); let l = locKey.get(code); if (!l) { l = newLoc(code, r.zone); S.locations.push(l); locKey.set(code, l); newLocs++; } else if (!l.zone && r.zone) l.zone = r.zone; });
  const before = new Map(); S.inventory.filter(i => ids.has(i.client_id)).forEach(i => before.set(i.item_id, (before.get(i.item_id) || 0) + i.qty));
  S.inventory = S.inventory.filter(i => !ids.has(i.client_id));
  let n = 0;
  rows.forEach(r => { const q = +r.qty || 0; if (q <= 0) return; const c = cl.get(up(r.client)), it = itemKey.get(c.id + "|" + up(r.sku)), l = locKey.get(up(r.loc)), wmsHold = ["HOLD", "H", "BLOCKED", "QC"].includes(up(r.status || "OK")), hold = wmsHold || l.hold;
    S.inventory.push({id: sid("iv"), client_id: c.id, item_id: it.id, location_id: l.id, lpn: r.lpn || "", batch: r.batch || "", ref2: r.ref2 || "", mfg_date: r.mfg || null, expiry_date: r.exp || null, received_at: r.in_date || null, asn: r.asn || "", ext_ref: r.ext_ref || "",
      qty: q, allocated_qty: Math.min(+r.alloc || 0, q), picked_qty: Math.min(+r.picked || 0, q), status: hold ? "hold" : "ok", hold_reason: wmsHold ? "On hold in the WMS" : l.hold ? "In " + l.code : "", updated_at: tick(), updated_by: me ? me.id : null}); n++; });
  const after = new Map(); S.inventory.filter(i => ids.has(i.client_id)).forEach(i => after.set(i.item_id, (after.get(i.item_id) || 0) + i.qty));
  let changed = 0;
  const had = new Set(S.items.filter(i => before.has(i.id)).map(i => i.client_id));   // first load of a client = opening stock, no per-item lines
  if (!quiet) S.items.filter(i => ids.has(i.client_id) && had.has(i.client_id)).forEach(i => { const b = before.get(i.id) || 0, a = after.get(i.id) || 0; if (a !== b) { changed++; S.stockMoves.push(mv({kind: "import", client_id: i.client_id, item_id: i.id, qty: a - b, qty_before: b, qty_after: a, reason: "Stock file loaded", ref: file}, me)); } });
  const held = holdExpired(S, me);
  const inv = S.inventory.filter(i => ids.has(i.client_id));
  return {clients: codes.sort(), rows: n, qty: inv.reduce((s, i) => s + i.qty, 0), new_items: newItems, new_locations: newLocs, changed_items: changed, expired_held: held, hold_rows: inv.filter(i => i.status === "hold").length};
}
function mv(x, me) { return {id: sid("mv"), created_at: tick(), user_id: me ? me.id : null, kind: "", client_id: null, item_id: null, inventory_id: null, from_loc: "", to_loc: "", lpn: "", batch: "", expiry_date: null, qty: null, qty_before: null, qty_after: null, reason: "", note: "", ref: "", device: null, client_uuid: null, ...x}; }
function holdExpired(S, me) { const t = uaeToday(), cl = new Map(S.clients.map(c => [c.id, c])), lc = new Map(S.locations.map(l => [l.id, l])); let n = 0;
  S.inventory.forEach(i => { if (i.status === "ok" && i.expiry_date && i.expiry_date < t && (cl.get(i.client_id) || {}).auto_hold_expired) { i.status = "hold"; i.hold_reason = "Expired"; i.updated_at = tick(); n++;
    S.stockMoves.push(mv({kind: "hold", client_id: i.client_id, item_id: i.item_id, inventory_id: i.id, from_loc: (lc.get(i.location_id) || {}).code || "", lpn: i.lpn, batch: i.batch, expiry_date: i.expiry_date, qty: i.qty, qty_before: i.qty, qty_after: i.qty, reason: "Expired (automatic)"}, me)); } });
  return n; }
function invView() {
  const t = uaeToday(), cl = new Map(S.clients.map(c => [c.id, c])), it = new Map(S.items.map(i => [i.id, i])), lc = new Map(S.locations.map(l => [l.id, l]));
  const days = d => Math.round((Date.parse(d) - Date.parse(t)) / 864e5);
  return S.inventory.map(i => { const c = cl.get(i.client_id) || {}, m = it.get(i.item_id) || {}, l = lc.get(i.location_id) || {}, dte = i.expiry_date ? days(i.expiry_date) : null;
    const expired = i.expiry_date && i.expiry_date < t;
    return {...i, client_code: c.code, client_name: c.name, batch_label: c.batch_label, ref2_label: c.ref2_label, near_expiry_days: c.near_expiry_days,
      sku: m.sku, description: m.description, barcode: m.barcode, base_uom: m.base_uom, case_qty: m.case_qty, case_uom: m.case_uom, item_group: m.item_group, item_group2: m.item_group2, shelf_life_days: m.shelf_life_days,
      location: l.code, zone: l.zone, location_kind: l.kind, location_hold: !!l.hold, days_to_expiry: dte,
      life_left_pct: i.expiry_date && m.shelf_life_days ? Math.round(Math.max(dte, 0) / m.shelf_life_days * 100) : null,
      expiry_state: !i.expiry_date ? "none" : expired ? "expired" : dte <= c.near_expiry_days ? "near" : "ok",
      available_qty: i.status === "ok" && !l.hold && !(c.auto_hold_expired && expired) ? Math.max(i.qty - i.allocated_qty - i.picked_qty, 0) : 0, updated_by_name: uname(i.updated_by)}; });
}
function itemStockView() {
  const cl = new Map(S.clients.map(c => [c.id, c])), agg = new Map();
  invView().forEach(v => { let a = agg.get(v.item_id); if (!a) agg.set(v.item_id, a = {qty: 0, allocated_qty: 0, picked_qty: 0, available_qty: 0, hold_qty: 0, stock_rows: 0, locs: new Set(), first_expiry: null});
    a.qty += v.qty; a.allocated_qty += v.allocated_qty; a.picked_qty += v.picked_qty; a.available_qty += v.available_qty; if (v.status === "hold" || v.location_hold) a.hold_qty += v.qty; a.stock_rows++; a.locs.add(v.location_id);
    if (v.expiry_date && v.qty > 0 && (!a.first_expiry || v.expiry_date < a.first_expiry)) a.first_expiry = v.expiry_date; });
  return S.items.map(i => { const a = agg.get(i.id) || {qty: 0, allocated_qty: 0, picked_qty: 0, available_qty: 0, hold_qty: 0, stock_rows: 0, locs: new Set(), first_expiry: null};
    return {item_id: i.id, client_id: i.client_id, client_code: (cl.get(i.client_id) || {}).code, sku: i.sku, description: i.description, barcode: i.barcode, base_uom: i.base_uom, case_qty: i.case_qty, case_uom: i.case_uom, item_group: i.item_group, item_group2: i.item_group2, shelf_life_days: i.shelf_life_days, unit_cost: i.unit_cost, active: i.active,
      qty: a.qty, allocated_qty: a.allocated_qty, picked_qty: a.picked_qty, available_qty: a.available_qty, hold_qty: a.hold_qty, stock_rows: a.stock_rows, locations: a.locs.size, first_expiry: a.first_expiry}; });
}
const stockViews = {
  clients: () => S.clients, items: () => S.items, locations: () => S.locations, inventory: () => S.inventory, stock_imports: () => S.stockImports,
  inventory_v: invView, item_stock_v: itemStockView,
  stock_move_list: () => { const cl = new Map(S.clients.map(c => [c.id, c])), it = new Map(S.items.map(i => [i.id, i])); return S.stockMoves.map(m => ({...m, client_code: (cl.get(m.client_id) || {}).code || null, sku: (it.get(m.item_id) || {}).sku || null, description: (it.get(m.item_id) || {}).description || null, user_name: uname(m.user_id)})); }
};
const bumpStock = () => { S.stockVer = (S.stockVer || 0) + 1; };
const STOCK_TABLES = {asns: () => S.asns, clients: () => S.clients, items: () => S.items, locations: () => S.locations, stock_imports: () => S.stockImports, stock_import_rows: () => S.stockImportRows};
function stockInsert(table, r, me) {
  bumpStock();
  const up = s => String(s || "").trim().toUpperCase();
  if (table === "clients") { const code = up(r.code); if (!code) return {__err: "Enter the client code"}; if (S.clients.some(c => c.code === code)) return {__err: "A client with this code already exists"}; const x = {...newClient(code, ""), ...r, code}; S.clients.push(x); return x; }
  if (table === "items") { const sku = up(r.sku); if (!sku || !r.client_id) return {__err: "Enter the client and SKU"}; if (S.items.some(i => i.client_id === r.client_id && i.sku === sku)) return {__err: "This SKU already exists for this client"}; const x = {...newItem(r.client_id, sku), ...r, sku}; S.items.push(x); return x; }
  if (table === "locations") { const code = up(r.code); if (!code) return {__err: "Enter the location code"}; if (S.locations.some(l => l.code === code)) return {__err: `Location ${code} already exists`}; const x = {...newLoc(code, r.zone), ...r, code}; S.locations.push(x); return x; }
  if (table === "stock_imports") { const x = {id: sid("imp"), file_name: "", status: "staging", summary: {}, created_by: me.id, created_at: tick(), finished_at: null, ...r}; S.stockImports.push(x); return x; }
  if (table === "stock_import_rows") { S.stockImportRows.push({...r}); return r; }
}
function stockDelete(table, ids) {
  bumpStock();
  if (table === "items") { if (S.inventory.some(i => ids.has(i.item_id))) return "This item has stock, so it can't be deleted. Turn it off instead."; S.items = S.items.filter(i => !ids.has(i.id)); }
  if (table === "locations") { if (S.inventory.some(i => ids.has(i.location_id))) return "This location has stock, so it can't be deleted. Turn it off instead."; S.locations = S.locations.filter(l => !ids.has(l.id)); }
  if (table === "clients") { if (S.inventory.some(i => ids.has(i.client_id))) return "This client has stock, so it can't be deleted. Turn it off instead."; S.clients = S.clients.filter(c => !ids.has(c.id)); S.items = S.items.filter(i => !ids.has(i.client_id)); }
  if (table === "stock_import_rows") S.stockImportRows = S.stockImportRows.filter(r => !ids.has(r.id));
  return null;
}
function stockRpc(name, a, me, staff) {
  if (!me || !me.active) return E("Your user is not active");
  if (!["stock_lookup", "stock_summary"].includes(name)) bumpStock();
  const up = s => String(s || "").trim().toUpperCase(), t = uaeToday();
  const loc = id => S.locations.find(l => l.id === id), cli = id => S.clients.find(c => c.id === id);
  switch (name) {
    case "stock_hold_expired": return {data: holdExpired(S, me), error: null};
    case "stock_summary": { const V = invView().filter(v => !a.p_client || v.client_code === up(a.p_client)), sum = (f, k = "qty") => V.filter(f).reduce((s, v) => s + (+v[k] || 0), 0), cnt = f => V.filter(f).length, all = () => true, hold = v => v.status === "hold" || v.location_hold;
      return {data: {rows: V.length, qty: sum(all), available: sum(all, "available_qty"), allocated: sum(all, "allocated_qty"), picked: sum(all, "picked_qty"), hold_qty: sum(hold), hold_rows: cnt(hold),
        expired_rows: cnt(v => v.expiry_state === "expired"), expired_qty: sum(v => v.expiry_state === "expired"), near_rows: cnt(v => v.expiry_state === "near"), near_qty: sum(v => v.expiry_state === "near"),
        items: new Set(V.map(v => v.item_id)).size, locations: new Set(V.map(v => v.location_id)).size, clients: new Set(V.map(v => v.client_id)).size}, error: null}; }
    case "stock_import_finish": {
      if (!staff) return E("Only supervisors can load stock files");
      const imp = S.stockImports.find(x => x.id === a.p_import); if (!imp) return E("Import not found"); if (imp.status !== "staging") return E("This file has already been loaded");
      const rows = S.stockImportRows.filter(r => r.import_id === imp.id).sort((x, y) => x.row_no - y.row_no).map(r => r.data);
      if (!rows.length) return E("The file has no stock rows");
      if (rows.some(r => !up(r.client) || !up(r.sku) || !up(r.loc))) return E("Every row needs a client, a SKU and a location");
      if (rows.some(r => +r.qty < 0 || +r.alloc < 0 || +r.picked < 0)) return E("Quantities can't be negative");
      const sum = stockApply(S, rows, imp.file_name, me);
      Object.assign(imp, {status: "done", finished_at: tick(), summary: sum}); S.stockImportRows = S.stockImportRows.filter(r => r.import_id !== imp.id);
      return {data: sum, error: null};
    }
    case "stock_lookup": {
      const v = up(a.p_code); if (!v) return {data: {kind: "none", rows: []}, error: null};
      const V = invView(), by = (k, f, o) => ({data: {kind: k, label: o || v, rows: V.filter(f).sort((x, y) => String(x.location).localeCompare(String(y.location))), location: k === "location" ? S.locations.find(l => l.code === v) : null}, error: null});
      if (S.inventory.some(i => up(i.lpn) === v)) return by("lpn", x => up(x.lpn) === v);
      if (S.locations.some(l => l.code === v)) return by("location", x => x.location === v);
      const its = S.items.filter(i => i.sku === v || (i.barcode && up(i.barcode) === v));
      if (its.length) { const ids = new Set(its.map(i => i.id)); const r = by("item", x => ids.has(x.item_id), [...new Set(its.map(i => i.sku))].join(", ")); r.data.rows.sort((x, y) => String(x.expiry_date || "9999").localeCompare(String(y.expiry_date || "9999"))); return r; }
      return {data: {kind: "none", label: v, rows: []}, error: null};
    }
    case "stock_move": {
      if (a.p_client_id) { const m = S.stockMoves.find(x => x.client_uuid === a.p_client_id); if (m) return {data: {ok: true, repeat: true, inventory_id: m.inventory_id}, error: null}; }
      const s = S.inventory.find(i => i.id === a.p_inv); if (!s) return E("This stock is no longer there. Refresh and scan again.");
      const f = loc(s.location_id), to = up(a.p_to), tl = S.locations.find(l => l.code === to);
      if (!tl) return E(`Location ${to} doesn't exist`); if (!tl.active) return E(`Location ${tl.code} is turned off`); if (tl.id === s.location_id) return E(`The stock is already in ${tl.code}`);
      const q = a.p_qty == null || a.p_qty === "" ? s.qty : +a.p_qty; if (!(q > 0)) return E("Enter a quantity above 0");
      const free = s.qty - s.allocated_qty - s.picked_qty; if (q > free) return E(`Only ${free} can be moved: ${s.allocated_qty + s.picked_qty} is allocated or picked for orders`);
      if (!tl.mixed_allowed && S.inventory.some(x => x.location_id === tl.id && x.item_id !== s.item_id && x.qty > 0)) return E(`${tl.code} holds another SKU and doesn't allow mixed stock`);
      const st = tl.hold ? "hold" : s.status, rs = tl.hold && s.status === "ok" ? "In " + tl.code : s.hold_reason, before = s.qty; let n;
      if (q === s.qty) { Object.assign(s, {location_id: tl.id, status: st, hold_reason: rs, lpn: (a.p_lpn || "").trim() || s.lpn, updated_at: tick(), updated_by: me.id}); n = s; }
      else { s.qty -= q; s.updated_at = tick(); s.updated_by = me.id; n = {...s, id: sid("iv"), location_id: tl.id, lpn: (a.p_lpn || "").trim(), qty: q, allocated_qty: 0, picked_qty: 0, status: st, hold_reason: rs}; S.inventory.push(n); }
      S.stockMoves.push(mv({kind: "move", client_id: s.client_id, item_id: s.item_id, inventory_id: n.id, from_loc: f.code, to_loc: tl.code, lpn: n.lpn || s.lpn, batch: s.batch, expiry_date: s.expiry_date, qty: q, qty_before: before, qty_after: before - q,
        note: (q < before ? "Part of the pallet" : "") + (tl.hold && s.status === "ok" ? ` Put on hold (${tl.kind} location)` : ""), device: a.p_device || null, client_uuid: a.p_client_id || null}, me));
      return {data: {ok: true, inventory_id: n.id, to: tl.code, qty: q, status: n.status}, error: null};
    }
    case "stock_set_status": {
      if (!staff) return E("Only supervisors can hold or release stock");
      if (!["ok", "hold"].includes(a.p_status)) return E("Unknown status"); if (!String(a.p_reason || "").trim()) return E("Enter a reason");
      const rows = S.inventory.filter(i => (a.p_ids || []).includes(i.id)); let n = 0;
      for (const r of rows) { const l = loc(r.location_id), c = cli(r.client_id); if (r.status === a.p_status) continue;
        if (a.p_status === "ok" && l.hold) return E(`Stock in ${l.code} (${l.kind} location) can't be released. Move it to a normal location first.`);
        if (a.p_status === "ok" && c.auto_hold_expired && r.expiry_date && r.expiry_date < t) return E(`Expired stock can't be released (${r.batch || "no batch"} in ${l.code}, expired ${r.expiry_date})`); }
      for (const r of rows) { if (r.status === a.p_status) continue; const l = loc(r.location_id);
        Object.assign(r, {status: a.p_status, hold_reason: a.p_status === "hold" ? a.p_reason.trim() : "", updated_at: tick(), updated_by: me.id}); n++;
        S.stockMoves.push(mv({kind: a.p_status === "hold" ? "hold" : "release", client_id: r.client_id, item_id: r.item_id, inventory_id: r.id, from_loc: l.code, lpn: r.lpn, batch: r.batch, expiry_date: r.expiry_date, qty: r.qty, qty_before: r.qty, qty_after: r.qty, reason: a.p_reason.trim()}, me)); }
      return {data: n, error: null};
    }
    case "stock_adjust": {
      if (!staff) return E("Only supervisors can adjust stock");
      const p = a.p || {}, reason = String(p.reason || "").trim(), nq = p.qty === "" || p.qty == null ? NaN : +p.qty;
      if (!reason) return E("Choose a reason"); if (!(nq >= 0)) return E("Enter the new quantity (0 or more)");
      if (p.inventory_id) {
        const s = S.inventory.find(i => i.id === p.inventory_id); if (!s) return E("This stock is no longer there. Refresh the page.");
        if (nq === s.qty) return E("The quantity is unchanged"); if (nq < s.allocated_qty + s.picked_qty) return E(`At least ${s.allocated_qty + s.picked_qty} is allocated or picked for orders`);
        const l = loc(s.location_id), b = s.qty;
        if (nq === 0) S.inventory = S.inventory.filter(i => i !== s); else Object.assign(s, {qty: nq, updated_at: tick(), updated_by: me.id});
        S.stockMoves.push(mv({kind: "adjust", client_id: s.client_id, item_id: s.item_id, inventory_id: s.id, from_loc: l.code, lpn: s.lpn, batch: s.batch, expiry_date: s.expiry_date, qty: nq - b, qty_before: b, qty_after: nq, reason, note: String(p.note || "").trim()}, me));
        return {data: {ok: true, inventory_id: s.id, qty: nq}, error: null};
      }
      const c = S.clients.find(x => x.code === up(p.client)); if (!c) return E("Choose the client");
      const it = S.items.find(i => i.client_id === c.id && i.sku === up(p.sku)); if (!it) return E(`SKU ${up(p.sku)} isn't in the item master for ${c.code}`);
      const l = S.locations.find(x => x.code === up(p.location)); if (!l) return E(`Location ${up(p.location)} doesn't exist`);
      if (!(nq > 0)) return E("Enter a quantity above 0");
      if (c.track_batch === "required" && !String(p.batch || "").trim()) return E(`${c.batch_label} is required for ${c.code}`);
      if (c.track_expiry === "required" && !p.expiry_date) return E(`The expiry date is required for ${c.code}`);
      const n = {id: sid("iv"), client_id: c.id, item_id: it.id, location_id: l.id, lpn: String(p.lpn || "").trim(), batch: String(p.batch || "").trim(), ref2: "", mfg_date: p.mfg_date || null, expiry_date: p.expiry_date || null, received_at: tick(), asn: "", ext_ref: "", qty: nq, allocated_qty: 0, picked_qty: 0,
        status: l.hold ? "hold" : "ok", hold_reason: l.hold ? "In " + l.code : "", updated_at: tick(), updated_by: me.id};
      S.inventory.push(n);
      S.stockMoves.push(mv({kind: "adjust", client_id: c.id, item_id: it.id, inventory_id: n.id, to_loc: l.code, lpn: n.lpn, batch: n.batch, expiry_date: n.expiry_date, qty: nq, qty_before: 0, qty_after: nq, reason, note: String(p.note || "").trim()}, me));
      return {data: {ok: true, inventory_id: n.id, qty: nq}, error: null};
    }
  }
  return E("Unknown function " + name);
}

Object.assign(views, stockViews);
if (!S.clients) seedStock(S);
/* ---------- Inbound: ASNs, receiving, putaway (demo) ---------- */
function seedAsn(S) {
  S.asns = []; S.asnLines = []; S.receipts = []; S.lpnSeq = 1000;
  const cl = code => S.clients.find(c => c.code === code), now = tick();
  ["RECV-01", "RECV-02"].forEach(code => { if (!S.locations.some(l => l.code === code)) S.locations.push({...newLoc(code, "RECEIVING"), kind: "staging"}); });
  const mk = (code, asn_no, ext_ref, supplier, days, lines) => {
    const c = cl(code); if (!c) return;
    const a = {id: sid("asn"), client_id: c.id, asn_no, ext_ref, supplier, expected_date: new Date(Date.now() + days * 864e5).toISOString().slice(0, 10), status: "open", notes: "", source_file: "ASN_sample.xlsx",
      created_by: "u-sup", created_at: now, started_at: null, received_at: null, closed_at: null, closed_by: null, close_note: "", updated_at: now};
    S.asns.push(a);
    const its = S.items.filter(i => i.client_id === c.id);
    lines.forEach(([idx, qty, batch, exp], n) => { const it = its[idx % its.length]; if (!it) return; S.asnLines.push({id: sid("al"), asn_id: a.id, line_no: n + 1, item_id: it.id, expected_qty: qty, received_qty: 0, damaged_qty: 0, batch: batch || "", expiry_date: exp || null, not_on_asn: false, updated_at: now}); });
  };
  mk("TGD", "ASN-55120", "PO-77188", "Chemist Warehouse AU", 0, [[0, 120], [3, 48], [5, 200], [8, 36]]);
  mk("FIXPRICE", "ASN-60311", "PO 6207701122", "China container EISU9007794", 1, [[1, 240], [4, 96], [7, 144]]);
  mk("TGD", "ASN-55131", "PO-77190", "Chemist Warehouse AU", 2, [[10, 60], [12, 24]]);
}
const asnViews = {
  asns: () => S.asns, asn_lines: () => S.asnLines, receipts: () => S.receipts,
  asn_list: () => S.asns.map(a => { const L = S.asnLines.filter(l => l.asn_id === a.id), R = S.receipts.filter(r => r.asn_id === a.id && !r.cancelled), c = S.clients.find(x => x.id === a.client_id) || {}, sum = f => L.reduce((s, l) => s + f(l), 0);
    return {...a, client_code: c.code, client_name: c.name, created_by_name: uname(a.created_by), closed_by_name: uname(a.closed_by), lines: L.length, expected_qty: sum(l => l.expected_qty), received_qty: sum(l => l.received_qty), damaged_qty: sum(l => l.damaged_qty),
      short_qty: sum(l => Math.max(l.expected_qty - l.received_qty - l.damaged_qty, 0)), excess_qty: sum(l => Math.max(l.received_qty + l.damaged_qty - l.expected_qty, 0)), not_on_asn_lines: L.filter(l => l.not_on_asn).length,
      pallets: R.length, flagged_pallets: R.filter(r => r.flags.length || r.condition === "damaged").length, last_at: R.reduce((m, r) => !m || r.created_at > m ? r.created_at : m, null)}; }),
  asn_line_v: () => S.asnLines.map(l => { const it = S.items.find(i => i.id === l.item_id) || {}; return {...l, sku: it.sku, description: it.description, barcode: it.barcode, base_uom: it.base_uom, case_qty: it.case_qty, case_uom: it.case_uom, short_qty: Math.max(l.expected_qty - l.received_qty - l.damaged_qty, 0), excess_qty: Math.max(l.received_qty + l.damaged_qty - l.expected_qty, 0)}; }),
  receipt_v: () => S.receipts.map(r => { const it = S.items.find(i => i.id === r.item_id) || {}, a = S.asns.find(x => x.id === r.asn_id) || {}, inv = S.inventory.find(i => i.id === r.inventory_id), cl = inv ? S.locations.find(l => l.id === inv.location_id) : null;
    return {...r, asn_no: a.asn_no, sku: it.sku, description: it.description, base_uom: it.base_uom, case_qty: it.case_qty, case_uom: it.case_uom, location: (S.locations.find(l => l.id === r.location_id) || {}).code, user_name: uname(r.user_id),
      current_location: cl ? cl.code : null, current_location_kind: cl ? cl.kind : null, stock_status: inv ? inv.status : null, hold_reason: inv ? inv.hold_reason : null, put_away: !!(inv && cl && !["staging", "dock"].includes(cl.kind))}; })
};
function asnRpc(name, a, me, staff) {
  if (!me || !me.active) return E("Your user is not active");
  const up = s => String(s ?? "").trim().toUpperCase(), t = uaeToday(), ok = d => ({data: d, error: null});
  bumpStock();
  switch (name) {
    case "asn_import": {
      if (!staff) return E("Only supervisors can load ASNs");
      const p = a.p || {}, rows = (p.rows || []).map(x => ({client: up(x.client), client_name: String(x.client_name || "").trim(), asn_no: up(x.asn_no), ext_ref: String(x.ext_ref || "").trim(), supplier: String(x.supplier || "").trim(), expected_date: x.expected_date || null, sku: up(x.sku), descr: String(x.descr || "").trim(), qty: +x.qty || 0, batch: String(x.batch || "").trim(), expiry_date: x.expiry_date || null}));
      if (!rows.length) return E("The file has no ASN lines");
      if (rows.some(r => !r.client || !r.asn_no || !r.sku)) return E("Every line needs a client, an ASN number and a SKU");
      if (rows.some(r => r.qty <= 0)) return E("Every line needs a quantity above 0");
      rows.forEach(r => { if (!S.clients.some(c => c.code === r.client)) S.clients.push(newClient(r.client, r.client_name)); });
      const cid = code => S.clients.find(c => c.code === code).id, findItem = r => S.items.find(i => i.client_id === cid(r.client) && i.sku === r.sku);
      let nItems = 0;
      const missing = rows.find(r => !findItem(r));
      if (missing && !p.create_items) return E(`SKU ${missing.sku} (${missing.client}) isn't in the item master. Add it first, or tick "create missing items".`);
      rows.forEach(r => { if (!findItem(r)) { S.items.push(newItem(cid(r.client), r.sku, {description: r.descr})); nItems++; } });
      const groups = new Map(); rows.forEach(r => { const k = r.client + "|" + r.asn_no; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
      for (const [k, rs] of groups) { const ex = S.asns.find(x => x.client_id === cid(rs[0].client) && x.asn_no === rs[0].asn_no);
        if (ex && (!["open", "cancelled"].includes(ex.status) || S.receipts.some(r => r.asn_id === ex.id && !r.cancelled))) return E(`ASN ${rs[0].asn_no} (${rs[0].client}) is already being received, so it can't be replaced`); }
      let nNew = 0, nRep = 0, nLines = 0;
      for (const [, rs] of groups) {
        const r0 = rs[0]; let x = S.asns.find(y => y.client_id === cid(r0.client) && y.asn_no === r0.asn_no);
        const hdr = {ext_ref: rs.map(r => r.ext_ref).filter(Boolean).pop() || "", supplier: rs.map(r => r.supplier).filter(Boolean).pop() || "", expected_date: rs.map(r => r.expected_date).filter(Boolean).pop() || null, status: "open", source_file: p.file || "", updated_at: tick()};
        if (x) { S.asnLines = S.asnLines.filter(l => l.asn_id !== x.id); Object.assign(x, hdr); nRep++; }
        else { x = {id: sid("asn"), client_id: cid(r0.client), asn_no: r0.asn_no, notes: "", created_by: me.id, created_at: tick(), started_at: null, received_at: null, closed_at: null, closed_by: null, close_note: "", ...hdr}; S.asns.push(x); nNew++; }
        const agg = new Map(); rs.forEach(r => { const it = findItem(r), k = it.id + "|" + r.batch + "|" + (r.expiry_date || ""); if (!agg.has(k)) agg.set(k, {item_id: it.id, qty: 0, batch: r.batch, expiry_date: r.expiry_date}); agg.get(k).qty += r.qty; });
        let n = 0; for (const g of agg.values()) { S.asnLines.push({id: sid("al"), asn_id: x.id, line_no: ++n, item_id: g.item_id, expected_qty: g.qty, received_qty: 0, damaged_qty: 0, batch: g.batch, expiry_date: g.expiry_date, not_on_asn: false, updated_at: tick()}); nLines++; }
      }
      return ok({new: nNew, replaced: nRep, lines: nLines, new_items: nItems});
    }
    case "asn_receive": {
      const p = a.p || {};
      if (p.client_uuid) { const r = S.receipts.find(x => x.client_uuid === p.client_uuid); if (r) return ok({ok: true, repeat: true, receipt_id: r.id, lpn: r.lpn}); }
      const x = S.asns.find(y => y.id === p.asn_id); if (!x) return E("ASN not found");
      if (["closed", "cancelled"].includes(x.status)) return E(`ASN ${x.asn_no} is ${x.status}`);
      const c = S.clients.find(y => y.id === x.client_id), code = up(p.code);
      const it = S.items.find(i => i.client_id === c.id && i.sku === code) || S.items.find(i => i.client_id === c.id && i.barcode && up(i.barcode) === code);
      if (!it) return E(`NOTITEM:${code} isn't a ${c.code} item. Ask a supervisor to add it to the item master.`);
      const qty = +p.qty, cond = p.condition || "good", batch = String(p.batch || "").trim(), mfg = p.mfg_date || null, exp = p.expiry_date || null; let lpn = up(p.lpn);
      if (!(qty > 0)) return E("Enter the quantity received");
      if (cond === "damaged" && !String(p.damage_reason || "").trim()) return E("Choose the damage reason");
      if (c.track_batch === "required" && !batch) return E(`${c.batch_label} is required for ${c.code}`);
      if (c.track_expiry === "required" && !exp) return E(`The expiry date is required for ${c.code}`);
      if (c.track_mfg === "required" && !mfg) return E(`The manufacturing date is required for ${c.code}`);
      if (mfg && mfg > t) return E("The manufacturing date is in the future");
      if (mfg && exp && exp <= mfg) return E("The expiry date must be after the manufacturing date");
      const l = S.locations.find(y => y.code === up(p.location)); if (!l) return E(`Scan the receiving location first (${up(p.location)} doesn't exist)`); if (!l.active) return E(`Location ${l.code} is turned off`);
      if (lpn && S.inventory.some(i => up(i.lpn) === lpn)) return E(`Pallet label ${lpn} is already used. Scan a new label or leave it empty to create one.`);
      const mine = S.asnLines.filter(y => y.asn_id === x.id && y.item_id === it.id), flags = []; let ln;
      if (!mine.length) { if (!p.confirm) return E(`CONFIRM:${it.sku} (${it.description}) is not on ASN ${x.asn_no}. Receive it anyway?`);
        ln = {id: sid("al"), asn_id: x.id, line_no: S.asnLines.filter(y => y.asn_id === x.id).reduce((m, y) => Math.max(m, y.line_no), 0) + 1, item_id: it.id, expected_qty: 0, received_qty: 0, damaged_qty: 0, batch: "", expiry_date: null, not_on_asn: true, updated_at: tick()}; S.asnLines.push(ln); flags.push("not_on_asn"); }
      else { ln = mine.slice().sort((p1, p2) => ((p2.received_qty + p2.damaged_qty < p2.expected_qty) - (p1.received_qty + p1.damaged_qty < p1.expected_qty)) || ((p2.batch === batch) - (p1.batch === batch)) || p1.line_no - p2.line_no)[0];
        const done = mine.reduce((s, y) => s + y.received_qty + y.damaged_qty, 0), expd = mine.reduce((s, y) => s + y.expected_qty, 0);
        if (done + qty > expd) { if (!p.confirm) return E(`CONFIRM:That makes ${done + qty} of ${it.sku}, but the ASN says ${expd}. Receive ${done + qty - Math.max(expd, done)} extra?`); flags.push("excess"); } }
      let st = "ok", reason = "";
      if (cond === "damaged") { st = "hold"; reason = "Damaged on receipt: " + String(p.damage_reason).trim(); }
      if (exp && exp < t) { flags.push("expired"); st = "hold"; reason = (reason ? reason + "; " : "") + "Expired on arrival"; }
      if (exp && +c.min_life_receive_pct > 0 && st === "ok") { const days = (Date.parse(exp) - Date.parse(t)) / 864e5, life = it.shelf_life_days > 0 ? days / it.shelf_life_days * 100 : mfg && exp > mfg ? days / ((Date.parse(exp) - Date.parse(mfg)) / 864e5) * 100 : null;
        if (life != null && life < +c.min_life_receive_pct) { flags.push("short_life"); st = "hold"; reason = `Short shelf life on receipt: ${Math.round(life)}% left, ${c.code} needs ${c.min_life_receive_pct}%`; } }
      if (l.hold && st === "ok") { st = "hold"; reason = "In " + l.code; }
      if (!lpn) lpn = "SW" + String(++S.lpnSeq + Math.floor(Math.random() * 9e5)).padStart(8, "0");
      const inv = {id: sid("iv"), client_id: c.id, item_id: it.id, location_id: l.id, lpn, batch, ref2: "", mfg_date: mfg, expiry_date: exp, received_at: tick(), asn: x.asn_no, ext_ref: x.ext_ref, qty, allocated_qty: 0, picked_qty: 0, status: st, hold_reason: reason, updated_at: tick(), updated_by: me.id};
      S.inventory.push(inv);
      if (cond === "good") ln.received_qty += qty; else ln.damaged_qty += qty; ln.updated_at = tick();
      const r = {id: sid("rc"), asn_id: x.id, asn_line_id: ln.id, item_id: it.id, inventory_id: inv.id, location_id: l.id, lpn, batch, mfg_date: mfg, expiry_date: exp, qty, condition: cond, damage_reason: String(p.damage_reason || "").trim(), flags, cancelled: false, cancelled_by: null, cancelled_at: null, user_id: me.id, device: p.device || null, client_uuid: p.client_uuid || null, created_at: tick()};
      S.receipts.push(r);
      if (x.status === "open") x.status = "receiving"; x.started_at = x.started_at || tick(); x.updated_at = tick();
      S.stockMoves.push(mv({kind: "receive", client_id: c.id, item_id: it.id, inventory_id: inv.id, to_loc: l.code, lpn, batch, expiry_date: exp, qty, qty_before: 0, qty_after: qty, reason: cond === "damaged" ? "Damaged on receipt" : "Received", note: flags.join(", "), ref: x.asn_no, device: p.device || null}, me));
      return ok({ok: true, receipt_id: r.id, lpn, status: st, hold_reason: reason, flags, sku: it.sku});
    }
    case "asn_undo_receipt": {
      const r = S.receipts.find(y => y.id === a.p_receipt); if (!r || r.cancelled) return E("This receipt is already undone");
      if (!staff && (r.user_id !== me.id || Date.parse(r.created_at) < Date.now() - 2 * 3600e3)) return E("Ask a supervisor to undo this receipt");
      const x = S.asns.find(y => y.id === r.asn_id); if (["closed", "cancelled"].includes(x.status)) return E(`ASN ${x.asn_no} is closed`);
      const v = S.inventory.find(i => i.id === r.inventory_id);
      if (!v || v.qty !== r.qty || v.location_id !== r.location_id || v.allocated_qty + v.picked_qty > 0) return E("The pallet has already been moved or changed, so the receipt can't be undone. Adjust the stock instead.");
      const lc = (S.locations.find(l => l.id === v.location_id) || {}).code || "";
      S.inventory = S.inventory.filter(i => i !== v); Object.assign(r, {cancelled: true, cancelled_by: me.id, cancelled_at: tick()});
      const ln = S.asnLines.find(y => y.id === r.asn_line_id); if (ln) { if (r.condition === "good") ln.received_qty -= r.qty; else ln.damaged_qty -= r.qty; if (ln.not_on_asn && !ln.received_qty && !ln.damaged_qty) S.asnLines = S.asnLines.filter(y => y !== ln); }
      S.stockMoves.push(mv({kind: "adjust", client_id: x.client_id, item_id: r.item_id, inventory_id: r.inventory_id, from_loc: lc, lpn: r.lpn, batch: r.batch, expiry_date: r.expiry_date, qty: -r.qty, qty_before: r.qty, qty_after: 0, reason: "Receipt undone", note: String(a.p_note || "").trim(), ref: x.asn_no}, me));
      return ok(null);
    }
    case "asn_set_status": {
      const x = S.asns.find(y => y.id === a.p_asn); if (!x) return E("ASN not found");
      const any = S.receipts.some(r => r.asn_id === x.id && !r.cancelled), note = String(a.p_note || "").trim(), s = a.p_status;
      if (s === "received") { if (!["open", "receiving"].includes(x.status)) return E(`ASN ${x.asn_no} is ${x.status}`); if (!any) return E("Nothing has been received on this ASN yet"); Object.assign(x, {status: "received", received_at: tick(), updated_at: tick()}); return ok(null); }
      if (!staff) return E("Only supervisors can do this");
      if (s === "closed") { if (!["open", "receiving", "received"].includes(x.status)) return E(`ASN ${x.asn_no} is ${x.status}`); if (!any) return E("Nothing has been received. Cancel the ASN instead.");
        if (S.asnLines.some(l => l.asn_id === x.id && (l.received_qty !== l.expected_qty || l.damaged_qty > 0)) && !note) return E("The ASN has short, extra or damaged lines. Enter a note to close it.");
        Object.assign(x, {status: "closed", received_at: x.received_at || tick(), closed_at: tick(), closed_by: me.id, close_note: note, updated_at: tick()}); return ok(null); }
      if (s === "cancelled") { if (any) return E("Goods have been received on this ASN, so it can't be cancelled. Undo the receipts first or close it."); if (!note) return E("Enter a reason");
        Object.assign(x, {status: "cancelled", closed_at: tick(), closed_by: me.id, close_note: note, updated_at: tick()}); return ok(null); }
      if (s === "receiving") { if (!["received", "closed"].includes(x.status)) return E(`ASN ${x.asn_no} is ${x.status}`); Object.assign(x, {status: "receiving", closed_at: null, closed_by: null, close_note: [x.close_note, "Reopened: " + note].filter(Boolean).join(" | "), updated_at: tick()}); return ok(null); }
      return E("Unknown status " + s);
    }
    case "asn_find": {
      const v = up(a.p_code), refs = new Set([v]); S.gateVisits.filter(g => g.pass_code === v).forEach(g => (g.refs || []).forEach(r => refs.add(up(r))));
      return ok(S.asns.filter(x => ["open", "receiving", "received"].includes(x.status) && (refs.has(x.asn_no) || refs.has(up(x.ext_ref)))).map(x => x.id));
    }
    case "putaway_suggest": {
      const v = S.inventory.find(i => i.id === a.p_inv); if (!v) return E("This pallet is no longer there");
      const occupied = new Set(S.inventory.filter(i => i.qty > 0).map(i => i.location_id));
      const withItem = new Set(S.inventory.filter(i => i.item_id === v.item_id && i.qty > 0).map(i => i.location_id));
      const zones = new Set(S.locations.filter(l => withItem.has(l.id) && l.zone && l.kind === "storage").map(l => l.zone));
      const same = S.locations.filter(l => l.active && !l.hold && ["storage", "pick"].includes(l.kind) && l.mixed_allowed && l.id !== v.location_id && withItem.has(l.id)).sort((p1, p2) => p1.code.localeCompare(p2.code)).slice(0, 3).map(l => ({code: l.code, why: "Has this item", zone: l.zone}));
      const empty = S.locations.filter(l => l.active && !l.hold && l.kind === "storage" && l.id !== v.location_id && !occupied.has(l.id)).sort((p1, p2) => (zones.has(p2.zone) - zones.has(p1.zone)) || p1.code.localeCompare(p2.code)).slice(0, 3).map(l => ({code: l.code, why: zones.has(l.zone) ? "Empty, same zone" : "Empty", zone: l.zone}));
      return ok(same.concat(empty));
    }
  }
  return E("Unknown function " + name);
}
Object.assign(views, asnViews);
if (!S.asns) seedAsn(S);
/* ---------- query builder (the small part of supabase-js the apps use) ---------- */
const reEsc = c => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const like = p => { const t = String(p); let out = ""; for (let i = 0; i < t.length; i++) { const c = t[i]; if (c === "\\" && i + 1 < t.length) out += reEsc(t[++i]); else if (c === "%") out += ".*"; else if (c === "_") out += "."; else out += reEsc(c); } return new RegExp("^" + out + "$", "i"); };
function builder(table, me) {
  const st = {filters: [], order: [], range: null, limit: null, single: false, count: false, op: "select", payload: null, returning: false};
  const api = {
    select(cols, opts) { if (st.op === "select") st.op = "select"; else st.returning = true; if (opts && opts.count) st.count = true; return api; },
    insert(rows) { st.op = "insert"; st.payload = Array.isArray(rows) ? rows : [rows]; return api; },
    upsert(rows, o) { st.op = "upsert"; st.payload = Array.isArray(rows) ? rows : [rows]; st.conflict = String(o && o.onConflict || "id").split(","); return api; },
    update(p) { st.op = "update"; st.payload = p; return api; },
    delete() { st.op = "delete"; return api; },
    eq(c, v) { st.filters.push(r => r[c] === v); return api; },
    neq(c, v) { st.filters.push(r => r[c] !== v); return api; },
    in(c, vs) { st.filters.push(r => vs.includes(r[c])); return api; },
    is(c, v) { st.filters.push(r => v === null ? r[c] == null : r[c] === v); return api; },
    not(c, op, v) { st.filters.push(r => op === "is" && v === null ? r[c] != null : r[c] !== v); return api; },
    gt(c, v) { st.filters.push(r => r[c] != null && +r[c] > v); return api; },
    gte(c, v) { st.filters.push(r => r[c] != null && r[c] >= v); return api; },
    lte(c, v) { st.filters.push(r => r[c] != null && r[c] <= v); return api; },
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
    if (st.op === "upsert") {
      if (!staff) return {data: null, error: {message: "Permission denied", code: "42501"}};
      if (!STOCK_TABLES[table]) return {data: null, error: {message: "Upsert not supported here", code: "0A000"}};
      const arr = STOCK_TABLES[table](), up = v => String(v ?? "").toUpperCase();
      for (const r of st.payload) { const ex = arr.find(x => st.conflict.every(k => up(x[k]) === up(r[k])));
        if (ex) { const keep = {}; if ("code" in ex) keep.code = ex.code; if ("sku" in ex) keep.sku = ex.sku; Object.assign(ex, r, keep); } else { const x = stockInsert(table, r, me); if (x && x.__err) return {data: null, error: {message: x.__err, code: "23505"}}; } }
      bumpStock(); return {data: null, error: null};
    }
    if (st.op === "insert") {
      if (!staff) return {data: null, error: {message: "Permission denied", code: "42501"}};
      const out = st.payload.map(r => {
        if (table === "count_sessions") { const s = {id: "s-" + Math.random().toString(36).slice(2, 8), site: "", zone: "", tolerance_pct: 2, blind: true, recount_other: false, recheck_pct: 5, confirm_location: true, rack_grouping: "last_segment", excess_batch: "optional", excess_mfg: "optional", excess_expiry: "required", status: "draft", source_file: null, created_by: me.id, created_at: tick(), opened_at: null, closed_at: null, closed_by: null, ...r}; S.sessions.push(s); return s; }
        if (table === "count_lines") { const l = {id: ++S.id, barcode: "", batch: "", units_per_case: 1, mfg_date: null, expiry_date: null, description: "", uom: "", unit_cost: 0, counted_qty: null, counted_by: null, counted_at: null, count_round: 0, recount_requested: false, accepted: false, accepted_by: null, accepted_at: null, is_found: false, expected_location: null, remarks: null, updated_at: tick(), ...r}; S.lines.push(l); return l; }
        if (table === "sites") { const x = {id: "site-" + Math.random().toString(36).slice(2, 8), code: "", active: true, created_at: tick(), ...r}; if (S.sites.some(y => y.name.toUpperCase() === String(x.name).toUpperCase())) return {__err: "A site with this name already exists"}; S.sites.push(x); return x; }
        if (table === "checklist_templates") { const x = {id: "ckt-" + Math.random().toString(36).slice(2, 9), kind: "vehicle", storer: "", items: [], active: true, version: 1, updated_at: tick(), updated_by: me.id, ...r};
          if (x.active && S.ckTemplates.some(y => y.active && y.kind === x.kind && (y.purpose || "") === (x.purpose || "") && (y.stage || "") === (x.stage || "") && y.storer.toUpperCase() === String(x.storer).toUpperCase())) return {__err: "An active checklist already exists for this. Turn the other one off first."};
          S.ckTemplates.push(x); return x; }
        if (STOCK_TABLES[table]) return stockInsert(table, r, me);
        if (table === "docks") { const x = {id: "dk-" + Math.random().toString(36).slice(2, 9), kind: "both", active: true, sort: 0, ...r}; if (S.docks.some(y => y.site_id === x.site_id && y.name.toUpperCase() === String(x.name).toUpperCase())) return {__err: `${x.name} already exists at this site`}; S.docks.push(x); return x; }
        return r;
      });
      const bad = out.find(x => x && x.__err); if (bad) return {data: null, error: {message: bad.__err, code: "23505"}};
      return {data: st.single ? out[0] : st.returning ? out : null, error: null};
    }
    const src = st.op === "select" ? (views[table] ? views[table]() : []) : (table === "count_sessions" ? S.sessions : table === "count_lines" ? S.lines : table === "profiles" ? S.users : table === "org_settings" ? S.org : table === "sites" ? S.sites : table === "docks" ? S.docks : table === "checklist_templates" ? S.ckTemplates : STOCK_TABLES[table] ? STOCK_TABLES[table]() : []);
    let rows = src.filter(r => st.filters.every(f => f(r)));
    if (st.op === "update") { if (!staff && table !== "profiles") return {data: null, error: {message: "Permission denied", code: "42501"}}; rows.forEach(r => Object.assign(r, st.payload, table === "count_lines" ? {updated_at: tick()} : {})); if (STOCK_TABLES[table]) bumpStock(); return {data: null, error: null}; }
    if (st.op === "delete") {
      if (!staff) return {data: null, error: {message: "Permission denied", code: "42501"}};
      const ids = new Set(rows.map(r => r.id));
      if (table === "count_lines") S.lines = S.lines.filter(r => !ids.has(r.id));
      if (table === "count_sessions") { S.sessions = S.sessions.filter(r => !ids.has(r.id)); S.lines = S.lines.filter(l => !ids.has(l.session_id)); }
      if (STOCK_TABLES[table]) { const m = stockDelete(table, ids); if (m) return {data: null, error: {message: m, code: "23503"}}; return {data: null, error: null}; }
      if (table === "docks") { if (S.gateVisits.some(v => ids.has(v.dock_id))) return {data: null, error: {message: "This dock has been used by vehicles, so it can't be deleted. Turn it off instead.", code: "23503"}}; S.docks = S.docks.filter(r => !ids.has(r.id)); }
      if (table === "sites") { if (S.gateVisits.some(v => ids.has(v.site_id))) return {data: null, error: {message: "This site has vehicle records, so it can't be deleted. Turn it off instead.", code: "23503"}}; S.sites = S.sites.filter(r => !ids.has(r.id)); S.docks = S.docks.filter(d => !ids.has(d.site_id)); }
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
      const show = !s.blind;   // blind is blind on the phone for every role
      const rows = S.lines.filter(l => l.session_id === s.id && l.id > (a.p_after_id || 0) && (!a.p_since || l.updated_at > a.p_since)).sort((x, y) => x.id - y.id).slice(0, a.p_limit || 1000)
        .map(l => ({id: l.id, seq: l.seq, location: l.location, sku: l.sku, barcode: l.barcode, batch: l.batch, description: l.description, uom: l.uom, units_per_case: l.units_per_case || 1, system_qty: show && !l.recount_requested ? l.system_qty : null, counted_qty: l.counted_qty, counted_by_name: uname(l.counted_by), counted_at: l.counted_at, recount_requested: l.recount_requested, is_found: l.is_found, updated_at: l.updated_at, damaged_qty: +(l.damaged_qty || 0), damage_reason: l.damage_reason || null, damage_note: l.damage_note || null, damage_photos: l.damage_photos || [], recount_blocked: !!(s.recount_other && l.recount_requested && l.first_counted_by === me.id), ref_v: l.is_found ? null : l.system_qty * 97 + l.id * 13}));
      return {data: rows, error: null};
    }
    case "submit_counts": {
      const s = sess(a.p_session); if (!s || s.status !== "open") return E("This count is not open for counting");
      let saved = 0, dup = 0;
      for (const e of a.p_entries) { if (e.client_id && S.events.some(x => x.client_id === e.client_id)) { dup++; continue; } const l = S.lines.find(x => x.id === e.line_id && x.session_id === s.id); if (!l) continue;
        if (s.recount_other && l.recount_requested && l.first_counted_by === me.id) return E(`${l.sku} at ${l.location} must be recounted by a different operator than the first count`);
        const dmg = +(e.damaged_qty || 0), reason = String(e.damage_reason || "").trim(), photos = e.photos || [];
        if (dmg < 0) return E("Damaged quantity can't be below 0");
        if (dmg > 0 && !reason) return E(`Choose a reason for the damaged units of ${l.sku} at ${l.location}`);
        if (dmg > 0 && !photos.length) return E(`Take a photo of the damaged units of ${l.sku} at ${l.location}`);
        ev(s.id, l.id, "count", {qty: e.qty, prev_qty: l.counted_qty, device: a.p_device, client_id: e.client_id, note: [e.first_entry == null ? null : +e.first_entry === +e.qty ? `Confirmed by typing twice: ${e.qty}` : `Re-entered: first ${e.first_entry}, final ${e.qty}`, dmg > 0 ? `Damaged ${dmg}: ${reason}` : null].filter(Boolean).join("; ") || null, photos: dmg > 0 ? photos : null});
        Object.assign(l, {counted_qty: +e.qty, counted_by: me.id, counted_at: e.client_ts || tick(), count_round: l.count_round + 1, recount_requested: false, accepted: false, updated_at: tick(),
          damaged_qty: dmg, damage_reason: dmg > 0 ? reason : null, damage_note: dmg > 0 ? (String(e.damage_note || "").trim() || null) : null, damage_photos: dmg > 0 ? photos : []}); saved++; }
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
      S.lines.filter(l => l.session_id === a.p_session && a.p_line_ids.includes(l.id) && l.counted_qty != null).forEach(l => { ev(a.p_session, l.id, "recount_request", {prev_qty: l.counted_qty}); Object.assign(l, {first_counted_by: l.first_counted_by || l.counted_by, counted_qty: null, counted_by: null, counted_at: null, recount_requested: true, accepted: false, damaged_qty: 0, damage_reason: null, damage_note: null, damage_photos: [], updated_at: tick()}); n++; });
      return {data: n, error: null}; }
    case "report_not_on_list": { const s = sess(a.p_session); if (!s || s.status !== "open") return E("This count is not open for counting");
      if (a.p_client_id && S.events.some(x => x.client_id === a.p_client_id)) return {data: null, error: null};
      ev(s.id, null, "not_on_list", {location: String(a.p_location || "").trim(), code: String(a.p_code || "").trim(), note: String(a.p_note || "").trim() || null, photos: a.p_photos || [], device: a.p_device, client_id: a.p_client_id});
      return {data: null, error: null}; }
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
    default: if (name.startsWith("qc_")) return qcRpc(name, a, me, staff);
      if (name.startsWith("gate_")) return gateRpc(name, a, me, staff);
      if (name.startsWith("checklist_")) return ckRpc(name, a, me, staff);
      if (name.startsWith("stock_")) return stockRpc(name, a, me, staff);
      if (name.startsWith("asn_") || name === "putaway_suggest") return asnRpc(name, a, me, staff);
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
    removeChannel(ch) { S.channels = S.channels.filter(c => c !== ch); },
    storage: {from: bucket => ({
      async upload(path, blob) {
        if (host.__CC_DEMO_OFFLINE && role === "counter") return {data: null, error: {message: "Failed to fetch"}};
        if (!S.photos) S.photos = {};
        if (S.photos[path]) return {data: null, error: {message: "The resource already exists", statusCode: "409"}};
        S.photos[path] = await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(blob); });
        (S.photoDocs || (S.photoDocs = [])).push({id: "p" + path.replace(/[^A-Za-z0-9]/g, "_").slice(-120), path, data: S.photos[path]});   // shared by the test link
        return {data: {path}, error: null};
      },
      async createSignedUrl(path) { const d = (S.photoDocs || []).find(x => x.path === path), u = (S.photos || {})[path] || (d && d.data); return u ? {data: {signedUrl: u}, error: null} : {data: null, error: {message: "Photo not uploaded yet"}}; }
    })}
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
  b.style.cssText = "background:#13233F;color:#FFFFFF;font:600 12px/1.2 system-ui,sans-serif;padding:5px 12px;text-align:center;position:relative;z-index:30";
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
    const qs = window.__qcDemo ? window.__qcDemo() : null;
    const qbtn = (v, label, cls = "") => `<button class="code ${cls}" data-v="${h(v)}">${h(label)}<span>${h(v)}</span></button>`;
    if (qs) {
      if (qs.blocked) body += `<div class="sec"><b>STOPPED</b>The app is waiting for the operator to tap the red screen. Scans are ignored until then.</div>`;
      else if (qs.view === "home" || qs.view === "passed" || qs.view === "sent") {
        const open = (S.qcOrders || []).filter(o => ["pending", "short"].includes(o.status) || (o.status === "in_progress" && (!o.assigned_to || o.assigned_to === "u-ali"))).slice(0, 5);
        body += `<div class="sec"><b>ORDER NUMBER ON THE PICK LIST</b>${open.map(o => qbtn(o.order_no, `${o.order_no} ${o.customer || ""}`)).join("") || '<span class="muted">No open orders. Upload some on the console.</span>'}</div>`;
        const busy = (S.qcOrders || []).find(o => o.status === "in_progress" && o.assigned_to && o.assigned_to !== "u-ali");
        const done = (S.qcOrders || []).find(o => o.status === "passed");
        body += `<div class="sec"><b>THESE SHOULD BE REFUSED</b>${busy ? qbtn(busy.order_no, `${busy.order_no} (someone else is checking it)`, "warn") : ""}${done ? qbtn(done.order_no, `${done.order_no} (already passed)`, "warn") : ""}${qbtn("SO-9999999", "Order not uploaded", "bad")}</div>`;
      } else if (qs.view === "tote") body += `<div class="sec"><b>TOTE LABELS</b>${qbtn("TOTE-0041", "Tote 0041")}${qbtn("TOTE-0042", "Tote 0042")}</div>`;
      else if (qs.view === "scan" || qs.view === "short") {
        const inOrder = new Set(qs.lines.map(l => String(l.barcode || l.sku).toUpperCase()));
        body += `<div class="sec"><b>PRODUCTS IN THIS ORDER</b>${qs.lines.map(l => { const left = l.expected_qty - l.scanned_qty; return qbtn(l.barcode || l.sku, `${l.sku} · ${left > 0 ? left + " more needed" : "complete: one more is extra"}`, left > 0 ? "" : "warn"); }).join("")}</div>`;
        const other = ["6291071800447", "6297000331189", "6291041500213", "6291056300715"].find(c => !inOrder.has(c)) || "6291999000017";
        body += `<div class="sec"><b>SHOULD BE REFUSED</b>${qbtn(other, "Product from another order", "bad")}${qbtn("6291999000017", "Unknown barcode", "bad")}</div>`;
        if (qs.order && qs.order.tote_mode !== "off") body += `<div class="sec"><b>TOTE LABEL</b><span class="small">Tap Change or Scan tote first.</span></div>`;
      } else if (qs.view === "line") body += `<div class="sec"><b>NEXT</b>Choose a reason to remove a unit, or go back to scanning.</div>`;
    } else if (!s.session) body += `<div class="sec"><b>START</b>Open the count "Weekly cycle count, Aisle A01".</div>`;
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
    body += `<div class="sec"><label class="check small"><input type="checkbox" id="tsx-off" ${window.__ccOffline() ? "checked" : ""}> Simulate no network</label><span class="small muted">Counts and scans wait on the phone and sync when you untick it.</span></div>`;
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
