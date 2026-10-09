/* Stowra console: gate pass (yard board, visits) and organisation settings (company name, sites, docks).
   Gate in and gate out happen on the security phone; dock in and dock out on the warehouse phones or here. */
(() => {
"use strict";
let C = null;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const PURPOSE = {inbound: "Inbound", outbound: "Outbound", other: "Other visit"};
const STATUS = {in_yard: "Waiting in yard", at_dock: "At dock", dock_done: "Ready to leave", out: "Left", rejected: "Refused at gate"};
const PILL = {in_yard: "open", at_dock: "draft", dock_done: "reconciled", out: "closed", rejected: "closed"};
const EVENT = {gate_in: "Gate in", rejected: "Refused at gate", dock_in: "Dock in", dock_out: "Dock out", gate_out: "Gate out", note: "Note", cancel: "Cancelled", checklist: "Checklist"};
const ckOk = r => r === "pass" || r === "accepted";
const ckReady = v => v.ck_before === "rejected" || v.ck_after === "rejected" || ((!v.ck_before_needed || ckOk(v.ck_before)) && (!v.ck_after_needed || ckOk(v.ck_after)));
// Checklist state of a vehicle at a dock, for the yard board
function ckState(v) {
  if (v.status !== "at_dock") return null;
  if (v.ck_before === "rejected" || v.ck_after === "rejected") return ["bad", "Rejected at dock"];
  if (v.ck_before === "fail" || v.ck_after === "fail") return ["bad", "Checklist failed: decide"];
  if (v.ck_before_needed && !["pass", "accepted"].includes(v.ck_before)) return ["warn", "Checklist to do"];
  if (v.ck_after_needed && !["pass", "accepted"].includes(v.ck_after)) return ["", "Dock-out checklist to do"];
  return null;
}
const V = {site: null, view: "active"};
const mins = m => m == null ? "–" : m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`;
const d8 = s => s ? new Date(s + "T00:00:00").toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"}) : "–";

async function loadBase() {
  const [org, sites, docks] = await Promise.all([C.q(C.sb.from("org_settings").select("*").eq("id", 1).single()), C.q(C.sb.from("sites").select("*").order("name")), C.q(C.sb.from("docks").select("*").order("sort").order("name"))]);
  return {org, sites, docks};
}
function page(main, ctx, id, sub) {
  C = ctx;
  if (sub === "settings") return pageSettings(main);
  if (id) return pageVisit(main, id);
  return pageBoard(main);
}

/* ---------- yard board ---------- */
async function pageBoard(main) {
  let B, rows = [], today = [];
  try {
    B = await loadBase();
    if (!B.sites.length) { main.innerHTML = `<div class="pagehead"><div><h1>Gate and yard</h1></div></div><div class="empty"><h2>No sites yet</h2><p>${C.me.role === "admin" ? `Add your sites and docks in <a href="#/settings">Settings</a> first.` : "Ask an administrator to add the sites and docks in Settings."}</p></div>`; return; }
    const act = B.sites.filter(s => s.active);
    if (!V.site || !B.sites.some(s => s.id === V.site)) V.site = (act.find(s => s.name === C.me.site) || act[0] || B.sites[0]).id;
    const since = new Date(); since.setHours(0, 0, 0, 0);
    [rows, today] = await Promise.all([
      C.q(C.sb.from("gate_visit_list").select("*").eq("site_id", V.site).in("status", ["in_yard", "at_dock", "dock_done"]).order("gate_in_at")),
      C.q(C.sb.from("gate_visit_list").select("*").eq("site_id", V.site).gte("gate_in_at", since.toISOString()).order("gate_in_at", {ascending: false}).limit(1000))]);
  } catch (e) { C.fail(e); return; }
  const alertMin = B.org.yard_alert_minutes || 120, docks = B.docks.filter(d => d.site_id === V.site && d.active);
  const over = rows.filter(v => v.total_minutes > alertMin), decide = rows.filter(v => v.status === "at_dock" && (v.ck_before === "fail" || v.ck_after === "fail"));
  const byDock = new Map(rows.filter(v => v.status === "at_dock").map(v => [v.dock_id, v]));
  const row = v => `<tr style="cursor:pointer" data-ga="open" data-id="${C.esc(v.id)}" class="${v.total_minutes > alertMin && !["out", "rejected"].includes(v.status) ? "over" : ""}">
    <td><strong>${C.esc(v.vehicle_plate)}</strong><br><span class="small muted">${C.esc(v.vehicle_type || "")}</span></td>
    <td>${PURPOSE[v.purpose]}<br><span class="small muted">${C.esc([v.storer, (v.refs || []).join(", ")].filter(Boolean).join(" · "))}</span></td>
    <td>${C.esc(v.driver_name)}<br><span class="small muted">${C.esc(v.transporter || "")}</span></td>
    <td><span class="pill ${PILL[v.status]}">${STATUS[v.status]}</span>${v.dock_name ? `<br><span class="small">${C.esc(v.dock_name)}</span>` : ""}${(c => c ? `<br><span class="status ${c[0] === "bad" ? "s-out" : c[0] === "warn" ? "s-accepted" : "s-uncounted"}">${c[1]}</span>` : "")(ckState(v))}${v.status === "rejected" ? `<br><span class="small var-neg" style="white-space:normal">${C.esc(v.reject_reason || "")}</span>` : ""}</td>
    <td class="small">${C.dt(v.gate_in_at)}</td><td class="n">${v.status === "rejected" ? "–" : mins(v.wait_minutes)}</td><td class="n">${v.dock_in_at ? mins(v.dock_minutes) : "–"}</td>
    <td class="n"><strong class="${v.total_minutes > alertMin && !["out", "rejected"].includes(v.status) ? "var-neg" : ""}">${v.status === "rejected" ? "–" : mins(v.total_minutes)}</strong></td></tr>`;
  const head = `<thead><tr><th>Vehicle</th><th>Purpose</th><th>Driver</th><th>Status</th><th>Gate in</th><th class="n">Waiting</th><th class="n">At dock</th><th class="n">Total</th></tr></thead>`;
  const list = V.view === "active" ? rows : today;
  main.innerHTML = `
    <div class="pagehead"><div><h1>Gate and yard</h1><p class="muted small" style="margin:4px 0 0">Security gates vehicles in and out on the phone; the warehouse team docks them in and out. Vehicles inside longer than ${mins(alertMin)} are highlighted.</p></div>
      <div class="row"><select class="search" id="gsite" style="min-width:0">${B.sites.map(s => `<option value="${C.esc(s.id)}" ${s.id === V.site ? "selected" : ""}>${C.esc(s.name)}${s.active ? "" : " (off)"}</option>`).join("")}</select>
      <button class="btn" data-ga="export">Export to Excel</button></div></div>
    ${decide.length ? `<div class="banner bad"><span>Checklist failed, supervisor decision needed: ${decide.map(v => `<a href="#/gate/${C.esc(v.id)}">${C.esc(v.vehicle_plate)}</a>`).join(", ")}.</span></div>` : ""}
    ${over.length ? `<div class="banner bad"><span>${over.length} vehicle${over.length === 1 ? " has" : "s have"} been inside longer than ${mins(alertMin)}: ${over.map(v => C.esc(v.vehicle_plate)).join(", ")}.</span></div>` : ""}
    <div class="stats">
      <div class="stat"><div class="l">Waiting in yard</div><div class="v">${C.fmt(rows.filter(v => v.status === "in_yard").length)}</div></div>
      <div class="stat"><div class="l">At dock</div><div class="v">${C.fmt(byDock.size)}<span class="muted" style="font-size:1.1rem"> / ${C.fmt(docks.length)} docks</span></div></div>
      <div class="stat"><div class="l">Ready to leave</div><div class="v">${C.fmt(rows.filter(v => v.status === "dock_done").length)}</div></div>
      <div class="stat"><div class="l">Left today</div><div class="v">${C.fmt(today.filter(v => v.status === "out").length)}</div></div>
      <div class="stat"><div class="l">Refused at gate today</div><div class="v ${today.some(v => v.status === "rejected") ? "var-neg" : ""}">${C.fmt(today.filter(v => v.status === "rejected").length)}</div></div>
      <div class="stat"><div class="l">Average time inside today</div><div class="v">${(() => { const t = today.filter(v => v.status === "out" && v.total_minutes != null); return t.length ? mins(Math.round(t.reduce((a, v) => a + v.total_minutes, 0) / t.length)) : "–"; })()}</div></div>
    </div>
    <h3 style="margin:6px 0 8px">Docks</h3>
    <div class="dockgrid">${docks.map(d => { const v = byDock.get(d.id); return `<button class="dock ${v ? "busy" : ""} ${v && v.total_minutes > alertMin ? "over" : ""}" ${v ? `data-ga="open" data-id="${C.esc(v.id)}"` : "disabled"} title="${C.esc(d.name)} (${d.kind})"><b>${C.esc(d.name.replace(/^dock\s*/i, ""))}</b><span>${v ? C.esc(v.vehicle_plate) : d.kind === "both" ? "Free" : d.kind === "inbound" ? "Free · in" : "Free · out"}</span>${v ? `<small>${mins(v.dock_minutes)}</small>` : ""}</button>`; }).join("") || `<p class="muted small">No docks at this site. ${C.me.role === "admin" ? `<a href="#/settings">Add docks</a>` : ""}</p>`}</div>
    <div class="toolbar" style="margin-top:18px"><div class="chips"><button class="chip" aria-pressed="${V.view === "active"}" data-ga="view" data-v="active">Inside now (${rows.length})</button><button class="chip" aria-pressed="${V.view === "today"}" data-ga="view" data-v="today">All today (${today.length})</button></div></div>
    ${list.length ? `<div class="tablewrap"><table>${head}<tbody>${list.map(row).join("")}</tbody></table></div>` : `<div class="empty" style="margin-top:8px"><h3>${V.view === "active" ? "No vehicles inside" : "No vehicles today"}</h3></div>`}`;
  $("#gsite").onchange = e => { V.site = e.target.value; pageBoard(main); };
  C.setTimer(() => { if (C.route()[0] === "gate" && !C.route()[1]) pageBoard(main); }, 20000);
}

/* ---------- one visit ---------- */
async function pageVisit(main, id) {
  let v, ev, B, runs = [];
  try { [v, ev, B, runs] = await Promise.all([C.q(C.sb.from("gate_visit_list").select("*").eq("id", id).single()), C.q(C.sb.from("gate_events").select("*").eq("visit_id", id).order("created_at")), loadBase(),
    C.q(C.sb.from("checklist_runs").select("*").eq("visit_id", id).order("submitted_at"))]); }
  catch { main.innerHTML = `<div class="empty"><h2>Visit not found</h2><p><a href="#/gate">Back to the yard</a></p></div>`; return; }
  const busy = new Set((await C.q(C.sb.from("gate_visits").select("dock_id").eq("status", "at_dock")).catch(() => [])).map(x => x.dock_id));
  const free = B.docks.filter(d => d.site_id === v.site_id && d.active && !busy.has(d.id) && (d.kind === "both" || d.kind === v.purpose));
  const today = new Date().toISOString().slice(0, 10), exp = d => d && d < today ? ` <span class="var-neg">(expired)</span>` : "";
  const users = new Map((await C.q(C.sb.from("profiles").select("id,full_name")).catch(() => [])).map(u => [u.id, u.full_name]));
  main.innerHTML = `
    <div class="pagehead"><div><a href="#/gate" class="small">Gate and yard</a><h1 style="margin-top:6px">${C.esc(v.vehicle_plate)}</h1>
      <span class="muted small">${PURPOSE[v.purpose]} · ${C.esc(v.site_name)} · pass <strong>${C.esc(v.pass_code)}</strong></span></div>
      <div class="row"><span class="pill ${PILL[v.status]}">${STATUS[v.status]}</span>
        ${v.status !== "rejected" ? `<button class="btn" data-ga="print">Print gate pass</button>` : ""}
        ${v.status === "dock_done" || (v.status === "in_yard" && v.purpose === "other") ? `<button class="btn go" data-ga="step" data-s="gate_out">Gate out</button>` : ""}
        ${["in_yard", "at_dock", "dock_done"].includes(v.status) ? `<button class="btn danger" data-ga="cancel">Cancel visit</button>` : ""}</div></div>
    ${v.status === "rejected" ? `<div class="banner bad"><span>Refused at the gate: ${C.esc(v.reject_reason || "")}</span></div>` : ""}
    ${v.status === "in_yard" && v.purpose !== "other" ? `<div class="panel" style="margin-bottom:14px"><h3 style="margin-bottom:8px">Dock in</h3><div class="row"><select class="search" id="gdock" style="min-width:200px">${free.length ? free.map(d => `<option value="${C.esc(d.id)}">${C.esc(d.name)}${d.kind !== "both" ? " (" + d.kind + ")" : ""}</option>`).join("") : `<option value="">No free dock</option>`}</select><button class="btn go" data-ga="step" data-s="dock_in" ${free.length ? "" : "disabled"}>Dock in</button></div></div>` : ""}
    ${v.status === "at_dock" && !ckReady(v) ? `<div class="banner warn"><span>${ckState(v) ? ckState(v)[1] : "Checklists to do"}. Dock out becomes available when the checklists are complete.</span></div>` : ""}
    ${v.status === "at_dock" && ckReady(v) ? `<div class="panel" style="margin-bottom:14px"><h3 style="margin-bottom:8px">Dock out from ${C.esc(v.dock_name || "")}${v.ck_before === "rejected" || v.ck_after === "rejected" ? " (vehicle rejected)" : ""}</h3><div class="row"><input class="search" id="gseal" placeholder="Seal number${v.purpose === "outbound" ? " (required)" : " (optional)"}"><button class="btn go" data-ga="step" data-s="dock_out">Dock out</button></div></div>` : ""}
    <div class="twocol">
      <div class="panel"><h3 style="margin-bottom:8px">Vehicle and driver</h3><table><tbody>
        <tr><th>Vehicle</th><td>${C.esc(v.vehicle_plate)} ${C.esc(v.vehicle_type ? "· " + v.vehicle_type : "")}</td></tr>
        <tr><th>Transporter</th><td>${C.esc(v.transporter || "–")}</td></tr>
        <tr><th>Driver</th><td>${C.esc(v.driver_name)}${v.driver_mobile ? ` · ${C.esc(v.driver_mobile)}` : ""}</td></tr>
        <tr><th>Emirates ID</th><td>${C.esc(v.eid_number || "–")} · expires ${d8(v.eid_expiry)}${exp(v.eid_expiry)}</td></tr>
        <tr><th>Driving licence</th><td>${C.esc(v.licence_number || "–")} · expires ${d8(v.licence_expiry)}${exp(v.licence_expiry)}</td></tr>
        <tr><th>Mulkiya</th><td>${C.esc(v.mulkiya_number || "–")} · expires ${d8(v.mulkiya_expiry)}${exp(v.mulkiya_expiry)}</td></tr>
        <tr><th>PPE at gate</th><td>${v.ppe_ok ? "Yes" : `<span class="var-neg">No</span>`}</td></tr></tbody></table></div>
      <div class="panel"><h3 style="margin-bottom:8px">Load</h3><table><tbody>
        <tr><th>Purpose</th><td>${PURPOSE[v.purpose]}</td></tr><tr><th>Storer / client</th><td>${C.esc(v.storer || "–")}</td></tr>
        <tr><th>${v.purpose === "inbound" ? "ASN / PO" : v.purpose === "outbound" ? "Orders" : "References"}</th><td>${(v.refs || []).map(r => `<span class="tag">${C.esc(r)}</span>`).join(" ") || (v.purpose === "outbound" && v.status === "in_yard" ? "Added at dock in" : "–")}</td></tr>
        <tr><th>Seal on arrival</th><td>${C.esc(v.seal_in || "–")}</td></tr><tr><th>Seal on departure</th><td>${C.esc(v.seal_out || "–")}</td></tr>
        <tr><th>Notes</th><td style="white-space:normal">${C.esc(v.notes || "–")}</td></tr>
        <tr><th>Time</th><td>Waiting ${mins(v.wait_minutes)} · at dock ${v.dock_in_at ? mins(v.dock_minutes) : "–"} · total ${mins(v.total_minutes)}</td></tr></tbody></table></div>
    </div>
    ${ckSection(v, runs)}
    <h3 style="margin:18px 0 0">Timeline</h3>
    <div class="tablewrap"><table><thead><tr><th>When</th><th>Step</th><th>Dock</th><th>By</th><th>Note</th></tr></thead><tbody>
      ${ev.map(e => `<tr><td class="small">${C.dt(e.created_at)}</td><td>${EVENT[e.event] || C.esc(e.event)}</td><td>${C.esc((B.docks.find(d => d.id === e.dock_id) || {}).name || "")}</td><td>${C.esc(e.user_name || users.get(e.user_id) || "–")}</td><td class="small" style="white-space:normal">${C.esc(e.note || "")}</td></tr>`).join("")}
    </tbody></table></div>
    <dialog id="gdlg"><form method="dialog" id="gdlgf"><h2 style="margin-bottom:8px">Cancel this visit?</h2><p class="hint">Use this only for a visit entered by mistake, or a vehicle that left without a gate out. It is kept for the record.</p>
      <label class="field" style="margin-bottom:16px">Reason<textarea name="note" rows="3" required style="min-height:70px;font-family:var(--sans)"></textarea></label>
      <div class="row"><button class="btn danger" value="ok">Cancel visit</button><button class="btn ghost" value="cancel" formnovalidate>Back</button></div></form></dialog>`;
  C.cache.visit = {v, org: B.org};
  if (["in_yard", "at_dock", "dock_done"].includes(v.status)) C.setTimer(() => { if (C.route()[0] === "gate" && C.route()[1] === id && !$("#gdlg").open && document.activeElement !== $("#gseal")) pageVisit(main, id); }, 20000);
}
async function step(s) {
  const {v} = C.cache.visit;
  const args = {p_code: v.pass_code, p_step: s, p_device: "Console"};
  if (s === "dock_in") args.p_dock = $("#gdock").value;
  if (s === "dock_out") args.p_seal = $("#gseal").value.trim();
  if (await C.run(() => C.q(C.sb.rpc("gate_step", args)), {dock_in: "Docked in", dock_out: "Docked out", gate_out: "Gated out"}[s])) pageVisit($("#main"), v.id);
}
function cancel() {
  const d = $("#gdlg"); d.showModal();
  d.onclose = async () => { if (d.returnValue !== "ok") return; const note = $("#gdlgf").elements.namedItem("note").value.trim(); if (!note) return C.toast("Enter a reason.", true);
    if (await C.run(() => C.q(C.sb.rpc("gate_cancel", {p_visit: C.cache.visit.v.id, p_note: note})), "Visit cancelled")) pageVisit($("#main"), C.cache.visit.v.id); };
}
function printPass() {
  const {v, org} = C.cache.visit;
  let img = "";
  try { const c = document.createElement("canvas"); window.bwipjs.toCanvas(c, {bcid: "qrcode", text: v.pass_code, scale: 6, eclevel: "M"}); img = c.toDataURL("image/png"); } catch {}
  let p = $("#qcprint"); if (!p) { p = document.createElement("div"); p.id = "qcprint"; document.body.appendChild(p); }
  p.innerHTML = `<div class="gpass">${org.company_name ? `<div class="gpass-co">${C.esc(org.company_name)}</div>` : ""}<h1>Gate pass</h1>${img ? `<img src="${img}" alt="QR code">` : ""}<div class="gpass-code">${C.esc(v.pass_code)}</div>
    <table><tbody><tr><th>Vehicle</th><td>${C.esc(v.vehicle_plate)}</td></tr><tr><th>Driver</th><td>${C.esc(v.driver_name)}</td></tr><tr><th>Purpose</th><td>${PURPOSE[v.purpose]}${(v.refs || []).length ? " · " + C.esc(v.refs.join(", ")) : ""}</td></tr>
    <tr><th>Site</th><td>${C.esc(v.site_name)}</td></tr><tr><th>Gate in</th><td>${C.esc(new Date(v.gate_in_at).toLocaleString())}</td></tr></tbody></table>
    <p>Show this pass at the dock and at the gate when leaving.</p></div>`;
  document.body.classList.add("qc-printing");
  const done = () => { document.body.classList.remove("qc-printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  try { window.print(); } catch { C.toast("Your browser blocked printing here. Open the console in its own tab to print.", true); }
  setTimeout(done, 60000);
}
async function exportVisits() {
  C.toast("Preparing the Excel file…");
  try {
    const since = new Date(Date.now() - 31 * 864e5).toISOString(), rows = [];
    let from = 0; for (;;) { const d = await C.q(C.sb.from("gate_visit_list").select("*").gte("gate_in_at", since).order("gate_in_at", {ascending: false}).range(from, from + 999)); rows.push(...d); if (d.length < 1000) break; from += 1000; }
    const X = window.XLSX, wb = X.utils.book_new(), t = s => s ? new Date(s) : "";
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(rows.map(v => ({"Pass": v.pass_code, Site: v.site_name, Purpose: PURPOSE[v.purpose], Status: STATUS[v.status], "Storer": v.storer, "ASN / PO / orders": (v.refs || []).join(", "),
      Vehicle: v.vehicle_plate, "Vehicle type": v.vehicle_type, Transporter: v.transporter, Driver: v.driver_name, Mobile: v.driver_mobile, "Emirates ID expiry": v.eid_expiry || "", "Licence expiry": v.licence_expiry || "", "Mulkiya expiry": v.mulkiya_expiry || "",
      PPE: v.ppe_ok ? "Yes" : "No", "Refused because": v.reject_reason || "", "Gate in": t(v.gate_in_at), "Gate in by": v.gate_in_name || "", Dock: v.dock_name || "", "Dock in": t(v.dock_in_at), "Dock out": t(v.dock_out_at), "Seal in": v.seal_in || "", "Seal out": v.seal_out || "",
      "Gate out": t(v.gate_out_at), "Gate out by": v.gate_out_name || "", "Waiting (min)": v.status === "rejected" ? "" : v.wait_minutes, "At dock (min)": v.dock_in_at ? v.dock_minutes : "", "Total (min)": v.status === "rejected" ? "" : v.total_minutes, Notes: v.notes || ""}))), "Visits, last 31 days");
    C.saveWorkbook(wb, `gate-visits-${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { C.fail(e); }
}

/* ---------- settings: company name, gate pass page, sites and docks ---------- */
async function pageSettings(main) {
  if (C.me.role !== "admin") { main.innerHTML = `<div class="empty"><h2>Administrators only</h2></div>`; return; }
  let B; try { B = await loadBase(); } catch (e) { C.fail(e); return; }
  const defUrl = new URL("../pass/", location.href).href;
  main.innerHTML = `<div class="pagehead"><div><h1>Settings</h1><p class="muted small" style="margin:4px 0 0">Company details, sites and docks. Everything in Stowra reads them from here, so a change here updates screens, gate passes and reports.</p></div></div>
    <div class="panel" style="max-width:760px"><h2 style="margin-bottom:10px">Company</h2>
      <form id="orgf" class="grid-form">
        <label class="field" style="grid-column:1/-1">Company name (optional)<input name="company" value="${C.esc(B.org.company_name)}" placeholder="Leave empty until decided"><span class="hint">Shown in the sidebar, on gate passes and in WhatsApp messages. While it's empty, they just say Stowra. You can add or change it any time.</span></label>
        <label class="field" style="grid-column:1/-1">Gate pass page address (sent to drivers on WhatsApp)<input name="passurl" value="${C.esc(B.org.pass_base_url || defUrl)}"><span class="hint">Usually your Stowra web address followed by <code>/pass/</code>. Suggested: ${C.esc(defUrl)}</span></label>
        <label class="field">Highlight vehicles inside longer than (minutes)<input name="alert" type="number" min="10" step="5" value="${C.esc(B.org.yard_alert_minutes)}"></label>
        <div class="row" style="grid-column:1/-1"><button class="btn primary">Save company settings</button></div></form></div>
    <div class="panel" style="max-width:960px;margin-top:16px"><h2 style="margin-bottom:10px">Sites and docks</h2>
      <form class="row" id="sitef"><input class="search" name="name" placeholder="New site name, e.g. JAFZA Warehouse 2" required style="min-width:260px"><input class="search" name="code" placeholder="Code, e.g. JAF2" style="min-width:0;width:120px"><button class="btn">Add site</button></form>
      ${B.sites.map(s => { const ds = B.docks.filter(d => d.site_id === s.id); return `<section class="siteblk" data-site="${C.esc(s.id)}">
        <div class="row" style="justify-content:space-between"><h3 style="margin:0">${C.esc(s.name)} ${s.code ? `<span class="tag">${C.esc(s.code)}</span>` : ""} ${s.active ? "" : `<span class="pill closed">Off</span>`}</h3>
          <div class="row"><button class="btn sm" data-ga="site-toggle" data-id="${C.esc(s.id)}" data-on="${s.active ? 0 : 1}">${s.active ? "Turn off" : "Turn on"}</button><button class="btn sm danger" data-ga="site-del" data-id="${C.esc(s.id)}">Delete</button></div></div>
        <p class="small muted" style="margin:4px 0 8px">${ds.length} dock${ds.length === 1 ? "" : "s"}: ${ds.filter(d => d.kind === "inbound").length} inbound, ${ds.filter(d => d.kind === "outbound").length} outbound, ${ds.filter(d => d.kind === "both").length} both.</p>
        <div class="row docksadd"><span class="small">Add docks</span><input class="search" data-k="prefix" value="Dock " style="min-width:0;width:90px" aria-label="Name before the number"><input class="search" data-k="from" type="number" min="1" value="${ds.length + 1}" style="min-width:0;width:70px" aria-label="From number"><span class="small">to</span><input class="search" data-k="to" type="number" min="1" value="${ds.length + 10}" style="min-width:0;width:70px" aria-label="To number">
          <select class="search" data-k="kind" style="min-width:0"><option value="both">Inbound and outbound</option><option value="inbound">Inbound only</option><option value="outbound">Outbound only</option></select><button class="btn sm" data-ga="docks-add" data-id="${C.esc(s.id)}">Add</button></div>
        <div class="docklist">${ds.map(d => `<span class="dk ${d.active ? "" : "off"}"><b>${C.esc(d.name)}</b><select data-ga-kind="${C.esc(d.id)}" aria-label="Type of ${C.esc(d.name)}">${["both", "inbound", "outbound"].map(k => `<option value="${k}" ${d.kind === k ? "selected" : ""}>${k === "both" ? "In + out" : k === "inbound" ? "In" : "Out"}</option>`).join("")}</select><button data-ga="dock-toggle" data-id="${C.esc(d.id)}" data-on="${d.active ? 0 : 1}" title="${d.active ? "Turn off" : "Turn on"}">${d.active ? "On" : "Off"}</button><button data-ga="dock-del" data-id="${C.esc(d.id)}" title="Delete" aria-label="Delete ${C.esc(d.name)}">×</button></span>`).join("") || `<span class="small muted">No docks yet.</span>`}</div></section>`; }).join("") || `<p class="muted small" style="margin-top:12px">No sites yet. Add your first site above.</p>`}
    </div>`;
  $("#orgf").onsubmit = async e => { e.preventDefault(); const f = e.target, el = n => f.elements.namedItem(n);
    if (await C.run(() => C.q(C.sb.from("org_settings").update({company_name: el("company").value.trim(), pass_base_url: el("passurl").value.trim(), yard_alert_minutes: Math.max(10, parseInt(el("alert").value, 10) || 120), updated_at: new Date().toISOString()}).eq("id", 1)), "Company settings saved")) { window.dispatchEvent(new Event("stowra-org")); pageSettings(main); } };
  $("#sitef").onsubmit = async e => { e.preventDefault(); const f = e.target; if (await C.run(() => C.q(C.sb.from("sites").insert({name: f.elements.namedItem("name").value.trim(), code: f.elements.namedItem("code").value.trim().toUpperCase()}).select().single()), "Site added")) pageSettings(main); };
  $$("[data-ga-kind]").forEach(sel => sel.onchange = async () => { await C.run(() => C.q(C.sb.from("docks").update({kind: sel.value}).eq("id", sel.dataset.gaKind)), "Dock updated"); });
}
async function addDocks(siteId, blk) {
  const g = k => blk.querySelector(`[data-k="${k}"]`).value, from = parseInt(g("from"), 10), to = parseInt(g("to"), 10), prefix = g("prefix"), kind = g("kind");
  if (!(from >= 1) || !(to >= from) || to - from > 199) return C.toast("Enter a range like 1 to 40 (up to 200 at a time).", true);
  const B = await loadBase(), have = new Set(B.docks.filter(d => d.site_id === siteId).map(d => d.name.toUpperCase())), w = String(to).length < 2 ? 2 : String(to).length;
  const rows = []; for (let i = from; i <= to; i++) { const name = (prefix + String(i).padStart(w, "0")).trim(); if (!have.has(name.toUpperCase())) rows.push({site_id: siteId, name, kind, sort: i}); }
  if (!rows.length) return C.toast("Those docks already exist.", true);
  if (await C.run(() => C.q(C.sb.from("docks").insert(rows).select()), `${rows.length} dock${rows.length === 1 ? "" : "s"} added`)) pageSettings($("#main"));
}

/* ---------- checklists on the visit page ---------- */
function ckSection(v, runs) {
  if (!runs.length && !(v.status === "at_dock" && (v.ck_before_needed || v.ck_after_needed))) return "";
  const word = v.purpose === "inbound" ? "unloading" : "loading";
  const latest = st => runs.filter(r => r.stage === st).slice(-1)[0];
  const ans = (it, a) => { a = a || {}; const val = a.value;
    const txt = it.type === "photo" ? "" : val === "yes" ? "Yes" : val === "no" ? "No" : val === "na" ? "N/A" : val == null || val === "" ? "–" : C.esc(val) + (it.unit ? " " + C.esc(it.unit) : "");
    const bad = val === "no" || (it.type === "number" && val !== "na" && val != null && val !== "" && ((it.min !== undefined && it.min !== "" && +val < +it.min) || (it.max !== undefined && it.max !== "" && +val > +it.max)));
    const ph = (a.photos || []).length ? ` <button class="linkbtn small" data-ga="ck-photos" data-p="${C.esc(JSON.stringify(a.photos))}" data-t="${C.esc(it.text)}">Photo${a.photos.length === 1 ? "" : "s"} (${a.photos.length})</button>` : "";
    return `<span class="${bad ? (it.critical ? "var-neg" : "warnc") : ""}"><strong>${txt}</strong></span>${ph}`; };
  const block = r => `<div class="panel ckpanel ${r.result}"><div class="row" style="justify-content:space-between"><h3 style="margin:0">${r.stage === "before" ? `Before ${word}` : "Before dock out"} <span class="small muted">${C.esc(r.template_name)}</span></h3>
      <span class="status ${r.result === "pass" || r.result === "accepted" ? "s-match" : "s-out"}">${{pass: "Passed", fail: "Failed", accepted: "Failed, accepted", rejected: "Failed, vehicle rejected"}[r.result]}</span></div>
    <p class="small muted" style="margin:4px 0 8px">By ${C.esc(r.submitted_by_name || "–")}, ${C.dt(r.submitted_at)}${r.decided_at ? ` · ${r.result === "accepted" ? "accepted" : "rejected"} by ${C.esc(r.decided_by_name || "–")}, ${C.dt(r.decided_at)}: ${C.esc(r.decision_note || "")}` : ""}</p>
    ${r.result === "fail" && latest(r.stage) && latest(r.stage).id === r.id && v.status === "at_dock" ? `<div class="banner bad"><span>Critical: ${C.esc((r.failed || []).join("; "))}. Decide whether the vehicle can be ${word === "unloading" ? "unloaded" : "loaded"}.</span>
      <span class="row"><button class="btn sm" data-ga="ck-decide" data-run="${C.esc(r.id)}" data-d="accept">Accept and continue</button><button class="btn sm danger" data-ga="ck-decide" data-run="${C.esc(r.id)}" data-d="reject">Reject vehicle</button></span></div>` : ""}
    <table><tbody>${(r.items || []).map(it => `<tr><td style="white-space:normal">${C.esc(it.text)}${it.critical ? ` <span class="xs-crit">critical</span>` : ""}</td><td class="n" style="white-space:normal">${ans(it, (r.answers || {})[it.id])}</td></tr>`).join("")}</tbody></table></div>`;
  const pend = st => v.status === "at_dock" && v["ck_" + st + "_needed"] && !runs.some(r => r.stage === st) ? `<div class="panel ckpanel todo"><h3 style="margin:0">${st === "before" ? `Before ${word}` : "Before dock out"}</h3><p class="small muted" style="margin:4px 0 0">Not done yet. It's filled in on the phone (Docks tab).</p></div>` : "";
  return `<h3 style="margin:18px 0 8px">Checklists</h3><div class="ckwrap">${runs.map(block).join("")}${pend("before")}${pend("after")}</div>`;
}
function ckDecide(run, d) {
  let dlg = $("#ckdlg"); if (dlg) dlg.remove();
  dlg = document.createElement("dialog"); dlg.id = "ckdlg";
  dlg.innerHTML = `<form method="dialog"><h2 style="margin-bottom:8px">${d === "accept" ? "Accept and continue" : "Reject the vehicle"}</h2>
    <p class="hint">${d === "accept" ? "The team can start working with this vehicle despite the failed checklist. Your name and reason are recorded." : "The vehicle isn't loaded or unloaded. The team docks it out and security can gate it out. Your name and reason are recorded."}</p>
    <label class="field" style="margin-bottom:16px">Reason<textarea name="note" rows="3" required style="min-height:70px;font-family:var(--sans)" placeholder="${d === "accept" ? "e.g. seal number typo on the delivery note, confirmed with the transporter" : "e.g. pests found in the trailer, transporter informed"}"></textarea></label>
    <div class="row"><button class="btn ${d === "accept" ? "primary" : "danger"}" value="ok">${d === "accept" ? "Accept" : "Reject vehicle"}</button><button class="btn ghost" value="cancel" formnovalidate>Back</button></div></form>`;
  document.body.appendChild(dlg); dlg.showModal();
  dlg.onclose = async () => { if (dlg.returnValue !== "ok") return; const note = dlg.querySelector("textarea").value.trim(); if (!note) return C.toast("Enter a reason.", true);
    if (await C.run(() => C.q(C.sb.rpc("checklist_decide", {p_run: run, p_decision: d, p_note: note})), d === "accept" ? "Accepted" : "Vehicle rejected")) pageVisit($("#main"), C.cache.visit.v.id); };
}

/* ---------- clicks ---------- */
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-ga]"); if (!b || !C) return;
  if (b.tagName === "A") e.preventDefault();
  switch (b.dataset.ga) {
    case "open": C.go("gate/" + b.dataset.id); break;
    case "view": V.view = b.dataset.v; pageBoard($("#main")); break;
    case "export": exportVisits(); break;
    case "step": step(b.dataset.s); break;
    case "cancel": cancel(); break;
    case "print": printPass(); break;
    case "ck-decide": ckDecide(b.dataset.run, b.dataset.d); break;
    case "ck-photos": C.showPhotos(JSON.parse(b.dataset.p || "[]"), b.dataset.t || "Photos"); break;
    case "site-toggle": if (await C.run(() => C.q(C.sb.from("sites").update({active: b.dataset.on === "1"}).eq("id", b.dataset.id)), "Site updated")) pageSettings($("#main")); break;
    case "site-del": if (C.confirmTwice(b, "sdel" + b.dataset.id, "Tap again to delete") && await C.run(() => C.q(C.sb.from("sites").delete().eq("id", b.dataset.id)), "Site deleted")) pageSettings($("#main")); break;
    case "docks-add": addDocks(b.dataset.id, b.closest(".siteblk")); break;
    case "dock-toggle": if (await C.run(() => C.q(C.sb.from("docks").update({active: b.dataset.on === "1"}).eq("id", b.dataset.id)), "Dock updated")) pageSettings($("#main")); break;
    case "dock-del": if (C.confirmTwice(b, "ddel" + b.dataset.id, "×?") && await C.run(() => C.q(C.sb.from("docks").delete().eq("id", b.dataset.id)), "Dock deleted")) pageSettings($("#main")); break;
  }
});

window.CCGate = {page};
})();
