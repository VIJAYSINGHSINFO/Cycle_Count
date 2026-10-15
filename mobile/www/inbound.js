/* Stowra mobile: inbound.
   Receive: find the ASN (type it, or scan the driver's gate pass), scan the receiving location once, then scan each product:
            quantity, batch / expiry as the client requires, good or damaged, pallet label. Each pallet goes into stock.
   Put away: scan a received pallet, see suggested locations, scan the location you put it in.
   Both need the network: the database checks the client rules and creates the stock. */
(() => {
"use strict";
let X = null;
const I = {tab: "recv", view: "home", asn: null, lines: [], client: null, item: null, form: null, mine: [], pallet: null, sugg: [], busy: false, gen: 0, note: ""};
const $ = (s, r = document) => r.querySelector(s);
const esc = s => X.esc(s);
const N = v => Number(v) || 0;
const STATUS = {open: "Expected", receiving: "Receiving", received: "Received", closed: "Closed", cancelled: "Cancelled"};
const DAMAGE = ["Crushed / broken", "Wet", "Torn packaging", "Leaking", "Pest or contamination", "Other"];
const fmtDate = s => s ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"}) : "–";
const msg = (kind, title, body) => `<div class="alert ${kind}" role="${kind === "bad" ? "alert" : "status"}"><strong>${title}</strong>${body ? `<span>${body}</span>` : ""}</div>`;
const recvLoc = () => X.ls.get("cc-recv-loc") || "";

function init(ctx) { X = ctx; }
function stop() { I.gen++; }
function shell(title, body, dock, back) {
  $("#root").innerHTML = X.topbar(title, back ? `<button data-in="${back}">Back</button>` : "", back ? "" : `<button data-act="signout">Sign out</button>`) +
    `<div class="wrap">${body}</div>${dock ? `<div class="dock">${dock}</div>` : ""}`;
}
function scanBox(ph, id = "inscan") {
  return `<label class="sr" for="${id}">${ph}</label><div class="scan"><input id="${id}" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="${ph}">${X.cameraAvailable() ? `<button class="cam" data-act="camera" aria-label="Scan with camera">${X.CAM_ICON}</button>` : ""}</div>`;
}
function wire(id = "inscan") { const s = $("#" + id); if (!s) return; s.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const v = s.value.trim(); s.value = ""; if (v) scan(v); } }); s.focus({preventScroll: true}); }
const offline = () => { if (X.isOnline()) return false; const m = $("#inmsg"); if (m) m.innerHTML = msg("warn", "No network", "Receiving and putaway need the network. Connect and try again."); return true; };
const sub = () => `<div class="seg ppe" role="tablist" style="margin-bottom:10px"><button role="tab" aria-checked="${I.tab === "recv"}" data-in="tab" data-t="recv">Receive</button><button role="tab" aria-checked="${I.tab === "put"}" data-in="tab" data-t="put">Put away</button></div>`;

/* ---------- home ---------- */
async function home(note) {
  X.leaveSession(); stop(); X.M.mode = "inbound"; X.ls.set("cc-mode", "inbound"); I.view = "home"; I.asn = null; I.pallet = null;
  const gen = I.gen;
  if (I.tab === "put") return putHome(note);
  shell("Inbound", `${X.modeTabs("inbound")}${sub()}${scanBox("Scan the gate pass, or type the ASN or PO")}<div id="inmsg">${note || ""}</div><div id="inlist"><div class="loading">Loading ASNs…</div></div>`);
  wire();
  if (offline()) return;
  let rows = [];
  try { const r = await X.sb.from("asn_list").select("*").in("status", ["open", "receiving", "received"]).order("expected_date").limit(40); if (!r.error) rows = r.data; } catch {}
  if (gen !== I.gen) return;
  const box = $("#inlist"); if (!box) return;
  box.innerHTML = rows.length ? `<h3 class="qc-h">Expected and in progress <span class="muted small">${rows.length}</span></h3><div class="sess">${rows.map(asnCard).join("")}</div>` : `<div class="empty"><h3>No ASNs expected</h3><p>A supervisor uploads ASNs on the console, under Inbound.</p></div>`;
  I.list = rows;
}
const asnCard = a => { const got = N(a.received_qty) + N(a.damaged_qty), p = N(a.expected_qty) ? Math.min(100, got / N(a.expected_qty) * 100) : 0;
  return `<button data-in="asn" data-id="${esc(a.id)}"><span class="nm">${esc(a.asn_no)} <span class="xs ${a.status === "receiving" ? "info" : a.status === "received" ? "ok" : ""}">${STATUS[a.status]}</span></span>
    <span class="small muted">${esc([a.client_code, a.ext_ref, a.supplier].filter(Boolean).join(" · "))}</span><span class="small">${X.fmt(got)} of ${X.fmt(a.expected_qty)} units · ${X.fmt(a.lines)} lines${a.expected_date ? " · due " + fmtDate(a.expected_date) : ""}</span><span class="progress"><b style="width:${p}%"></b></span></button>`; };
async function findAsn(code) {
  if (offline()) return;
  const m = $("#inmsg"); if (m) m.innerHTML = `<div class="loading">Looking up ${esc(code)}…</div>`;
  let r; try { r = await X.sb.rpc("asn_find", {p_code: code}); } catch { r = {error: {message: "No network"}}; }
  if (r.error) { X.vibrate([200, 80, 200]); if (m) m.innerHTML = msg("bad", "Couldn't look this up", esc(r.error.message)); return; }
  const ids = (r.data || []).map(x => typeof x === "object" ? Object.values(x)[0] : x);
  if (!ids.length) { X.vibrate([200, 80, 200]); if (m) m.innerHTML = msg("bad", `No open ASN for ${esc(code.toUpperCase())}`, "Check the ASN or PO number. Closed ASNs can't be received on."); return; }
  if (ids.length === 1) return openAsn(ids[0]);
  const rows = (await X.sb.from("asn_list").select("*").in("id", ids)).data || [];
  if (m) m.innerHTML = msg("info", `${rows.length} ASNs for ${esc(code.toUpperCase())}`, "Choose one.");
  const box = $("#inlist"); if (box) box.innerHTML = `<div class="sess">${rows.map(asnCard).join("")}</div>`;
}

/* ---------- one ASN ---------- */
async function openAsn(id, note) {
  stop(); I.view = "asn"; const gen = I.gen;
  shell("Receive", `<div class="loading">Loading…</div>`, "", "home");
  let a, lines, cl, mine;
  try {
    const [ra, rl, rm] = await Promise.all([X.sb.from("asn_list").select("*").eq("id", id).single(), X.sb.from("asn_line_v").select("*").eq("asn_id", id).order("line_no"),
      X.sb.from("receipt_v").select("*").eq("asn_id", id).eq("user_id", X.M.me.id).eq("cancelled", false).order("created_at", {ascending: false}).limit(5)]);
    if (ra.error) throw ra.error; a = ra.data; lines = rl.data || []; mine = rm.data || [];
    const rc = await X.sb.from("clients").select("*").eq("id", a.client_id).single(); cl = rc.data;
  } catch { if (gen === I.gen) home(msg("bad", "Couldn't open the ASN", "Check the network and try again.")); return; }
  if (gen !== I.gen) return;
  Object.assign(I, {asn: a, lines, client: cl, mine});
  const loc = recvLoc(), got = N(a.received_qty) + N(a.damaged_qty), closed = ["closed", "cancelled"].includes(a.status);
  const head = `<div class="panel qc-head"><div class="qc-top"><div><div class="qc-no">${esc(a.asn_no)}</div><div class="small muted">${esc([a.client_code, a.ext_ref && "PO " + a.ext_ref, a.supplier].filter(Boolean).join(" · "))}</div></div><span class="xs ${a.status === "received" ? "ok" : "info"}">${STATUS[a.status]}</span></div>
    <div class="progress" style="margin-top:8px"><b style="width:${N(a.expected_qty) ? Math.min(100, got / N(a.expected_qty) * 100) : 0}%"></b></div><div class="small muted" style="margin-top:4px">${X.fmt(got)} of ${X.fmt(a.expected_qty)} units received · ${X.fmt(a.pallets)} pallets${N(a.damaged_qty) ? ` · ${X.fmt(a.damaged_qty)} damaged` : ""}</div></div>`;
  const locRow = `<div class="panel" style="display:flex;justify-content:space-between;align-items:center;gap:8px"><span><span class="small muted">Receiving into</span><br><strong>${loc ? esc(loc) : "Not set"}</strong></span><button class="btn sm" data-in="set-loc">${loc ? "Change" : "Scan location"}</button></div>`;
  const lineRow = l => { const g = N(l.received_qty) + N(l.damaged_qty), e = N(l.expected_qty);
    return `<button data-in="line" data-sku="${esc(l.sku)}"><span class="nm">${esc(l.sku)} <span class="xs ${l.not_on_asn ? "bad" : g >= e && g ? "ok" : g ? "info" : ""}">${l.not_on_asn ? "Not on ASN" : g > e ? "Extra" : g >= e ? "Done" : g ? "Part" : "To receive"}</span></span>
      <span class="small muted">${esc(l.description)}</span><span class="small"><strong>${X.fmt(g)}</strong> of ${X.fmt(e)} ${esc(l.base_uom || "")}${N(l.case_qty) > 1 ? ` (${X.fmt(N(l.case_qty))} per ${esc(l.case_uom || "case")})` : ""}${N(l.damaged_qty) ? ` · ${X.fmt(l.damaged_qty)} damaged` : ""}${l.batch ? ` · batch ${esc(l.batch)}` : ""}</span></button>`; };
  const recent = mine.length ? `<h3 class="qc-h">Your last pallets</h3><div class="sess">${mine.map(r => `<div class="card" style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:10px;background:var(--surface)"><span class="small"><strong>${esc(r.lpn)}</strong> · ${esc(r.sku)} · ${X.fmt(r.qty)}${r.condition === "damaged" ? " · damaged" : ""}</span><button class="btn sm ghost" data-in="undo" data-id="${esc(r.id)}">Undo</button></div>`).join("")}</div>` : "";
  shell("Receive", `${closed ? msg("warn", `ASN is ${STATUS[a.status].toLowerCase()}`, "Nothing more can be received on it.") : `${locRow}${scanBox(loc ? "Scan a product (barcode or SKU)" : "Scan the receiving location")}`}<div id="inmsg">${note || ""}</div>${head}
    <div class="sess">${lines.map(lineRow).join("")}</div>${recent}`,
    closed ? `<button class="btn primary save" data-in="home">Back</button>` : `<button class="btn primary save" data-in="finish" ${a.pallets ? "" : "disabled"}>Unloading finished</button><div class="row"><button class="btn ghost" data-in="home">Back</button></div>`, "home");
  wire();
}
async function setLocation(code) {
  const c = String(code).trim().toUpperCase(), m = $("#inmsg");
  const r = await X.sb.from("locations").select("code,kind,active").eq("code", c).limit(1);
  const l = r.data && r.data[0];
  if (!l) { X.vibrate([200, 80, 200]); if (m) m.innerHTML = msg("bad", `Location ${esc(c)} doesn't exist`, "Scan the label of the receiving area or dock."); return false; }
  if (!l.active) { if (m) m.innerHTML = msg("bad", `Location ${esc(c)} is turned off`, ""); return false; }
  X.ls.set("cc-recv-loc", l.code); X.vibrate(40);
  openAsn(I.asn.id, ["staging", "dock"].includes(l.kind) ? msg("ok", `Receiving into ${esc(l.code)}`, "Now scan the products.") : msg("warn", `Receiving into ${esc(l.code)}`, "This isn't a staging or dock location; pallets will go straight into it."));
  return true;
}

/* ---------- receive one product ---------- */
async function startItem(code) {
  const a = I.asn, c = String(code).trim().toUpperCase(), m = $("#inmsg");
  let it = null;
  try {
    let r = await X.sb.from("items").select("*").eq("client_id", a.client_id).eq("sku", c).limit(1); it = r.data && r.data[0];
    if (!it) { r = await X.sb.from("items").select("*").eq("client_id", a.client_id).eq("barcode", c).limit(1); it = r.data && r.data[0]; }
    if (!it) { r = await X.sb.from("items").select("*").eq("client_id", a.client_id).ilike("barcode", c).limit(1); it = r.data && r.data[0]; }
  } catch {}
  if (!it) { X.vibrate([200, 80, 200]); if (m) m.innerHTML = msg("bad", `${esc(c)} isn't a ${esc(a.client_code)} product`, "Check the label. If it's a new product, ask a supervisor to add it to the item master."); return; }
  const ln = I.lines.filter(l => l.item_id === it.id), exp = ln.reduce((s, l) => s + N(l.expected_qty), 0), got = ln.reduce((s, l) => s + N(l.received_qty) + N(l.damaged_qty), 0);
  I.item = it; I.form = {qty: "", cases: "", batch: (ln.find(l => l.batch) || {}).batch || "", mfg: "", exp: (ln.find(l => l.expiry_date) || {}).expiry_date || "", cond: "good", reason: "", lpn: "", confirm: false, expected: exp, got, onAsn: ln.length > 0};
  renderForm();
}
function renderForm(note) {
  stop(); I.view = "form";
  const it = I.item, f = I.form, c = I.client, cs = N(it.case_qty);
  const req = k => c[k] === "required" ? " (required)" : "";
  shell("Receive", `<div class="panel qc-head"><div class="qc-no" style="font-size:1.4rem">${esc(it.sku)}</div><div class="small muted">${esc(it.description)}</div>
      <div class="small" style="margin-top:4px">${f.onAsn ? `ASN: ${X.fmt(f.got)} of ${X.fmt(f.expected)} received so far` : `<span class="bad">Not on this ASN</span>`}${cs > 1 ? ` · ${X.fmt(cs)} ${esc(it.base_uom)} per ${esc(it.case_uom)}` : ""}</div></div>
    <div id="inmsg">${note || ""}</div>
    <div class="panel">
      <div class="grid2">${cs > 1 ? `<label class="field">${esc(it.case_uom || "Cases")}<input id="f_cases" type="number" inputmode="numeric" min="0" step="1" value="${esc(f.cases)}"></label>` : ""}
        <label class="field">${cs > 1 ? "Total " + esc(it.base_uom || "units") : "Quantity (" + esc(it.base_uom || "units") + ")"}<input id="f_qty" type="number" inputmode="decimal" min="0" step="any" value="${esc(f.qty)}"></label></div>
      ${c.track_batch !== "off" ? `<label class="field">${esc(c.batch_label || "Batch")}${req("track_batch")}<input id="f_batch" autocapitalize="characters" autocomplete="off" data-scan="1" value="${esc(f.batch)}"></label>` : ""}
      <div class="grid2">${c.track_mfg !== "off" ? `<label class="field">Mfg date${req("track_mfg")}<input id="f_mfg" type="date" value="${esc(f.mfg)}"></label>` : ""}
        ${c.track_expiry !== "off" ? `<label class="field">Expiry date${req("track_expiry")}<input id="f_exp" type="date" value="${esc(f.exp)}"></label>` : ""}</div>
      <div class="seg ppe" style="margin:6px 0 8px"><button data-in="cond" data-v="good" aria-pressed="${f.cond === "good"}">Good</button><button data-in="cond" data-v="damaged" aria-pressed="${f.cond === "damaged"}" class="no">Damaged</button></div>
      ${f.cond === "damaged" ? `<label class="field">Damage<select id="f_reason"><option value="">Choose…</option>${DAMAGE.map(d => `<option ${f.reason === d ? "selected" : ""}>${d}</option>`).join("")}</select></label><p class="hint" style="margin-top:0">Damaged goods are received on hold.</p>` : ""}
      <label class="field">Pallet label (LPN)<input id="f_lpn" autocapitalize="characters" autocomplete="off" data-scan="1" value="${esc(f.lpn)}" placeholder="Scan it, or leave empty to create one"></label>
    </div>`, `<button class="btn primary save" data-in="save">Receive</button><div class="row"><button class="btn ghost" data-in="back-asn">Cancel</button></div>`, "back-asn");
  const q = $("#f_qty"), k = $("#f_cases");
  if (k) k.oninput = () => { if (k.value !== "") q.value = Math.round(N(k.value) * cs * 1000) / 1000; };
  if (q) q.oninput = () => { if (k) k.value = ""; };
  (k || q).focus({preventScroll: true});
}
function grab() {
  const f = I.form, v = id => ($("#" + id) || {}).value;
  Object.assign(f, {qty: v("f_qty") ?? f.qty, cases: v("f_cases") ?? f.cases, batch: v("f_batch") ?? f.batch, mfg: v("f_mfg") ?? f.mfg, exp: v("f_exp") ?? f.exp, reason: v("f_reason") ?? f.reason, lpn: v("f_lpn") ?? f.lpn});
}
async function save(confirm) {
  grab(); const f = I.form, m = $("#inmsg"), c = I.client;
  const err = t => { X.vibrate([200, 80, 200]); m.innerHTML = msg("bad", "Not received", t); m.scrollIntoView({block: "center"}); };
  if (!(N(f.qty) > 0)) return err("Enter the quantity.");
  if (c.track_batch === "required" && !f.batch.trim()) return err(`Enter the ${esc((c.batch_label || "batch").toLowerCase())}.`);
  if (c.track_expiry === "required" && !f.exp) return err("Enter the expiry date.");
  if (c.track_mfg === "required" && !f.mfg) return err("Enter the manufacturing date.");
  if (f.cond === "damaged" && !f.reason) return err("Choose what the damage is.");
  if (offline()) return;
  if (I.busy) return; I.busy = true;
  if (!f.uuid) f.uuid = X.uuid();
  try {
    const r = await X.sb.rpc("asn_receive", {p: {asn_id: I.asn.id, code: I.item.sku, qty: N(f.qty), condition: f.cond, damage_reason: f.reason, batch: f.batch.trim(), mfg_date: f.mfg || null, expiry_date: f.exp || null,
      lpn: f.lpn.trim(), location: recvLoc(), confirm: !!confirm, device: X.DEVICE, client_uuid: f.uuid}});
    if (r.error) {
      const t = r.error.message || "";
      if (t.startsWith("CONFIRM:")) { X.vibrate([120, 60, 120]); m.innerHTML = `${msg("warn", "Check this", esc(t.slice(8)))}<div class="row" style="margin:-4px 0 10px"><button class="btn primary" data-in="save-confirm">Yes, receive it</button><button class="btn ghost" data-in="back-asn">No</button></div>`; m.scrollIntoView({block: "center"}); return; }
      if (/receiving location/i.test(t)) X.ls.set("cc-recv-loc", "");
      f.uuid = null; return err(esc(t.replace(/^NOTITEM:/, "")));
    }
    X.vibrate(60);
    const d = r.data, held = d.status === "hold";
    openAsn(I.asn.id, `${msg(held ? "warn" : "ok", `${X.fmt(f.qty)} ${esc(I.item.base_uom || "")} of ${esc(I.item.sku)} received`, `Pallet label <strong style="font-size:1.15em">${esc(d.lpn)}</strong>${f.lpn ? "" : ": write it on the pallet or print a label"}.${held ? ` On hold: ${esc(d.hold_reason)}.` : ""}`)}`);
  } catch { err("No network. Connect and try again."); }
  finally { I.busy = false; }
}

/* ---------- put away ---------- */
async function putHome(note) {
  I.view = "put-home"; const gen = I.gen;
  shell("Inbound", `${X.modeTabs("inbound")}${sub()}${scanBox("Scan the pallet label")}<div id="inmsg">${note || ""}</div><div id="inlist"><div class="loading">Loading pallets…</div></div>`);
  wire();
  if (offline()) return;
  let rows = [];
  try { const r = await X.sb.from("inventory_v").select("*").in("location_kind", ["staging", "dock"]).gt("qty", 0).order("received_at").limit(60); if (!r.error) rows = r.data; } catch {}
  if (gen !== I.gen) return;
  I.putRows = rows;
  const box = $("#inlist"); if (!box) return;
  box.innerHTML = rows.length ? `<h3 class="qc-h">Waiting in receiving and docks <span class="muted small">${rows.length}</span></h3><div class="sess">${rows.map((v, i) => `<button data-in="pallet" data-i="${i}"><span class="nm">${esc(v.lpn || "No label")} <span class="xs ${v.status === "hold" ? "bad" : "ok"}">${v.status === "hold" ? "On hold" : esc(v.location)}</span></span>
      <span class="small muted">${esc(v.client_code)} · ${esc(v.sku)} · ${esc(v.description)}</span><span class="small"><strong>${X.fmt(v.qty)} ${esc(v.base_uom || "")}</strong>${v.batch ? " · " + esc(v.batch) : ""}${v.expiry_date ? " · exp " + fmtDate(v.expiry_date) : ""}${v.status === "hold" && v.hold_reason ? " · " + esc(v.hold_reason) : ""}</span></button>`).join("")}</div>`
    : `<div class="empty"><h3>Nothing to put away</h3><p>Received pallets in staging and dock locations appear here.</p></div>`;
}
async function openPallet(v) {
  stop(); I.view = "put"; I.pallet = v; I.sugg = []; const gen = I.gen;
  const free = N(v.qty) - N(v.allocated_qty) - N(v.picked_qty);
  const render = () => shell("Put away", `<div class="panel qc-head"><div class="small muted">Pallet</div><div class="qc-no">${esc(v.lpn || "No label")}</div><div class="small muted">${esc(v.client_code)} · ${esc(v.sku)} · ${esc(v.description)}</div>
      <div class="small" style="margin-top:4px"><strong>${X.fmt(v.qty)} ${esc(v.base_uom || "")}</strong> in ${esc(v.location)}${v.batch ? " · " + esc(v.batch) : ""}${v.expiry_date ? " · exp " + fmtDate(v.expiry_date) : ""}</div>
      ${v.status === "hold" ? `<div class="small bad" style="margin-top:4px">On hold: ${esc(v.hold_reason || "")}. Put it in a hold location (damage / quarantine) or wait for a supervisor.</div>` : ""}</div>
    <div id="inmsg"></div>
    <div class="panel"><h3 style="margin-bottom:6px">Suggested locations</h3>${I.sugg.length ? `<div class="dockpick">${I.sugg.map(s => `<button class="chip" data-in="sugg" data-code="${esc(s.code)}"><strong>${esc(s.code)}</strong> <span class="small muted">${esc(s.why)}</span></button>`).join("")}</div>` : `<p class="hint" style="margin:0">${I.sugg.loaded ? "No empty location found. Scan any location." : "Looking…"}</p>`}
      <p class="hint" style="margin:8px 0 0">Go to the location and scan its label to confirm. You can scan a different location.</p></div>
    ${free < N(v.qty) ? msg("warn", "Part of this pallet is allocated", `Only ${X.fmt(free)} can be moved.`) : ""}
    ${scanBox("Scan the location you put it in", "putto")}`, `<button class="btn ghost save" data-in="put-home">Back</button>`, "put-home");
  render(); wire("putto");
  try { const r = await X.sb.rpc("putaway_suggest", {p_inv: v.id}); if (gen !== I.gen) return; I.sugg = r.data || []; } catch { I.sugg = []; }
  I.sugg.loaded = true; if (gen !== I.gen || I.view !== "put") return;
  render(); wire("putto");
}
async function putTo(code) {
  const v = I.pallet, to = String(code).trim().toUpperCase(), m = $("#inmsg");
  const free = N(v.qty) - N(v.allocated_qty) - N(v.picked_qty);
  if (free <= 0) { if (m) m.innerHTML = msg("bad", "Can't be moved", "All of it is allocated or picked."); return; }
  if (offline() || I.busy) return; I.busy = true;
  try {
    const r = await X.sb.rpc("stock_move", {p_inv: v.id, p_to: to, p_qty: free === N(v.qty) ? null : free, p_device: X.DEVICE, p_client_id: X.uuid()});
    if (r.error) { X.vibrate([200, 80, 200]); if (m) m.innerHTML = msg("bad", "Not put away", esc(r.error.message)); return; }
    X.vibrate(60);
    const sug = I.sugg.some(s => s.code === to);
    home(msg(r.data.status === "hold" ? "warn" : "ok", `${esc(v.lpn || v.sku)} put away in ${esc(to)}`, `${esc(v.sku)} · ${X.fmt(free)} ${esc(v.base_uom || "")}${sug ? "" : " (not a suggested location)"}${r.data.status === "hold" ? ". It is on hold." : ""}`));
  } catch { if (m) m.innerHTML = msg("bad", "No network", "Connect and try again."); }
  finally { I.busy = false; }
}
async function lookupPallet(code) {
  const m = $("#inmsg"); if (offline()) return;
  let r; try { r = await X.sb.rpc("stock_lookup", {p_code: code}); } catch { r = {error: {message: "No network"}}; }
  if (r.error) { if (m) m.innerHTML = msg("bad", "Couldn't look this up", esc(r.error.message)); return; }
  if (r.data.kind !== "lpn" || !r.data.rows.length) { X.vibrate([200, 80, 200]); if (m) m.innerHTML = msg("bad", `${esc(String(code).toUpperCase())} isn't a pallet label`, "Scan the LPN label on the pallet, or tap a pallet below."); return; }
  openPallet(r.data.rows[0]);
}

/* ---------- scans and taps ---------- */
function scan(raw) {
  const v = String(raw).trim(); if (!v || !X) return;
  const fe = document.activeElement;
  if (I.view === "form") { if (fe && fe.dataset && fe.dataset.scan) { fe.value = v.toUpperCase(); fe.dispatchEvent(new Event("input")); } else { const l = $("#f_lpn"); if (l && !l.value) l.value = v.toUpperCase(); } return; }
  if (I.view === "home") return findAsn(v);
  if (I.view === "asn") { if (!recvLoc() || I.settingLoc) { I.settingLoc = false; return setLocation(v); } return startItem(v); }
  if (I.view === "put-home") return lookupPallet(v);
  if (I.view === "put") return putTo(v);
}
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-in]"); if (!b || !X) return;
  switch (b.dataset.in) {
    case "tab": I.tab = b.dataset.t; home(); break;
    case "home": I.tab = "recv"; home(); break;
    case "put-home": I.tab = "put"; home(); break;
    case "asn": openAsn(b.dataset.id); break;
    case "back-asn": openAsn(I.asn.id); break;
    case "set-loc": { I.settingLoc = true; const s = $("#inscan"); if (s) { s.placeholder = "Scan the receiving location"; s.focus(); } const m = $("#inmsg"); if (m) m.innerHTML = msg("info", "Scan the receiving location", "The label of the receiving area or the dock you're unloading at."); break; }
    case "line": if (!recvLoc()) { const m = $("#inmsg"); if (m) m.innerHTML = msg("warn", "Scan the receiving location first", ""); break; } startItem(b.dataset.sku); break;
    case "cond": grab(); I.form.cond = b.dataset.v; renderForm(); break;
    case "save": save(false); break;
    case "save-confirm": save(true); break;
    case "undo": {
      if (!X.confirmTwice || X.confirmTwice(b, "undo" + b.dataset.id, "Tap again to undo")) {
        const r = await X.sb.rpc("asn_undo_receipt", {p_receipt: isNaN(b.dataset.id) ? b.dataset.id : +b.dataset.id, p_note: "Undone on the phone"});
        openAsn(I.asn.id, r.error ? msg("bad", "Couldn't undo", esc(r.error.message)) : msg("ok", "Receipt undone", "The pallet was removed from stock."));
      }
      break;
    }
    case "finish": {
      if (X.confirmTwice && !X.confirmTwice(b, "fin", "Tap again: all unloaded?")) break;
      const r = await X.sb.rpc("asn_set_status", {p_asn: I.asn.id, p_status: "received", p_note: ""});
      if (r.error) { const m = $("#inmsg"); if (m) m.innerHTML = msg("bad", "Not done", esc(r.error.message)); break; }
      home(msg("ok", `${esc(I.asn.asn_no)} received`, "A supervisor checks the differences and closes it. Now put the pallets away."));
      break;
    }
    case "pallet": openPallet(I.putRows[+b.dataset.i]); break;
    case "sugg": { const t = $("#putto"); if (t) { t.value = b.dataset.code; t.focus(); } const m = $("#inmsg"); if (m) m.innerHTML = msg("info", `Go to ${esc(b.dataset.code)}`, "Scan its label to confirm (or press Enter if you're there)."); break; }
  }
});

window.CCInboundM = {init, home, scan, stop, view: () => I.view};
window.__inDemo = () => I;
})();
