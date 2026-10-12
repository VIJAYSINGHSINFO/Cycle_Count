/* Stowra test link: one page that runs either app and keeps the demo data in a shared test database,
   so a count uploaded on the laptop can be counted on a phone. */
(async () => {
"use strict";
const P = JSON.parse(document.getElementById("payload").textContent);
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ls = {get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} }, del: k => { try { localStorage.removeItem(k); } catch {} }};
const addStyle = css => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
const runScript = code => { const s = document.createElement("script"); s.textContent = code; document.body.appendChild(s); };
const loadScript = src => new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; setTimeout(res, 12000); document.head.appendChild(s); });
const COLLS = ["cc_users", "cc_sessions", "cc_recon", "cc_lines", "cc_events", "cc_qc_orders", "cc_qc_lines", "cc_qc_events", "cc_photos", "cc_org", "cc_sites", "cc_docks", "cc_gate_visits", "cc_gate_events", "cc_ck_templates", "cc_ck_runs", "cc_clients", "cc_simports", "cc_items", "cc_locs", "cc_inv", "cc_smoves"];
// Stock is large: items, locations and stock lines are packed many to a document (one field per row).
const PACKED = [["cc_items", "items"], ["cc_locs", "locations"], ["cc_inv", "inventory"]];
const bucket = id => { let h = 0; for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0; return "b" + (h % 32); };
const fkey = id => "r" + String(id).replace(/-/g, "_"), fid = f => f.slice(1).replace(/_/g, "-");
const canon = v => JSON.stringify(v, (k, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.keys(x).sort().reduce((o, key) => (o[key] = x[key], o), {}) : x);
const clone = o => JSON.parse(JSON.stringify(o));

addStyle(P.theme + P.shell);
let db = null;
try { db = window.claude && typeof window.claude.use === "function" ? await window.claude.use("db") : null; } catch { db = null; }
const choice = ls.get("cc-test-app");
if (choice === "desktop" || choice === "mobile") start(choice); else chooser();

function chooser() {
  const phone = matchMedia("(max-width: 700px)").matches;
  $("#root").innerHTML = `<div class="auth"><div class="panel" style="max-width:480px">
    <div class="brand-big">${P.mark}<span>stowra<small>Test link</small></span></div>
    <p>This test link shares one database between your laptop and your phone.</p>
    <ol class="steps"><li><strong>On your laptop</strong>, open the console, create a count, upload your stock file and click <em>Open for counting</em>.</li>
      <li><strong>On your phone</strong>, open this same link in the Claude app or your phone's browser (signed in to Claude) and choose the mobile app.</li></ol>
    <div class="choose">
      <button class="btn ${phone ? "" : "go"}" data-app="desktop"><strong>Desktop console</strong><span>Upload, review, reconcile</span></button>
      <button class="btn ${phone ? "go" : ""}" data-app="mobile"><strong>Mobile app</strong><span>Count with the phone</span></button>
    </div>
    <p class="small muted" style="margin-top:14px">${db ? "Shared test database connected." : "The shared test database isn't available in this view, so data stays in this browser tab only."} Everyone signs in automatically: the console as Sara (administrator), the phone as Ali (counter).</p>
    ${db ? `<p class="small"><a href="#" id="reset">Reset the test database</a> <span class="muted">(deletes everything and reloads the sample data)</span></p>` : ""}
  </div></div>`;
  document.querySelectorAll("[data-app]").forEach(b => b.onclick = () => { ls.set("cc-test-app", b.dataset.app); location.reload(); });
  const r = $("#reset");
  if (r) r.onclick = async e => {
    e.preventDefault();
    if (r.dataset.armed !== "1") { r.dataset.armed = "1"; r.textContent = "Click again to delete all test data"; return; }
    r.textContent = "Deleting…";
    try { for (const c of COLLS) { const s = await db.collection(c).get(); for (const d of s.docs) await db.doc(`${c}/${d.id}`).delete(); } location.reload(); }
    catch (err) { r.textContent = "Couldn't reset. Try again."; }
  };
}

async function loadRemote() {
  const out = {};
  for (const c of COLLS) { $("#root").innerHTML = `<div class="loading">Loading test data (${esc(c.replace("cc_", ""))})…</div>`; out[c] = (await db.collection(c).get()).docs.map(d => ({id: d.id, data: clone(d.data())})); }
  return out;
}

async function start(app) {
  $("#root").innerHTML = `<div class="loading">Connecting to the test database…</div>`;
  let remote = null;
  if (db) { try { remote = await loadRemote(); } catch { remote = null; } }
  window.CC_APP = app;
  window.CONFIG = {DEMO: true, DEMO_BANNER: false, SUPABASE_URL: "", SUPABASE_ANON_KEY: ""};
  const sent = new Map(), known = new Set(), linesSent = new Map();
  const hasData = remote && remote.cc_users.length;
  if (hasData) {
    const store = {users: [], sessions: [], lines: [], events: [], reconciliations: [], presence: {}, id: 0, evId: 0, clock: Date.now(), channels: [], sessionFor: {}};
    const put = (arr, coll) => remote[coll].forEach(d => { arr.push(d.data); sent.set(`${coll}/${d.id}`, canon(d.data)); known.add(`${coll}/${d.id}`); });
    put(store.users, "cc_users"); put(store.sessions, "cc_sessions"); put(store.reconciliations, "cc_recon");
    if (remote.cc_qc_orders.length) { store.qcOrders = []; store.qcLines = []; store.qcEvents = []; put(store.qcOrders, "cc_qc_orders"); put(store.qcLines, "cc_qc_lines"); }
    store.photoDocs = []; put(store.photoDocs, "cc_photos");
    if (remote.cc_sites.length) { store.org = []; store.sites = []; store.docks = []; store.gateVisits = []; store.gateEvents = [];
      put(store.org, "cc_org"); put(store.sites, "cc_sites"); put(store.docks, "cc_docks"); put(store.gateVisits, "cc_gate_visits"); put(store.gateEvents, "cc_gate_events");
      if (remote.cc_ck_templates.length) { store.ckTemplates = []; store.ckRuns = []; put(store.ckTemplates, "cc_ck_templates"); put(store.ckRuns, "cc_ck_runs"); }
      remote.cc_users.forEach(d => { if (!d.data.job) d.data.job = "operator"; }); }
    if (remote.cc_clients.length) {
      store.clients = []; store.stockImports = []; store.stockImportRows = []; store.stockMoves = []; store.stockVer = 1;
      put(store.clients, "cc_clients"); put(store.stockImports, "cc_simports");
      for (const [coll, key] of PACKED) { store[key] = []; remote[coll].forEach(d => { known.add(`${coll}/${d.id}`); Object.entries(d.data).forEach(([f, v]) => { if (f[0] !== "r" || v == null) return; store[key].push(v); sent.set(`${coll}/${d.id}#${f}`, canon(v)); }); }); }
      remote.cc_smoves.forEach(d => { known.add(`cc_smoves/${d.id}`); Object.entries(d.data).forEach(([f, v]) => { if (f[0] !== "e" || v == null) return; store.stockMoves.push(v); sent.set(`cc_smoves/${d.id}#${f}`, canon(v)); }); });
    }
    for (const [coll, arr, pre] of [["cc_lines", store.lines, "l"], ["cc_events", store.events, "e"], ["cc_qc_events", store.qcEvents, "e"]]) if (arr) remote[coll].forEach(d => {
      known.add(`${coll}/${d.id}`);
      Object.entries(d.data).forEach(([f, v]) => { if (f[0] !== pre || v == null) return; arr.push(v); sent.set(`${coll}/${d.id}#${f}`, canon(v)); if (pre === "l") linesSent.set(v.id, v.updated_at); });
    });
    store.id = store.lines.reduce((m, l) => l.id < 1e9 ? Math.max(m, l.id) : m, 0);
    store.lines.forEach(l => { const t = Date.parse(l.updated_at); if (t > store.clock) store.clock = t; });
    window.__CC_DEMO_STORE = store;
  }
  if (app === "desktop" && !window.XLSX) { try { await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"); } catch {} }
  $("#root").innerHTML = `<div class="loading">Loading…</div>`;
  addStyle(P[app].css);
  runScript(P.demo);
  const S = window.__CC_DEMO_API.store;
  S.evPrefix = "d" + Math.random().toString(36).slice(2, 7) + "-";
  S.evId = 0;
  if (app === "mobile") { let n = 0; const base = 1e9 + (Date.now() % 1e7) * 50; S.nextExcessId = () => base + (n++); }
  if (P[app].lib) runScript(P[app].lib);
  runScript(P[app].js);
  addFloating(app);
  if (db) startSync(S, sent, known, linesSent);
}

function addFloating(app) {
  const w = document.createElement("div"); w.className = "tl-float " + app;
  w.innerHTML = `<span id="tl-sync" class="tl-pill">${db ? "Test database" : "This tab only"}</span><button class="tl-pill" id="tl-switch">Switch app</button>`;
  document.body.appendChild(w);
  $("#tl-switch").onclick = () => { ls.del("cc-test-app"); location.reload(); };
}
function syncLabel(t, bad) { const e = $("#tl-sync"); if (e) { e.textContent = t; e.classList.toggle("bad", !!bad); } }

function startSync(S, sent, known, linesSent) {
  let busy = false, evCount = 0, lastLen = -1;
  const lineDoc = l => `cc_lines/${l.session_id}__${l.id >= 1e9 ? "x" + Math.floor((l.id - 1e9) / 250) : "c" + Math.floor(l.id / 250)}`;
  const items = () => [["cc_users", S.users], ["cc_sessions", S.sessions], ["cc_recon", S.reconciliations], ["cc_qc_orders", S.qcOrders || []], ["cc_qc_lines", S.qcLines || []], ["cc_photos", S.photoDocs || (S.photoDocs = [])], ["cc_org", S.org || []], ["cc_sites", S.sites || []], ["cc_docks", S.docks || []], ["cc_gate_visits", S.gateVisits || []], ["cc_gate_events", S.gateEvents || []], ["cc_ck_templates", S.ckTemplates || []], ["cc_ck_runs", S.ckRuns || []], ["cc_clients", S.clients || []], ["cc_simports", S.stockImports || []]];
  let qcCount = 0, smCount = 0, stockVerSent = -1;
  async function out() {
    if (busy) return; busy = true;
    try {
      const docs = [], fields = new Map(), seen = new Set();
      const addField = (path, f, v, key) => { if (!fields.has(path)) fields.set(path, {}); fields.get(path)[f] = {v, key}; };
      for (const [coll, arr] of items()) for (const o of arr) { const p = `${coll}/${o.id}`, j = canon(o); seen.add(p); if (sent.get(p) !== j) docs.push({p, data: clone(o), j}); }
      const scanAll = S.lines.length !== lastLen; lastLen = S.lines.length;
      for (const l of S.lines) {
        const p = lineDoc(l), k = `${p}#l${l.id}`;
        if (scanAll) seen.add(k);
        if (linesSent.get(l.id) === l.updated_at && sent.has(k)) continue;
        const j = canon(l); if (sent.get(k) !== j) addField(p, "l" + l.id, clone(l), k);
      }
      for (const e of S.events) {
        if (!e._c) e._c = `cc_events/${S.evPrefix}${Math.floor(evCount++ / 300)}`;
        const k = `${e._c}#e${e.id}`; if (!sent.has(k)) addField(e._c, "e" + e.id, clone(e), k);
      }
      if (S.stockVer !== stockVerSent) {   // stock changed: compare every packed row
        stockVerSent = S.stockVer;
        for (const [coll, key] of PACKED) {
          const live = new Set();
          for (const o of S[key] || []) { const p = `${coll}/${bucket(o.id)}`, k = `${p}#${fkey(o.id)}`; live.add(k); const j = canon(o); if (sent.get(k) !== j) addField(p, fkey(o.id), clone(o), k); }
          for (const k of sent.keys()) if (k.startsWith(coll + "/") && k.includes("#") && !live.has(k)) { const [p, f] = k.split("#"); addField(p, f, null, k); }
        }
      }
      for (const e of S.stockMoves || []) {
        if (!e._c) e._c = `cc_smoves/${S.evPrefix}${Math.floor(smCount++ / 300)}`;
        const k = `${e._c}#e${String(e.id).replace(/-/g, "_")}`; if (!sent.has(k)) addField(e._c, `e${String(e.id).replace(/-/g, "_")}`, clone(e), k);
      }
      for (const e of S.qcEvents || []) {
        if (!e._c) e._c = `cc_qc_events/${S.evPrefix}${Math.floor(qcCount++ / 300)}`;
        const k = `${e._c}#e${e.id}`; if (!sent.has(k)) addField(e._c, "e" + e.id, clone(e), k);
      }
      for (const k of [...sent.keys()]) {
        if (k.startsWith("cc_events/") || k.startsWith("cc_qc_events/") || k.startsWith("cc_smoves/") || PACKED.some(([c]) => k.startsWith(c + "/"))) continue;
        if (k.includes("#")) { if (scanAll && !seen.has(k)) { const [p, f] = k.split("#"); addField(p, f, null, k); } }
        else if (!seen.has(k)) docs.push({p: k, del: true});
      }
      if (!docs.length && !fields.size) { syncLabel("Saved"); return; }
      syncLabel("Saving…");
      for (const d of docs) {
        if (d.del) { await db.doc(d.p).delete(); sent.delete(d.p); known.delete(d.p); }
        else { await db.doc(d.p).set(d.data); sent.set(d.p, d.j); known.add(d.p); }
      }
      for (const [p, fs] of fields) {
        const patch = {}; Object.entries(fs).forEach(([f, x]) => patch[f] = x.v);
        if (known.has(p)) { try { await db.doc(p).update(patch); } catch (e) { if (e && e.code === "invalid_argument") await db.doc(p).set(patch); else throw e; } }
        else await db.doc(p).set(patch);
        known.add(p);
        Object.values(fs).forEach(x => { if (x.v == null) sent.delete(x.key); else { sent.set(x.key, canon(x.v)); if (x.v.updated_at && x.key.includes("#l")) linesSent.set(x.v.id, x.v.updated_at); } });
      }
      syncLabel("Saved");
    } catch (e) {
      syncLabel(e && e.code === "quota_exceeded" ? "Test database full" : e && e.code === "invalid_argument" ? "View only: not saved" : "Not saved, retrying", true);
    } finally { busy = false; }
  }
  setInterval(out, 800); out();

  // changes from the other device
  const replaceIn = (arr, id, remote) => { const i = arr.findIndex(x => x.id === id); if (remote == null) { if (i >= 0) arr.splice(i, 1); } else if (i >= 0) { const o = arr[i]; Object.keys(o).forEach(k => delete o[k]); Object.assign(o, remote); } else arr.push(remote); };
  const bump = t => { const v = Date.parse(t || ""); if (v > S.clock) S.clock = v; };
  for (const [coll, get] of [["cc_users", () => S.users], ["cc_sessions", () => S.sessions], ["cc_recon", () => S.reconciliations], ["cc_qc_orders", () => S.qcOrders], ["cc_qc_lines", () => S.qcLines], ["cc_photos", () => S.photoDocs || (S.photoDocs = [])], ["cc_org", () => S.org], ["cc_sites", () => S.sites], ["cc_docks", () => S.docks], ["cc_gate_visits", () => S.gateVisits], ["cc_gate_events", () => S.gateEvents], ["cc_ck_templates", () => S.ckTemplates], ["cc_ck_runs", () => S.ckRuns], ["cc_clients", () => S.clients || (S.clients = [])], ["cc_simports", () => S.stockImports || (S.stockImports = [])]]) {
    db.collection(coll).onSnapshot(snap => {
      const ids = new Set();
      snap.docs.forEach(d => { const p = `${coll}/${d.id}`; ids.add(p); known.add(p); const r = clone(d.data()), rj = canon(r); if (rj === sent.get(p)) return;
        const local = get().find(x => String(x.id) === d.id); if (local && canon(local) !== sent.get(p)) return;
        replaceIn(get(), r.id, r); sent.set(p, rj); });
      for (const k of [...sent.keys()]) if (k.startsWith(coll + "/") && !ids.has(k)) { const id = k.slice(coll.length + 1); const local = get().find(x => String(x.id) === id); if (!local || canon(local) === sent.get(k)) { replaceIn(get(), local ? local.id : id, null); sent.delete(k); } }
    }, () => syncLabel("Live updates stopped", true));
  }
  db.collection("cc_lines").onSnapshot(snap => {
    const byId = new Map(S.lines.map(l => [l.id, l]));
    snap.docs.forEach(d => { const p = `cc_lines/${d.id}`; known.add(p); const data = d.data();
      for (const f in data) { if (f[0] !== "l") continue; const k = `${p}#${f}`, r = data[f] == null ? null : clone(data[f]), rj = r == null ? undefined : canon(r);
        if (rj === sent.get(k)) continue;
        const id = +f.slice(1), local = byId.get(id);
        if (local && canon(local) !== sent.get(k)) continue;
        if (r == null) { if (local) S.lines.splice(S.lines.indexOf(local), 1); sent.delete(k); linesSent.delete(id); continue; }
        if (local) { Object.keys(local).forEach(x => delete local[x]); Object.assign(local, r); } else { S.lines.push(r); if (r.id < 1e9 && r.id > S.id) S.id = r.id; }
        sent.set(k, rj); linesSent.set(id, r.updated_at); bump(r.updated_at); }
    });
    lastLen = S.lines.length;
  }, () => syncLabel("Live updates stopped", true));
  // Packed snapshots are applied once things go quiet (a big stock file arrives as many writes).
  const pendingSnap = new Map(); let snapT = null;
  const applyLater = () => { clearTimeout(snapT); snapT = setTimeout(() => { if (busy) return applyLater(); for (const [coll, snap] of pendingSnap) applyPacked(coll, snap); pendingSnap.clear(); }, 1200); };
  for (const [coll] of PACKED) db.collection(coll).onSnapshot(snap => { pendingSnap.set(coll, snap); applyLater(); }, () => syncLabel("Live updates stopped", true));
  function applyPacked(coll, snap) {
    const key = PACKED.find(x => x[0] === coll)[1];
    const arr = S[key] || (S[key] = []), byId = new Map(arr.map(o => [String(o.id), o])); let changed = false;
    snap.docs.forEach(d => { const p = `${coll}/${d.id}`; known.add(p); const data = d.data();
      for (const f in data) { if (f[0] !== "r") continue; const k = `${p}#${f}`, r = data[f] == null ? null : clone(data[f]), rj = r == null ? undefined : canon(r);
        if (rj === sent.get(k)) continue;
        const local = byId.get(fid(f));
        if (local && sent.has(k) && canon(local) !== sent.get(k)) continue;   // changed here too; ours wins and is sent
        if (r == null) { if (local) { arr.splice(arr.indexOf(local), 1); byId.delete(fid(f)); } sent.delete(k); changed = true; continue; }
        if (local) { Object.keys(local).forEach(x => delete local[x]); Object.assign(local, r); } else { arr.push(r); byId.set(String(r.id), r); }
        sent.set(k, rj); changed = true; }
    });
    if (changed) S.stockVer = (S.stockVer || 0) + 1;
  }
  db.collection("cc_smoves").onSnapshot(snap => {
    const arr = S.stockMoves || (S.stockMoves = []), have = new Set(arr.map(e => String(e.id)));
    snap.docs.forEach(d => { const p = `cc_smoves/${d.id}`; known.add(p); const data = d.data();
      for (const f in data) { if (f[0] !== "e" || data[f] == null) continue; const k = `${p}#${f}`; if (sent.has(k)) continue; const r = clone(data[f]); if (!have.has(String(r.id))) { arr.push(r); have.add(String(r.id)); } sent.set(k, canon(r)); } });
  });
  for (const [coll, get] of [["cc_events", () => S.events], ["cc_qc_events", () => S.qcEvents]]) db.collection(coll).onSnapshot(snap => {
    const arr = get(), have = new Set(arr.map(e => String(e.id)));
    snap.docs.forEach(d => { const p = `${coll}/${d.id}`; known.add(p); const data = d.data();
      for (const f in data) { if (f[0] !== "e" || data[f] == null) continue; const k = `${p}#${f}`; if (sent.has(k)) continue; const r = clone(data[f]); if (!have.has(String(r.id))) { arr.push(r); have.add(String(r.id)); } sent.set(k, canon(r)); } });
  });
}
})();
