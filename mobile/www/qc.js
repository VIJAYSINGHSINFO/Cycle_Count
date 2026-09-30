/* Order QC on the phone: scan the order number, scan every unit, finish.
   Loaded before app.js; app.js calls CCQC.init() with its helpers.
   Rules: more than the order quantity is never counted (the unit is set aside), products not in the order are
   refused, and an order with missing units can only pass once they are scanned or a supervisor releases it. */
(() => {
"use strict";
let X = null;
const Q = {view: "home", orders: null, order: null, lines: [], byKey: new Map(), byCode: new Map(), tote: "", toteAsk: false,
  choose: null, block: null, msg: null, lineKey: null, result: null, busy: false, lost: null, timers: []};
const $ = (s, r = document) => r.querySelector(s);
const up = s => String(s ?? "").trim().toUpperCase();
const K = id => String(id);
const N = v => Number(v) || 0;
let seqN = 0;
const nextSeq = () => Date.now() * 1000 + (seqN++ % 1000);
const esc = s => X.esc(s), fmt = n => X.fmt(n);
const CLOSED = {passed: ["ok", "has already passed QC", "A passed order can't be checked again. If something is wrong with it, tell your supervisor."],
  released: ["warn", "was released short by a supervisor", "It can't be checked again."], cancelled: ["warn", "was cancelled", "Ask your supervisor if it should be uploaded again."]};

function init(ctx) { X = ctx; }
const me = () => X.M.me.id;
const pendingFor = id => X.M.outbox.filter(o => o.kind === "qc" && o.order_id === id && !o.failed).length;
const failedFor = id => X.M.outbox.filter(o => o.kind === "qc" && o.order_id === id && o.failed);
function stopTimers() { Q.timers.forEach(clearInterval); Q.timers = []; }

/* ---------- sounds ---------- */
let actx;
function tone(freq, ms, vol = .08) { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = freq; g.gain.value = vol; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + ms / 1000); } catch {} }
const goodSound = () => { tone(1320, 70, .05); X.vibrate(25); };
const badSound = () => { tone(220, 380, .1); setTimeout(() => tone(180, 380, .1), 420); X.vibrate([220, 90, 220, 90, 220]); };

/* ---------- order list ---------- */
async function home(note) {
  stopTimers(); X.leaveSession(); X.M.mode = "qc"; X.ls.set("cc-mode", "qc"); closeBlock(true);
  Object.assign(Q, {view: "home", order: null, lines: [], byKey: new Map(), byCode: new Map(), msg: note || null, choose: null, result: null, lost: null, lineKey: null, toteAsk: false});
  $("#root").innerHTML = X.topbar("Order QC", "", `<button data-act="signout">Sign out</button>`) + `<div class="wrap">${X.modeTabs("qc")}
    <p class="small muted" style="margin:0 0 8px">Signed in as ${esc(X.M.me.full_name)}</p>
    <label class="sr" for="qcscan">Order number</label>${scanBox("Scan or type the order number", false)}
    <div id="qcmsg"></div><div id="qclist"><div class="loading">Loading orders…</div></div></div>`;
  bindScan(); renderMsg();
  let rows = null;
  try { const r = await X.sb.rpc("qc_mobile_orders", {p_search: null}); if (r.error) throw r.error; rows = r.data; X.idb.set("qc-orders", rows).catch(() => {}); }
  catch { rows = await X.idb.get("qc-orders").catch(() => null); if (rows) X.toast("Offline: showing saved orders"); }
  if (Q.view !== "home") return;
  Q.orders = rows || [];
  renderHomeList();
}
function orderButton(o, disabled) {
  const p = N(o.units_expected) ? Math.round(N(o.units_scanned) / N(o.units_expected) * 100) : 0;
  const tags = [o.status === "short" ? `<span class="xs bad">Waiting for pick</span>` : "", o.status === "in_progress" && !o.assigned_to ? `<span class="xs">Paused</span>` : "",
    o.tote_mode === "required" ? `<span class="xs info">Tote required</span>` : "", o.allow_qty ? `<span class="xs info">Quantity entry</span>` : ""].join("");
  return `<button data-qc="open" data-id="${esc(o.id)}" ${disabled ? "disabled" : ""}><span class="nm">${esc(o.order_no)}</span>
    <span class="small muted">${esc([o.customer, o.reference, o.storer].filter(Boolean).join(" · ") || "No customer")}</span>
    <span class="small">${fmt(o.units_scanned)} of ${fmt(o.units_expected)} units, ${fmt(o.lines_total)} line${N(o.lines_total) === 1 ? "" : "s"}${disabled ? `, being checked by ${esc(o.assigned_name || "someone else")}` : ""}</span>
    <span class="progress"><b style="width:${p}%"></b></span>${tags ? `<span class="row" style="gap:6px">${tags}</span>` : ""}</button>`;
}
function renderHomeList() {
  const box = $("#qclist"); if (!box) return;
  const rows = Q.orders || [];
  const mine = rows.filter(o => o.status === "in_progress" && o.assigned_to === me());
  const ready = rows.filter(o => o.status === "pending" || (o.status === "in_progress" && !o.assigned_to));
  const pick = rows.filter(o => o.status === "short" && (!o.assigned_to || o.assigned_to === me()));
  const others = rows.filter(o => o.assigned_to && o.assigned_to !== me());
  if (!rows.length) { box.innerHTML = `<div class="empty"><h3>No orders to check</h3><p>Your supervisor uploads orders from the desktop console. You can also scan an order number above.</p><button class="btn" data-qc="reload">Refresh</button></div>`; return; }
  const sec = (t, list, dis) => list.length ? `<h3 class="qc-h">${t} <span class="muted small">${list.length}</span></h3><div class="sess">${list.map(o => orderButton(o, dis)).join("")}</div>` : "";
  box.innerHTML = sec("Continue", mine) + sec("Ready for QC", ready) + sec("Waiting for pick", pick) + sec("Being checked by others", others, true) +
    `<p style="margin-top:14px"><button class="btn ghost" data-qc="reload">Refresh</button></p>`;
}
async function findOrder(raw) {
  const code = String(raw).trim(); if (!code) return;
  let rows = null;
  if (X.isOnline()) { try { const r = await X.sb.rpc("qc_mobile_orders", {p_search: code}); if (r.error) throw r.error; rows = r.data; } catch { rows = null; } }
  if (rows == null) rows = (Q.orders || []).filter(o => up(o.order_no) === up(code) || (o.reference && up(o.reference) === up(code)));
  if (!rows.length) { badSound(); return setMsg("bad", `Order ${esc(code)} not found`, "Check the number on the pick list. If it's right, the order hasn't been uploaded yet: ask your supervisor."); }
  const open = rows.filter(o => ["pending", "in_progress", "short"].includes(o.status));
  if (!open.length) { const o = rows[0], c = CLOSED[o.status] || ["warn", "is closed", ""]; if (c[0] !== "ok") badSound(); return setMsg(c[0], `Order ${esc(o.order_no)} ${c[1]}`, c[2]); }
  if (open.length > 1) return setMsg("info", "More than one order has this number", "Choose the right one.", open.map(o => `<button class="btn sm" data-qc="open" data-id="${esc(o.id)}">${esc(o.order_no)} · ${esc(o.storer || o.customer || o.reference)}</button>`).join(""));
  openOrder(open[0].id);
}
async function openOrder(id) {
  if (Q.busy) return; Q.busy = true; Q.msg = null; renderMsg();
  const box = $("#qclist"); if (box) box.innerHTML = `<div class="loading">Opening order…</div>`;
  try {
    if (!X.isOnline()) throw Object.assign(new Error("offline"), {offline: true});
    await X.flushNow();
    const r = await X.sb.rpc("qc_start", {p_order: id, p_device: X.DEVICE});
    if (r.error) { if (X.isServerError(r.error)) { badSound(); setMsg("bad", "Can't open this order", esc(r.error.message)); renderHomeList(); return; } throw r.error; }
    const l = await X.sb.rpc("qc_mobile_lines", {p_order: id}); if (l.error) throw l.error;
    const cached = await X.idb.get("qc:" + id).catch(() => null);
    enter(r.data, l.data, cached && cached.tote || "", false);
  } catch (e) {
    const c = await X.idb.get("qc:" + id).catch(() => null);
    if (c && c.order && c.order.assigned_to === me() && c.order.status === "in_progress") { enter(c.order, c.lines, c.tote || "", true); X.toast("Offline: using this order as saved on the phone"); }
    else { setMsg("bad", "Connect to the network to start this order", "Orders are opened online so that two people can't check the same order."); renderHomeList(); }
  } finally { Q.busy = false; }
}

/* ---------- one order ---------- */
function index() {
  Q.byKey = new Map(); Q.byCode = new Map();
  const add = (c, k) => { if (!c) return; const u = up(c); if (!Q.byCode.has(u)) Q.byCode.set(u, []); const a = Q.byCode.get(u); if (!a.includes(k)) a.push(k); };
  Q.lines.forEach(l => { l.expected_qty = N(l.expected_qty); l.scanned_qty = N(l.scanned_qty); l.over_qty = N(l.over_qty); Q.byKey.set(K(l.id), l); add(l.sku, K(l.id)); add(l.barcode, K(l.id)); });
}
function enter(order, lines, tote, fromCache) {
  Q.order = {...order}; Q.lines = (lines || []).map(l => ({...l})); Q.tote = tote || ""; index();
  if (!fromCache) X.M.outbox.filter(o => o.kind === "qc" && o.order_id === Q.order.id && !o.failed).sort((a, b) => a.seq - b.seq).forEach(o => applyLocal(o.entry));
  Object.assign(Q, {view: Q.order.tote_mode === "required" && !Q.tote ? "tote" : "scan", toteAsk: false, choose: null, lost: null, lineKey: null,
    msg: {kind: "info", title: `Order ${esc(Q.order.order_no)}`, body: Q.order.status === "short" || Q.lines.some(l => l.scanned_qty) ? "Scans saved so far are shown below. Scan the rest." : "Scan every unit in the order."}});
  saveCache(); render(); goodSound();
  stopTimers(); Q.timers.push(setInterval(checkStillMine, 20000));
}
let cacheT;
function saveCache() { clearTimeout(cacheT); if (!Q.order) return; const id = Q.order.id, data = {order: Q.order, lines: Q.lines, tote: Q.tote}; cacheT = setTimeout(() => X.idb.set("qc:" + id, JSON.parse(JSON.stringify(data))).catch(() => {}), 300); }
function applyLocal(en) {
  const l = Q.byKey.get(K(en.line_id)); if (!l) return;
  const q = N(en.qty);
  if (en.kind === "scan") { const fit = Math.max(0, Math.min(q, l.expected_qty - l.scanned_qty)); l.scanned_qty += fit; if (fit < q) l.over_qty += q - fit; }
  else if (en.kind === "over") l.over_qty += q;
  else if (en.kind === "undo") l.scanned_qty -= Math.min(q, l.scanned_qty);
}
function push(en) {
  const entry = {client_ts: new Date().toISOString(), tote: Q.tote || null, ...en};
  applyLocal(entry);
  X.queue([{client_id: X.uuid(), kind: "qc", order_id: Q.order.id, seq: nextSeq(), entry, tries: 0}]);
  saveCache();
}
async function checkStillMine() {
  if (!Q.order || !X.isOnline() || Q.lost) return;
  try {
    const r = await X.sb.rpc("qc_mobile_orders", {p_search: Q.order.order_no}); if (r.error) return;
    const o = (r.data || []).find(x => x.id === Q.order.id); if (!o) return;
    if (o.status !== "in_progress" || o.assigned_to !== me()) {
      Q.lost = o.status === "in_progress" ? "A supervisor unlocked this order, so it's no longer assigned to you." : o.status === "pending" ? "A supervisor reset this order." : `This order is now ${o.status === "passed" ? "passed" : o.status === "short" ? "waiting for pick" : o.status}.`;
      badSound(); render();
    }
  } catch {}
}

const totals = () => Q.lines.reduce((a, l) => (a.exp += l.expected_qty, a.scan += l.scanned_qty, a.over += l.over_qty, a.done += l.scanned_qty >= l.expected_qty ? 1 : 0, a), {exp: 0, scan: 0, over: 0, done: 0});
function scanBox(ph, withQty) {
  return `<div class="scan"><input id="qcscan" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go" placeholder="${esc(ph)}">
    ${withQty ? `<label class="qc-qty">Qty<input id="qcqty" type="number" inputmode="numeric" min="1" step="1" value="1" aria-label="Quantity for the next scan"></label>` : ""}
    ${X.cameraAvailable() ? `<button class="cam" data-act="camera" aria-label="Scan with camera">${X.CAM_ICON}</button>` : ""}</div>`;
}
function bindScan() {
  const s = $("#qcscan"); if (!s) return;
  s.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const v = s.value.trim(); s.value = ""; if (v) scan(v); } });
  const qi = $("#qcqty"); if (qi) qi.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); s.focus(); } });
  focusScan();
}
function focusScan() { if (Q.block) return; const s = $("#qcscan"); if (s && document.activeElement !== $("#qcqty")) s.focus({preventScroll: true}); }
function setMsg(kind, title, body, actions) { Q.msg = {kind, title, body, actions}; renderMsg(); }
function renderMsg() {
  const m = $("#qcmsg"); if (!m) return;
  m.innerHTML = Q.msg ? `<div class="alert ${Q.msg.kind}" role="${Q.msg.kind === "bad" ? "alert" : "status"}"><strong>${Q.msg.title}</strong>${Q.msg.body ? `<span>${Q.msg.body}</span>` : ""}${Q.msg.actions ? `<div class="row">${Q.msg.actions}</div>` : ""}</div>` : "";
}

function render() {
  if (!Q.order) return home();
  const o = Q.order, t = totals(), pct = t.exp ? t.scan / t.exp * 100 : 0;
  const failed = failedFor(o.id);
  const head = `<div class="panel qc-head">
      <div class="qc-top"><div><div class="qc-no">${esc(o.order_no)}</div><div class="small muted">${esc([o.customer, o.reference, o.storer].filter(Boolean).join(" · "))}</div></div>
        <div class="qc-count"><b>${fmt(t.scan)}</b><span>of ${fmt(t.exp)} units</span></div></div>
      <div class="progress" style="height:8px;margin-top:10px"><b style="width:${pct}%"></b></div>
      <div class="row small" style="margin-top:8px;justify-content:space-between"><span>${fmt(t.done)} of ${fmt(Q.lines.length)} lines complete</span>
        ${o.tote_mode !== "off" ? `<span class="tote">${Q.tote ? `Tote <strong>${esc(Q.tote)}</strong>` : o.tote_mode === "required" ? "No tote yet" : "No tote"} <button class="btn sm" data-qc="tote">${Q.tote ? "Change" : "Scan tote"}</button></span>` : ""}</div>
      ${t.over ? `<p class="qc-aside">${fmt(t.over)} unit${t.over === 1 ? "" : "s"} set aside (more than the order). Return ${t.over === 1 ? "it" : "them"} to stock.</p>` : ""}</div>`;
  const lostBanner = Q.lost ? `<div class="banner bad" style="flex-direction:column;align-items:stretch"><strong>${esc(Q.lost)}</strong><span class="small">Scans made on this phone since then can't be saved. Go back to the order list.</span><button class="btn" data-qc="home">Back to orders</button></div>` : "";
  const failBanner = failed.length ? `<div class="banner bad" style="flex-direction:column;align-items:stretch"><strong>${failed.length} scan${failed.length === 1 ? " was" : "s were"} rejected by the server</strong><span class="small">${esc(failed[0].error || "")}</span><div class="row"><button class="btn sm" data-act="retry-failed">Try again</button><button class="btn sm danger" data-act="discard-failed">Discard</button></div></div>` : "";
  let body = "", dock = "";
  const title = "Order QC";
  if (Q.view === "tote" || Q.toteAsk) {
    body = `${head}<div id="qcmsg"></div><div class="panel"><div class="instruct" style="margin-top:0"><span class="stepn">1</span><div><strong>Scan the tote label</strong><span class="muted small">${o.tote_mode === "required" ? "This order needs a tote before you scan products." : "Everything you scan next is recorded in this tote."}</span></div></div></div>`;
    dock = `<button class="btn primary save" data-qc="${Q.toteAsk ? "tote-cancel" : "home-pause"}">${Q.toteAsk ? "Cancel" : "Back to orders"}</button>`;
  } else if (Q.view === "line") {
    const l = Q.byKey.get(Q.lineKey);
    body = `${head}<div id="qcmsg"></div><div class="panel"><div class="prod"><div class="prod-sku">${esc(l.sku)}</div><div>${esc(l.description || "No description")}</div>
      <dl>${l.barcode ? `<div class="wide"><dt>Barcode</dt><dd>${esc(l.barcode)}</dd></div>` : ""}${l.batch ? `<div><dt>Batch</dt><dd>${esc(l.batch)}</dd></div>` : ""}${l.uom ? `<div><dt>UOM</dt><dd>${esc(l.uom)}</dd></div>` : ""}
      <div><dt>Ordered</dt><dd>${fmt(l.expected_qty)}</dd></div><div><dt>Scanned</dt><dd>${fmt(l.scanned_qty)}</dd></div><div><dt>Still needed</dt><dd>${fmt(l.expected_qty - l.scanned_qty)}</dd></div>${l.over_qty ? `<div><dt>Set aside</dt><dd>${fmt(l.over_qty)}</dd></div>` : ""}</dl></div>
      ${l.scanned_qty > 0 ? `<h3 style="margin:16px 0 4px">Remove a scanned unit</h3><p class="hint">Use this if a unit was scanned twice or taken out of the order. It's recorded with the reason.</p>
        <div class="chips">${["Scanned twice by mistake", "Damaged, taken out", "Wrong product, taken out"].map(r => `<button class="chip" data-qc="undo" data-r="${esc(r)}">${esc(r)}</button>`).join("")}</div>` : `<p class="hint" style="margin-top:14px">Nothing scanned for this product yet.</p>`}</div>`;
    dock = `<button class="btn primary save" data-qc="line-done">Back to scanning</button>`;
  } else if (Q.view === "short") {
    if (Q.msg && Q.msg.kind === "ok") Q.msg = null;
    const sh = Q.lines.filter(l => l.scanned_qty < l.expected_qty), units = sh.reduce((a, l) => a + l.expected_qty - l.scanned_qty, 0);
    body = `${head}<label class="sr" for="qcscan">Scan a product</label>${scanBox("Found it? Scan it here", o.allow_qty)}<div id="qcmsg"></div><div class="panel qc-short"><h2>${fmt(units)} unit${units === 1 ? "" : "s"} short on ${sh.length} line${sh.length === 1 ? "" : "s"}</h2>
      <p>Before sending the order back, check the tote, the packing table and the floor. If you find the units, scan them now.</p>
      <ul class="qc-lines">${sh.map(l => `<li class="qc-row part"><div class="qc-rowin"><span class="qc-id"><strong>${esc(l.sku)}</strong> ${esc(l.description || "")}<br><span class="muted small">Ordered ${fmt(l.expected_qty)}, scanned ${fmt(l.scanned_qty)}</span></span><span class="qc-n bad">−${fmt(l.expected_qty - l.scanned_qty)}</span></div></li>`).join("")}</ul>
      <p class="hint">If they really are missing, send the order back for picking. It waits under “Waiting for pick” until someone scans the missing units, or a supervisor releases it short.</p></div>`;
    dock = `<button class="btn primary save" data-qc="keep">Keep scanning</button><button class="btn danger" style="min-height:46px" data-qc="send-short">Send back for picking</button>`;
  } else if (Q.view === "passed" || Q.view === "sent") {
    const passed = Q.view === "passed", sh = Q.lines.filter(l => l.scanned_qty < l.expected_qty);
    body = `<div class="panel entry-empty"><div class="${passed ? "big-ok" : "big-bad"}">${passed ? "✓" : "!"}</div>
      <h3>${passed ? `Order ${esc(o.order_no)} passed QC` : `Order ${esc(o.order_no)} is waiting for pick`}</h3>
      <p>${passed ? `${fmt(t.scan)} units in ${fmt(Q.lines.length)} lines checked.` : `Missing: ${sh.map(l => `${fmt(l.expected_qty - l.scanned_qty)} × ${esc(l.sku)}`).join(", ")}. When the picker brings them, scan the order number again and scan the missing units.`}</p>
      ${t.over ? `<p class="qc-aside" style="text-align:left">Return ${fmt(t.over)} set-aside unit${t.over === 1 ? "" : "s"} to stock: ${Q.lines.filter(l => l.over_qty).map(l => `${fmt(l.over_qty)} × ${esc(l.sku)}`).join(", ")}.</p>` : ""}</div>
      <label class="sr" for="qcscan">Next order number</label>${scanBox("Scan the next order number", false)}`;
    dock = `<button class="btn primary save" data-qc="home">Back to orders</button>`;
  } else {
    const sorted = Q.lines.slice().sort((a, b) => (a.scanned_qty >= a.expected_qty) - (b.scanned_qty >= b.expected_qty) || a.line_no - b.line_no);
    body = `${head}<label class="sr" for="qcscan">Scan a product</label>${scanBox("Scan product barcode", o.allow_qty)}<div id="qcmsg"></div>
      <ul class="qc-lines">${sorted.map(l => { const done = l.scanned_qty >= l.expected_qty, part = !done && l.scanned_qty > 0;
        return `<li class="qc-row ${done ? "done" : part ? "part" : ""}"><button data-qc="line" data-id="${esc(K(l.id))}"><span class="qc-id"><strong>${esc(l.sku)}</strong> ${esc(l.description || "")}<br><span class="muted small">${esc(l.barcode || "No barcode: scan or type the SKU")}${l.batch ? " · Batch " + esc(l.batch) : ""}</span>${l.over_qty ? ` <span class="xs bad">${fmt(l.over_qty)} set aside</span>` : ""}</span>
          <span class="qc-n">${done ? "✓ " : ""}${fmt(l.scanned_qty)}<small>/${fmt(l.expected_qty)}</small></span></button></li>`; }).join("")}</ul>`;
    dock = `<button class="btn primary save" data-qc="finish">Finish QC</button><div class="row"><button class="btn ghost" data-qc="home-pause">Pause, back to orders</button></div>`;
  }
  $("#root").innerHTML = X.topbar(title, `<button data-qc="home-pause">Back</button>`) + `<div class="wrap">${lostBanner}${failBanner}${body}</div><div class="dock">${Q.lost ? `<button class="btn primary save" data-qc="home">Back to orders</button>` : dock}</div>`;
  if (Q.lost) $$(".wrap [data-qc]:not([data-qc=home])").forEach(b => b.disabled = true);
  bindScan(); renderMsg();
  if (Q.block) showBlock();
}
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- scanning ---------- */
function scan(v) {
  if (!X) return;
  if (Q.block) { X.vibrate([60, 60, 60]); return; }
  if (Q.lost) { badSound(); return; }
  if (Q.view === "home" || Q.view === "passed" || Q.view === "sent") return findOrder(v);
  if (Q.view === "tote" || Q.toteAsk) return setTote(v);
  if (Q.view === "line") { X.toast("Go back to scanning first.", true); return; }
  if (Q.view === "short") { Q.view = "scan"; render(); }
  scanProduct(v);
}
function setTote(raw) {
  const v = String(raw).trim(), k = up(v);
  if (Q.byCode.has(k)) { badSound(); return setMsg("bad", "That's a product barcode", "Scan the tote label."); }
  if (k === up(Q.order.order_no) || (Q.order.reference && k === up(Q.order.reference))) { badSound(); return setMsg("bad", "That's the order number", "Scan the tote label."); }
  Q.tote = v; Q.toteAsk = false; Q.view = "scan";
  push({kind: "tote", code: v, tote: v});
  Q.msg = {kind: "ok", title: `Tote ${esc(v)}`, body: "Scan the products."}; goodSound(); render();
}
function scanProduct(raw) {
  const v = String(raw).trim(), k = up(v), o = Q.order;
  Q.choose = null;
  if (o.tote_mode === "required" && !Q.tote) { Q.view = "tote"; Q.msg = {kind: "bad", title: "Scan the tote first", body: "This order needs a tote before products are scanned."}; badSound(); return render(); }
  if (k === up(o.order_no) || (o.reference && k === up(o.reference))) { setMsg("info", "That's the order number", "Scan the product barcodes."); return; }
  const keys = Q.byCode.get(k) || [];
  if (!keys.length) {
    push({kind: "unknown", code: v});
    return block("Not in this order", `<strong>${esc(v)}</strong> isn't a product in order ${esc(o.order_no)}. Nothing was counted. Put the item aside and check it against the pick list.`, "I've put it aside");
  }
  if (keys.length > 1) {
    Q.choose = {code: v};
    return setMsg("warn", "More than one product has this barcode", "Check the SKU on the label and tap the right one.", keys.map(key => { const l = Q.byKey.get(key); return `<button class="btn sm" data-qc="choose" data-id="${esc(key)}">${esc(l.sku)}</button>`; }).join(""));
  }
  addUnits(Q.byKey.get(keys[0]), v);
}
function readQty() {
  const qi = $("#qcqty"); if (!qi || !Q.order.allow_qty) return 1;
  const n = Number(qi.value);
  qi.value = "1";
  return Number.isFinite(n) && n > 0 ? n : NaN;
}
function addUnits(l, code) {
  const qty = readQty();
  if (!(qty > 0)) { badSound(); return setMsg("bad", "Enter a quantity of 1 or more", "Nothing was counted. Enter the quantity, then scan again."); }
  const rem = l.expected_qty - l.scanned_qty, name = `${esc(l.sku)}${l.description ? " " + esc(l.description) : ""}`;
  if (rem <= 0) {
    push({kind: "over", line_id: l.id, qty, code});
    return block("Too many", `The order needs <strong>${fmt(l.expected_qty)}</strong> and all ${fmt(l.expected_qty)} are already scanned. ${qty === 1 ? "This unit is" : `These ${fmt(qty)} units are`} extra and ${qty === 1 ? "was" : "were"} not counted.<br><br>Put ${qty === 1 ? "it" : "them"} aside to return to stock.`, "I've put it aside", name);
  }
  if (qty > rem) {
    push({kind: "scan", line_id: l.id, qty: rem, code});
    push({kind: "over", line_id: l.id, qty: qty - rem, code, note: `Entered ${qty}, ${rem} needed`});
    return block(`Only ${fmt(rem)} needed`, `${fmt(rem)} added to ${esc(l.sku)}; that line is now complete. The other <strong>${fmt(qty - rem)}</strong> are more than the order and were not counted.<br><br>Put them aside to return to stock.`, "I've put them aside", name);
  }
  push({kind: "scan", line_id: l.id, qty, code});
  goodSound();
  const left = l.expected_qty - l.scanned_qty, t = totals();
  Q.msg = t.scan >= t.exp ? {kind: "ok", title: "All units scanned", body: "Tap Finish QC."}
    : {kind: "ok", title: `${esc(l.sku)}: ${fmt(l.scanned_qty)} of ${fmt(l.expected_qty)}`, body: left ? `${fmt(left)} more of this product.` : "This product is complete."};
  render();
}

/* ---------- blocking alert: the operator must tap to continue ---------- */
function block(title, body, button, sub) { Q.block = {title, body, button, sub}; badSound(); render(); }
function showBlock() {
  let d = $("#qcblock"); if (d) d.remove();
  d = document.createElement("div"); d.id = "qcblock"; d.className = "qc-block"; d.tabIndex = -1;
  d.setAttribute("role", "alertdialog"); d.setAttribute("aria-modal", "true"); d.setAttribute("aria-labelledby", "qcblock-t");
  d.innerHTML = `<div class="qc-block-in"><div class="qc-stop" aria-hidden="true">✕</div><h2 id="qcblock-t">${Q.block.title}</h2>${Q.block.sub ? `<p class="qc-sub">${Q.block.sub}</p>` : ""}<p>${Q.block.body}</p>
    <button class="btn" data-qc="unblock">${esc(Q.block.button)}</button></div>`;
  document.body.appendChild(d);
  const s = $("#qcscan"); if (s) s.blur();
  d.focus();   // keep the scanner's Enter key away from the button: it must be tapped
}
function closeBlock(silent) { Q.block = null; const d = $("#qcblock"); if (d) d.remove(); if (!silent) { Q.msg = {kind: "info", title: "Carry on scanning", body: ""}; renderMsg(); focusScan(); } }

/* ---------- finish ---------- */
async function finish() {
  if (Q.lines.some(l => l.scanned_qty < l.expected_qty)) { Q.view = "short"; render(); scrollTo(0, 0); return; }
  submitFinish(false);
}
async function submitFinish(confirmShort) {
  if (Q.busy) return;
  const o = Q.order;
  if (failedFor(o.id).length) return setMsg("bad", "Some scans were rejected", "Try sending them again, or discard them and scan again, before finishing.");
  if (!X.isOnline()) return setMsg("warn", "No network", "Connect to finish. Your scans are saved on this phone.");
  Q.busy = true;
  try {
    await X.flushNow();
    if (pendingFor(o.id)) return setMsg("warn", "Scans are still being sent", "Wait a moment and try again.");
    if (failedFor(o.id).length) { render(); return; }
    const r = await X.sb.rpc("qc_finish", {p_order: o.id, p_confirm_short: !!confirmShort, p_device: X.DEVICE});
    if (r.error) { badSound(); return setMsg("bad", "Couldn't finish", esc(r.error.message)); }
    const l = await X.sb.rpc("qc_mobile_lines", {p_order: o.id}); if (!l.error && l.data) { Q.lines = l.data.map(x => ({...x})); index(); }
    if (r.data.status === "check") { Q.view = "short"; render(); return; }
    stopTimers();
    X.idb.set("qc:" + o.id, null).catch(() => {});
    Q.view = r.data.status === "passed" ? "passed" : "sent";
    if (Q.view === "passed") goodSound(); else X.vibrate(60);
    Q.msg = null; render(); scrollTo(0, 0);
  } finally { Q.busy = false; }
}
async function pauseAndLeave() {
  const o = Q.order;
  if (o && !Q.lost && ["scan", "tote", "line", "short"].includes(Q.view) && X.isOnline()) {
    await X.flushNow();
    if (!pendingFor(o.id)) await X.sb.rpc("qc_pause", {p_order: o.id, p_device: X.DEVICE}).catch(() => {});
  }
  home();
}

/* ---------- taps ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-qc]"); if (!b || !X) return;
  if (b.tagName === "A") e.preventDefault();
  switch (b.dataset.qc) {
    case "reload": home(); break;
    case "open": openOrder(b.dataset.id); break;
    case "home": home(); break;
    case "home-pause": pauseAndLeave(); break;
    case "unblock": closeBlock(); break;
    case "choose": { const l = Q.byKey.get(b.dataset.id); if (l && Q.choose) { const c = Q.choose.code; Q.choose = null; Q.msg = null; addUnits(l, c); } break; }
    case "line": Q.lineKey = b.dataset.id; Q.view = "line"; Q.msg = null; render(); scrollTo(0, 0); break;
    case "line-done": Q.view = "scan"; Q.lineKey = null; Q.msg = null; render(); break;
    case "undo": {
      const l = Q.byKey.get(Q.lineKey); if (!l || l.scanned_qty <= 0) break;
      push({kind: "undo", line_id: l.id, qty: 1, note: b.dataset.r});
      Q.view = "scan"; Q.lineKey = null; Q.msg = {kind: "warn", title: `1 × ${esc(l.sku)} removed`, body: `${fmt(l.scanned_qty)} of ${fmt(l.expected_qty)} now scanned. Reason recorded: ${esc(b.dataset.r)}.`}; render(); break;
    }
    case "tote": Q.toteAsk = true; Q.msg = null; render(); break;
    case "tote-cancel": Q.toteAsk = false; Q.msg = null; render(); break;
    case "finish": finish(); break;
    case "keep": Q.view = "scan"; Q.msg = {kind: "info", title: "Scan the missing units", body: ""}; render(); break;
    case "send-short": if (X.confirmTwice(b, "short-" + Q.order.id, "Tap again to send back")) submitFinish(true); break;
  }
});

async function refresh() {   // after discarding rejected scans: take the server's numbers again
  if (!Q.order) return home();
  if (X.isOnline()) { try { const l = await X.sb.rpc("qc_mobile_lines", {p_order: Q.order.id}); if (!l.error && l.data) { Q.lines = l.data.map(x => ({...x})); index();
    X.M.outbox.filter(o => o.kind === "qc" && o.order_id === Q.order.id && !o.failed).sort((x, y) => x.seq - y.seq).forEach(o => applyLocal(o.entry)); saveCache(); } } catch {} }
  render();
}
window.CCQC = {init, home, scan, render: refresh, onSynced: () => { if (!Q.order || !["scan", "short", "tote", "line"].includes(Q.view)) return; if (failedFor(Q.order.id).length) { checkStillMine(); if (!Q.block) render(); } }};
window.__qcDemo = () => X && X.M.mode === "qc" ? {view: Q.toteAsk ? "tote" : Q.view, order: Q.order, lines: Q.lines, orders: Q.orders, tote: Q.tote, blocked: !!Q.block} : null;
})();
