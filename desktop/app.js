/* Stowra console (desktop, full access) */
(() => {
"use strict";
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const fmt = n => n == null || n === "" || isNaN(n) ? "–" : (Math.round(Number(n) * 1000) / 1000).toLocaleString();
const money = n => n == null || isNaN(n) ? "–" : (Number(n) < 0 ? "−" : "") + Math.abs(Number(n)).toLocaleString(undefined, {minimumFractionDigits: 2, maximumFractionDigits: 2});
const dt = s => s ? new Date(s).toLocaleString(undefined, {dateStyle: "medium", timeStyle: "short"}) : "–";
const d8 = s => s ? new Date(s).toLocaleDateString(undefined, {dateStyle: "medium"}) : "–";
const COLL = new Intl.Collator(undefined, {numeric: true, sensitivity: "base"});
const STATUS_LABEL = {match: "Match", within: "Within tolerance", out: "Out of tolerance", accepted: "Accepted", uncounted: "Not counted", recount: "Recount"};
const MARK = `<svg class="mark" viewBox="-6 -6 76 76" aria-hidden="true"><path d="M0 0H64V16.7H16.7V32H0Z" fill="#13233F"/><path d="M64 64H0V47.3H47.3V32H64Z" fill="#1FA38A"/><rect x="23.4" y="23.4" width="17.2" height="17.2" rx="2.6" fill="#F2A33A"/></svg>`, MARK_NAVY = `<svg class="mark" viewBox="-6 -6 76 76" aria-hidden="true"><path d="M0 0H64V16.7H16.7V32H0Z" fill="#F5F3EE"/><path d="M64 64H0V47.3H47.3V32H64Z" fill="#1FA38A"/><rect x="23.4" y="23.4" width="17.2" height="17.2" rx="2.6" fill="#F2A33A"/></svg>`;
const SESSION_LABEL = {draft: "Draft", open: "Counting", closed: "Closed", reconciled: "Reconciled"};

if (!CONFIG.DEMO && CONFIG.isPlaceholder()) { window.CC_showSetup(); return; }
const sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY, {auth: {persistSession: true, autoRefreshToken: true}});
const S = {me: null, timer: null};

/* ---------- helpers ---------- */
let tT;
function toast(msg, bad) { const t = $("#toast"); t.textContent = msg; t.className = "toast show" + (bad ? " bad" : ""); clearTimeout(tT); tT = setTimeout(() => t.className = "toast", bad ? 5000 : 2400); }
async function q(p) { const {data, error, count} = await p; if (error) throw error; return count != null ? {data, count} : data; }
function fail(e) { console.error(e); toast(e && e.message ? e.message : "Something went wrong. Try again.", true); }
async function run(fn, ok) { try { const r = await fn(); if (ok) toast(ok); return r ?? true; } catch (e) { fail(e); return false; } }
const route = () => (location.hash.replace(/^#\/?/, "") || "counts").split("/");
const go = h => { location.hash = "#/" + h; };
function stopTimer() { clearInterval(S.timer); S.timer = null; }
const armed = new Set();
function confirmTwice(btn, key, label) { if (armed.has(key)) { armed.delete(key); return true; } const o = btn.textContent; btn.textContent = label; armed.add(key); setTimeout(() => { armed.delete(key); if (btn.isConnected) btn.textContent = o; }, 4000); return false; }

/* ---------- auth ---------- */
async function boot() {
  const {data: {session}} = await sb.auth.getSession();
  S.uid = session ? session.user.id : null;
  if (!session) return renderLogin();
  try { const rows = await q(sb.rpc("whoami")); S.me = rows && rows[0]; } catch (e) { S.me = null; }
  if (!S.me || !S.me.active) return renderMessage("Waiting for approval", `Your account (${esc(session.user.email)}) was created. An administrator needs to approve it and assign a role before you can sign in.`);
  if (S.me.role === "counter") return renderMessage("Use the mobile app", "This console is for supervisors and administrators. Operators count stock and check orders in the Stowra mobile app.");
  renderShell();
}
sb.auth.onAuthStateChange((ev, session) => {   // react only when the signed-in user actually changes
  const uid = session && session.user ? session.user.id : null;
  if (uid !== S.uid) { S.uid = uid; setTimeout(boot, 0); }
});
function renderMessage(title, body) {
  $("#root").innerHTML = `<div class="auth"><div class="panel"><div class="brand-big">${MARK}<span>stowra<small>Warehouse console</small></span></div><h2>${esc(title)}</h2><p>${body}</p><button class="btn" data-act="signout">Sign out</button></div></div>`;
}
function renderLogin(mode = "in") {
  $("#root").innerHTML = `<div class="auth"><form class="panel" id="authf">
    <div class="brand-big">${MARK}<span>stowra<small>Warehouse console</small></span></div>
    <h2 style="margin-bottom:14px">${mode === "in" ? "Sign in" : "Create an account"}</h2>
    ${mode === "up" ? `<label class="field" style="margin-bottom:10px">Full name<input name="full_name" required autocomplete="name"></label>` : ""}
    <label class="field" style="margin-bottom:10px">Email<input name="email" type="email" required autocomplete="email"></label>
    <label class="field" style="margin-bottom:16px">Password<input name="password" type="password" required minlength="8" autocomplete="${mode === "in" ? "current-password" : "new-password"}"></label>
    <button class="btn primary" style="width:100%" type="submit">${mode === "in" ? "Sign in" : "Create account"}</button>
    <p class="small muted" style="margin:14px 0 0">${mode === "in" ? `New here? <a href="#" data-act="to-signup">Create an account</a>. An administrator approves new accounts.` : `Already have an account? <a href="#" data-act="to-signin">Sign in</a>.`}</p>
    ${CONFIG.FROM_DEVICE ? `<p class="small muted" style="margin:8px 0 0"><a href="#" data-act="reset-conn">Change database connection</a></p>` : ""}
  </form></div>`;
  const f = $("#authf"), el = n => f.elements.namedItem(n);
  f.onsubmit = async e => {
    e.preventDefault();
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true;
    try {
      if (mode === "in") { const {error} = await sb.auth.signInWithPassword({email: el("email").value.trim(), password: el("password").value}); if (error) throw error; }
      else {
        const {data, error} = await sb.auth.signUp({email: el("email").value.trim(), password: el("password").value, options: {data: {full_name: el("full_name").value.trim()}}});
        if (error) throw error;
        if (!data.session) renderMessage("Check your email", "Confirm your email address using the link we sent, then sign in. An administrator will approve your account.");
      }
    } catch (err) { fail(err); btn.disabled = false; }
  };
}

/* ---------- shell ---------- */
function renderShell() {
  $("#root").innerHTML = `<div class="shell">
    <nav class="side" aria-label="Main">
      <div class="brand">${MARK_NAVY}<span class="wordmark">stowra</span></div>
      <a href="#/counts" data-nav="counts">Counts</a>
      <a href="#/history" data-nav="history">Reconciliation history</a>
      <a href="#/items" data-nav="items">Item history</a>
      <a href="#/qc" data-nav="qc">Order QC</a>
      <a href="#/labels" data-nav="labels">Barcode labels</a>
      ${S.me.role === "admin" ? `<a href="#/users" data-nav="users">Users</a>` : ""}
      <div class="me">${esc(S.me.full_name)}<br><span style="opacity:.7">${S.me.role === "admin" ? "Administrator" : "Supervisor"}</span><br><button data-act="signout">Sign out</button></div>
    </nav>
    <main class="main" id="main"></main></div>`;
  onRoute();
}
window.addEventListener("hashchange", () => { if ($("#main")) onRoute(); });
function onRoute() {
  stopTimer();
  const [page, id, tab] = route();
  $$(".side a").forEach(a => a.setAttribute("aria-current", a.dataset.nav === page ? "page" : "false"));
  const m = $("#main"); m.innerHTML = `<div class="loading">Loading…</div>`;
  ({counts: pageCounts, count: () => pageCount(id, tab || "overview"), history: pageHistory, items: pageItems, labels: () => window.CCLabels.page($("#main"), {sb, q, toast, parseDelimited}), qc: () => window.CCQc.page($("#main"), qcCtx(), id), users: pageUsers}[page] || pageCounts)();
}

const QC_CACHE = {};
function qcCtx() { return {sb, q, toast, fail, run, esc, fmt, dt, go, route, readTable, saveWorkbook, cache: QC_CACHE, me: S.me, setTimer: (fn, ms) => { stopTimer(); S.timer = setInterval(fn, ms); }}; }

/* ---------- counts list ---------- */
async function pageCounts() {
  const filter = sessionStorage.getItem("cc-filter") || "active";
  let rows;
  try {
    let qq = sb.from("session_list").select("*").order("created_at", {ascending: false}).limit(200);
    if (filter === "active") qq = qq.in("status", ["draft", "open", "closed"]);
    if (filter === "reconciled") qq = qq.eq("status", "reconciled");
    rows = await q(qq);
  } catch (e) { fail(e); rows = []; }
  $("#main").innerHTML = `
    <div class="pagehead"><div><h1>Counts</h1><p class="muted small" style="margin:4px 0 0">Create a count, upload the stock file, open it for counting, then review and reconcile.</p></div>
      <button class="btn go" data-act="new-count">New count</button></div>
    <div class="chips" style="margin-bottom:12px">${[["active", "In progress"], ["reconciled", "Reconciled"], ["all", "All"]].map(([k, l]) => `<button class="chip" aria-pressed="${filter === k}" data-act="count-filter" data-f="${k}">${l}</button>`).join("")}</div>
    ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Count</th><th>Site / zone</th><th>Status</th><th class="n">Lines</th><th>Progress</th><th class="n">Out of tol.</th><th class="n">Net value</th><th>Created</th></tr></thead><tbody>
      ${rows.map(r => { const p = r.lines_total ? Math.round(r.lines_counted / r.lines_total * 100) : 0; return `<tr style="cursor:pointer" data-act="open-count" data-id="${r.id}">
        <td><strong>${esc(r.name)}</strong></td><td>${esc([r.site, r.zone].filter(Boolean).join(" / ") || "–")}</td>
        <td><span class="pill ${r.status}">${SESSION_LABEL[r.status]}</span></td><td class="n">${fmt(r.lines_total)}</td>
        <td style="min-width:140px"><div class="progress"><b style="width:${p}%"></b></div><span class="small muted">${p}%</span></td>
        <td class="n">${r.lines_out ? `<span class="var-neg">${fmt(r.lines_out)}</span>` : "0"}</td><td class="n">${money(r.net_value)}</td>
        <td class="small">${d8(r.created_at)}<br><span class="muted">${esc(r.created_by_name || "")}</span></td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="empty"><h2>No counts here</h2><p>Create a count to get started.</p></div>`}
    <dialog id="newdlg"><form method="dialog" id="newf"><h2 style="margin-bottom:14px">New count</h2>
      <div class="grid-form">
        <label class="field">Name<input name="cname" required value="Cycle count ${esc(new Date().toLocaleDateString(undefined, {day: "numeric", month: "short", year: "numeric"}))}"></label>
        <label class="field">Site<input name="site" value="${esc(S.me.site || "")}"></label>
        <label class="field">Zone<input name="zone" placeholder="e.g. Aisle A to F"></label>
        <label class="field">Tolerance (%)<input name="tol" type="number" min="0" step="0.1" value="2"></label>
      </div>
      <label class="check" style="margin:14px 0 6px"><input type="checkbox" name="blind" checked> Blind count (counters don't see system quantity)</label>
      ${countOptions({}, false)}
      <div class="row" style="margin-top:14px"><button class="btn primary" value="ok">Create count</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div></form></dialog>`;
}
async function createCount() {
  const f = $("#newf"), el = n => f.elements.namedItem(n);
  const row = await run(() => q(sb.from("count_sessions").insert({name: el("cname").value.trim() || "Cycle count", site: el("site").value.trim(), zone: el("zone").value.trim(), tolerance_pct: Math.max(0, parseFloat(el("tol").value) || 0), blind: el("blind").checked, confirm_location: true, ...readOptions(el)}).select().single()));
  if (row) go(`count/${row.id}/upload`);
}

const REQ = [["required", "Required"], ["optional", "Optional"], ["hidden", "Don't ask"]];
function countOptions(s, locked) {
  const sel = (n, v) => `<select name="${n}" ${locked ? "disabled" : ""}>${REQ.map(([k, l]) => `<option value="${k}" ${v === k ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  return `<fieldset class="opts"><legend>Rack positions</legend>
      <label class="field">How locations group into one rack<select name="rack" ${locked ? "disabled" : ""}><option value="last_segment" ${!s.rack_grouping || s.rack_grouping === "last_segment" ? "selected" : ""}>Last part is the level (A01-01-A, A01-01-B… share rack A01-01)</option><option value="last_char" ${s.rack_grouping === "last_char" ? "selected" : ""}>Last letter is the level (W2C2M0103A, W2C2M0103B… share rack W2C2M0103)</option><option value="none" ${s.rack_grouping === "none" ? "selected" : ""}>Every location stands alone (bins)</option></select></label>
      <p class="hint">Scanning a product that belongs to another level of the same rack tells the counter to switch level instead of recording excess.</p></fieldset>
    <fieldset class="opts"><legend>Details asked for excess and misplaced stock</legend><div class="grid-form">
      <label class="field">Batch number${sel("ex_batch", s.excess_batch || "optional")}</label>
      <label class="field">Manufacturing date${sel("ex_mfg", s.excess_mfg || "optional")}</label>
      <label class="field">Expiry date${sel("ex_exp", s.excess_expiry || "required")}</label></div></fieldset>`;
}
const readOptions = el => ({rack_grouping: el("rack").value, excess_batch: el("ex_batch").value, excess_mfg: el("ex_mfg").value, excess_expiry: el("ex_exp").value});
/* ---------- one count ---------- */
const V = {filter: "out", search: "", page: 0, per: 100, sel: new Set()};
async function loadSession(id) { const r = await q(sb.from("session_list").select("*").eq("id", id).single()); return r; }
async function pageCount(id, tab) {
  let s; try { s = await loadSession(id); } catch (e) { $("#main").innerHTML = `<div class="empty"><h2>Count not found</h2><p><a href="#/counts">Back to counts</a></p></div>`; return; }
  S.cur = s;
  const tabs = [["overview", "Overview"], ["upload", "Stock file"], ["variances", "Variances"], ["activity", "Activity"], ["settings", "Settings"]];
  $("#main").innerHTML = `
    <div class="pagehead"><div><a href="#/counts" class="small">All counts</a><h1 style="margin-top:6px">${esc(s.name)}</h1>
      <span class="muted small">${esc([s.site, s.zone].filter(Boolean).join(" / ") || "No site or zone")}, tolerance ±${fmt(s.tolerance_pct)}%${s.blind ? ", blind" : ""}, excess needs ${[s.excess_batch === "required" && "batch", s.excess_mfg === "required" && "mfg date", s.excess_expiry === "required" && "expiry"].filter(Boolean).join(", ") || "no extra details"}</span></div>
      <div class="row"><span class="pill ${s.status}">${SESSION_LABEL[s.status]}</span>${statusButtons(s)}</div></div>
    <div class="tabs" role="tablist">${tabs.map(([k, l]) => `<a class="tab" role="tab" href="#/count/${id}/${k}" aria-selected="${tab === k}">${l}</a>`).join("")}</div>
    <div id="tab"></div>
    <dialog id="recdlg"><form method="dialog" id="recf"><h2 style="margin-bottom:8px">Reconcile this count</h2>
      <p class="hint">This freezes the count and stores a permanent reconciliation record. Post the adjustments in your WMS, then enter its reference here.</p>
      <label class="field" style="margin-bottom:10px">WMS adjustment reference<input name="ref" placeholder="e.g. ADJ-2026-0412"></label>
      <label class="field" style="margin-bottom:16px">Notes<textarea name="notes" rows="3" style="min-height:70px;font-family:var(--sans)"></textarea></label>
      <div class="row"><button class="btn primary" value="ok">Reconcile</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div></form></dialog>`;
  ({overview: tabOverview, upload: tabUpload, variances: tabVariances, activity: tabActivity, settings: tabSettings}[tab] || tabOverview)(s);
}
function statusButtons(s) {
  if (s.status === "draft") return `<button class="btn go" data-act="status" data-to="open" ${s.lines_total ? "" : "disabled title='Upload the stock file first'"}>Open for counting</button>`;
  if (s.status === "open") return `<button class="btn primary" data-act="status" data-to="closed">Close count</button>`;
  if (s.status === "closed") return `<button class="btn" data-act="status" data-to="open">Reopen</button><button class="btn go" data-act="reconcile">Reconcile</button>`;
  return "";
}
function tabOverview(s) {
  const p = s.lines_total ? s.lines_counted / s.lines_total * 100 : 0;
  const lp = s.locations_total ? (s.locations_total - s.locations_open) / s.locations_total * 100 : 0;
  const acc = s.lines_counted ? s.lines_within / s.lines_counted * 100 : null;
  $("#tab").innerHTML = `
    ${(() => { const n = sessionStorage.getItem("cc-upload-note"); if (!n) return ""; sessionStorage.removeItem("cc-upload-note"); return `<div class="banner ok"><span>${esc(n)}</span></div>`; })()}
    ${s.status === "draft" ? `<div class="banner warn"><span>${s.lines_total ? "The stock file is loaded. Open the count when counters are ready." : "Upload the stock file for this count."}</span>${s.lines_total ? "" : `<a class="btn sm" href="#/count/${s.id}/upload">Upload file</a>`}</div>` : ""}
    ${s.status === "closed" && s.lines_out ? `<div class="banner bad"><span>${fmt(s.lines_out)} lines are out of tolerance. Reopen and request recounts, or accept them, before reconciling.</span><a class="btn sm" href="#/count/${s.id}/variances">Review variances</a></div>` : ""}
    <div class="stats">
      <div class="stat"><div class="l">Locations done</div><div class="v">${fmt(s.locations_total - s.locations_open)}<span class="muted" style="font-size:1.1rem"> / ${fmt(s.locations_total)}</span></div><div class="progress" style="margin-top:8px"><b style="width:${lp}%"></b></div></div>
      <div class="stat"><div class="l">Lines counted</div><div class="v">${fmt(s.lines_counted)}<span class="muted" style="font-size:1.1rem"> / ${fmt(s.lines_total)}</span></div><div class="progress" style="margin-top:8px"><b style="width:${p}%"></b></div></div>
      <div class="stat"><div class="l">Accuracy (±${fmt(s.tolerance_pct)}%)</div><div class="v">${acc == null ? "–" : fmt(Math.round(acc * 10) / 10) + "%"}</div></div>
      <div class="stat"><div class="l">Out of tolerance</div><div class="v ${s.lines_out ? "var-neg" : ""}">${fmt(s.lines_out)}</div></div>
      <div class="stat"><div class="l">Recounts pending</div><div class="v">${fmt(s.lines_recount)}</div></div>
      <div class="stat"><div class="l">Excess and misplaced lines</div><div class="v">${fmt(s.found_lines)}</div></div>
      <div class="stat"><div class="l">Net unit variance</div><div class="v ${s.net_units > 0 ? "var-pos" : s.net_units < 0 ? "var-neg" : ""}">${s.net_units > 0 ? "+" : ""}${fmt(s.net_units)}</div></div>
      <div class="stat"><div class="l">Net value variance</div><div class="v ${s.net_value > 0 ? "var-pos" : s.net_value < 0 ? "var-neg" : ""}">${money(s.net_value)}</div></div>
      <div class="stat"><div class="l">Absolute value variance</div><div class="v">${money(s.abs_value)}</div></div>
    </div>
    <div class="twocol">
      <div class="panel"><h3 style="margin-bottom:8px">Details</h3><table><tbody>
        <tr><td class="muted">Stock file</td><td>${esc(s.source_file || "–")}</td></tr>
        <tr><td class="muted">Created</td><td>${dt(s.created_at)} by ${esc(s.created_by_name || "–")}</td></tr>
        <tr><td class="muted">Opened</td><td>${dt(s.opened_at)}</td></tr>
        <tr><td class="muted">Closed</td><td>${dt(s.closed_at)}${s.closed_by_name ? " by " + esc(s.closed_by_name) : ""}</td></tr></tbody></table></div>
      <div class="panel" id="recbox"><h3 style="margin-bottom:8px">Reconciliation</h3><p class="muted small">${s.status === "reconciled" ? "Loading…" : "Not reconciled yet."}</p></div>
    </div>
    <div class="row" style="margin-top:16px"><button class="btn" data-act="export">Export to Excel</button></div>`;
  if (s.status === "reconciled") q(sb.from("reconciliation_list").select("*").eq("session_id", s.id).single()).then(r => {
    $("#recbox").innerHTML = `<h3 style="margin-bottom:8px">Reconciliation</h3><table><tbody>
      <tr><td class="muted">Approved</td><td>${dt(r.approved_at)} by ${esc(r.approved_by_name || "–")}</td></tr>
      <tr><td class="muted">WMS reference</td><td><strong>${esc(r.wms_reference || "–")}</strong></td></tr>
      <tr><td class="muted">Accuracy</td><td>${fmt(r.accuracy_pct)}%</td></tr>
      <tr><td class="muted">Net / absolute value</td><td>${money(r.net_value)} / ${money(r.abs_value)}</td></tr>
      <tr><td class="muted">Notes</td><td style="white-space:normal">${esc(r.notes || "–")}</td></tr></tbody></table>`;
  }).catch(() => {});
  if (s.status === "open") S.timer = setInterval(async () => { try { const n = await loadSession(s.id); if (route()[2] === "overview" || !route()[2]) { S.cur = n; tabOverview(n); } } catch {} }, 15000);
}

/* ---------- upload ---------- */
const FIELDS = [["location", "Location", true], ["sku", "SKU", true], ["barcode", "Product barcode"], ["description", "Description"], ["system_qty", "System qty", true], ["uom", "UOM"], ["batch", "Batch number"], ["mfg_date", "Manufacturing date"], ["expiry_date", "Expiry date"], ["unit_cost", "Unit cost"]];
const POS_MAP = {location: 0, sku: 1, barcode: -1, description: 2, system_qty: 3, uom: 4, batch: -1, mfg_date: -1, expiry_date: -1, unit_cost: -1};
let pending = null;
function guessMap(h) {
  const find = re => h.findIndex(x => re.test(String(x).toLowerCase()));
  const bc = find(/barcode|ean|upc|gtin/);
  const skuI = h.findIndex((x, i) => i !== bc && /sku|item|part|material|article|product/.test(String(x).toLowerCase()));
  return {location: find(/loc|bin|slot|position/), sku: skuI, barcode: bc, description: find(/desc|name/),
    system_qty: h.findIndex((x, i) => /sys|on.?hand|expected|book|avail|qty|quantity|stock/.test(String(x).toLowerCase()) && !/date|batch|lot/.test(String(x).toLowerCase())),
    uom: find(/uom|unit of|^unit$/), batch: find(/^batch/) >= 0 ? find(/^batch/) : find(/batch|lot/), mfg_date: find(/mfg|manuf|prod.*date|mfd/), expiry_date: find(/exp|best before|bbd|use by/), unit_cost: find(/cost|price|value/)};
}
function parseDate(v) {
  if (typeof v === "number" || /^\d{5}(\.\d+)?$/.test(String(v))) { const n = +v; if (n > 20000 && n < 80000) return new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10); return null; }
  const s = String(v).trim(); let y, mo, d, x;
  if ((x = s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/))) [, y, mo, d] = x;
  else if ((x = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})$/))) { [, d, mo, y] = x; if (y.length === 2) y = "20" + y; }   // day first (dd/mm/yyyy)
  else if ((x = s.match(/^([A-Za-z]{3})[a-z]*\.? (\d{1,2}),? (\d{4})$/))) { const i = "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(x[1].toLowerCase()); if (i < 0) return null; mo = i / 3 + 1; d = x[2]; y = x[3]; }
  else if ((x = s.match(/^(\d{1,2})[- ]([A-Za-z]{3})[a-z]*[- ,]+(\d{2,4})$/))) { const i = "janfebmaraprmayjunjulaugsepoctnovdec".indexOf(x[2].toLowerCase()); if (i < 0) return null; d = x[1]; mo = i / 3 + 1; y = x[3].length === 2 ? "20" + x[3] : x[3]; }
  else return null;
  const dt = new Date(Date.UTC(+y, +mo - 1, +d));
  return dt.getUTCDate() === +d && dt.getUTCMonth() === +mo - 1 ? dt.toISOString().slice(0, 10) : null;
}
function parseDelimited(text) {
  text = text.replace(/^\uFEFF/, "");
  const nl = text.indexOf("\n"), first = nl < 0 ? text : text.slice(0, nl);
  const d = first.includes("\t") ? "\t" : (first.split(";").length > first.split(",").length ? ";" : ",");
  const rows = []; let row = [], cur = "", qt = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (qt) { if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else qt = false; } else cur += ch; }
    else if (ch === '"') qt = true; else if (ch === d) { row.push(cur); cur = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(x => x.trim())) rows.push(row.map(x => x.trim())); row = []; }
    else cur += ch;
  }
  row.push(cur); if (row.some(x => x.trim())) rows.push(row.map(x => x.trim()));
  return rows;
}
async function readTable(file) {   // Excel or CSV to rows of trimmed text, padded to the same width
  let table;
  if (/\.xlsx?$/i.test(file.name)) { const wb = XLSX.read(await file.arrayBuffer(), {type: "array"}); table = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, raw: true, defval: ""}).map(r => r.map(v => String(v).trim())).filter(r => r.some(v => v !== "")); }
  else table = parseDelimited(await file.text());
  if (!table.length) throw new Error("The file has no rows.");
  const w = Math.max(...table.slice(0, 50).map(r => r.length)); table.forEach(r => { while (r.length < w) r.push(""); });
  return table;
}
async function readFile(file) {
  toast(`Reading ${file.name}…`);
  try {
    const table = await readTable(file);
    const g = guessMap(table[0]), header = g.location >= 0 || g.sku >= 0;
    pending = {table, name: file.name, header, map: header ? g : {...POS_MAP}};
    pending.descBarcode = header && g.barcode < 0 && g.description >= 0 && descBarcodeShare(table.slice(1), g.description) >= 0.2;
    tabUpload(S.cur);
  } catch (e) { fail(e.message ? e : new Error("Couldn't read that file. Save it as .xlsx or .csv and try again.")); }
}
const DESC_BC = /^\s*(\d{8,14})\s*[-–|:]\s*(.+)$/;
function descBarcodeShare(rows, col) { const sample = rows.slice(0, 500).filter(r => r[col]); return sample.length ? sample.filter(r => DESC_BC.test(String(r[col]))).length / sample.length : 0; }
function tabUpload(s) {
  const box = $("#tab");
  if (s.status !== "draft") { box.innerHTML = `<div class="panel"><h2 style="margin-bottom:6px">Stock file</h2><p>${fmt(s.lines_total)} lines at ${fmt(s.locations_total)} locations from <strong>${esc(s.source_file || "upload")}</strong>.</p><p class="hint">The line list is locked once a count is open, so every count stays tied to the right system quantity. For a new snapshot, create a new count.</p></div>`; return; }
  if (!pending) {
    box.innerHTML = `<div class="panel"><h2 style="margin-bottom:6px">Upload the stock file</h2>
      <p class="hint">Export on-hand stock for this zone from your WMS or ERP as Excel (.xlsx, .xls) or CSV. Required columns: location, SKU and system quantity. Optional: description, UOM, unit cost. Take the export right before counting starts.</p>
      ${s.lines_total ? `<div class="banner warn"><span>${fmt(s.lines_total)} lines are already loaded from ${esc(s.source_file || "a file")}. Uploading again replaces them.</span></div>` : ""}
      <label class="drop" id="drop"><input type="file" id="file" accept=".xlsx,.xls,.csv,.txt,.tsv"><strong>Choose a file</strong><br><span class="small muted">or drop it here</span></label></div>`;
    $("#file").onchange = e => e.target.files[0] && readFile(e.target.files[0]);
    const d = $("#drop"); d.ondragover = e => { e.preventDefault(); d.classList.add("over"); }; d.ondragleave = () => d.classList.remove("over");
    d.ondrop = e => { e.preventDefault(); d.classList.remove("over"); e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0]); };
    return;
  }
  const p = pending, head = p.header ? p.table[0] : p.table[0].map((_, k) => `Column ${k + 1}`);
  const opts = sel => `<option value="-1">Not in file</option>` + head.map((h, k) => `<option value="${k}" ${sel === k ? "selected" : ""}>${esc(h || `Column ${k + 1}`)}</option>`).join("");
  const body = p.table.slice(p.header ? 1 : 0, (p.header ? 1 : 0) + 6);
  box.innerHTML = `<div class="panel" id="uppanel"><h2 style="margin-bottom:6px">Check the columns</h2>
    <p class="hint"><strong>${esc(p.name)}</strong>: ${fmt(p.table.length - (p.header ? 1 : 0))} rows.</p>
    <label class="check small"><input type="checkbox" id="hdr" ${p.header ? "checked" : ""}> First row is column names</label>
    <label class="check small" style="margin-top:6px"><input type="checkbox" id="descbc" ${p.descBarcode ? "checked" : ""}> Product barcode is at the start of the description (for example <code>9345156233829-Hair brush</code>)</label>
    <div class="map">${FIELDS.map(([k, l, req]) => `<label class="field">${l}${req ? " (required)" : ""}<select data-map="${k}">${opts(p.map[k])}</select></label>`).join("")}</div>
    <label class="field" style="max-width:440px">Walking order<select id="order"><option value="sort">Sort by location code (A-01-01, A-01-02…)</option><option value="file">Keep the order in the file (pick path)</option></select></label>
    <div class="tablewrap"><table><thead><tr>${head.map(h => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${body.map(r => `<tr>${head.map((_, k) => `<td>${esc(r[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="row" style="margin-top:14px"><button class="btn primary" data-act="do-upload">Upload lines</button><button class="btn ghost" data-act="cancel-upload">Choose another file</button></div></div>`;
  $("#hdr").onchange = e => { p.header = e.target.checked; p.map = p.header ? guessMap(p.table[0]) : {...POS_MAP}; tabUpload(s); };
  $$("[data-map]").forEach(sel => sel.onchange = () => { p.map[sel.dataset.map] = +sel.value; });
  $("#descbc").onchange = e => { p.descBarcode = e.target.checked; };
}
async function doUpload() {
  const s = S.cur, p = pending, m = p.map;
  if (m.location < 0 || m.sku < 0 || m.system_qty < 0) return toast("Choose the columns for location, SKU and system qty.", true);
  const num = v => { const n = parseFloat(String(v).replace(/[^\d.\-]/g, "")); return isNaN(n) ? 0 : n; };
  const txt = (r, f, max) => m[f] >= 0 ? String(r[m[f]] || "").trim().slice(0, max) : "";
  let badDates = 0;
  const date = (r, f) => { if (m[f] < 0) return null; const v = r[m[f]]; if (v === "" || v == null) return null; const d = parseDate(v); if (!d) badDates++; return d; };
  const merged = new Map(); let dup = 0, skipped = 0, sciBarcodes = 0;
  for (const r of (p.header ? p.table.slice(1) : p.table)) {
    const loc = String(r[m.location] || "").trim(), sku = String(r[m.sku] || "").trim();
    if (!loc || !sku) { skipped++; continue; }
    const batch = txt(r, "batch", 60);
    const k = loc.toUpperCase() + "\u0000" + sku.toUpperCase() + "\u0000" + batch.toUpperCase();
    if (merged.has(k)) { merged.get(k).system_qty += num(r[m.system_qty]); dup++; continue; }
    let barcode = txt(r, "barcode", 60), description = txt(r, "description", 200);
    if (/^\d(\.\d+)?E\+\d+$/i.test(barcode)) { barcode = ""; sciBarcodes++; }
    if (p.descBarcode) { const mm = description.match(DESC_BC); if (mm) { if (!barcode) barcode = mm[1]; description = mm[2].trim(); } }
    merged.set(k, {location: loc, sku, barcode, batch, mfg_date: date(r, "mfg_date"), expiry_date: date(r, "expiry_date"), description, uom: txt(r, "uom", 20), system_qty: num(r[m.system_qty]), unit_cost: m.unit_cost >= 0 ? num(r[m.unit_cost]) : 0});
  }
  let rows = [...merged.values()];
  if (!rows.length) return toast("No usable rows. Each row needs a location and a SKU.", true);
  if (badDates && !confirmTwice($('[data-act="do-upload"]'), "bd", `${fmt(badDates)} dates couldn't be read. Upload anyway?`)) return;
  if ($("#order").value === "sort") rows.sort((a, b) => COLL.compare(a.location, b.location) || COLL.compare(a.sku, b.sku));
  else { const g = new Map(); rows.forEach(x => { const k = x.location.toUpperCase(); if (!g.has(k)) g.set(k, []); g.get(k).push(x); }); rows = [].concat(...g.values()); }
  rows.forEach((x, i) => { x.session_id = s.id; x.seq = i + 1; });
  const panel = $("#uppanel");
  panel.innerHTML = `<h2>Uploading ${fmt(rows.length)} lines</h2><div class="bigprog"><b id="upbar" style="width:0%"></b></div><p class="small muted" id="uptext">Removing the previous file…</p><p class="hint">Keep this page open until the upload finishes.</p>`;
  const bar = (pct, t) => { $("#upbar").style.width = pct + "%"; $("#uptext").textContent = t; };
  try {
    if (s.lines_total) await q(sb.from("count_lines").delete().eq("session_id", s.id));
    const B = 1000;
    for (let i = 0; i < rows.length; i += B) {
      let tries = 0;
      for (;;) { try { await q(sb.from("count_lines").insert(rows.slice(i, i + B))); break; } catch (e) { if (++tries > 3) throw e; await new Promise(r => setTimeout(r, 1000 * tries)); } }
      bar(Math.min(99, (i + B) / rows.length * 100), `Saved ${fmt(Math.min(i + B, rows.length))} of ${fmt(rows.length)} lines`);
    }
    const res = await q(sb.rpc("finish_import", {p_session: s.id, p_source_file: p.name}));
    pending = null;
    const locs = [...new Set(rows.map(x => x.location))];
    const compact = locs.filter(x => !/[-\/. _]/.test(x) && /[A-Za-z]$/.test(x) && x.length > 3).length;
    let rackNote = "";
    if (s.rack_grouping === "last_segment" && compact / locs.length >= 0.8) { await q(sb.from("count_sessions").update({rack_grouping: "last_char"}).eq("id", s.id)); rackNote = " Rack levels set to the last letter of the location code."; }
    const noBc = rows.filter(x => !x.barcode).length;
    const bcNote = noBc ? ` ${fmt(noBc)} line${noBc === 1 ? " has" : "s have"} no product barcode, so counters type the SKU for those.` : "";
    const sciNote = sciBarcodes ? ` ${fmt(sciBarcodes)} barcodes were damaged by Excel (shown like 9.34516E+12) and were ignored.` : "";
    sessionStorage.setItem("cc-upload-note", `${fmt(res.lines)} lines at ${fmt(res.locations)} locations uploaded${dup ? `, ${fmt(dup)} duplicate rows merged` : ""}${skipped ? `, ${fmt(skipped)} rows skipped` : ""}.${rackNote}${bcNote}${sciNote}`);
    toast(`${fmt(res.lines)} lines uploaded.`);
    go(`count/${s.id}/overview`);
  } catch (e) { fail(e); bar(0, "The upload stopped. Upload the file again; the partial upload will be replaced."); }
}

/* ---------- variances ---------- */
function lineQuery(s, select = "*", count) {
  let qq = sb.from("count_lines_v").select(select, count ? {count: "exact"} : undefined).eq("session_id", s.id);
  const f = V.filter;
  if (f === "out") qq = qq.in("status", ["out", "accepted"]);
  else if (f === "variance") qq = qq.not("counted_qty", "is", null).neq("variance", 0);
  else if (f === "uncounted") qq = qq.eq("status", "uncounted");
  else if (f === "recount") qq = qq.eq("status", "recount");
  else if (f === "found") qq = qq.eq("is_found", true);
  const term = V.search.replace(/[,()%*\\]/g, " ").trim();
  if (term) qq = qq.or(`location.ilike.%${term}%,sku.ilike.%${term}%`);
  return qq;
}
async function tabVariances(s) {
  const F = [["out", "Out of tolerance"], ["variance", "Any variance"], ["uncounted", "Not counted"], ["recount", "Recount pending"], ["found", "Excess and misplaced"], ["all", "All lines"]];
  const editable = s.status === "open" || s.status === "closed";
  $("#tab").innerHTML = `<div class="toolbar"><div class="chips">${F.map(([k, l]) => `<button class="chip" aria-pressed="${V.filter === k}" data-act="vfilter" data-f="${k}">${l}</button>`).join("")}</div>
      <div class="row"><input class="search" id="vsearch" placeholder="Search location or SKU" value="${esc(V.search)}"><button class="btn sm" data-act="export">Export to Excel</button></div></div>
    ${editable ? `<div class="row" style="margin-top:12px" id="bulk">
      <button class="btn sm" data-act="recount-sel" ${s.status === "open" ? "" : "disabled title='Reopen the count to request recounts'"}>Recount selected</button>
      <button class="btn sm" data-act="accept-sel">Accept selected</button><button class="btn sm ghost" data-act="unaccept-sel">Undo accept</button>
      ${s.status === "open" && s.lines_out ? `<button class="btn sm" data-act="recount-all-out">Recount all ${fmt(s.lines_out)} out-of-tolerance lines</button>` : ""}
      <span class="small muted" id="selcount"></span></div>` : ""}
    <div class="tablewrap" id="vtable"><div class="loading">Loading…</div></div><div class="pager" id="pager"></div>`;
  let t; $("#vsearch").oninput = e => { clearTimeout(t); t = setTimeout(() => { V.search = e.target.value; V.page = 0; loadVariances(s); }, 300); };
  loadVariances(s);
}
async function loadVariances(s) {
  const editable = s.status === "open" || s.status === "closed";
  let res;
  try {
    let qq = lineQuery(s, "*", true);
    qq = V.filter === "out" || V.filter === "variance" ? qq.order("sort_weight", {ascending: false}).order("id") : qq.order("seq").order("id");
    res = await q(qq.range(V.page * V.per, V.page * V.per + V.per - 1));
  } catch (e) { fail(e); return; }
  const {data, count} = res;
  const sc = $("#selcount"); if (sc) sc.textContent = V.sel.size ? `${V.sel.size} selected` : "";
  if (!data.length) { $("#vtable").innerHTML = `<div class="empty" style="border:0"><h3>No lines in this view</h3><p>${V.filter === "out" ? "Nothing is out of tolerance." : "Try another filter or search."}</p></div>`; $("#pager").innerHTML = ""; return; }
  $("#vtable").innerHTML = `<table><thead><tr>${editable ? `<th><input type="checkbox" id="selall" aria-label="Select all on this page"></th>` : ""}<th>Location</th><th>SKU</th><th>Description</th><th>Batch</th><th>Expiry</th><th class="n">System</th><th class="n">Counted</th><th class="n">Variance</th><th class="n">%</th><th class="n">Value</th><th>Status</th><th>Counted by</th><th class="n">Round</th></tr></thead><tbody>
    ${data.map(l => `<tr class="${V.sel.has(l.id) ? "sel" : ""}">${editable ? `<td><input type="checkbox" data-sel="${l.id}" ${V.sel.has(l.id) ? "checked" : ""} aria-label="Select ${esc(l.location)} ${esc(l.sku)}"></td>` : ""}
      <td><span class="tag">${esc(l.location)}</span></td><td><strong>${esc(l.sku)}</strong>${l.is_found ? (l.expected_location ? ` <span class="status s-accepted" title="System location ${esc(l.expected_location)}">Misplaced from ${esc(l.expected_location)}</span>` : ' <span class="status s-accepted">Excess</span>') : ""}${l.remarks ? `<br><span class="small muted">${esc(l.remarks)}</span>` : ""}</td><td class="desc">${esc(l.description)}</td><td>${esc(l.batch || "")}</td><td class="small">${expiryCell(l)}</td>
      <td class="n">${fmt(l.system_qty)}</td><td class="n">${fmt(l.counted_qty)}</td>
      <td class="n ${l.variance > 0 ? "var-pos" : l.variance < 0 ? "var-neg" : ""}">${l.variance == null ? "–" : (l.variance > 0 ? "+" : "") + fmt(l.variance)}</td>
      <td class="n">${l.variance_pct == null ? "–" : (l.variance_pct > 0 ? "+" : "") + fmt(l.variance_pct) + "%"}</td>
      <td class="n">${l.variance_value == null ? "–" : money(l.variance_value)}</td>
      <td><span class="status s-${l.status}">${STATUS_LABEL[l.status]}</span></td>
      <td class="small">${esc(l.counted_by_name || "")}${l.counted_at ? `<br><span class="muted">${dt(l.counted_at)}</span>` : ""}</td><td class="n">${l.count_round}</td></tr>`).join("")}
    </tbody></table>`;
  const pages = Math.ceil(count / V.per);
  $("#pager").innerHTML = `<span class="muted">${fmt(V.page * V.per + 1)}–${fmt(Math.min(count, (V.page + 1) * V.per))} of ${fmt(count)}</span><button class="btn sm" data-act="vpage" data-d="-1" ${V.page ? "" : "disabled"}>Previous</button><button class="btn sm" data-act="vpage" data-d="1" ${V.page + 1 < pages ? "" : "disabled"}>Next</button>`;
  $$("[data-sel]").forEach(c => c.onchange = () => { const id = +c.dataset.sel; c.checked ? V.sel.add(id) : V.sel.delete(id); c.closest("tr").classList.toggle("sel", c.checked); const sc = $("#selcount"); if (sc) sc.textContent = V.sel.size ? `${V.sel.size} selected` : ""; });
  const all = $("#selall"); if (all) all.onchange = () => $$("[data-sel]").forEach(c => { c.checked = all.checked; c.onchange(); });
}
async function allIdsWhere(s, filterFn) {
  const ids = []; let from = 0;
  for (;;) { const rows = await q(filterFn(sb.from("count_lines_v").select("id").eq("session_id", s.id)).order("id").range(from, from + 999)); ids.push(...rows.map(r => r.id)); if (rows.length < 1000) break; from += 1000; }
  return ids;
}
async function chunked(ids, fn) { let n = 0; for (let i = 0; i < ids.length; i += 500) n += await q(fn(ids.slice(i, i + 500))); return n; }

function expiryCell(l) { if (!l.expiry_date) return l.mfg_date ? `Mfg ${d8(l.mfg_date)}` : ""; const past = l.expiry_date < new Date().toISOString().slice(0, 10); return `<span class="${past ? "var-neg" : ""}">${d8(l.expiry_date)}${past ? " (expired)" : ""}</span>${l.mfg_date ? `<br><span class="muted">Mfg ${d8(l.mfg_date)}</span>` : ""}`; }
/* ---------- activity ---------- */
async function tabActivity(s) {
  let rows; try { rows = await q(sb.from("event_list").select("*").eq("session_id", s.id).order("created_at", {ascending: false}).limit(300)); } catch (e) { fail(e); rows = []; }
  const L = {count: "Counted", found: "Found stock", recount_request: "Recount requested", accept: "Variance accepted", unaccept: "Accept undone", status: "Status changed", reconcile: "Reconciled", import: "Stock file uploaded"};
  $("#tab").innerHTML = rows.length ? `<p class="hint">Every action on this count is recorded permanently. Showing the latest 300.</p><div class="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>Location</th><th>SKU</th><th class="n">Qty</th><th class="n">Previous</th><th>Device / note</th></tr></thead><tbody>
    ${rows.map(e => `<tr><td class="small">${dt(e.created_at)}</td><td>${esc(e.user_name || "–")}</td><td>${L[e.event] || esc(e.event)}</td><td>${e.location ? `<span class="tag">${esc(e.location)}</span>` : ""}</td><td>${esc(e.sku || "")}</td><td class="n">${fmt(e.qty)}</td><td class="n">${fmt(e.prev_qty)}</td><td class="small muted">${esc([e.device, e.note].filter(Boolean).join(", "))}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty"><h3>No activity yet</h3></div>`;
}

/* ---------- settings ---------- */
function tabSettings(s) {
  const locked = s.status === "reconciled";
  $("#tab").innerHTML = `<div class="panel" style="max-width:720px"><h2 style="margin-bottom:12px">Settings</h2>
    <form id="setf" class="grid-form">
      <label class="field">Name<input name="cname" value="${esc(s.name)}" ${locked ? "disabled" : ""}></label>
      <label class="field">Site<input name="site" value="${esc(s.site)}" ${locked ? "disabled" : ""}></label>
      <label class="field">Zone<input name="zone" value="${esc(s.zone)}" ${locked ? "disabled" : ""}></label>
      <label class="field">Tolerance (%)<input name="tol" type="number" min="0" step="0.1" value="${esc(s.tolerance_pct)}" ${locked ? "disabled" : ""}></label>
      <label class="check" style="grid-column:1/-1"><input type="checkbox" name="blind" ${s.blind ? "checked" : ""} ${locked ? "disabled" : ""}> Blind count</label>
      <div style="grid-column:1/-1">${countOptions(s, locked)}</div>
      ${locked ? `<p class="hint" style="grid-column:1/-1">This count is reconciled, so its settings are locked.</p>` : `<div class="row" style="grid-column:1/-1"><button class="btn primary" type="submit">Save settings</button></div>`}
    </form>
    ${S.me.role === "admin" && s.status === "draft" ? `<div class="toolbar" style="margin-top:24px"><span class="small muted">Only draft counts can be deleted. Opened counts are kept for the audit trail.</span><button class="btn danger sm" data-act="delete-count">Delete this draft</button></div>` : ""}</div>`;
  const f = $("#setf"), el = n => f.elements.namedItem(n);
  f.onsubmit = async e => { e.preventDefault(); if (await run(() => q(sb.from("count_sessions").update({name: el("cname").value.trim() || s.name, site: el("site").value.trim(), zone: el("zone").value.trim(), tolerance_pct: Math.max(0, parseFloat(el("tol").value) || 0), blind: el("blind").checked, ...readOptions(el)}).eq("id", s.id)), "Settings saved")) onRoute(); };
}

/* ---------- export ---------- */
async function saveWorkbook(wb, name) {
  // Inside a claude.ai preview, files go through its download prompt; everywhere else the browser saves them directly.
  try {
    const dl = window.claude && window.claude.use ? await window.claude.use("downloads") : null;
    if (dl) { await dl.save({filename: name, data: new Uint8Array(XLSX.write(wb, {type: "array", bookType: "xlsx"}))}); toast("Excel file saved"); return; }
  } catch (e) { if (e && e.code === "declined") return; }
  XLSX.writeFile(wb, name);
}
async function exportSession(s) {
  toast("Preparing the Excel file…");
  try {
    const rows = []; let from = 0;
    for (;;) { const d = await q(sb.from("count_lines_v").select("*").eq("session_id", s.id).order("seq").order("id").range(from, from + 999)); rows.push(...d); if (d.length < 1000) break; from += 1000; }
    const lines = rows.map(l => ({"Walk #": l.seq, Location: l.location, SKU: l.sku, Barcode: l.barcode, Batch: l.batch, "Mfg date": l.mfg_date || "", "Expiry date": l.expiry_date || "", Description: l.description, UOM: l.uom, "System qty": +l.system_qty, "Counted qty": l.counted_qty == null ? "" : +l.counted_qty, Variance: l.variance == null ? "" : +l.variance, "Variance %": l.variance_pct == null ? "" : +l.variance_pct, "Unit cost": +l.unit_cost, "Variance value": l.variance_value == null ? "" : Math.round(l.variance_value * 100) / 100, Status: STATUS_LABEL[l.status], "Line type": l.is_found ? (l.expected_location ? "Misplaced" : "Excess") : "Expected", "System location": l.expected_location || "", Remarks: l.remarks || "", "Count round": l.count_round, "Counted by": l.counted_by_name || "", "Counted at": l.counted_at ? new Date(l.counted_at) : ""}));
    const adj = lines.filter(l => l.Variance !== "" && l.Variance !== 0).map(l => ({Location: l.Location, SKU: l.SKU, Batch: l.Batch, "Expiry date": l["Expiry date"], UOM: l.UOM, "Adjust by": l.Variance, "New qty": l["Counted qty"], "Value": l["Variance value"]}));
    const summary = [["Count", s.name], ["Site", s.site], ["Zone", s.zone], ["Status", SESSION_LABEL[s.status]], ["Stock file", s.source_file || ""], ["Tolerance %", +s.tolerance_pct], ["Lines", s.lines_total], ["Counted", s.lines_counted], ["Within tolerance", s.lines_within], ["Out of tolerance", s.lines_out], ["Accepted", s.lines_accepted], ["Excess and misplaced lines", s.found_lines], ["Net units", +s.net_units], ["Net value", +s.net_value], ["Absolute value", +s.abs_value], ["Exported", new Date()], ["Exported by", S.me.full_name]];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), "Summary");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lines), "All lines");
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(adj.length ? adj : [{Note: "No variances"}]), "Adjustments");
    saveWorkbook(wb, `${s.name.replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, "-") || "cycle-count"}.xlsx`);
  } catch (e) { fail(e); }
}

/* ---------- reconciliation history ---------- */
async function pageHistory() {
  let rows; try { rows = await q(sb.from("reconciliation_list").select("*").order("approved_at", {ascending: false}).limit(500)); } catch (e) { fail(e); rows = []; }
  $("#main").innerHTML = `<div class="pagehead"><div><h1>Reconciliation history</h1><p class="muted small" style="margin:4px 0 0">Every reconciled count, kept permanently. Open one to see its lines and audit trail.</p></div><button class="btn" data-act="export-history" ${rows.length ? "" : "disabled"}>Export to Excel</button></div>
    ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Reconciled</th><th>Count</th><th>Site / zone</th><th class="n">Lines</th><th class="n">Accuracy</th><th class="n">Net value</th><th class="n">Absolute value</th><th>WMS reference</th><th>Approved by</th></tr></thead><tbody>
      ${rows.map(r => `<tr style="cursor:pointer" data-act="open-count" data-id="${r.session_id}"><td class="small">${dt(r.approved_at)}</td><td><strong>${esc(r.session_name)}</strong></td><td>${esc([r.site, r.zone].filter(Boolean).join(" / ") || "–")}</td><td class="n">${fmt(r.lines_total)}</td><td class="n">${fmt(r.accuracy_pct)}%</td><td class="n ${r.net_value < 0 ? "var-neg" : r.net_value > 0 ? "var-pos" : ""}">${money(r.net_value)}</td><td class="n">${money(r.abs_value)}</td><td>${esc(r.wms_reference || "–")}</td><td>${esc(r.approved_by_name || "–")}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><h2>No reconciled counts yet</h2><p>Reconcile a closed count and it appears here.</p></div>`}`;
  S.history = rows;
}

/* ---------- item history ---------- */
async function pageItems() {
  $("#main").innerHTML = `<div class="pagehead"><div><h1>Item history</h1><p class="muted small" style="margin:4px 0 0">Every count of a SKU or location across all counts, newest first. Useful for spotting repeat variances.</p></div></div>
    <form class="row" id="itemf"><input class="search" name="term" placeholder="Exact SKU or location" required style="min-width:280px"><select name="kind" class="search" style="min-width:0"><option value="sku">SKU</option><option value="location">Location</option></select><button class="btn primary">Search</button></form>
    <div id="itemres" style="margin-top:14px"></div>`;
  const f = $("#itemf");
  f.onsubmit = async e => {
    e.preventDefault();
    const term = f.elements.namedItem("term").value.trim(), kind = f.elements.namedItem("kind").value;
    $("#itemres").innerHTML = `<div class="loading">Searching…</div>`;
    let rows; try { rows = await q(sb.from("count_lines_v").select("*").ilike(kind, term.replace(/[%_\\]/g, m => "\\" + m)).order("session_created_at", {ascending: false}).limit(500)); } catch (err) { fail(err); return; }
    const outs = rows.filter(r => r.status === "out" || r.status === "accepted").length;
    $("#itemres").innerHTML = rows.length ? `<p class="small muted">${fmt(rows.length)} records${outs ? `, ${outs} out of tolerance` : ""}.</p><div class="tablewrap"><table><thead><tr><th>Count</th><th>Date</th><th>Location</th><th>SKU</th><th class="n">System</th><th class="n">Counted</th><th class="n">Variance</th><th class="n">Value</th><th>Status</th><th>Counted by</th></tr></thead><tbody>
      ${rows.map(l => `<tr style="cursor:pointer" data-act="open-count" data-id="${l.session_id}"><td><strong>${esc(l.session_name)}</strong><br><span class="pill ${l.session_status}">${SESSION_LABEL[l.session_status]}</span></td><td class="small">${d8(l.session_created_at)}</td><td><span class="tag">${esc(l.location)}</span></td><td>${esc(l.sku)}</td><td class="n">${fmt(l.system_qty)}</td><td class="n">${fmt(l.counted_qty)}</td><td class="n ${l.variance > 0 ? "var-pos" : l.variance < 0 ? "var-neg" : ""}">${l.variance == null ? "–" : fmt(l.variance)}</td><td class="n">${l.variance_value == null ? "–" : money(l.variance_value)}</td><td><span class="status s-${l.status}">${STATUS_LABEL[l.status]}</span></td><td class="small">${esc(l.counted_by_name || "")}</td></tr>`).join("")}
      </tbody></table></div>` : `<div class="empty"><h3>No records for ${esc(term)}</h3><p>Check the exact code. The search isn't case-sensitive.</p></div>`;
  };
}

/* ---------- users ---------- */
async function pageUsers() {
  if (S.me.role !== "admin") { $("#main").innerHTML = `<div class="empty"><h2>Administrators only</h2></div>`; return; }
  let rows; try { rows = await q(sb.from("profiles").select("*").order("active").order("full_name")); } catch (e) { fail(e); rows = []; }
  const pendingN = rows.filter(r => !r.active).length;
  $("#main").innerHTML = `<div class="pagehead"><div><h1>Users</h1><p class="muted small" style="margin:4px 0 0">People create their own account in either app; approve them here and choose their role. To add someone directly, invite them from the Supabase dashboard (Authentication, Users).</p></div></div>
    ${pendingN ? `<div class="banner warn"><span>${pendingN} account${pendingN === 1 ? " is" : "s are"} waiting for approval.</span></div>` : ""}
    <div class="tablewrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Site</th><th>Access</th><th></th></tr></thead><tbody>
    ${rows.map(u => `<tr data-uid="${u.id}"><td><input class="search" style="min-width:160px" data-f="full_name" value="${esc(u.full_name)}"></td><td class="small">${esc(u.email || "")}</td>
      <td><select class="search" style="min-width:0" data-f="role" ${u.id === S.me.id ? "disabled" : ""}>${[["counter", "Operator (mobile: counting and QC)"], ["supervisor", "Supervisor"], ["admin", "Administrator"]].map(([k, l]) => `<option value="${k}" ${u.role === k ? "selected" : ""}>${l}</option>`).join("")}</select></td>
      <td><input class="search" style="min-width:100px" data-f="site" value="${esc(u.site)}"></td>
      <td><label class="check"><input type="checkbox" data-f="active" ${u.active ? "checked" : ""} ${u.id === S.me.id ? "disabled" : ""}> ${u.active ? "Active" : "Not approved"}</label></td>
      <td><button class="btn sm" data-act="save-user">Save</button></td></tr>`).join("")}</tbody></table></div>`;
}

/* ---------- clicks ---------- */
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-act]"); if (!b) return;
  const a = b.dataset.act, s = S.cur;
  if (b.tagName === "A") e.preventDefault();
  switch (a) {
    case "signout": await sb.auth.signOut(); break;
    case "reset-conn": window.CC_resetConnection(); break;
    case "to-signup": renderLogin("up"); break;
    case "to-signin": renderLogin("in"); break;
    case "count-filter": sessionStorage.setItem("cc-filter", b.dataset.f); pageCounts(); break;
    case "new-count": { const d = $("#newdlg"); d.showModal(); d.onclose = () => { if (d.returnValue === "ok") createCount(); }; break; }
    case "open-count": V.sel = new Set(); V.page = 0; go(`count/${b.dataset.id}/overview`); break;
    case "status": {
      const to = b.dataset.to;
      if (to === "closed" && s.lines_total - s.lines_counted > 0 && !confirmTwice(b, "close", `${fmt(s.lines_total - s.lines_counted)} lines not counted. Close anyway?`)) break;
      if (await run(() => q(sb.rpc("set_session_status", {p_session: s.id, p_status: to})), to === "open" ? "Count is open. Counters can see it in the mobile app." : to === "closed" ? "Count closed" : "Count reopened")) onRoute();
      break;
    }
    case "reconcile": {
      if (s.lines_out) { toast(`${fmt(s.lines_out)} lines are out of tolerance. Recount or accept them first.`, true); break; }
      const d = $("#recdlg"); d.showModal();
      d.onclose = async () => { if (d.returnValue !== "ok") return; const f = $("#recf"); if (await run(() => q(sb.rpc("reconcile_session", {p_session: s.id, p_wms_reference: f.elements.namedItem("ref").value.trim() || null, p_notes: f.elements.namedItem("notes").value.trim() || null})), "Count reconciled and saved to history")) onRoute(); };
      break;
    }
    case "export": exportSession(s); break;
    case "do-upload": doUpload(); break;
    case "cancel-upload": pending = null; tabUpload(s); break;
    case "vfilter": V.filter = b.dataset.f; V.page = 0; V.sel = new Set(); tabVariances(s); break;
    case "vpage": V.page += +b.dataset.d; loadVariances(s); break;
    case "recount-sel": case "accept-sel": case "unaccept-sel": {
      const ids = [...V.sel]; if (!ids.length) { toast("Select lines first.", true); break; }
      const n = await run(() => chunked(ids, part => a === "recount-sel" ? sb.rpc("request_recount", {p_session: s.id, p_line_ids: part}) : sb.rpc("set_accepted", {p_session: s.id, p_line_ids: part, p_accepted: a === "accept-sel"})));
      if (n !== false) { toast(a === "recount-sel" ? `Recount requested for ${fmt(n)} lines` : a === "accept-sel" ? `${fmt(n)} variances accepted` : `Accept undone on ${fmt(n)} lines`); V.sel = new Set(); S.cur = await loadSession(s.id); tabVariances(S.cur); }
      break;
    }
    case "recount-all-out": {
      if (!confirmTwice(b, "rao", `Tap again to send ${fmt(s.lines_out)} lines back`)) break;
      const n = await run(async () => chunked(await allIdsWhere(s, qq => qq.eq("status", "out")), part => sb.rpc("request_recount", {p_session: s.id, p_line_ids: part})));
      if (n !== false) { toast(`Recount requested for ${fmt(n)} lines`); S.cur = await loadSession(s.id); tabVariances(S.cur); }
      break;
    }
    case "delete-count": if (confirmTwice(b, "del", "Tap again to delete permanently")) { if (await run(() => q(sb.from("count_sessions").delete().eq("id", s.id)), "Draft deleted")) go("counts"); } break;
    case "export-history": {
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet((S.history || []).map(r => ({Reconciled: new Date(r.approved_at), Count: r.session_name, Site: r.site, Zone: r.zone, "Stock file": r.source_file, Lines: r.lines_total, Counted: r.lines_counted, "Within tolerance": r.lines_within, Accepted: r.lines_accepted, "Found stock": r.found_lines, "Accuracy %": +r.accuracy_pct, "Net units": +r.net_units, "Net value": +r.net_value, "Absolute value": +r.abs_value, "WMS reference": r.wms_reference, Notes: r.notes, "Approved by": r.approved_by_name}))), "Reconciliations");
      saveWorkbook(wb, "reconciliation-history.xlsx"); break;
    }
    case "save-user": {
      const tr = b.closest("tr"), id = tr.dataset.uid, val = f => tr.querySelector(`[data-f="${f}"]`);
      const patch = {full_name: val("full_name").value.trim(), site: val("site").value.trim()};
      if (id !== S.me.id) { patch.role = val("role").value; patch.active = val("active").checked; }
      if (await run(() => q(sb.from("profiles").update(patch).eq("id", id)), "User saved")) pageUsers();
      break;
    }
  }
});

if ("serviceWorker" in navigator && location.protocol === "https:" && !CONFIG.DEMO && !/claude\.ai|claudeusercontent/.test(location.host)) navigator.serviceWorker.register("sw.js").catch(() => {});
boot();
})();
