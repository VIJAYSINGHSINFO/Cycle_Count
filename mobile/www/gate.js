/* Stowra mobile: gate pass.
   Gate (security):  gate in with documents, PPE and the driver's mobile -> QR gate pass on WhatsApp; gate out by scanning the pass.
   Docks (warehouse): scan the pass -> dock in (choose a free dock) -> dock out (seal for outbound).
   These steps need the network: the database checks dock availability and the order of steps. */
(() => {
"use strict";
let X = null;
const G = {mode: "gate", view: "home", org: null, sites: [], docks: [], site: null, visits: [], visit: null, form: null, result: null, busy: false, timer: null};
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => X.esc(s);
const PURPOSE = {inbound: "Inbound", outbound: "Outbound", other: "Other visit"};
const STATUS = {in_yard: "Waiting in yard", at_dock: "At dock", dock_done: "Ready to leave", out: "Left", rejected: "Refused at gate"};
const TYPES = ["Truck", "Trailer", "Container 20ft", "Container 40ft", "Reefer", "Van", "Pickup", "Car", "Other"];
const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
const mins = iso => { const m = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 60000)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`; };
const fmtDate = s => s ? new Date(s + "T00:00:00").toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"}) : "–";

function init(ctx) { X = ctx; }
function uaeMobile(raw) {   // to international digits for WhatsApp: 050 123 4567 -> 971501234567
  let d = String(raw || "").replace(/[^0-9]/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.length === 10 && d.startsWith("05")) d = "971" + d.slice(1);
  else if (d.length === 9 && d.startsWith("5")) d = "971" + d;
  return d;
}
async function loadBase() {
  const [o, s, d] = await Promise.all([X.sb.from("org_settings").select("*").eq("id", 1).single(), X.sb.from("sites").select("*").eq("active", true).order("name"), X.sb.from("docks").select("*").eq("active", true).order("sort").order("name")]);
  if (o.error || s.error || d.error) throw (o.error || s.error || d.error);
  G.org = o.data; G.sites = s.data; G.docks = d.data;
  const saved = X.ls.get("cc-site");
  G.site = G.sites.some(x => x.id === saved) ? saved : (G.sites.find(x => x.name === X.M.me.site) || G.sites[0] || {}).id || null;
}
function stop() { clearInterval(G.timer); G.timer = null; G.gen = (G.gen || 0) + 1; }
function shell(title, body, dock, back) {
  $("#root").innerHTML = X.topbar(title, back ? `<button data-gt="${back}">Back</button>` : "", back ? "" : `<button data-act="signout">Sign out</button>`) +
    `<div class="wrap">${body}</div>${dock ? `<div class="dock">${dock}</div>` : ""}`;
}
function siteSelect() {
  return G.sites.length > 1 ? `<label class="field" style="margin-bottom:10px">Site<select id="gsite">${G.sites.map(s => `<option value="${esc(s.id)}" ${s.id === G.site ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>` : "";
}
function msg(kind, title, body) { return `<div class="alert ${kind}" role="${kind === "bad" ? "alert" : "status"}"><strong>${title}</strong>${body ? `<span>${body}</span>` : ""}</div>`; }

/* ---------- home: Gate (security) or Docks (warehouse) ---------- */
async function home(mode, note) {
  X.leaveSession(); stop(); const gen = G.gen; G.mode = mode; G.view = "home"; G.visit = null; X.M.mode = mode; X.ls.set("cc-mode", mode);
  const live = () => gen === G.gen && X.M.mode === mode && G.view === "home";
  shell(mode === "gate" ? "Gate" : "Docks", `${X.modeTabs(mode)}<div class="loading">Loading…</div>`);
  if (!X.isOnline()) { shell(mode === "gate" ? "Gate" : "Docks", `${X.modeTabs(mode)}${msg("warn", "No network", "The gate and dock screens need the network. Connect and try again.")}<button class="btn" data-gt="reload">Try again</button>`); return; }
  try { await loadBase(); } catch { if (!live()) return; shell(mode === "gate" ? "Gate" : "Docks", `${X.modeTabs(mode)}${msg("bad", "Couldn't load the sites", "Check the network and try again.")}<button class="btn" data-gt="reload">Try again</button>`); return; }
  if (!live()) return;
  if (!G.site) { shell(mode === "gate" ? "Gate" : "Docks", `${X.modeTabs(mode)}<div class="empty"><h3>No sites set up</h3><p>An administrator adds sites and docks on the console, under Settings.</p></div>`); return; }
  let rows = [];
  try { const r = await X.sb.from("gate_visit_list").select("*").eq("site_id", G.site).in("status", ["in_yard", "at_dock", "dock_done"]).order("gate_in_at"); if (r.error) throw r.error; rows = r.data; } catch {}
  if (!live()) return;
  G.visits = rows;
  const card = v => `<button data-gt="visit" data-code="${esc(v.pass_code)}"><span class="nm">${esc(v.vehicle_plate)} <span class="xs ${v.status === "dock_done" ? "ok" : v.status === "at_dock" ? "info" : ""}">${STATUS[v.status]}${v.dock_name ? " · " + esc(v.dock_name) : ""}</span></span>
    <span class="small muted">${PURPOSE[v.purpose]}${v.storer ? " · " + esc(v.storer) : ""}${(v.refs || []).length ? " · " + esc(v.refs.join(", ")) : ""}</span><span class="small">${esc(v.driver_name)} · inside ${mins(v.gate_in_at)}</span></button>`;
  const sec = (t, list) => list.length ? `<h3 class="qc-h">${t} <span class="muted small">${list.length}</span></h3><div class="sess">${list.map(card).join("")}</div>` : "";
  const body = mode === "gate"
    ? `${X.modeTabs(mode)}${siteSelect()}<button class="btn primary bigbtn" data-gt="new">Gate in a vehicle</button>
       <label class="sr" for="gscan">Gate out: scan the gate pass</label><div class="scan" style="margin-top:12px"><input id="gscan" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="Gate out: scan pass or type plate">${X.cameraAvailable() ? `<button class="cam" data-act="camera" aria-label="Scan with camera">${X.CAM_ICON}</button>` : ""}</div>
       <div id="gmsg">${note || ""}</div>${sec("Ready to leave", rows.filter(v => v.status === "dock_done" || (v.purpose === "other" && v.status === "in_yard")))}${sec("Inside", rows.filter(v => !(v.status === "dock_done" || (v.purpose === "other" && v.status === "in_yard"))))}
       ${rows.length ? "" : `<p class="muted small" style="margin-top:14px">No vehicles inside.</p>`}<p style="margin-top:14px"><button class="btn ghost" data-gt="reload">Refresh</button></p>`
    : `${X.modeTabs(mode)}${siteSelect()}<label class="sr" for="gscan">Scan the driver's gate pass</label><div class="scan"><input id="gscan" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="Scan gate pass or type plate">${X.cameraAvailable() ? `<button class="cam" data-act="camera" aria-label="Scan with camera">${X.CAM_ICON}</button>` : ""}</div>
       <div id="gmsg">${note || ""}</div>${sec("Waiting in yard", rows.filter(v => v.status === "in_yard" && v.purpose !== "other"))}${sec("At docks", rows.filter(v => v.status === "at_dock"))}
       ${rows.some(v => v.status !== "dock_done") ? "" : `<p class="muted small" style="margin-top:14px">No vehicles waiting or at a dock.</p>`}<p style="margin-top:14px"><button class="btn ghost" data-gt="reload">Refresh</button></p>`;
  shell(mode === "gate" ? "Gate" : "Docks", body);
  const sel = $("#gsite"); if (sel) sel.onchange = () => { G.site = sel.value; X.ls.set("cc-site", G.site); home(mode); };
  const s = $("#gscan"); s.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const v = s.value.trim(); s.value = ""; if (v) scan(v); } }); s.focus({preventScroll: true});
  clearInterval(G.timer); G.timer = setInterval(() => { if (!live()) { stop(); return; } if (document.activeElement !== $("#gscan")) home(mode); }, 30000);
}

/* ---------- scanning a pass (or typing a plate) ---------- */
async function scan(raw) {
  const fe = document.activeElement;
  if (G.view === "visit" && fe && fe.id === "dref") { fe.value = raw; addDockRef(); return; }
  if ((G.view === "form" || G.view === "visit") && fe && fe.dataset && fe.dataset.scan) { fe.value = raw; fe.dispatchEvent(new Event("input")); return; }
  if (G.view === "form") return;
  const code = String(raw).trim().toUpperCase().replace(/^.*[?&]c=([A-Z0-9]+).*$/i, "$1");
  let r = await X.sb.from("gate_visit_list").select("*").eq("pass_code", code).limit(1);
  let v = !r.error && r.data[0];
  if (!v) { r = await X.sb.from("gate_visit_list").select("*").ilike("vehicle_plate", raw.trim()).in("status", ["in_yard", "at_dock", "dock_done"]).limit(1); v = !r.error && r.data[0]; }
  if (!v) { X.vibrate([200, 80, 200]); const m = $("#gmsg"); if (m) m.innerHTML = msg("bad", `No gate pass ${esc(code)}`, "Check the code on the driver's pass, or type the vehicle plate."); return; }
  openVisit(v);
}
async function refreshVisit(code) { const r = await X.sb.from("gate_visit_list").select("*").eq("pass_code", code).limit(1); return !r.error && r.data[0]; }

/* ---------- one visit: what this phone can do with it ---------- */
async function openVisit(v, note) {
  stop(); G.view = "visit"; G.visit = v;
  const otherSite = v.site_id !== G.site ? msg("warn", `This vehicle is at ${esc(v.site_name)}`, "Not at the site chosen on this phone.") : "";
  const info = `<div class="panel qc-head"><div class="qc-top"><div><div class="qc-no">${esc(v.vehicle_plate)}</div><div class="small muted">${PURPOSE[v.purpose]}${v.storer ? " · " + esc(v.storer) : ""} · pass ${esc(v.pass_code)}</div></div>
      <span class="xs ${v.status === "dock_done" ? "ok" : v.status === "rejected" || v.status === "out" ? "bad" : "info"}">${STATUS[v.status]}</span></div>
    <dl class="gdl"><div><dt>Driver</dt><dd>${esc(v.driver_name)}</dd></div><div><dt>Transporter</dt><dd>${esc(v.transporter || "–")}</dd></div>
      <div class="wide"><dt>${v.purpose === "inbound" ? "ASN / PO" : v.purpose === "outbound" ? "Orders" : "Reference"}</dt><dd>${esc((v.refs || []).join(", ") || "–")}</dd></div>
      <div><dt>Inside</dt><dd>${v.status === "out" || v.status === "rejected" ? "–" : mins(v.gate_in_at)}</dd></div><div><dt>Dock</dt><dd>${esc(v.dock_name || "–")}</dd></div>
      ${v.seal_in ? `<div><dt>Seal in</dt><dd>${esc(v.seal_in)}</dd></div>` : ""}${v.seal_out ? `<div><dt>Seal out</dt><dd>${esc(v.seal_out)}</dd></div>` : ""}</dl></div>`;
  let body = "", dock = "";
  if (G.mode === "gate") {
    const cleared = v.status === "dock_done" || (v.purpose === "other" && v.status === "in_yard");
    if (cleared) {
      body = `<div class="gclear ok"><div class="big">✓</div><h2>Cleared to leave</h2><p>${v.purpose === "outbound" && v.seal_out ? `Check the seal on the vehicle: <strong>${esc(v.seal_out)}</strong>` : "All steps are done."}</p></div>${otherSite}${info}`;
      dock = `<button class="btn primary save" data-gt="gate-out">Confirm gate out</button><div class="row"><button class="btn ghost" data-gt="home">Cancel</button></div>`;
    } else {
      const why = v.status === "out" ? `Already left at ${new Date(v.gate_out_at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}.` : v.status === "rejected" ? `Refused at the gate: ${esc(v.reject_reason || "")}` : v.status === "in_yard" ? "It hasn't been to a dock yet." : `It is still at ${esc(v.dock_name || "a dock")} and hasn't been docked out.`;
      body = `<div class="gclear bad"><div class="big">✕</div><h2>Not cleared to leave</h2><p>${why}</p></div>${info}`;
      dock = `<button class="btn primary save" data-gt="home">Back</button>`;
    }
  } else {
    if (v.status === "in_yard" && v.purpose !== "other") {
      const busy = new Set(((await X.sb.from("gate_visits").select("dock_id").eq("status", "at_dock")).data || []).map(x => x.dock_id));
      const free = G.docks.filter(d => d.site_id === v.site_id && !busy.has(d.id) && (d.kind === "both" || d.kind === v.purpose));
      G.pickDock = null; G.dockRefs = [];
      const orders = v.purpose === "outbound" ? `<div class="panel"><h3 style="margin-bottom:6px">Orders loading on this vehicle</h3>
        <label class="field">${(v.refs || []).length ? "Add more order numbers (optional)" : "Order numbers (at least one)"}<span class="refadd"><input id="dref" placeholder="Scan or type, then Add" autocapitalize="characters" autocomplete="off"><button class="btn sm" data-gt="dref-add" type="button">Add</button></span></label>
        <div class="chips" id="drefs"></div></div>` : "";
      body = `${otherSite}${info}${orders}<div class="panel"><h3 style="margin-bottom:6px">Dock in: choose a free dock</h3>${free.length ? `<div class="dockpick">${free.map(d => `<button class="chip" data-gt="pick-dock" data-id="${esc(d.id)}">${esc(d.name)}</button>`).join("")}</div>` : `<p class="hint">No free ${v.purpose} dock at this site right now.</p>`}</div>`;
      dock = `<button class="btn primary save" data-gt="dock-in" disabled id="dockinbtn">Dock in</button><div class="row"><button class="btn ghost" data-gt="home">Cancel</button></div>`;
    } else if (v.status === "at_dock") {
      // Checklists first: "before" right after dock in, "after" before dock out
      let cks = [];
      try { const r = await X.sb.rpc("checklist_status", {p_visit: v.id}); if (!r.error) cks = r.data || []; } catch {}
      G.cks = cks;
      const word = v.purpose === "inbound" ? "unloading" : "loading", label = st => st === "before" ? `Before ${word}` : "Before dock out";
      const rejected = cks.find(c => c.run && c.run.result === "rejected");
      const next = rejected ? null : cks.find(c => c.template && !(c.run && ["pass", "accepted"].includes(c.run.result)));
      const rows = cks.map(c => { const r = c.run, res = r ? r.result : null;
        return `<li class="ckrow ${res || "todo"}"><span><strong>${label(c.stage)}</strong><br><span class="small muted">${esc(c.template ? c.template.name : "")}</span>
          ${res === "fail" ? `<br><span class="small bad">Failed: ${esc((r.failed || []).join("; "))}</span>` : ""}${(res === "accepted" || res === "rejected") && r.decision_note ? `<br><span class="small">${res === "accepted" ? "Accepted" : "Rejected"} by ${esc(r.decided_by_name || "supervisor")}: ${esc(r.decision_note)}</span>` : ""}
          ${r && r.issues && r.issues.length ? `<br><span class="small warnc">Issues: ${esc(r.issues.join("; "))}</span>` : ""}</span>
          <span class="ckres">${{pass: "✓ Passed", accepted: "✓ Accepted", fail: "✕ Failed", rejected: "✕ Rejected"}[res] || "To do"}</span></li>`; }).join("");
      const ckPanel = cks.length ? `<div class="panel"><h3 style="margin-bottom:8px">Checklists</h3><ul class="cklist">${rows}</ul></div>` : "";
      if (rejected) {
        body = `${otherSite}${msg("bad", "Vehicle rejected at the dock", `Not ${v.purpose === "inbound" ? "unloaded" : "loaded"}. Dock it out so it can leave.`)}${info}${ckPanel}`;
        dock = `<button class="btn primary save" data-gt="dock-out">Dock out (rejected)</button><div class="row"><button class="btn ghost" data-gt="home">Cancel</button></div>`;
      } else if (next && next.run && next.run.result === "fail") {
        body = `${otherSite}${msg("bad", "Checklist failed: stop, don't start " + (v.purpose === "inbound" ? "unloading" : "loading"), `Critical: ${esc((next.run.failed || []).join("; "))}. A supervisor must accept or reject the vehicle on the console. If the problem has been fixed, you can do the checklist again.`)}${info}${ckPanel}`;
        dock = `<button class="btn primary save" data-gt="ck-start" data-stage="${next.stage}">Do the checklist again</button><div class="row"><button class="btn ghost" data-gt="refresh-visit">Refresh</button><button class="btn ghost" data-gt="home">Back</button></div>`;
      } else if (next) {
        body = `${otherSite}${info}${ckPanel}`;
        dock = `<button class="btn primary save" data-gt="ck-start" data-stage="${next.stage}">Start checklist: ${label(next.stage).toLowerCase()}</button><div class="row"><button class="btn ghost" data-gt="home">Back</button></div>`;
      } else {
        body = `${otherSite}${info}${ckPanel}<div class="panel"><h3 style="margin-bottom:6px">Dock out from ${esc(v.dock_name || "")}</h3>
          <label class="field">Seal number ${v.purpose === "outbound" ? "applied to the vehicle (required)" : "(optional)"}<input id="gseal" autocapitalize="characters" autocomplete="off" data-scan="1"></label></div>`;
        dock = `<button class="btn primary save" data-gt="dock-out">Dock out</button><div class="row"><button class="btn ghost" data-gt="home">Cancel</button></div>`;
      }
    } else {
      body = `${msg("info", STATUS[v.status], v.status === "dock_done" ? "Docked out. Security will gate it out." : v.purpose === "other" ? "This visit doesn't use a dock." : "")}${info}`;
      dock = `<button class="btn primary save" data-gt="home">Back</button>`;
    }
  }
  shell(v.vehicle_plate, `${note || ""}${body}`, dock, "home");
  const dr = $("#dref"); if (dr) { dr.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addDockRef(); } }); dr.focus({preventScroll: true}); }
}
function addDockRef() {
  const i = $("#dref"); if (!i) return; const r = i.value.trim().toUpperCase(); i.value = ""; if (!r) return;
  if (!G.dockRefs.includes(r) && !(G.visit.refs || []).includes(r)) G.dockRefs.push(r);
  drawDockRefs(); i.focus();
}
function drawDockRefs() { const c = $("#drefs"); if (c) c.innerHTML = G.dockRefs.map((r, i) => `<button class="chip" data-gt="dref-del" data-i="${i}" aria-label="Remove ${esc(r)}">${esc(r)} ×</button>`).join(""); }

/* ---------- gate in form ---------- */
function newForm() {
  G.form = {purpose: "inbound", refs: [], ppe: null, vehicle_type: "Truck"};
  G.view = "form"; renderForm();
}
function renderForm() {
  const f = G.form, siteName = (G.sites.find(s => s.id === G.site) || {}).name || "";
  const doc = (k, label, numLabel) => `<div class="gdoc" data-doc="${k}"><h4>${label}</h4>
    <div class="grid2"><label class="field">${numLabel}<input id="g_${k}_no" value="${esc(f[k + "_no"] || "")}" autocapitalize="characters" autocomplete="off" data-scan="1"></label>
    <label class="field">Expiry date<input id="g_${k}_exp" type="date" value="${esc(f[k + "_exp"] || "")}"></label></div><p class="docstate" id="g_${k}_st"></p></div>`;
  const refLabel = f.purpose === "inbound" ? "ASN / PO numbers" : f.purpose === "outbound" ? "Order numbers (optional: the warehouse adds them at dock in)" : "Reference (optional)";
  shell("Gate in", `
    <p class="small muted" style="margin:0 0 8px">${esc([siteName, G.org.company_name].filter(Boolean).join(" · "))}</p>
    <div class="seg" role="radiogroup" aria-label="Purpose">${["inbound", "outbound", "other"].map(p => `<button role="radio" aria-checked="${f.purpose === p}" data-gt="purpose" data-p="${p}">${PURPOSE[p]}</button>`).join("")}</div>
    <div class="panel"><h3>Load</h3>
      <label class="field">Storer / client${f.purpose === "other" ? " (optional)" : ""}<input id="g_storer" value="${esc(f.storer || "")}" autocapitalize="characters"></label>
      <label class="field">${refLabel}<span class="refadd"><input id="g_ref" placeholder="Scan or type, then Add" autocapitalize="characters" autocomplete="off" data-scan="1"><button class="btn sm" data-gt="ref-add" type="button">Add</button></span></label>
      <div class="chips" id="g_refs">${f.refs.map((r, i) => `<button class="chip" data-gt="ref-del" data-i="${i}" aria-label="Remove ${esc(r)}">${esc(r)} ×</button>`).join("")}</div>
      ${f.purpose === "inbound" ? `<label class="field">Seal number on arrival (optional)<input id="g_seal" value="${esc(f.seal_in || "")}" autocapitalize="characters" data-scan="1"></label>` : ""}
      ${f.purpose === "other" ? `<label class="field">Reason for visit<input id="g_notes" value="${esc(f.notes || "")}" placeholder="e.g. maintenance contractor, visitor"></label>` : ""}</div>
    <div class="panel"><h3>Vehicle and driver</h3>
      <div class="grid2"><label class="field">Vehicle plate<input id="g_plate" value="${esc(f.vehicle_plate || "")}" autocapitalize="characters" placeholder="e.g. DXB K 48213"></label>
      <label class="field">Vehicle type<select id="g_type">${TYPES.map(t => `<option ${f.vehicle_type === t ? "selected" : ""}>${t}</option>`).join("")}</select></label></div>
      <label class="field">Transporter<input id="g_trans" value="${esc(f.transporter || "")}"></label>
      <label class="field">Driver's name<input id="g_driver" value="${esc(f.driver_name || "")}"></label>
      <label class="field">Driver's mobile (for the WhatsApp gate pass)<input id="g_mobile" type="tel" inputmode="tel" value="${esc(f.driver_mobile || "")}" placeholder="050 123 4567"></label></div>
    <div class="panel"><h3>Documents</h3><p class="hint" style="margin-top:0">An expired document refuses entry.</p>
      ${doc("eid", "Emirates ID", "ID number")}${doc("lic", "Driving licence", "Licence number")}${doc("mul", "Mulkiya (vehicle registration)", "Traffic file or registration number")}</div>
    <div class="panel"><h3>PPE</h3><p class="hint" style="margin-top:0">Is the driver wearing the required PPE (safety shoes, vest)?</p>
      <div class="seg ppe"><button data-gt="ppe" data-v="1" aria-pressed="${f.ppe === true}">Yes</button><button data-gt="ppe" data-v="0" aria-pressed="${f.ppe === false}" class="no">No</button></div>
      ${f.ppe === false ? msg("bad", "No PPE: entry will be refused", "The driver can come back once wearing the PPE.") : ""}</div>
    <div id="gmsg"></div>`,
    `<button class="btn primary save" data-gt="submit">${f.ppe === false ? "Record refusal" : "Gate in and create pass"}</button>`, "home");
  ["eid", "lic", "mul"].forEach(k => { const i = $(`#g_${k}_exp`); i.oninput = () => docState(k); docState(k); });
  const ri = $("#g_ref"); ri.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); addRef(); } });
}
function docState(k) {
  const v = $(`#g_${k}_exp`).value, el = $(`#g_${k}_st`);
  if (!v) { el.textContent = ""; el.className = "docstate"; return; }
  const days = Math.round((Date.parse(v) - Date.parse(today())) / 864e5);
  el.className = "docstate " + (days < 0 ? "bad" : days <= 30 ? "warn" : "ok");
  el.textContent = days < 0 ? `Expired ${-days} day${days === -1 ? "" : "s"} ago: entry will be refused` : days === 0 ? "Expires today: valid" : days <= 30 ? `Valid, expires in ${days} day${days === 1 ? "" : "s"}` : "Valid";
}
function grab() {
  const f = G.form, v = id => ($("#" + id) || {}).value;
  Object.assign(f, {storer: v("g_storer"), seal_in: v("g_seal"), notes: v("g_notes"), vehicle_plate: v("g_plate"), vehicle_type: v("g_type"), transporter: v("g_trans"), driver_name: v("g_driver"), driver_mobile: v("g_mobile"),
    eid_no: v("g_eid_no"), eid_exp: v("g_eid_exp"), lic_no: v("g_lic_no"), lic_exp: v("g_lic_exp"), mul_no: v("g_mul_no"), mul_exp: v("g_mul_exp")});
}
function addRef() {
  const i = $("#g_ref"); const r = i.value.trim().toUpperCase(); if (!r) return;
  if (!G.form.refs.includes(r)) G.form.refs.push(r); i.value = ""; grab(); renderForm(); $("#g_ref").focus();
}
async function submit() {
  grab(); const f = G.form, err = t => { const m = $("#gmsg"); m.innerHTML = msg("bad", t, ""); m.scrollIntoView({block: "center"}); X.vibrate([150, 60, 150]); };
  const pending = ($("#g_ref") || {}).value; if (pending && pending.trim()) addRef();
  if (f.purpose !== "other" && !String(f.storer || "").trim()) return err("Enter the storer / client");
  if (f.purpose === "inbound" && !f.refs.length) return err("Add at least one ASN or PO number");
  if (!String(f.vehicle_plate || "").trim()) return err("Enter the vehicle plate");
  if (!String(f.driver_name || "").trim()) return err("Enter the driver's name");
  if (f.ppe == null) return err("Answer the PPE question");
  if (f.ppe && (!f.eid_exp || !f.lic_exp || !f.mul_exp)) return err("Enter the expiry date of all three documents");
  if (f.ppe && uaeMobile(f.driver_mobile).length < 9) return err("Enter the driver's mobile number");
  if (G.busy) return; G.busy = true;
  try {
    const r = await X.sb.rpc("gate_in", {p: {site_id: G.site, purpose: f.purpose, storer: f.storer, refs: f.refs, vehicle_plate: f.vehicle_plate, vehicle_type: f.vehicle_type, transporter: f.transporter,
      driver_name: f.driver_name, driver_mobile: uaeMobile(f.driver_mobile), eid_number: f.eid_no, eid_expiry: f.eid_exp || null, licence_number: f.lic_no, licence_expiry: f.lic_exp || null,
      mulkiya_number: f.mul_no, mulkiya_expiry: f.mul_exp || null, ppe_ok: !!f.ppe, seal_in: f.seal_in, notes: f.notes}, p_device: X.DEVICE});
    if (r.error) return err(esc(r.error.message));
    G.result = r.data; G.view = "result"; renderResult();
  } catch { err("No network. Connect and try again."); }
  finally { G.busy = false; }
}

/* ---------- result: the gate pass ---------- */
function passLink(v) {
  const base = String(G.org.pass_base_url || "").trim(); if (!base) return "";
  const u = new URL(base, location.href);
  u.searchParams.set("c", v.pass_code); u.searchParams.set("p", v.vehicle_plate); if (G.org.company_name) u.searchParams.set("n", G.org.company_name);
  u.searchParams.set("s", (G.sites.find(s => s.id === v.site_id) || {}).name || ""); u.searchParams.set("t", v.gate_in_at);
  return u.href;
}
function renderResult() {
  const v = G.result;
  if (v.status === "rejected") {
    X.vibrate([300, 100, 300]);
    shell("Gate in", `<div class="gclear bad"><div class="big">✕</div><h2>Entry refused</h2><p>${esc(v.reject_reason || "")}</p><p class="small">Recorded for ${esc(v.vehicle_plate)} at ${new Date(v.gate_in_at).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}. The vehicle must not enter.</p></div>`,
      `<button class="btn primary save" data-gt="home">Done</button>`);
    return;
  }
  const link = passLink(v);
  const text = `${G.org.company_name || "Stowra"}: gate pass ${v.pass_code} for vehicle ${v.vehicle_plate}.${link ? ` Show this QR code at the dock and at the gate: ${link}` : " Show this code at the dock and at the gate."}`;
  G.wa = `https://wa.me/${uaeMobile(v.driver_mobile)}?text=${encodeURIComponent(text)}`;
  shell("Gate pass", `<div class="gclear ok"><div class="big">✓</div><h2>${esc(v.vehicle_plate)} may enter</h2><p>Pass <strong class="mono">${esc(v.pass_code)}</strong>. Send it to the driver now.</p></div>
    <div class="panel passqr"><canvas id="gqr" aria-label="QR code of the gate pass"></canvas><div class="mono big2">${esc(v.pass_code)}</div><p class="small muted">${esc(v.driver_name)} · ${esc(v.driver_mobile ? "+" + v.driver_mobile : "")}</p></div>
    ${link ? "" : msg("warn", "No gate pass page set", "The WhatsApp message will contain the code only. An administrator can set the pass page address in Settings on the console.")}`,
    `<button class="btn primary save wa" data-gt="whatsapp">Send on WhatsApp</button><div class="row"><button class="btn ghost" data-gt="print-pass">Print</button><button class="btn ghost" data-gt="home">Done</button></div>`);
  drawQR($("#gqr"), v.pass_code);
}
async function drawQR(canvas, text) {
  try {
    if (!window.bwipjs) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "lib/bwip-js-min.js"; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
    window.bwipjs.toCanvas(canvas, {bcid: "qrcode", text, scale: 6, eclevel: "M"});
  } catch { canvas.replaceWith(Object.assign(document.createElement("p"), {className: "hint", textContent: "The QR picture couldn't be drawn here. The driver can show the code instead."})); }
}

/* ---------- checklist form ---------- */
function startChecklist(stage) {
  const c = (G.cks || []).find(x => x.stage === stage); if (!c || !c.template) return;
  G.ck = {stage, t: c.template, answers: {}, clientId: X.uuid ? X.uuid() : String(Date.now())};
  G.view = "checklist"; stop(); renderChecklist();
}
function renderChecklist() {
  const {t, answers} = G.ck, v = G.visit;
  const row = it => {
    const a = answers[it.id] || {}, photos = a.photos || [];
    const tag = it.critical ? `<span class="xs bad">Critical</span>` : "";
    let ctl = "";
    if (it.type === "yesno") ctl = `<div class="seg ckseg ${it.na ? "three" : ""}">${[["yes", "Yes"], ["no", "No"], ...(it.na ? [["na", "N/A"]] : [])].map(([k, l]) => `<button data-gt="ck-ans" data-id="${esc(it.id)}" data-v="${k}" aria-pressed="${a.value === k}" class="${k}">${l}</button>`).join("")}</div>`;
    else if (it.type === "number") ctl = `<div class="cknum"><input type="number" inputmode="decimal" step="any" data-ck-num="${esc(it.id)}" value="${a.value != null && a.value !== "na" ? esc(a.value) : ""}" ${a.value === "na" ? "disabled" : ""} placeholder="${it.min !== undefined && it.min !== "" || it.max !== undefined && it.max !== "" ? `${it.min ?? "…"} to ${it.max ?? "…"}` : ""}"><span>${esc(it.unit || "")}</span>${it.na ? `<button class="chip" data-gt="ck-ans" data-id="${esc(it.id)}" data-v="${a.value === "na" ? "" : "na"}" aria-pressed="${a.value === "na"}">N/A</button>` : ""}</div>`;
    else if (it.type === "text") ctl = `<input class="cktext" data-ck-text="${esc(it.id)}" value="${esc(a.value || "")}">`;
    const needPhoto = it.type === "photo" || (it.photo_on_no && a.value === "no");
    const ph = it.type === "photo" || it.photo_on_no ? `<div class="thumbs" style="margin-top:8px">${photos.map((p, i) => `<span class="thumb"><img src="${esc(p.url)}" alt="Photo ${i + 1}"><button data-gt="ck-photo-del" data-id="${esc(it.id)}" data-i="${i}" aria-label="Remove photo">×</button></span>`).join("")}
      ${needPhoto || photos.length ? `<button class="btn sm" data-gt="ck-photo" data-id="${esc(it.id)}">${X.CAM_ICON} ${photos.length ? "Add photo" : needPhoto ? "Take photo (required)" : "Add photo"}</button>` : ""}</div>` : "";
    return `<li class="ckq ${a.value === "no" ? (it.critical ? "bad" : "warn") : ""}"><div class="ckt">${esc(it.text)} ${tag}</div>${ctl}${ph}</li>`;
  };
  shell(G.ck.stage === "before" ? `Before ${v.purpose === "inbound" ? "unloading" : "loading"}` : "Before dock out",
    `<p class="small muted" style="margin:0 0 8px">${esc(v.vehicle_plate)} · ${esc(v.dock_name || "")} · ${esc(t.name)}</p><ol class="ckform">${t.items.map(row).join("")}</ol><div id="gmsg"></div>`,
    `<button class="btn primary save" data-gt="ck-submit">Submit checklist</button><div class="row"><button class="btn ghost" data-gt="ck-cancel">Cancel</button></div>`, "ck-cancel");
  $$("[data-ck-num]").forEach(i => i.oninput = () => { (G.ck.answers[i.dataset.ckNum] = G.ck.answers[i.dataset.ckNum] || {}).value = i.value; });
  $$("[data-ck-text]").forEach(i => i.oninput = () => { (G.ck.answers[i.dataset.ckText] = G.ck.answers[i.dataset.ckText] || {}).value = i.value; });
}
async function compressImage(file) {
  const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = URL.createObjectURL(file); });
  const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight)), c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
  return await new Promise(r => c.toBlob(r, "image/jpeg", 0.7));
}
function ckPhoto(id) {
  const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*"; inp.setAttribute("capture", "environment");
  inp.onchange = async () => {
    const f = inp.files && inp.files[0]; if (!f) return;
    try {
      const blob = await compressImage(f), path = `gate/${G.visit.id}/${G.ck.stage}/${(X.uuid ? X.uuid() : Date.now())}.jpg`;
      const r = await X.sb.storage.from("stowra-photos").upload(path, blob, {contentType: "image/jpeg", upsert: false});
      if (r.error) throw r.error;
      const a = G.ck.answers[id] = G.ck.answers[id] || {}; (a.photos = a.photos || []).push({path, url: URL.createObjectURL(blob)});
      renderChecklist();
    } catch { X.toast("The photo couldn't be uploaded. Check the network and try again.", true); }
  };
  inp.click();
}
async function submitChecklist() {
  if (G.busy) return;
  const {t, answers} = G.ck, err = m => { const g = $("#gmsg"); g.innerHTML = msg("bad", m, ""); g.scrollIntoView({block: "center"}); X.vibrate([150, 60, 150]); };
  const missing = t.items.filter(it => { const a = answers[it.id] || {}; if (it.required === false) return false; if (it.type === "photo") return !(a.photos || []).length; return a.value == null || String(a.value).trim() === ""; });
  if (missing.length) return err(`Answer every item: ${missing.length} left (${esc(missing[0].text)}${missing.length > 1 ? ", …" : ""})`);
  const noPhoto = t.items.find(it => it.photo_on_no && (answers[it.id] || {}).value === "no" && !((answers[it.id] || {}).photos || []).length);
  if (noPhoto) return err(`Take a photo for: ${esc(noPhoto.text)}`);
  const payload = {}; Object.entries(answers).forEach(([k, a]) => { payload[k] = {value: a.value == null ? null : a.value, photos: (a.photos || []).map(p => p.path)}; });
  G.busy = true;
  try {
    const r = await X.sb.rpc("checklist_submit", {p_visit: G.visit.id, p_stage: G.ck.stage, p_answers: payload, p_device: X.DEVICE, p_client_id: G.ck.clientId});
    if (r.error) return err(esc(r.error.message));
    const run = r.data; G.ck = null;
    const nv = await refreshVisit(G.visit.pass_code);
    if (run.result === "fail") { X.vibrate([300, 100, 300]); openVisit(nv || G.visit); }
    else { X.vibrate(60); openVisit(nv || G.visit, msg("ok", "Checklist passed", run.issues && run.issues.length ? `Noted issues: ${esc(run.issues.join("; "))}` : "")); }
  } catch { err("No network. Your answers are still here; try again."); }
  finally { G.busy = false; }
}

/* ---------- taps ---------- */
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-gt]"); if (!b || !X) return;
  switch (b.dataset.gt) {
    case "home": case "reload": home(G.mode); break;
    case "new": newForm(); break;
    case "ck-start": startChecklist(b.dataset.stage); break;
    case "ck-ans": { const a = G.ck.answers[b.dataset.id] = G.ck.answers[b.dataset.id] || {}; a.value = b.dataset.v || null; renderChecklist(); break; }
    case "ck-photo": ckPhoto(b.dataset.id); break;
    case "ck-photo-del": { const a = G.ck.answers[b.dataset.id]; if (a && a.photos) a.photos.splice(+b.dataset.i, 1); renderChecklist(); break; }
    case "ck-submit": submitChecklist(); break;
    case "ck-cancel": G.ck = null; openVisit(G.visit); break;
    case "refresh-visit": { const nv = await refreshVisit(G.visit.pass_code); openVisit(nv || G.visit); break; }
    case "visit": { const v = G.visits.find(x => x.pass_code === b.dataset.code); if (v) openVisit(v); break; }
    case "purpose": grab(); G.form.purpose = b.dataset.p; renderForm(); break;
    case "ppe": grab(); G.form.ppe = b.dataset.v === "1"; renderForm(); break;
    case "ref-add": addRef(); break;
    case "dref-add": addDockRef(); break;
    case "dref-del": G.dockRefs.splice(+b.dataset.i, 1); drawDockRefs(); break;
    case "ref-del": grab(); G.form.refs.splice(+b.dataset.i, 1); renderForm(); break;
    case "submit": submit(); break;
    case "whatsapp": window.open(G.wa, "_blank"); break;
    case "print-pass": window.print(); break;
    case "pick-dock": { $$(".dockpick .chip").forEach(c => c.setAttribute("aria-pressed", c === b)); G.pickDock = b.dataset.id; const di = $("#dockinbtn"); if (di) { di.disabled = false; di.textContent = `Dock in at ${b.textContent}`; } break; }
    case "dock-in": case "dock-out": case "gate-out": {
      const v = G.visit, s = b.dataset.gt.replace("-", "_");
      if (s === "dock_in" && $("#dref")) {
        if ($("#dref").value.trim()) addDockRef();
        if (v.purpose === "outbound" && !(v.refs || []).length && !G.dockRefs.length) { X.vibrate([150, 60, 150]); X.toast("Add at least one order number", true); $("#dref").focus(); break; }
      }
      if (G.busy) break; G.busy = true;
      try {
        const r = await X.sb.rpc("gate_step", {p_code: v.pass_code, p_step: s, p_dock: s === "dock_in" ? G.pickDock : null, p_seal: s === "dock_out" && $("#gseal") ? ($("#gseal").value || "").trim() : null, p_device: X.DEVICE, p_refs: s === "dock_in" && G.dockRefs && G.dockRefs.length ? G.dockRefs : null});
        if (r.error) { X.vibrate([200, 80, 200]); const nv = await refreshVisit(v.pass_code); openVisit(nv || v, msg("bad", "Not done", esc(r.error.message))); break; }
        X.vibrate(60);
        home(G.mode, msg("ok", {dock_in: `${esc(v.vehicle_plate)} docked in`, dock_out: `${esc(v.vehicle_plate)} docked out`, gate_out: `${esc(v.vehicle_plate)} gated out`}[s], s === "dock_out" ? "Security can now gate it out." : ""));
      } catch { openVisit(v, msg("bad", "No network", "Connect and try again.")); }
      finally { G.busy = false; }
      break;
    }
  }
});

window.CCGate = {init, home, scan, stop, view: () => G.view};
window.__ckDemo = () => G.ck;
window.__gateDemo = () => X && ["gate", "dock"].includes(X.M.mode) ? {view: G.view, mode: G.mode, visits: G.visits, visit: G.visit, result: G.result} : null;
})();
