/* Stowra mobile: stock.
   Scan a location, a pallet (LPN), a SKU or a barcode to see the stock there; tap a line to move it to another location.
   Moves need the network: the database checks the quantity and the target location. */
(() => {
"use strict";
let X = null;
const K = {view: "home", code: "", res: null, line: null, note: "", busy: false, gen: 0};
const $ = (s, r = document) => r.querySelector(s);
const esc = s => X.esc(s);
const N = v => Number(v) || 0;
const KIND = {lpn: "Pallet", location: "Location", item: "Item"};
const LK = {staging: "Staging", outbound: "Outbound", dock: "Dock", damage: "Damage", short: "Short", quarantine: "Quarantine", pick: "Pick face"};
const fmtDate = s => s ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"}) : "–";

function init(ctx) { X = ctx; }
function stop() { K.gen++; }
function shell(title, body, dock, back) {
  $("#root").innerHTML = X.topbar(title, back ? `<button data-sk="${back}">Back</button>` : "", back ? "" : `<button data-act="signout">Sign out</button>`) +
    `<div class="wrap">${body}</div>${dock ? `<div class="dock">${dock}</div>` : ""}`;
}
const msg = (kind, title, body) => `<div class="alert ${kind}" role="${kind === "bad" ? "alert" : "status"}"><strong>${title}</strong>${body ? `<span>${body}</span>` : ""}</div>`;
const free = l => Math.max(N(l.qty) - N(l.allocated_qty) - N(l.picked_qty), 0);
const cases = l => N(l.case_qty) > 1 && N(l.qty) ? ` · ${X.fmt(Math.round(N(l.qty) / N(l.case_qty) * 100) / 100)} ${esc(l.case_uom || "cases")}` : "";

/* ---------- home: scan anything ---------- */
function home(note) {
  X.leaveSession(); stop(); K.view = "home"; K.line = null; X.M.mode = "stock"; X.ls.set("cc-mode", "stock");
  if (K.res && !note) return showResult();
  const body = `${X.modeTabs("stock")}${scanBox("Scan a location, pallet, SKU or barcode")}<div id="skmsg">${note || ""}</div>
    <div class="empty" style="margin-top:18px"><h3>Find stock</h3><p>Scan a location to see what's in it, a pallet label (LPN) to see where it is, or a product to see all its pallets, first to expire first. Tap a line to move it.</p></div>`;
  shell("Stock", body);
  wireScan();
}
function scanBox(ph) {
  return `<label class="sr" for="skscan">${ph}</label><div class="scan"><input id="skscan" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="${ph}">${X.cameraAvailable() ? `<button class="cam" data-act="camera" aria-label="Scan with camera">${X.CAM_ICON}</button>` : ""}</div>`;
}
function wireScan() {
  const s = $("#skscan"); if (!s) return;
  s.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const v = s.value.trim(); s.value = ""; if (v) scan(v); } });
  s.focus({preventScroll: true});
}
async function scan(raw) {
  const v = String(raw).trim(); if (!v) return;
  if (K.view === "move") { const t = $("#skto"); if (t) { t.value = v.toUpperCase(); return doMove(); } }
  if (!X.isOnline()) { const m = $("#skmsg"); if (m) m.innerHTML = msg("warn", "No network", "Looking up stock needs the network. Connect and try again."); return; }
  const gen = ++K.gen; K.code = v;
  const m = $("#skmsg"); if (m) m.innerHTML = `<div class="loading">Looking up ${esc(v)}…</div>`;
  let r;
  try { r = await X.sb.rpc("stock_lookup", {p_code: v}); } catch { r = {error: {message: "No network"}}; }
  if (gen !== K.gen || X.M.mode !== "stock") return;
  if (r.error) { X.vibrate([200, 80, 200]); const mm = $("#skmsg"); if (mm) mm.innerHTML = msg("bad", "Couldn't look this up", esc(r.error.message)); return; }
  if (r.data.kind === "none") { X.vibrate([200, 80, 200]); K.res = null; const mm = $("#skmsg"); if (mm) mm.innerHTML = msg("bad", `${esc(v.toUpperCase())} not found`, "It isn't a location, pallet (LPN), SKU or barcode in Stowra."); return; }
  X.vibrate(40); K.res = r.data; K.view = "home"; showResult();
}
function showResult(note) {
  const r = K.res, rows = r.rows || [];
  const qty = rows.reduce((a, l) => a + N(l.qty), 0), avail = rows.reduce((a, l) => a + N(l.available_qty), 0);
  const loc = r.location;
  const head = `<div class="panel qc-head"><div class="qc-top"><div><div class="small muted">${KIND[r.kind]}</div><div class="qc-no">${esc(r.label)}</div>
      <div class="small muted">${r.kind === "item" && rows[0] ? esc(rows[0].description) + " · " : ""}${loc ? `${esc(LK[loc.kind] || "Storage")}${loc.zone ? " · " + esc(loc.zone) : ""} · ` : ""}${rows.length} line${rows.length === 1 ? "" : "s"}, ${X.fmt(qty)} units, ${X.fmt(avail)} available</div></div>
      ${loc && loc.hold ? `<span class="xs bad">Hold location</span>` : ""}</div></div>`;
  const card = (l, i) => {
    const exp = l.expiry_date ? `<span class="${l.expiry_state === "expired" ? "bad" : l.expiry_state === "near" ? "warnc" : ""}">Exp ${fmtDate(l.expiry_date)}${l.expiry_state === "expired" ? " (expired)" : ""}</span>` : "";
    const hold = l.status === "hold" || l.location_hold;
    return `<button data-sk="line" data-i="${i}"><span class="nm">${r.kind === "location" ? esc(l.sku) : esc(l.location)} <span class="xs ${hold ? "bad" : N(l.available_qty) > 0 ? "ok" : "info"}">${hold ? "On hold" : N(l.available_qty) > 0 ? "Available" : l.expiry_state === "expired" ? "Expired" : "Allocated"}</span></span>
      <span class="small muted">${r.kind === "location" ? esc(l.description) : r.kind === "lpn" ? esc(l.sku + " · " + l.description) : esc(l.client_code)}</span>
      <span class="small">${[l.lpn && r.kind !== "lpn" ? "LPN " + esc(l.lpn) : "", l.batch ? esc(l.batch_label || "Batch") + " " + esc(l.batch) : "", exp].filter(Boolean).join(" · ")}</span>
      <span class="small"><strong>${X.fmt(l.qty)} ${esc(l.base_uom || "")}</strong>${cases(l)}${N(l.allocated_qty) + N(l.picked_qty) ? ` · ${X.fmt(N(l.allocated_qty) + N(l.picked_qty))} allocated/picked` : ""}${hold && l.hold_reason ? ` · ${esc(l.hold_reason)}` : ""}</span></button>`;
  };
  shell("Stock", `${X.modeTabs("stock")}${scanBox("Scan another location, pallet or product")}<div id="skmsg">${note || ""}</div>${head}
    ${rows.length ? `<div class="sess">${rows.map(card).join("")}</div>` : `<p class="muted small">${r.kind === "location" ? "This location is empty." : "No stock."}</p>`}`);
  wireScan();
}

/* ---------- move a line ---------- */
function openLine(i) {
  const l = (K.res.rows || [])[i]; if (!l) return;
  stop(); K.view = "move"; K.line = l;
  const f = free(l), hold = l.status === "hold" || l.location_hold;
  const info = `<div class="panel qc-head"><div class="qc-no" style="font-size:1.4rem">${esc(l.sku)}</div><div class="small muted">${esc(l.client_code)} · ${esc(l.description)}</div>
    <dl class="gdl"><div><dt>Location</dt><dd>${esc(l.location)}</dd></div><div><dt>LPN</dt><dd>${esc(l.lpn || "–")}</dd></div>
      <div><dt>${esc(l.batch_label || "Batch")}</dt><dd>${esc(l.batch || "–")}</dd></div><div><dt>Expiry</dt><dd>${fmtDate(l.expiry_date)}</dd></div>
      <div><dt>Quantity</dt><dd>${X.fmt(l.qty)} ${esc(l.base_uom || "")}${cases(l)}</dd></div><div><dt>Status</dt><dd>${hold ? "On hold" + (l.hold_reason ? ": " + esc(l.hold_reason) : "") : "Available"}</dd></div></dl></div>`;
  if (f <= 0) {
    shell("Move stock", `${info}${msg("warn", "Can't be moved", "All of it is allocated or picked for orders.")}`, `<button class="btn primary save" data-sk="back">Back</button>`, "back");
    return;
  }
  shell("Move stock", `${info}<div id="skmsg"></div><div class="panel"><h3 style="margin-bottom:6px">Move to</h3>
      <label class="field">Quantity to move (${X.fmt(f)} can be moved)<input id="skqty" type="number" inputmode="decimal" step="any" min="0" max="${f}" value="${f}"></label>
      <label class="field">New location: scan its label<input id="skto" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" data-scan="1" placeholder="Scan or type the location"></label>
      <p class="hint" style="margin:0">Moving into a damage, short or quarantine location puts the stock on hold.</p></div>`,
    `<button class="btn primary save" data-sk="do-move">Move</button><div class="row"><button class="btn ghost" data-sk="back">Cancel</button></div>`, "back");
  const t = $("#skto"); t.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doMove(); } }); t.focus({preventScroll: true});
}
async function doMove() {
  const l = K.line, to = ($("#skto").value || "").trim().toUpperCase(), q = N($("#skqty").value), m = $("#skmsg");
  const err = t => { X.vibrate([200, 80, 200]); m.innerHTML = msg("bad", "Not moved", t); };
  if (!to) return err("Scan the new location.");
  if (!(q > 0) || q > free(l)) return err(`Enter a quantity from 1 to ${X.fmt(free(l))}.`);
  if (!X.isOnline()) return err("No network. Moves need the network; connect and try again.");
  if (K.busy) return; K.busy = true;
  try {
    const r = await X.sb.rpc("stock_move", {p_inv: l.id, p_to: to, p_qty: q === N(l.qty) ? null : q, p_device: X.DEVICE, p_client_id: X.uuid()});
    if (r.error) return err(esc(r.error.message));
    X.vibrate(60);
    const done = msg("ok", `${X.fmt(q)} ${esc(l.base_uom || "")} moved to ${esc(to)}`, `${esc(l.sku)} from ${esc(l.location)}${r.data && r.data.status === "hold" ? ". It is now on hold." : ""}`);
    K.view = "home"; await scan(K.code); if (K.res) showResult(done); else home(done);
  } catch { err("No network. Connect and try again."); }
  finally { K.busy = false; }
}

/* ---------- taps ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-sk]"); if (!b || !X) return;
  switch (b.dataset.sk) {
    case "line": openLine(+b.dataset.i); break;
    case "back": K.view = "home"; if (K.res) showResult(); else home(); break;
    case "do-move": doMove(); break;
  }
});

window.CCStockM = {init, home, scan, stop, view: () => K.view};
})();
