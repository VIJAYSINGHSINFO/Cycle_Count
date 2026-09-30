/* Stowra mobile app: cycle counting and Order QC. Works offline: counts and scans queue on the device and sync when online. */
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => n == null || n === "" || isNaN(n) ? "–" : (Math.round(Number(n) * 1000) / 1000).toLocaleString();
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
const ls = {get: k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }};

if (!CONFIG.DEMO && CONFIG.isPlaceholder()) { window.CC_showSetup(); return; }
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {auth: {persistSession: true, autoRefreshToken: true}});
const deviceId = ls.get("cc-device") || (() => { const d = uuid().slice(0, 8); ls.set("cc-device", d); return d; })();
const platform = window.Capacitor && window.Capacitor.getPlatform ? window.Capacitor.getPlatform() : "web";
const DEVICE = `${platform}-${deviceId}`;
const isOnline = () => navigator.onLine && !(window.__ccOffline && window.__ccOffline());

/* ---------- IndexedDB (device storage) ---------- */
const idb = (() => {
  let dbp;
  const open = () => dbp || (dbp = new Promise((res, rej) => { const r = indexedDB.open("cyclecount", 1); r.onupgradeneeded = () => { const d = r.result; d.createObjectStore("kv"); d.createObjectStore("outbox", {keyPath: "client_id"}); }; r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }));
  const tx = async (store, mode, fn) => { const d = await open(); return new Promise((res, rej) => { const t = d.transaction(store, mode), req = fn(t.objectStore(store)); t.oncomplete = () => res(req && "result" in req ? req.result : undefined); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error); }); };
  return {
    get: k => tx("kv", "readonly", s => s.get(k)), set: (k, v) => tx("kv", "readwrite", s => s.put(v, k)),
    outAll: () => tx("outbox", "readonly", s => s.getAll()), outPut: o => tx("outbox", "readwrite", s => s.put(o)),
    outDel: ids => tx("outbox", "readwrite", s => { ids.forEach(i => s.delete(i)); return null; })
  };
})();

/* ---------- state ---------- */
const M = {
  me: ls.get("cc-me"), sess: null, lines: [], byId: new Map(), locs: [], locIdx: new Map(), skuIdx: new Map(),
  cur: -1, confirmed: false, draft: new Map(), scanAdd: false, peers: new Map(),
  outbox: [], syncing: false, lastSyncErr: null, maxUpdated: null, closed: false, channel: null, timers: [], mode: ls.get("cc-mode") === "qc" ? "qc" : "count"
};
let tT;
function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.className = "toast show" + (bad ? " bad" : ""); clearTimeout(tT); tT = setTimeout(() => t.className = "toast", bad ? 4500 : 2000); }
const vibrate = ms => { try { navigator.vibrate && navigator.vibrate(ms); } catch {} };
const isServerError = e => e && e.code && /^[0-9A-Z]{5}$/.test(e.code) && e.code !== "PGRST301";

/* ---------- auth ---------- */
async function boot() {
  M.outbox = await idb.outAll().catch(() => []);
  const {data: {session}} = await sb.auth.getSession();
  M.uid = session ? session.user.id : null;
  if (!session) return renderLogin();
  try { const r = await sb.rpc("whoami"); if (!r.error && r.data && r.data[0]) { M.me = r.data[0]; ls.set("cc-me", M.me); } } catch {}
  if (!M.me || M.me.id !== session.user.id) return renderMessage("Can't reach the server", "Connect to the network once to finish signing in.", true);
  if (!M.me.active) return renderMessage("Waiting for approval", "Your account was created. Ask your supervisor or administrator to approve it, then open the app again.", true);
  renderSessions();
}
sb.auth.onAuthStateChange((ev, session) => { const uid = session && session.user ? session.user.id : null; if (uid !== M.uid) { M.uid = uid; setTimeout(boot, 0); } });
function renderMessage(title, body, withSignOut) {
  $("#root").innerHTML = `<div class="auth"><div class="panel"><div class="brand-big"><svg class="mark" viewBox="-6 -6 76 76" aria-hidden="true"><path d="M0 0H64V16.7H16.7V32H0Z" fill="#13233F"/><path d="M64 64H0V47.3H47.3V32H64Z" fill="#1FA38A"/><rect x="23.4" y="23.4" width="17.2" height="17.2" rx="2.6" fill="#F2A33A"/></svg><span>stowra</span></div><h2>${esc(title)}</h2><p>${esc(body)}</p><div class="row"><button class="btn primary" data-act="retry">Try again</button>${withSignOut ? `<button class="btn" data-act="signout">Sign out</button>` : ""}</div></div></div>`;
}
function renderLogin(mode = "in") {
  $("#root").innerHTML = `<div class="auth"><form class="panel" id="authf">
    <div class="brand-big"><svg class="mark" viewBox="-6 -6 76 76" aria-hidden="true"><path d="M0 0H64V16.7H16.7V32H0Z" fill="#13233F"/><path d="M64 64H0V47.3H47.3V32H64Z" fill="#1FA38A"/><rect x="23.4" y="23.4" width="17.2" height="17.2" rx="2.6" fill="#F2A33A"/></svg><span>stowra</span></div>
    ${mode === "up" ? `<label class="field" style="margin-bottom:10px">Full name<input name="full_name" required autocomplete="name"></label>` : ""}
    <label class="field" style="margin-bottom:10px">Email<input name="email" type="email" required autocomplete="email" inputmode="email"></label>
    <label class="field" style="margin-bottom:16px">Password<input name="password" type="password" required minlength="8"></label>
    <button class="btn primary" style="width:100%;min-height:50px" type="submit">${mode === "in" ? "Sign in" : "Create account"}</button>
    <p class="small muted" style="margin:14px 0 0">${mode === "in" ? `No account? <a href="#" data-act="to-signup">Create one</a>. Your supervisor approves it.` : `<a href="#" data-act="to-signin">Back to sign in</a>`}</p>
    ${CONFIG.FROM_DEVICE ? `<p class="small muted" style="margin:8px 0 0"><a href="#" data-act="reset-conn">Change database connection</a></p>` : ""}</form></div>`;
  const f = $("#authf"), el = n => f.elements.namedItem(n);
  f.onsubmit = async e => {
    e.preventDefault(); const btn = f.querySelector("[type=submit]"); btn.disabled = true;
    try {
      if (mode === "in") { const {error} = await sb.auth.signInWithPassword({email: el("email").value.trim(), password: el("password").value}); if (error) throw error; }
      else { const {data, error} = await sb.auth.signUp({email: el("email").value.trim(), password: el("password").value, options: {data: {full_name: el("full_name").value.trim()}}}); if (error) throw error; if (!data.session) renderMessage("Check your email", "Confirm your email address, then sign in. Your supervisor will approve the account.", false); }
    } catch (err) { toast(err.message || "Sign-in failed", true); btn.disabled = false; }
  };
}

/* ---------- sessions list ---------- */
function syncBadge() {
  const pend = M.outbox.filter(o => !o.failed).length, failed = M.outbox.filter(o => o.failed).length;
  const cls = failed ? "err" : !isOnline() ? "off" : "";
  const txt = failed ? `${failed} not saved` : !isOnline() ? (pend ? `Offline, ${pend} waiting` : "Offline") : pend ? `Syncing ${pend}` : "Synced";
  return `<span class="sync ${cls}" id="sync" role="status"><i></i>${txt}</span>`;
}
function topbar(title, left = "", right = "") { return `<header class="top">${left}<span class="t">${esc(title)}</span>${syncBadge()}${right}</header>`; }
function renderSync() { const s = $("#sync"); if (!s) return; s.outerHTML = syncBadge(); }
function modeTabs(active) {
  return `<div class="modes" role="tablist" aria-label="What are you doing?">${[["count", "Cycle count"], ["qc", "Order QC"]].map(([k, l]) => `<button role="tab" aria-selected="${active === k}" data-act="mode" data-m="${k}">${l}</button>`).join("")}</div>`;
}
async function renderSessions() {
  leaveSession();
  if (M.mode === "qc" && window.CCQC) return window.CCQC.home();
  $("#root").innerHTML = topbar("Choose a count", "", `<button data-act="signout">Sign out</button>`) + `<div class="wrap">${modeTabs("count")}<p class="small muted">Signed in as ${esc(M.me.full_name)}</p><div class="sess" id="sess"><div class="loading">Loading counts…</div></div></div>`;
  let rows = null;
  try { const r = await sb.rpc("mobile_sessions"); if (r.error) throw r.error; rows = r.data; idb.set("sessions", rows); } catch { rows = await idb.get("sessions").catch(() => null); if (rows) toast("Offline: showing saved counts"); }
  const box = $("#sess"); if (!box) return;
  if (!rows || !rows.length) { box.innerHTML = `<div class="empty"><h3>No counts are open</h3><p>Your supervisor opens counts from the desktop console.</p><button class="btn" data-act="reload-sessions">Refresh</button></div>`; return; }
  box.innerHTML = rows.map(s => { const p = s.lines_total ? Math.round(s.lines_counted / s.lines_total * 100) : 0; return `<button data-act="open" data-id="${s.id}"><span class="nm">${esc(s.name)}</span><span class="small muted">${esc([s.site, s.zone].filter(Boolean).join(" / ") || "No zone")}, ${fmt(s.locations_total - s.locations_open)} of ${fmt(s.locations_total)} locations done</span><span class="progress"><b style="width:${p}%"></b></span></button>`; }).join("");
  M.sessions = rows;
}

/* ---------- load a session ---------- */
function rebuild() {
  M.lines.sort((a, b) => a.seq - b.seq || a.id - b.id);
  M.byId = new Map(); const locMap = new Map(); M.codeIdx = new Map();
  const addCode = (c, id) => { if (!c) return; const k = String(c).toUpperCase(); if (!M.codeIdx.has(k)) M.codeIdx.set(k, []); const a = M.codeIdx.get(k); if (!a.includes(id)) a.push(id); };
  M.lines.forEach(l => {
    M.byId.set(l.id, l);
    const k = String(l.location).toUpperCase();
    if (!locMap.has(k)) locMap.set(k, {loc: l.location, key: k, ids: []});
    locMap.get(k).ids.push(l.id);
    addCode(l.sku, l.id); addCode(l.barcode, l.id);
  });
  (M.extraLocs || []).forEach(x => { const k = x.toUpperCase(); if (!locMap.has(k)) locMap.set(k, {loc: x, key: k, ids: []}); });
  M.locs = [...locMap.values()];
  M.locs.forEach(L => { L.rack = rackOf(L.key); L.rackLabel = L.loc.slice(0, L.rack.length); });
  M.locIdx = new Map(M.locs.map((L, i) => [L.key, i]));
}
let cacheT;
function saveCache() { if (!M.sess || M.mode === "qc") return; const sid = M.sess.id; clearTimeout(cacheT); cacheT = setTimeout(() => idb.set("lines:" + sid, {lines: M.lines.filter(l => l.id > 0), maxUpdated: M.maxUpdated, at: Date.now()}).catch(() => {}), 1500); }
async function fetchPages(since, onPage) {
  let after = 0, total = 0;
  for (;;) {
    const {data, error} = await sb.rpc("mobile_lines", {p_session: M.sess.id, p_since: since, p_after_id: after, p_limit: 1000});
    if (error) throw error;
    total += data.length; onPage(data, total);
    if (data.length < 1000) break; after = data[data.length - 1].id;
  }
}
function applyRows(rows) {
  const pendingIds = new Set(M.outbox.filter(o => o.kind === "count" && o.session_id === M.sess.id).map(o => o.line_id));
  let added = false;
  for (const r of rows) {
    if (!M.maxUpdated || r.updated_at > M.maxUpdated) M.maxUpdated = r.updated_at;
    const cur = M.byId.get(r.id);
    if (!cur) {
      const tmp = M.lines.findIndex(l => l.id < 0 && l.location.toUpperCase() === r.location.toUpperCase() && l.sku.toUpperCase() === r.sku.toUpperCase() && String(l.batch || "").toUpperCase() === String(r.batch || "").toUpperCase());
      if (tmp >= 0) {
        const old = M.lines[tmp].id; M.lines.splice(tmp, 1);
        if (M.visit && M.visit.totals.has(old)) { M.visit.totals.set(r.id, M.visit.totals.get(old)); M.visit.totals.delete(old); M.visit.order = M.visit.order.map(x => x === old ? r.id : x); }
      }
      M.lines.push({...r}); added = true;
    } else if (!pendingIds.has(r.id)) Object.assign(cur, r);
  }
  if (added) rebuild();
  return added;
}
async function openSession(id) {
  M.sess = (M.sessions || []).find(s => s.id === id); if (!M.sess) return;
  Object.assign(M, {lines: [], cur: -1, visit: null, phase: "arrive", item: null, err: null, extraLocs: [], closed: false, maxUpdated: null, peers: new Map()});
  $("#root").innerHTML = topbar(M.sess.name, `<button data-act="back">Back</button>`) + `<div class="wrap"><div class="loading" id="loadmsg">Loading lines…</div></div>`;
  const cached = await idb.get("lines:" + id).catch(() => null);
  if (cached && cached.lines && cached.lines.length) { M.lines = cached.lines; M.maxUpdated = cached.maxUpdated; }
  M.outbox.filter(o => o.session_id === id && o.kind === "count").forEach(o => { const l = M.lines.find(x => x.id === o.line_id); if (l) l.counted_qty = o.qty; });
  rebuild();
  try {
    await fetchPages(M.lines.length ? M.maxUpdated : null, (rows, total) => { applyRows(rows); const m = $("#loadmsg"); if (m) m.textContent = `Loading lines: ${fmt(total)}`; });
    saveCache();
  } catch (e) {
    if (!M.lines.length) { $("#loadmsg").textContent = "Couldn't download this count. Connect to the network and try again."; return; }
    toast("Offline: using lines saved on this device");
  }
  renderWalk();
  joinPresence();
  M.timers.push(setInterval(pull, 15000), setInterval(checkOpen, 60000));
}
function leaveSession() { M.timers.forEach(clearInterval); M.timers = []; if (M.channel) { try { sb.removeChannel(M.channel); } catch {} M.channel = null; } }
async function pull() {
  if (!isOnline() || !M.sess) return;
  try { await fetchPages(M.maxUpdated, rows => applyRows(rows)); saveCache(); refreshWalk(); } catch {}
}
async function checkOpen() {
  if (!isOnline() || !M.sess) return;
  try { const r = await sb.rpc("mobile_sessions"); if (r.error) return; const cur = r.data.find(s => s.id === M.sess.id); if (!cur) { M.closed = true; renderStage(); toast("A supervisor closed this count.", true); } else Object.assign(M.sess, cur); } catch {}
}

/* ---------- presence: skip locations others are at ---------- */
function joinPresence() {
  try {
    const ch = sb.channel("walk-" + M.sess.id, {config: {presence: {key: M.me.id + ":" + deviceId}}});
    ch.on("presence", {event: "sync"}, () => {
      const st = ch.presenceState(), m = new Map();
      Object.entries(st).forEach(([k, arr]) => { if (k === M.me.id + ":" + deviceId) return; const p = arr[arr.length - 1]; if (p && p.loc) m.set(String(p.loc).toUpperCase(), String(p.name || "Another counter")); });
      M.peers = m; if ($("#stage")) { renderPeerNote(); renderUpNext(); }
    });
    ch.subscribe(status => { if (status === "SUBSCRIBED") announce(); });
    M.channel = ch;
  } catch {}
}
function announce() { if (!M.channel) return; const L = M.phase === "count" ? M.locs[M.cur] : null; M.channel.track({loc: L ? L.loc : null, name: M.me.full_name}).catch(() => {}); }

/* ---------- walk logic: suggest location > scan location > scan product > quantity ---------- */
const lineOf = id => M.byId.get(id);
const expectedAt = li => M.locs[li].ids.filter(id => !lineOf(id).is_found);
const locDone = li => M.locs[li].ids.every(id => lineOf(id).counted_qty != null);
const locRecount = li => M.locs[li].ids.some(id => { const l = lineOf(id); return l.recount_requested && l.counted_qty == null; });
function rackOf(key) { if (M.sess.rack_grouping === "none") return key; if (M.sess.rack_grouping === "last_char") return key.length > 3 && /[A-Z]$/.test(key) ? key.slice(0, -1) : key; const m = key.match(/^(.*)[-\/. _]([^-\/. _]+)$/); return m ? m[1] : key; }
function rackLocs(li) { const r = M.locs[li].rack; return M.locs.map((L, i) => L.rack === r ? i : -1).filter(i => i >= 0); }
function nextLoc(from) {
  const n = M.locs.length; let fallback = -1;
  for (let k = 1; k <= n; k++) {
    const li = ((from + k) % n + n) % n;
    if (locDone(li)) continue;
    if (M.peers.has(M.locs[li].key)) { if (fallback < 0) fallback = li; continue; }
    return li;
  }
  return fallback;
}
function newVisit(li, confirmed) { M.cur = li; M.phase = li < 0 ? "done" : confirmed ? "count" : "arrive"; M.visit = {totals: new Map(), order: [], lastBatch: new Map()}; M.item = null; M.err = null; }

function renderWalk() {
  if (M.cur < 0 || M.cur >= M.locs.length || !M.visit) newVisit(nextLoc(-1), false);
  $("#root").innerHTML = topbar(M.sess.name, `<button data-act="back">Back</button>`) + `<div class="wrap">
    <div class="walkbar" id="walkbar"></div>
    <label class="sr" for="scan">Scan a barcode</label>
    <div class="scan"><input id="scan" autocomplete="off" autocapitalize="characters" spellcheck="false" enterkeyhint="go">${cameraAvailable() ? `<button class="cam" data-act="camera" aria-label="Scan with camera">${CAM_ICON}</button>` : ""}</div>
    <div id="stage"></div><div id="upnext"></div></div>
    <div class="dock" id="dock"></div>`;
  const scan = $("#scan");
  scan.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); const v = scan.value.trim(); scan.value = ""; if (v) handleScan(v); } });
  renderBar(); renderStage(); announce();
}
const CAM_ICON = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="4"/></svg>`;
function refreshWalk() { if (!$("#stage")) return; renderBar(); if (M.phase === "arrive" || M.phase === "done") { if (M.phase === "done" || locDone(M.cur)) { newVisit(nextLoc(M.cur < 0 ? -1 : M.cur - 1), false); } renderStage(); } else renderUpNext(); }
function renderBar() {
  const w = $("#walkbar"); if (!w) return;
  let done = 0; for (let i = 0; i < M.locs.length; i++) if (locDone(i)) done++;
  const p = M.locs.length ? done / M.locs.length * 100 : 0;
  w.innerHTML = `<strong>${fmt(done)}</strong><span class="muted">of ${fmt(M.locs.length)} locations</span><span class="progress"><b style="width:${p}%"></b></span><label class="check small"><input type="checkbox" id="scanadd" ${M.scanAdd ? "checked" : ""}> Each scan = 1</label>`;
  $("#scanadd").onchange = e => { M.scanAdd = e.target.checked; toast(M.scanAdd ? "Each product scan now adds 1" : "Enter a quantity after each scan"); focusScan(); };
}
function rack(L, state) {
  const levels = rackLocs(M.locIdx.get(L.key));
  return `<div class="rack ${state === "ok" ? "ok" : ""}"><div class="rack-top"><span>${state === "ok" ? "✓ AT LOCATION" : state === "next" ? "GO TO LOCATION" : "LOCATION"}</span><span>${M.locIdx.get(L.key) + 1} of ${fmt(M.locs.length)}</span></div>
    <div class="rack-loc">${esc(L.loc)}</div><div class="bars" aria-hidden="true"></div>
    ${levels.length > 1 ? `<div class="levels">Rack ${esc(L.rackLabel)}: ${levels.map(i => `<span class="${i === M.locIdx.get(L.key) ? "on" : ""} ${locDone(i) ? "done" : ""}">${esc(M.locs[i].loc.slice(L.rackLabel.length).replace(/^[-\/. _]/, "") || M.locs[i].loc)}</span>`).join("")}</div>` : ""}</div>`;
}
function focusScan() { const s = $("#scan"); if (s && !["qty", "excess", "batch"].includes(M.phase)) s.focus(); }
function setPlaceholder(t) { const s = $("#scan"); if (s) s.placeholder = t; }

function renderStage() {
  const st = $("#stage"), dock = $("#dock"); if (!st) return;
  if (M.closed) { st.innerHTML = `<div class="panel entry-empty"><h3>This count is closed</h3><p>A supervisor closed it. Anything saved on this device is still sent when possible.</p></div>`; dock.innerHTML = `<button class="btn" data-act="back">Choose another count</button>`; setPlaceholder(""); return; }
  if (M.phase === "done" || M.cur < 0) { st.innerHTML = `<div class="panel entry-empty"><div class="big-ok">✓</div><h3>Every location is counted</h3><p>Your supervisor reviews the results on the console. New recounts appear here automatically.</p></div>`; dock.innerHTML = `<button class="btn" data-act="back">Choose another count</button>`; setPlaceholder("Scan a location to count it again"); renderUpNext(); return; }
  if (["qty", "batch", "excess"].includes(M.phase)) { const u = $("#upnext"); if (u) u.innerHTML = ""; setPlaceholder("Finish this item first"); }
  const L = M.locs[M.cur], err = M.err ? `<div class="alert ${M.err.kind}" role="alert"><strong>${M.err.title}</strong><span>${M.err.body}</span>${M.err.actions ? `<div class="row">${M.err.actions}</div>` : ""}</div>` : "";
  if (M.phase === "arrive") {
    st.innerHTML = `${err}<div class="panel">${rack(L, "next")}
      ${locRecount(M.cur) ? `<p class="flag" style="display:inline-block;margin:10px 0 0">Recount requested</p>` : ""}
      <div class="instruct"><span class="stepn">1</span><div><strong>Go to ${esc(L.loc)} and scan the location label</strong><span class="muted small">Then scan each product you find there.</span></div></div>
      <div id="peernote"></div></div>`;
    dock.innerHTML = `<div class="row"><button class="btn ghost" data-act="skip">Skip location</button><button class="btn ghost" data-act="manual-confirm">Label damaged</button></div>`;
    setPlaceholder("Scan location label"); renderPeerNote(); renderUpNext(); focusScan(); return;
  }
  if (M.phase === "count") {
    const scanned = M.visit.order.map(id => lineOf(id)).filter(Boolean);
    st.innerHTML = `${err}<div class="panel">${rack(L, "ok")}
      <div class="instruct"><span class="stepn">2</span><div><strong>Scan a product barcode</strong><span class="muted small">${M.scanAdd ? "Each scan adds 1." : "You'll enter the quantity after each scan."}</span></div></div>
      <h3 style="margin:14px 0 4px">Scanned here <span class="muted small" style="font-family:var(--sans);font-weight:500">${scanned.length ? `(${scanned.length} item${scanned.length === 1 ? "" : "s"})` : ""}</span></h3>
      ${scanned.length ? `<ul class="scanned">${scanned.map(l => `<li><button data-act="edit" data-id="${l.id}"><span><strong>${esc(l.sku)}</strong>${l.batch ? ` <span class="muted small">Batch ${esc(l.batch)}</span>` : ""}${l.is_found ? ' <span class="xs">Excess</span>' : ""}<br><span class="muted small">${esc(l.description || "")}</span></span><span class="q">${fmt(M.visit.totals.get(l.id))}</span></button></li>`).join("")}</ul>` : `<p class="muted small" style="margin:4px 0 0">Nothing scanned yet.</p>`}
      <div id="peernote"></div></div>`;
    dock.innerHTML = `<button class="btn primary save" data-act="complete">Location complete</button>
      <div class="row"><button class="btn ghost" data-act="empty">Location empty</button><button class="btn ghost" data-act="excess-manual">No barcode</button><button class="btn ghost" data-act="leave">Leave</button></div>`;
    setPlaceholder("Scan product barcode"); renderPeerNote(); renderUpNext(); focusScan(); return;
  }
  if (M.phase === "batch") {
    const it = M.item, batches = it.ids.map(id => lineOf(id));
    st.innerHTML = `${err}<div class="panel">${productCard(batches[0], true)}
      <label class="field" style="margin-top:12px">Which batch is this? Scan or type the batch number<input id="batchin" autocapitalize="characters" autocomplete="off"></label>
      <div class="chips" style="margin-top:10px">${batches.map(l => `<button class="chip" data-act="pick-batch" data-id="${l.id}">${esc(l.batch || "No batch")}</button>`).join("")}</div></div>`;
    dock.innerHTML = `<div class="row"><button class="btn ghost" data-act="cancel-item">Cancel</button><button class="btn ghost" data-act="batch-other">Batch not listed</button></div>`;
    const bi = $("#batchin"); bi.focus();
    bi.addEventListener("keydown", e => { if (e.key !== "Enter") return; e.preventDefault(); const v = bi.value.trim().toUpperCase(); if (!v) return; const m = batches.find(l => String(l.batch).toUpperCase() === v); if (m) pickLine(m.id); else openExcess({sku: batches[0].sku, barcode: batches[0].barcode, description: batches[0].description, uom: batches[0].uom, batch: bi.value.trim(), reason: `Batch ${bi.value.trim()} isn't expected at ${L.loc}.`}); });
    return;
  }
  if (M.phase === "qty") {
    const l = lineOf(M.item.id), so = M.visit.totals.get(l.id);
    st.innerHTML = `${err}<div class="panel">${productCard(l)}
      ${so != null ? `<p class="sofar">Already scanned here: <strong>${fmt(so)}</strong></p>` : ""}
      <label class="field" for="qty" style="margin-top:10px">${so != null ? (M.replace ? "New total quantity" : "Quantity to add") : "Quantity"}${l.uom ? ` (${esc(l.uom)})` : ""}</label>
      <input id="qty" class="bigqty" type="number" inputmode="decimal" min="0" step="any" placeholder="0">
      ${so != null ? `<label class="check small" style="margin-top:8px"><input type="checkbox" id="repl" ${M.replace ? "checked" : ""}> Replace the total instead of adding</label>` : ""}</div>`;
    dock.innerHTML = `<button class="btn primary save" data-act="save-qty">Save quantity</button><div class="row"><button class="btn ghost" data-act="cancel-item">Cancel</button></div>`;
    const q = $("#qty"); q.focus();
    q.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); saveQty(); } });
    const rp = $("#repl"); if (rp) rp.onchange = () => { M.replace = rp.checked; renderStage(); };
    return;
  }
  if (M.phase === "excess") return renderExcess();
}
function productCard(l, hideBatch) {
  return `<div class="prod"><div class="prod-sku">${esc(l.sku)}</div><div>${esc(l.description || "No description")}</div>
    <dl>${l.barcode ? `<div class="wide"><dt>Barcode</dt><dd>${esc(l.barcode)}</dd></div>` : ""}${l.batch && !hideBatch ? `<div><dt>Batch</dt><dd>${esc(l.batch)}</dd></div>` : ""}${l.uom ? `<div><dt>UOM</dt><dd>${esc(l.uom)}</dd></div>` : ""}${l.system_qty != null && !l.is_found ? `<div><dt>System</dt><dd>${fmt(l.system_qty)}</dd></div>` : ""}</dl></div>`;
}
function renderPeerNote() { const n = $("#peernote"); if (!n || M.cur < 0) return; const who = M.peers.get(M.locs[M.cur].key); n.innerHTML = who ? `<div class="peer">${esc(who)} is also at this location.</div>` : ""; }
function renderUpNext() {
  const u = $("#upnext"); if (!u) return;
  if (M.phase !== "arrive" && M.phase !== "count" && M.phase !== "done") { u.innerHTML = ""; return; }
  const list = []; let li = M.cur;
  for (let k = 0; k < 4 && M.locs.length; k++) { li = nextLoc(li); if (li < 0 || li === M.cur || list.includes(li)) break; list.push(li); }
  let rc = 0, firstRc = -1; for (let i = 0; i < M.locs.length; i++) if (locRecount(i)) { rc++; if (firstRc < 0 && i !== M.cur) firstRc = i; }
  u.innerHTML = `${rc ? `<div class="banner bad" style="margin-top:12px"><span>${fmt(rc)} location${rc === 1 ? "" : "s"} need recount</span>${firstRc >= 0 && M.phase !== "count" ? `<button class="btn sm" data-act="goto" data-li="${firstRc}">Go to recount</button>` : ""}</div>` : ""}
    ${list.length && M.phase !== "done" ? `<p class="small muted" style="margin:14px 0 6px">Up next</p><ol class="upnext">${list.map(i => `<li><span class="tag">${esc(M.locs[i].loc)}</span></li>`).join("")}</ol>` : ""}`;
}

function setErr(kind, title, body, actions) { M.err = {kind, title, body, actions}; vibrate(kind === "bad" ? [70, 50, 70] : 30); if (kind === "bad") beep(); }
let actx;
function beep() { try { actx = actx || new (window.AudioContext || window.webkitAudioContext)(); const o = actx.createOscillator(), g = actx.createGain(); o.frequency.value = 220; g.gain.value = .08; o.connect(g); g.connect(actx.destination); o.start(); o.stop(actx.currentTime + .18); } catch {} }

function handleScan(v) {
  if (!M.sess || !$("#stage")) { toast("Open a count first, then scan.", true); return; }
  if (M.closed) return;
  const k = v.toUpperCase(); M.err = null;
  const li = M.locIdx.get(k);
  if (M.phase === "qty" || M.phase === "batch" || M.phase === "excess") { toast("Finish or cancel this item first.", true); return; }
  if (li != null) return scanLocation(li);
  const ids = M.codeIdx.get(k) || [];
  if (M.phase === "arrive" || M.phase === "done") {
    if (ids.length) { setErr("bad", "Scan the location label first", `That's a product barcode. Scan the label of ${esc(M.locs[M.cur] ? M.locs[M.cur].loc : "a location")} to start.`); }
    else setErr("bad", `${esc(v)} isn't a location in this count`, "Check the label. If this location really exists but has no stock in the system, you can count it now.", `<button class="btn sm" data-act="new-loc" data-v="${esc(v)}">Count ${esc(v)} as a new location</button>`);
    renderStage(); return;
  }
  scanProduct(v, ids);
}
function scanLocation(li) {
  if (M.phase === "count" && li === M.cur) { setErr("info", "Already at this location", "Scan a product barcode."); renderStage(); return; }
  if (M.phase === "count" && M.visit.order.length && !locDone(M.cur)) {
    setErr("warn", `${esc(M.locs[M.cur].loc)} isn't complete`, `You scanned ${esc(M.locs[li].loc)}. Finish this location first, or leave it and come back later.`,
      `<button class="btn sm" data-act="switch-loc" data-li="${li}">Go to ${esc(M.locs[li].loc)}</button>`); renderStage(); return;
  }
  const was = M.cur, suggested = M.phase === "arrive" ? M.cur : -1;
  newVisit(li, true); announce(); vibrate(40);
  if (suggested >= 0 && suggested !== li) M.err = {kind: "info", title: `Counting ${esc(M.locs[li].loc)}`, body: `The suggested location was ${esc(M.locs[suggested].loc)}. It stays in the list for later.`};
  renderStage();
}
function scanProduct(v, ids) {
  const L = M.locs[M.cur];
  const here = ids.filter(id => L.ids.includes(id));
  if (here.length) {
    vibrate(30);
    const skus = [...new Set(here.map(id => lineOf(id).sku.toUpperCase()))];
    if (skus.length > 1) { setErr("warn", "More than one product uses this barcode", "Check the SKU on the product label and pick one.", here.map(id => `<button class="btn sm" data-act="pick-line" data-id="${id}">${esc(lineOf(id).sku)}${lineOf(id).batch ? " / " + esc(lineOf(id).batch) : ""}</button>`).join(" ")); renderStage(); return; }
    if (here.length > 1) {
      const remembered = M.visit.lastBatch.get(skus[0]);
      if (M.scanAdd && remembered && here.includes(remembered)) return addOne(remembered);
      M.item = {ids: here}; M.phase = "batch"; renderStage(); return;
    }
    return M.scanAdd ? addOne(here[0]) : pickLine(here[0]);
  }
  if (ids.length) {
    const l0 = lineOf(ids[0]);
    const locsOf = [...new Set(ids.map(id => M.locIdx.get(lineOf(id).location.toUpperCase())))].filter(i => i != null);
    const sameRack = locsOf.filter(i => M.locs[i].rack === L.rack);
    if (sameRack.length) {
      const t = M.locs[sameRack[0]].loc;
      setErr("bad", "Wrong location", `${esc(l0.sku)} belongs to <strong>${esc(t)}</strong> in this same rack, not ${esc(L.loc)}. Count it under ${esc(t)}.`,
        `<button class="btn sm" data-act="switch-loc" data-li="${sameRack[0]}">Switch to ${esc(t)}</button>`);
      renderStage(); return;
    }
    const where = locsOf.slice(0, 3).map(i => esc(M.locs[i].loc)).join(", ") + (locsOf.length > 3 ? ` and ${locsOf.length - 3} more` : "");
    setErr("bad", "Not expected at this location", `${esc(l0.sku)} ${esc(l0.description ? "(" + l0.description + ")" : "")} is at <strong>${where}</strong> in the system. If it's physically here, record it as misplaced stock.`,
      `<button class="btn sm" data-act="excess-from" data-id="${ids[0]}" data-exp="${esc(M.locs[locsOf[0]] ? M.locs[locsOf[0]].loc : "")}">Record as misplaced here</button>`);
    renderStage(); return;
  }
  setErr("bad", "Not in the stock file", `Barcode <strong>${esc(v)}</strong> isn't in the system for this count. If the product is here, record it as excess.`,
    `<button class="btn sm" data-act="excess-new" data-v="${esc(v)}">Record as excess</button>`);
  renderStage();
}
function pickLine(id) { M.item = {id}; M.replace = false; M.err = null; M.phase = "qty"; const l = lineOf(id); if (l.batch) M.visit.lastBatch.set(l.sku.toUpperCase(), id); if (M.scanAdd) return addOne(id); renderStage(); }
function addOne(id) { const n = (M.visit.totals.get(id) || 0) + 1; recordTotal(id, n); M.phase = "count"; M.item = null; const l = lineOf(id); M.err = {kind: "ok", title: `${esc(l.sku)} ${l.batch ? "/ " + esc(l.batch) : ""}: ${fmt(n)}`, body: "Scan the next unit or product."}; renderStage(); }
function saveQty() {
  const l = lineOf(M.item.id), raw = $("#qty").value.trim(), q = parseFloat(raw);
  if (raw === "" || isNaN(q) || q < 0) { toast("Enter a quantity of 0 or more.", true); $("#qty").focus(); return; }
  const prev = M.visit.totals.get(l.id), total = prev != null && !M.replace ? prev + q : q;
  recordTotal(l.id, total);
  M.phase = "count"; M.item = null; M.err = {kind: "ok", title: `Saved ${fmt(total)} × ${esc(l.sku)}`, body: "Scan the next product, or tap Location complete."};
  renderStage();
}
async function recordTotal(id, total) {
  const l = lineOf(id);
  if (!M.visit.order.includes(id)) M.visit.order.push(id);
  M.visit.totals.set(id, total);
  l.counted_qty = total; l.recount_requested = false; l.counted_by_name = M.me.full_name;
  const o = l.id < 0
    ? {client_id: uuid(), kind: "excess", session_id: M.sess.id, location: l.location, sku: l.sku, barcode: l.barcode, description: l.description, uom: l.uom, batch: l.batch, mfg_date: l.mfg_date || null, expiry_date: l.expiry_date || null, expected_location: l.expected_location || null, remarks: l.remarks || null, qty: total, client_ts: new Date().toISOString(), tries: 0}
    : {client_id: uuid(), kind: "count", session_id: M.sess.id, line_id: id, qty: total, client_ts: new Date().toISOString(), tries: 0};
  await queue([o]);
}
async function queue(items) {
  try { for (const o of items) await idb.outPut(o); } catch { toast("This device's storage is full. Free some space.", true); return false; }
  M.outbox.push(...items); saveCache(); renderSync(); flush(); return true;
}
async function completeLoc(force) {
  const L = M.locs[M.cur];
  const missing = expectedAt(M.cur).filter(id => !M.visit.totals.has(id) && lineOf(id).counted_qty == null);
  if (missing.length && !force) {
    setErr("warn", `${missing.length} expected item${missing.length === 1 ? " was" : "s were"} not scanned`, `If you've checked the whole location, they'll be saved as 0 (not found).`,
      `<button class="btn sm primary" data-act="complete-force">Save as not found</button><button class="btn sm" data-act="dismiss">Keep counting</button>`);
    renderStage(); return;
  }
  const now = new Date().toISOString();
  const zeros = missing.map(id => { const l = lineOf(id); l.counted_qty = 0; l.recount_requested = false; l.counted_by_name = M.me.full_name; return {client_id: uuid(), kind: "count", session_id: M.sess.id, line_id: id, qty: 0, client_ts: now, tries: 0}; });
  if (zeros.length && !(await queue(zeros))) return;
  vibrate(60);
  const nx = nextLoc(M.cur);
  toast(nx >= 0 ? `${L.loc} done. Next: ${M.locs[nx].loc}` : `${L.loc} done. All locations counted.`);
  newVisit(nx, false); renderBar(); renderStage(); announce(); scrollTo(0, 0);
}
function openExcess(pre) { M.item = {excess: pre}; M.phase = "excess"; M.err = null; renderStage(); }
function renderExcess() {
  const st = $("#stage"), dock = $("#dock"), p = M.item.excess, S = M.sess, L = M.locs[M.cur];
  const req = f => S[f] === "required", show = f => S[f] !== "hidden";
  st.innerHTML = `<div class="panel"><h2 style="margin-bottom:4px">${p.expected ? "Misplaced stock" : "Excess stock"} at ${esc(L.loc)}</h2>
    <p class="hint">${p.reason ? p.reason + " " : ""}Fill in the details from the product label. Fields marked * are required.</p>
    <form id="exf" class="grid-form" novalidate>
      <label class="field">SKU *<input name="sku" required value="${esc(p.sku || "")}" autocapitalize="characters"></label>
      <label class="field">Barcode<input name="barcode" value="${esc(p.barcode || "")}"></label>
      <label class="field" style="grid-column:1/-1">Description<input name="description" value="${esc(p.description || "")}"></label>
      <label class="field">Quantity *<input name="qty" type="number" inputmode="decimal" min="0" step="any" required></label>
      <label class="field">UOM<input name="uom" value="${esc(p.uom || "EA")}"></label>
      ${show("excess_batch") ? `<label class="field">Batch number${req("excess_batch") ? " *" : ""}<input name="batch" value="${esc(p.batch || "")}" autocapitalize="characters"></label>` : ""}
      ${show("excess_mfg") ? `<label class="field">Manufacturing date${req("excess_mfg") ? " *" : ""}<input name="mfg_date" type="date"></label>` : ""}
      ${show("excess_expiry") ? `<label class="field">Expiry date${req("excess_expiry") ? " *" : ""}<input name="expiry_date" type="date"></label>` : ""}
      ${p.expected ? `<label class="field">System location<input name="expected_location" value="${esc(p.expected)}" readonly></label>` : ""}
      <label class="field" style="grid-column:1/-1">Remarks<input name="remarks" placeholder="Optional, e.g. damaged, no label"></label>
    </form><p class="scanmsg bad" id="exerr"></p></div>`;
  dock.innerHTML = `<button class="btn primary save" data-act="save-excess">Save ${p.expected ? "misplaced" : "excess"} stock</button><div class="row"><button class="btn ghost" data-act="cancel-item">Cancel</button></div>`;
  const f = $("#exf"); (p.sku ? f.elements.namedItem("qty") : f.elements.namedItem("sku")).focus();
}
async function saveExcess() {
  const f = $("#exf"), g = n => { const e = f.elements.namedItem(n); return e ? e.value.trim() : ""; }, S = M.sess, L = M.locs[M.cur], p = M.item.excess;
  const errs = [];
  if (!g("sku")) errs.push("SKU");
  const qv = parseFloat(g("qty")); if (g("qty") === "" || isNaN(qv) || qv < 0) errs.push("quantity");
  if (S.excess_batch === "required" && !g("batch")) errs.push("batch number");
  if (S.excess_mfg === "required" && !g("mfg_date")) errs.push("manufacturing date");
  if (S.excess_expiry === "required" && !g("expiry_date")) errs.push("expiry date");
  if (errs.length) { $("#exerr").textContent = `Enter the ${errs.join(", ")}.`; vibrate([60, 60, 60]); return; }
  if (g("mfg_date") && g("expiry_date") && g("expiry_date") < g("mfg_date")) { $("#exerr").textContent = "The expiry date can't be before the manufacturing date."; return; }
  if (g("expiry_date") && g("expiry_date") < new Date().toISOString().slice(0, 10)) toast("Note: this stock is past its expiry date.", true);
  const key = (L.loc + "|" + g("sku") + "|" + g("batch")).toUpperCase();
  let l = M.lines.find(x => (x.location + "|" + x.sku + "|" + (x.batch || "")).toUpperCase() === key);
  if (!l) {
    l = {id: -Date.now(), seq: Math.max(...L.ids.map(id => lineOf(id).seq)), location: L.loc, sku: g("sku"), barcode: g("barcode"), batch: g("batch"), description: g("description"), uom: g("uom"),
         mfg_date: g("mfg_date") || null, expiry_date: g("expiry_date") || null, expected_location: p.expected || null, remarks: g("remarks") || null, system_qty: null, counted_qty: null, recount_requested: false, is_found: true};
    M.lines.push(l); rebuild();
  }
  const prev = M.visit.totals.get(l.id) || 0;
  await recordTotal(l.id, prev + qv);
  M.phase = "count"; M.item = null; M.err = {kind: "ok", title: `${p.expected ? "Misplaced" : "Excess"} stock saved`, body: `${fmt(prev + qv)} × ${esc(l.sku)}${l.batch ? " / batch " + esc(l.batch) : ""}. Scan the next product.`};
  renderStage();
}

/* ---------- sync ---------- */
async function flush() {
  if (M.syncing || !isOnline()) { renderSync(); return; }
  const todo = M.outbox.filter(o => !o.failed); if (!todo.length) { renderSync(); return; }
  M.syncing = true;
  try {
    const bySess = new Map(); todo.filter(o => o.kind === "count").forEach(o => { if (!bySess.has(o.session_id)) bySess.set(o.session_id, []); bySess.get(o.session_id).push(o); });
    for (const [sid, list] of bySess) for (let i = 0; i < list.length; i += 200) {
      const part = list.slice(i, i + 200);
      const {error} = await sb.rpc("submit_counts", {p_session: sid, p_entries: part.map(o => ({line_id: o.line_id, qty: o.qty, client_id: o.client_id, client_ts: o.client_ts})), p_device: DEVICE});
      if (error) { if (isServerError(error)) { await markFailed(part, error.message); continue; } throw error; }
      await removeOut(part.map(o => o.client_id));
    }
    for (const o of todo.filter(o => o.kind === "excess")) {
      const {error} = await sb.rpc("add_excess", {p_session: o.session_id, p_location: o.location, p_sku: o.sku, p_qty: o.qty, p_barcode: o.barcode || null, p_description: o.description || null, p_uom: o.uom || null,
        p_batch: o.batch || null, p_mfg_date: o.mfg_date || null, p_expiry_date: o.expiry_date || null, p_expected_location: o.expected_location || null, p_remarks: o.remarks || null, p_client_id: o.client_id, p_device: DEVICE});
      if (error) { if (isServerError(error)) { await markFailed([o], error.message); continue; } throw error; }
      await removeOut([o.client_id]);
    }
    const qcBy = new Map();
    todo.filter(o => o.kind === "qc").sort((a, b) => a.seq - b.seq).forEach(o => { if (!qcBy.has(o.order_id)) qcBy.set(o.order_id, []); qcBy.get(o.order_id).push(o); });
    for (const [oid, list] of qcBy) for (let i = 0; i < list.length; i += 200) {
      const part = list.slice(i, i + 200);
      const {error} = await sb.rpc("qc_submit", {p_order: oid, p_entries: part.map(o => ({...o.entry, client_id: o.client_id})), p_device: DEVICE});
      if (error) { if (isServerError(error)) { await markFailed(list.slice(i), error.message); break; } throw error; }
      await removeOut(part.map(o => o.client_id));
    }
    if (qcBy.size && window.CCQC) window.CCQC.onSynced();
    M.lastSyncErr = null;
  } catch (e) { M.lastSyncErr = e; }
  finally { M.syncing = false; renderSync(); }
}
async function flushNow() { for (let i = 0; i < 100 && M.syncing; i++) await new Promise(r => setTimeout(r, 100)); await flush(); }
async function removeOut(ids) { const set = new Set(ids); M.outbox = M.outbox.filter(o => !set.has(o.client_id)); await idb.outDel(ids).catch(() => {}); }
async function markFailed(list, msg) { for (const o of list) { o.failed = true; o.error = msg; await idb.outPut(o).catch(() => {}); } toast(`Some entries could not be saved: ${msg}`, true); if (window.CCQC) window.CCQC.onSynced(); }
function showFailed() {
  const f = M.outbox.filter(o => o.failed); if (!f.length) return;
  const d = document.createElement("div");
  d.innerHTML = `<div class="banner bad" style="flex-direction:column;align-items:stretch"><strong>${f.length} entr${f.length === 1 ? "y was" : "ies were"} rejected by the server</strong><span class="small">${esc(f[0].error || "")}</span><span class="small">Tell your supervisor. These stay on this device until you discard them.</span><div class="row"><button class="btn sm" data-act="retry-failed">Try again</button><button class="btn sm danger" data-act="discard-failed">Discard</button></div></div>`;
  $(".wrap")?.prepend(d.firstChild);
}
window.addEventListener("online", () => { renderSync(); flush(); pull(); });
window.addEventListener("offline", renderSync);
setInterval(flush, 5000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) { flush(); pull(); } });

/* ---------- camera scanning ---------- */
function dispatchScan(v) { if (!v) return; if (M.mode === "qc" && window.CCQC) window.CCQC.scan(v); else handleScan(v); }
function nativeScanner() { const c = window.Capacitor; return c && c.isNativePlatform && c.isNativePlatform() && c.Plugins && c.Plugins.BarcodeScanner ? c.Plugins.BarcodeScanner : null; }
const cameraAvailable = () => !!nativeScanner() || "BarcodeDetector" in window;
async function cameraScan() {
  const BS = nativeScanner();
  if (BS) {
    try {
      if (BS.isGoogleBarcodeScannerModuleAvailable) { const a = await BS.isGoogleBarcodeScannerModuleAvailable(); if (!a.available) { await BS.installGoogleBarcodeScannerModule(); toast("Installing the scanner. Try again in a moment."); return; } }
      const {barcodes} = await BS.scan();
      if (barcodes && barcodes[0]) dispatchScan(String(barcodes[0].rawValue || barcodes[0].displayValue || "").trim());
    } catch (e) { if (!/cancel/i.test(e && e.message || "")) toast("Camera scan failed. Type the code instead.", true); }
    return;
  }
  // Browser fallback (Chrome on Android)
  const ov = document.createElement("div");
  ov.style.cssText = "position:fixed;inset:0;background:#000;z-index:60;display:flex;flex-direction:column";
  ov.innerHTML = `<video playsinline muted style="flex:1;object-fit:cover"></video><button class="btn" style="margin:12px">Cancel</button>`;
  document.body.appendChild(ov);
  const video = ov.querySelector("video"); let stream, stop = false;
  const close = () => { stop = true; stream && stream.getTracks().forEach(t => t.stop()); ov.remove(); };
  ov.querySelector("button").onclick = close;
  try {
    stream = await navigator.mediaDevices.getUserMedia({video: {facingMode: "environment"}});
    video.srcObject = stream; await video.play();
    const det = new BarcodeDetector();
    const loop = async () => { if (stop) return; try { const r = await det.detect(video); if (r[0]) { close(); dispatchScan(r[0].rawValue.trim()); return; } } catch {} requestAnimationFrame(loop); };
    loop();
  } catch { close(); toast("Camera not available. Type the code instead.", true); }
}

/* ---------- clicks ---------- */
const armed = new Set();
function confirmTwice(btn, key, label) { if (armed.has(key)) { armed.delete(key); return true; } const o = btn.textContent; btn.textContent = label; armed.add(key); setTimeout(() => { armed.delete(key); if (btn.isConnected) btn.textContent = o; }, 3500); return false; }
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  if (b.tagName === "A") e.preventDefault();
  const a = b.dataset.act;
  switch (a) {
    case "signout": if (M.outbox.length && !confirmTwice(b, "so", `${M.outbox.length} not synced. Sign out anyway?`)) break; await sb.auth.signOut(); break;
    case "retry": boot(); break;
    case "reset-conn": window.CC_resetConnection(); break;
    case "to-signup": renderLogin("up"); break;
    case "to-signin": renderLogin("in"); break;
    case "reload-sessions": renderSessions(); break;
    case "mode": M.mode = b.dataset.m === "qc" ? "qc" : "count"; ls.set("cc-mode", M.mode); renderSessions(); break;
    case "open": openSession(b.dataset.id).then(showFailed); break;
    case "back": renderSessions(); break;
    case "goto": newVisit(+b.dataset.li, false); renderStage(); announce(); break;
    case "skip": { const nx = nextLoc(M.cur); if (nx >= 0 && nx !== M.cur) { newVisit(nx, false); renderStage(); } else toast("No other locations left."); break; }
    case "leave": { const nx = nextLoc(M.cur); newVisit(nx >= 0 ? nx : M.cur, false); toast("Location left open. It stays in the list."); renderStage(); announce(); break; }
    case "manual-confirm": M.phase = "count"; M.err = null; renderStage(); announce(); break;
    case "switch-loc": newVisit(+b.dataset.li, true); renderStage(); announce(); break;
    case "new-loc": { const v = b.dataset.v; M.extraLocs.push(v); rebuild(); newVisit(M.locIdx.get(v.toUpperCase()), true); M.err = {kind: "info", title: `Counting new location ${esc(v)}`, body: "It isn't in the stock file, so everything you scan here is recorded as excess."}; renderStage(); announce(); break; }
    case "pick-line": case "pick-batch": pickLine(+b.dataset.id); break;
    case "batch-other": { const l = lineOf(M.item.ids[0]); openExcess({sku: l.sku, barcode: l.barcode, description: l.description, uom: l.uom, reason: "This batch isn't expected here."}); break; }
    case "edit": M.item = {id: +b.dataset.id}; M.replace = true; M.err = null; M.phase = "qty"; renderStage(); break;
    case "save-qty": saveQty(); break;
    case "cancel-item": M.phase = "count"; M.item = null; M.err = null; renderStage(); break;
    case "dismiss": M.err = null; renderStage(); break;
    case "complete": completeLoc(false); break;
    case "complete-force": completeLoc(true); break;
    case "empty": if (M.visit.order.length) { toast("You've already scanned items here. Use Location complete.", true); break; } if (confirmTwice(b, "empty" + M.cur, "Tap again: nothing here")) completeLoc(true); break;
    case "excess-new": openExcess({barcode: b.dataset.v, reason: "This barcode isn't in the stock file."}); break;
    case "excess-from": { const l = lineOf(+b.dataset.id); openExcess({sku: l.sku, barcode: l.barcode, description: l.description, uom: l.uom, expected: b.dataset.exp, reason: `The system has this product at ${esc(b.dataset.exp)}.`}); break; }
    case "excess-manual": openExcess({reason: "For an item without a readable barcode."}); break;
    case "save-excess": saveExcess(); break;
    case "camera": cameraScan(); break;
    case "retry-failed": for (const o of M.outbox) if (o.failed) { o.failed = false; o.error = null; await idb.outPut(o).catch(() => {}); } b.closest(".banner").remove(); flush().then(() => { if (M.mode === "qc" && window.CCQC) window.CCQC.render(); }); break;
    case "discard-failed": if (confirmTwice(b, "disc", "Tap again to discard")) { await removeOut(M.outbox.filter(o => o.failed).map(o => o.client_id)); b.closest(".banner").remove(); renderSync(); if (M.mode === "qc" && window.CCQC) window.CCQC.render(); } break;
  }
});

if (CONFIG.DEMO) {   // hooks for the preview page's test barcodes
  window.__demoScan = v => dispatchScan(v);
  window.__demoState = () => ({phase: M.phase, loc: M.sess && M.locs[M.cur] ? M.locs[M.cur].loc : null, rack: M.sess && M.locs[M.cur] ? M.locs[M.cur].rack : null, session: M.sess ? M.sess.id : null});
}
if (window.CCQC) window.CCQC.init({sb, M, esc, fmt, uuid, ls, idb, toast, vibrate, isOnline, isServerError, DEVICE, topbar, modeTabs, leaveSession, queue, flushNow, confirmTwice, cameraAvailable, CAM_ICON});
if ("serviceWorker" in navigator && platform === "web" && !CONFIG.DEMO) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
})();
