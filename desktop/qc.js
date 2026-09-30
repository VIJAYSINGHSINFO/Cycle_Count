/* Cycle Count Console: Order QC. Upload picked orders, watch operators check them on the phone,
   handle short orders (release with a reason, or wait for the extra pick), and export the results. */
(() => {
"use strict";
let C = null;   // helpers from app.js
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const N = v => Number(v) || 0;
const STATUS = {pending: "Waiting for QC", in_progress: "In QC", short: "Short: waiting for pick", passed: "Passed", released: "Released short", cancelled: "Cancelled"};
const PILL = {pending: "draft", in_progress: "open", short: "closed", passed: "reconciled", released: "open", cancelled: "draft"};
const EVENT = {import: "Uploaded", start: "Started QC", resume: "Resumed QC", pause: "Paused", scan: "Scanned", over: "Extra, set aside", wrong_item: "Wrong product",
  unknown: "Not in order", undo: "Removed unit", tote: "Tote scanned", finish: "Passed QC", short: "Sent back for picking", unlock: "Unlocked", release: "Released short", cancel: "Cancelled", reset: "Reset"};
const V = {filter: "open", search: "", pending: null, note: null};
const statusLabel = o => o.status === "in_progress" && !o.assigned_to ? "In QC (paused)" : STATUS[o.status] || o.status;

function page(main, ctx, id) {
  C = ctx;
  if (id === "upload") return pageUpload(main);
  if (id) return pageOrder(main, id);
  return pageList(main);
}

/* ---------- list ---------- */
async function pageList(main) {
  let rows = [];
  try {
    let qq = C.sb.from("qc_order_list").select("*").order("created_at", {ascending: false}).limit(500);
    if (V.filter === "open") qq = qq.in("status", ["pending", "in_progress", "short"]);
    else if (V.filter === "closed") qq = qq.in("status", ["released", "cancelled"]);
    else if (V.filter !== "all") qq = qq.eq("status", V.filter);
    const term = V.search.replace(/[,()%*\\]/g, " ").trim();
    if (term) qq = qq.or(`order_no.ilike.%${term}%,reference.ilike.%${term}%,customer.ilike.%${term}%`);
    rows = await C.q(qq);
  } catch (e) { C.fail(e); }
  let all = [];
  try { all = await C.q(C.sb.from("qc_order_list").select("status,assigned_to,finished_at,closed_at,units_over,created_at").gte("created_at", new Date(Date.now() - 7 * 864e5).toISOString()).limit(5000)); } catch {}
  const today = new Date().toISOString().slice(0, 10);
  const cnt = f => all.filter(f).length;
  const note = V.note; V.note = null;
  main.innerHTML = `
    <div class="pagehead"><div><h1>Order QC</h1><p class="muted small" style="margin:4px 0 0">Upload picked orders. Operators scan every unit in the mobile app before dispatch; extra units are refused and shortages are sent back for picking.</p></div>
      <div class="row"><button class="btn" data-qa="export-list" ${rows.length ? "" : "disabled"}>Export to Excel</button><a class="btn go" href="#/qc/upload">Upload orders</a></div></div>
    ${note ? `<div class="banner ok"><span>${C.esc(note)}</span></div>` : ""}
    <div class="stats">
      <div class="stat"><div class="l">Waiting for QC</div><div class="v">${C.fmt(cnt(o => o.status === "pending"))}</div></div>
      <div class="stat"><div class="l">In QC now</div><div class="v">${C.fmt(cnt(o => o.status === "in_progress" && o.assigned_to))}</div></div>
      <div class="stat"><div class="l">Short, waiting for pick</div><div class="v ${cnt(o => o.status === "short") ? "var-neg" : ""}">${C.fmt(cnt(o => o.status === "short"))}</div></div>
      <div class="stat"><div class="l">Passed today</div><div class="v">${C.fmt(cnt(o => o.status === "passed" && String(o.finished_at || "").slice(0, 10) === today))}</div></div>
      <div class="stat"><div class="l">Extra units set aside, last 7 days</div><div class="v">${C.fmt(all.reduce((a, o) => a + N(o.units_over), 0))}</div></div>
    </div>
    <div class="toolbar"><div class="chips">${[["open", "Open"], ["short", "Short"], ["in_progress", "In QC"], ["passed", "Passed"], ["closed", "Released or cancelled"], ["all", "All"]].map(([k, l]) => `<button class="chip" aria-pressed="${V.filter === k}" data-qa="filter" data-f="${k}">${l}</button>`).join("")}</div>
      <input class="search" id="qcsearch" placeholder="Search order, reference or customer" value="${C.esc(V.search)}"></div>
    ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Order</th><th>Storer</th><th>Customer</th><th>Status</th><th>Progress</th><th class="n">Short</th><th class="n">Set aside</th><th>Operator</th><th>Uploaded</th></tr></thead><tbody>
      ${rows.map(o => { const p = N(o.units_expected) ? N(o.units_scanned) / N(o.units_expected) * 100 : 0; return `<tr style="cursor:pointer" data-qa="open" data-id="${C.esc(o.id)}">
        <td><strong>${C.esc(o.order_no)}</strong>${o.reference ? `<br><span class="small muted">${C.esc(o.reference)}</span>` : ""}</td><td>${C.esc(o.storer || "–")}</td><td>${C.esc(o.customer || "–")}</td>
        <td><span class="pill ${PILL[o.status]}">${statusLabel(o)}</span></td>
        <td style="min-width:150px"><div class="progress"><b style="width:${p}%"></b></div><span class="small muted">${C.fmt(o.units_scanned)} of ${C.fmt(o.units_expected)} units</span></td>
        <td class="n">${N(o.units_short) && o.status !== "pending" ? `<span class="var-neg">${C.fmt(o.units_short)}</span>` : N(o.units_short) ? C.fmt(o.units_short) : "0"}</td>
        <td class="n">${N(o.units_over) ? `<span class="status s-accepted">${C.fmt(o.units_over)}</span>` : "0"}</td>
        <td class="small">${C.esc(o.assigned_name || o.finished_by_name || "–")}</td><td class="small">${C.dt(o.created_at)}</td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="empty" style="margin-top:12px"><h2>No orders here</h2><p>${V.filter === "open" && !V.search ? `Upload an order file to start. <a href="#/qc/upload">Upload orders</a>` : "Try another filter or search."}</p></div>`}`;
  let t; $("#qcsearch").oninput = e => { clearTimeout(t); t = setTimeout(() => { V.search = e.target.value; pageList(main).then(() => { const s = $("#qcsearch"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); }); }, 350); };
  C.setTimer(() => { if (C.route()[0] === "qc" && !C.route()[1] && document.activeElement !== $("#qcsearch")) pageList(main); }, 15000);
  C.cache.list = rows;
}

/* ---------- one order ---------- */
async function pageOrder(main, id) {
  let o, lines, events;
  try {
    [o, lines, events] = await Promise.all([C.q(C.sb.from("qc_order_list").select("*").eq("id", id).single()),
      C.q(C.sb.from("qc_lines").select("*").eq("order_id", id).order("line_no")), C.q(C.sb.from("qc_event_list").select("*").eq("order_id", id).order("created_at", {ascending: false}).limit(1000))]);
  } catch (e) { main.innerHTML = `<div class="empty"><h2>Order not found</h2><p><a href="#/qc">Back to Order QC</a></p></div>`; return; }
  C.cache.order = {o, lines, events};
  const open = ["pending", "in_progress", "short"].includes(o.status);
  const short = lines.filter(l => N(l.scanned_qty) < N(l.expected_qty));
  const totes = new Map();
  events.filter(e => e.tote && (e.event === "scan" || e.event === "undo")).forEach(e => { const k = e.tote; totes.set(k, (totes.get(k) || 0) + (e.event === "scan" ? N(e.qty) : -N(e.qty))); });
  const flags = events.filter(e => ["over", "unknown", "wrong_item", "undo"].includes(e.event));
  const banner = o.status === "short" ? `<div class="banner bad"><span>${C.fmt(o.units_short)} unit${N(o.units_short) === 1 ? "" : "s"} short on ${short.length} line${short.length === 1 ? "" : "s"}. Pick the missing units and give them to a QC operator, who scans the order again. If they can't be supplied, release the order short.</span></div>`
    : o.status === "in_progress" ? `<div class="banner warn"><span>${o.assigned_to ? `${C.esc(o.assigned_name || "An operator")} is checking this order (since ${C.dt(o.assigned_at)}).` : "Paused. Any operator can continue it by scanning the order number."}</span></div>`
    : o.status === "passed" ? `<div class="banner ok"><span>Passed QC on ${C.dt(o.finished_at)} by ${C.esc(o.finished_by_name || "–")}.${N(o.units_over) ? ` ${C.fmt(o.units_over)} extra unit${N(o.units_over) === 1 ? " was" : "s were"} set aside to return to stock.` : ""}</span></div>`
    : o.status === "released" ? `<div class="banner warn"><span>Released short by ${C.esc(o.closed_by_name || "–")} on ${C.dt(o.closed_at)}. Reason: ${C.esc(o.closed_note || "–")}</span></div>`
    : o.status === "cancelled" ? `<div class="banner"><span>Cancelled by ${C.esc(o.closed_by_name || "–")} on ${C.dt(o.closed_at)}. Reason: ${C.esc(o.closed_note || "–")}</span></div>` : "";
  main.innerHTML = `
    <div class="pagehead"><div><a href="#/qc" class="small">All orders</a><h1 style="margin-top:6px">${C.esc(o.order_no)}</h1>
      <span class="muted small">${C.esc([o.reference && "Ref " + o.reference, o.storer, o.customer].filter(Boolean).join(" · ") || "No details")}. Tote scan ${o.tote_mode === "off" ? "off" : o.tote_mode}, ${o.allow_qty ? "operators may type quantities" : "every unit scanned"}. Uploaded ${C.dt(o.created_at)}${o.source_file ? ` from ${C.esc(o.source_file)}` : ""}.</span></div>
      <div class="row"><span class="pill ${PILL[o.status]}">${statusLabel(o)}</span>
        ${open && o.assigned_to ? `<button class="btn" data-qa="act" data-a="unlock">Unlock</button>` : ""}
        ${o.status === "short" ? `<button class="btn go" data-qa="act" data-a="release">Release short</button>` : ""}
        ${open ? `<button class="btn ghost" data-qa="act" data-a="reset">Reset scans</button><button class="btn danger" data-qa="act" data-a="cancel">Cancel order</button>` : ""}
        <button class="btn" data-qa="export-order">Export</button></div></div>
    ${banner}
    <div class="stats">
      <div class="stat"><div class="l">Units scanned</div><div class="v">${C.fmt(o.units_scanned)}<span class="muted" style="font-size:1.1rem"> / ${C.fmt(o.units_expected)}</span></div><div class="progress" style="margin-top:8px"><b style="width:${N(o.units_expected) ? N(o.units_scanned) / N(o.units_expected) * 100 : 0}%"></b></div></div>
      <div class="stat"><div class="l">Lines complete</div><div class="v">${C.fmt(o.lines_done)}<span class="muted" style="font-size:1.1rem"> / ${C.fmt(o.lines_total)}</span></div></div>
      <div class="stat"><div class="l">Short</div><div class="v ${N(o.units_short) && o.status !== "pending" ? "var-neg" : ""}">${C.fmt(o.units_short)}</div></div>
      <div class="stat"><div class="l">Extra, set aside</div><div class="v">${C.fmt(o.units_over)}</div></div>
      <div class="stat"><div class="l">Refused scans</div><div class="v">${C.fmt(events.filter(e => e.event === "unknown" || e.event === "wrong_item").length)}</div></div>
      <div class="stat"><div class="l">Units removed</div><div class="v">${C.fmt(events.filter(e => e.event === "undo").reduce((a, e) => a + N(e.qty), 0))}</div></div>
    </div>
    <div class="tablewrap"><table><thead><tr><th class="n">#</th><th>SKU</th><th>Description</th><th>Barcode</th><th>Batch</th><th>UOM</th><th class="n">Ordered</th><th class="n">Scanned</th><th class="n">Short</th><th class="n">Set aside</th><th>Status</th></tr></thead><tbody>
      ${lines.map(l => { const e = N(l.expected_qty), s = N(l.scanned_qty), st = s >= e ? ["s-match", "Complete"] : s > 0 ? ["s-accepted", "Partly scanned"] : ["s-uncounted", "Not scanned"];
        return `<tr><td class="n">${l.line_no}</td><td><strong>${C.esc(l.sku)}</strong></td><td class="desc">${C.esc(l.description)}</td><td class="small">${C.esc(l.barcode || "–")}</td><td>${C.esc(l.batch || "")}</td><td>${C.esc(l.uom || "")}</td>
          <td class="n">${C.fmt(e)}</td><td class="n">${C.fmt(s)}</td><td class="n ${e - s > 0 && o.status !== "pending" ? "var-neg" : ""}">${C.fmt(e - s)}</td><td class="n">${N(l.over_qty) ? C.fmt(l.over_qty) : "0"}</td>
          <td><span class="status ${st[0]}">${st[1]}</span></td></tr>`; }).join("")}
    </tbody></table></div>
    <div class="twocol" style="margin-top:16px">
      <div class="panel"><h3 style="margin-bottom:8px">Exceptions</h3>${flags.length ? `<table><tbody>${flags.slice(0, 50).map(e => `<tr><td class="small">${C.dt(e.created_at)}</td><td>${EVENT[e.event] || C.esc(e.event)}</td><td>${C.esc(e.sku || e.code || "")}</td><td class="n">${e.qty != null ? C.fmt(e.qty) : ""}</td><td class="small" style="white-space:normal;min-width:150px">${C.esc(e.note || "")}</td><td class="small">${C.esc(e.user_name || "")}</td></tr>`).join("")}</tbody></table>` : `<p class="muted small">No extra units, refused scans or removed units.</p>`}</div>
      <div class="panel"><h3 style="margin-bottom:8px">Totes</h3>${totes.size ? `<table><tbody>${[...totes].map(([t, n]) => `<tr><td><span class="tag">${C.esc(t)}</span></td><td class="n">${C.fmt(n)} units</td></tr>`).join("")}</tbody></table>` : `<p class="muted small">${o.tote_mode === "off" ? "Tote scanning is off for this order." : "No totes scanned yet."}</p>`}</div>
    </div>
    <h3 style="margin:18px 0 0">Activity</h3>
    <div class="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>Action</th><th>SKU / code</th><th class="n">Qty</th><th>Tote</th><th>Note</th><th>Device</th></tr></thead><tbody>
      ${events.map(e => `<tr><td class="small">${C.dt(e.created_at)}</td><td>${C.esc(e.user_name || "–")}</td><td>${EVENT[e.event] || C.esc(e.event)}</td><td>${C.esc(e.sku || e.code || "")}</td><td class="n">${e.qty != null ? C.fmt(e.qty) : ""}</td><td>${C.esc(e.tote || "")}</td><td class="small" style="white-space:normal;min-width:160px">${C.esc(e.note || "")}</td><td class="small muted">${C.esc(e.device || "")}</td></tr>`).join("")}
    </tbody></table></div>
    <dialog id="qcdlg"><form method="dialog" id="qcdlgf"><h2 id="qcdlg-t" style="margin-bottom:8px"></h2><p class="hint" id="qcdlg-h"></p>
      <label class="field" style="margin-bottom:16px">Reason<textarea name="note" rows="3" required style="min-height:70px;font-family:var(--sans)"></textarea></label>
      <div class="row"><button class="btn primary" value="ok" id="qcdlg-ok"></button><button class="btn ghost" value="cancel" formnovalidate>Back</button></div></form></dialog>`;
  if (open) C.setTimer(async () => { if (C.route()[0] === "qc" && C.route()[1] === id && !$("#qcdlg").open) pageOrder(main, id); }, 15000);
}
const ACTIONS = {
  unlock: ["Unlock this order?", "The operator's phone stops saving scans for this order. Anyone can then continue it by scanning the order number. Scans already saved are kept.", "Unlock", false],
  release: ["Release short", "The order is closed as short and can be dispatched without the missing units. Record who approved it and why. This can't be undone.", "Release short", true],
  reset: ["Reset scans", "All scanned and set-aside quantities go back to 0 so the order can be checked again from the start. The history is kept.", "Reset scans", true],
  cancel: ["Cancel order", "The order can't be checked any more. You can upload it again afterwards. This can't be undone.", "Cancel order", true]
};
async function act(a) {
  const {o} = C.cache.order, [title, hint, label, needNote] = ACTIONS[a];
  const d = $("#qcdlg"), f = $("#qcdlgf");
  $("#qcdlg-t").textContent = title; $("#qcdlg-h").textContent = hint; $("#qcdlg-ok").textContent = label;
  f.elements.namedItem("note").required = needNote; f.elements.namedItem("note").value = "";
  f.elements.namedItem("note").placeholder = a === "release" ? "e.g. Out of stock, customer agreed by phone (Omar)" : needNote ? "Required" : "Optional";
  d.showModal();
  d.onclose = async () => {
    if (d.returnValue !== "ok") return;
    const note = f.elements.namedItem("note").value.trim();
    if (needNote && !note) { C.toast("Enter a reason.", true); return; }
    const done = {unlock: "Order unlocked", release: "Order released short", reset: "Scans reset", cancel: "Order cancelled"}[a];
    if (await C.run(() => C.q(C.sb.rpc("qc_supervise", {p_order: o.id, p_action: a, p_note: note || null})), done)) pageOrder($("#main"), o.id);
  };
}

/* ---------- upload ---------- */
const FIELDS = [["order_no", "Order number", true], ["reference", "Reference"], ["storer", "Storer / owner"], ["customer", "Customer"], ["sku", "SKU", true],
  ["barcode", "Product barcode"], ["description", "Description"], ["qty", "Order quantity", true], ["uom", "UOM"], ["batch", "Batch / lot"]];
const DESC_BC = /^\s*(\d{8,14})\s*[-–|:]\s*(.+)$/;
function guessMap(h) {
  const L = h.map(x => String(x).toLowerCase().trim());
  const find = (...res) => { for (const re of res) { const i = L.findIndex(x => re.test(x)); if (i >= 0) return i; } return -1; };
  const m = {};
  m.reference = find(/extern.*order|^ext.*key|cust.*(po|order)|^po\b|po.?(no|num)|reference|^ref/);
  m.order_no = L.findIndex((x, i) => i !== m.reference && /^orderkey$|order.?(no|num|number|key|id|#)|^order$|sales.?order|^so.?(no|num)?$|shipment.?(no|id)|delivery.?(no|num)|^doc(ument)?.?(no|num)/.test(x));
  if (m.order_no < 0) m.order_no = L.findIndex((x, i) => i !== m.reference && /order/.test(x) && !/qty|quantity|date|line|type|status/.test(x));
  m.storer = find(/storer|owner|principal|^client/);
  m.customer = find(/c_company|customer.?name|consignee.?name|ship.?to.?name|^company/, /consignee|customer|ship.?to|deliver.?to/);
  if (m.customer === m.reference) m.customer = -1;
  m.barcode = find(/barcode|ean|upc|gtin|alt.?sku/);
  m.sku = L.findIndex((x, i) => i !== m.barcode && /^sku$|sku|item.?(code|no)?|material|article|product.?(code|no)?|part/.test(x) && !/desc|name/.test(x));
  m.description = find(/desc/, /name/);
  const qtyish = (x, i) => /qty|quantity|units|pcs/.test(x) && !/date|uom|case|pack|alloc|avail|pick|ship|second|uom2/.test(x);
  m.qty = find(/^orig.*qty|original.?qty|order(ed)?.?qty|qty.?order|^openqty$|open.?qty/);
  if (m.qty < 0) m.qty = L.findIndex(qtyish);
  if (m.qty < 0) m.qty = L.findIndex(x => /qty|quantity/.test(x) && !/date|uom/.test(x));
  m.uom = find(/^uom$|uom|unit of|^unit$/);
  m.batch = find(/^batch|lot.?(no|num)|^lot$|batch/, /^lottable0?2$/);
  return m;
}
async function pageUpload(main) {
  const p = V.pending;
  if (!p) {
    main.innerHTML = `<div class="pagehead"><div><a href="#/qc" class="small">All orders</a><h1 style="margin-top:6px">Upload orders</h1></div></div>
      <div class="panel" style="max-width:820px"><h2 style="margin-bottom:6px">Choose the order file</h2>
      <p class="hint">Export the picked orders from your WMS as Excel (.xlsx, .xls) or CSV, one row per order line. Required columns: order number, SKU and order quantity. Helpful: product barcode, description, storer, customer, UOM. One file can hold many orders.</p>
      <label class="drop" id="drop"><input type="file" id="file" accept=".xlsx,.xls,.csv,.txt,.tsv"><strong>Choose a file</strong><br><span class="small muted">or drop it here</span></label></div>`;
    $("#file").onchange = e => e.target.files[0] && readFile(e.target.files[0], main);
    const d = $("#drop"); d.ondragover = e => { e.preventDefault(); d.classList.add("over"); }; d.ondragleave = () => d.classList.remove("over");
    d.ondrop = e => { e.preventDefault(); d.classList.remove("over"); e.dataTransfer.files[0] && readFile(e.dataTransfer.files[0], main); };
    return;
  }
  const head = p.header ? p.table[0] : p.table[0].map((_, k) => `Column ${k + 1}`);
  const opts = sel => `<option value="-1">Not in file</option>` + head.map((h, k) => `<option value="${k}" ${sel === k ? "selected" : ""}>${C.esc(h || `Column ${k + 1}`)}</option>`).join("");
  const sample = p.table.slice(p.header ? 1 : 0, (p.header ? 1 : 0) + 6);
  main.innerHTML = `<div class="pagehead"><div><a href="#/qc" class="small">All orders</a><h1 style="margin-top:6px">Upload orders</h1></div></div>
    <div class="panel" id="uppanel"><h2 style="margin-bottom:6px">Check the columns</h2>
    <p class="hint"><strong>${C.esc(p.name)}</strong>: ${C.fmt(p.table.length - (p.header ? 1 : 0))} rows.</p>
    <label class="check small"><input type="checkbox" id="hdr" ${p.header ? "checked" : ""}> First row is column names</label>
    <label class="check small" style="margin-top:6px"><input type="checkbox" id="descbc" ${p.descBarcode ? "checked" : ""}> Product barcode is at the start of the description (for example <code>9345156233829-Hair brush</code>)</label>
    <div class="map">${FIELDS.map(([k, l, req]) => `<label class="field">${l}${req ? " (required)" : ""}<select data-map="${k}">${opts(p.map[k])}</select></label>`).join("")}</div>
    <p class="hint">Operators check against <strong>Order quantity</strong>. If your file has both ordered and picked quantity, choose the one the customer should receive.</p>
    <fieldset class="opts"><legend>How operators check these orders</legend><div class="grid-form">
      <label class="field">Tote scan<select id="tote"><option value="off" ${p.tote === "off" ? "selected" : ""}>Off</option><option value="optional" ${p.tote === "optional" ? "selected" : ""}>Optional: operator can scan a tote</option><option value="required" ${p.tote === "required" ? "selected" : ""}>Required before scanning products</option></select></label>
      <label class="check" style="align-self:end;padding-bottom:10px"><input type="checkbox" id="allowqty" ${p.allowQty ? "checked" : ""}> Operators may type a quantity (for full cases)</label></div>
      <p class="hint">With quantity typing off, every unit must be scanned. Either way, anything above the order quantity is refused.</p></fieldset>
    <div id="upsum"></div>
    <div class="tablewrap"><table><thead><tr>${head.map(h => `<th>${C.esc(h)}</th>`).join("")}</tr></thead><tbody>${sample.map(r => `<tr>${head.map((_, k) => `<td>${C.esc(r[k])}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
    <div class="row" style="margin-top:14px"><button class="btn primary" data-qa="do-upload">Upload orders</button><button class="btn ghost" data-qa="cancel-upload">Choose another file</button></div></div>`;
  $("#hdr").onchange = e => { p.header = e.target.checked; p.map = p.header ? guessMap(p.table[0]) : Object.fromEntries(FIELDS.map(([k], i) => [k, -1])); pageUpload(main); };
  $$("[data-map]").forEach(sel => sel.onchange = () => { p.map[sel.dataset.map] = +sel.value; summarise(); });
  $("#descbc").onchange = e => { p.descBarcode = e.target.checked; summarise(); };
  $("#tote").onchange = e => { p.tote = e.target.value; };
  $("#allowqty").onchange = e => { p.allowQty = e.target.checked; };
  summarise();
}
async function readFile(file, main) {
  C.toast(`Reading ${file.name}…`);
  try {
    const table = await C.readTable(file);
    const g = guessMap(table[0]), header = g.order_no >= 0 || g.sku >= 0;
    const col = g.description;
    const sample = table.slice(1, 500).filter(r => r[col]);
    const descBarcode = header && g.barcode < 0 && col >= 0 && sample.length > 0 && sample.filter(r => DESC_BC.test(String(r[col]))).length / sample.length >= 0.2;
    V.pending = {table, name: file.name, header, map: header ? g : Object.fromEntries(FIELDS.map(([k]) => [k, -1])), descBarcode, tote: "off", allowQty: false};
    pageUpload(main);
  } catch (e) { C.fail(e.message ? e : new Error("Couldn't read that file. Save it as .xlsx or .csv and try again.")); }
}
function build() {
  const p = V.pending, m = p.map;
  const cell = (r, f, max = 200) => m[f] >= 0 ? String(r[m[f]] ?? "").trim().slice(0, max) : "";
  const num = v => { const s = String(v ?? "").replace(/,/g, "").trim(); const n = parseFloat(s); return /^-?\d*\.?\d+$/.test(s) ? n : NaN; };
  const orders = new Map(); let skipped = 0, merged = 0, zero = 0, sci = 0, mixed = 0;
  for (const r of (p.header ? p.table.slice(1) : p.table)) {
    const no = cell(r, "order_no", 60), sku = cell(r, "sku", 60), q = num(m.qty >= 0 ? r[m.qty] : "");
    if (!no || !sku) { if (r.some(x => String(x).trim())) skipped++; continue; }
    if (!(q > 0)) { zero++; continue; }
    const storer = cell(r, "storer", 60), key = storer.toUpperCase() + "\u0000" + no.toUpperCase();
    if (!orders.has(key)) orders.set(key, {order_no: no, storer, reference: cell(r, "reference", 60), customer: cell(r, "customer", 120), lines: new Map()});
    const o = orders.get(key);
    let barcode = cell(r, "barcode", 60), description = cell(r, "description", 200);
    if (/^\d(\.\d+)?E\+\d+$/i.test(barcode)) { barcode = ""; sci++; }
    if (p.descBarcode) { const mm = description.match(DESC_BC); if (mm) { if (!barcode) barcode = mm[1]; description = mm[2].trim(); } }
    const k = sku.toUpperCase(), batch = cell(r, "batch", 60);
    if (o.lines.has(k)) {
      const l = o.lines.get(k); l.qty += q; merged++;
      if (batch && !l.batches.includes(batch)) l.batches.push(batch);
      if (!l.barcode && barcode) l.barcode = barcode;
      if (m.uom >= 0 && cell(r, "uom", 20) && l.uom && cell(r, "uom", 20).toUpperCase() !== l.uom.toUpperCase()) mixed++;
    } else o.lines.set(k, {sku, barcode, description, uom: cell(r, "uom", 20), batches: batch ? [batch] : [], qty: q});
  }
  const list = [...orders.values()].map(o => ({...o, lines: [...o.lines.values()].map(l => ({sku: l.sku, barcode: l.barcode, description: l.description, uom: l.uom, batch: l.batches.join(", ").slice(0, 60), qty: Math.round(l.qty * 1000) / 1000}))}));
  const codes = new Map(); let shared = 0;
  list.forEach(o => { codes.clear(); o.lines.forEach(l => { if (!l.barcode) return; const c = l.barcode.toUpperCase(); if (codes.has(c)) shared++; codes.set(c, 1); }); });
  return {list, skipped, merged, zero, sci, mixed, shared, noBarcode: list.reduce((a, o) => a + o.lines.filter(l => !l.barcode).length, 0)};
}
function summarise() {
  const p = V.pending, m = p.map, box = $("#upsum"); if (!box) return;
  if (m.order_no < 0 || m.sku < 0 || m.qty < 0) { box.innerHTML = `<div class="banner warn"><span>Choose the columns for order number, SKU and order quantity.</span></div>`; return; }
  const b = build(), lines = b.list.reduce((a, o) => a + o.lines.length, 0), units = b.list.reduce((a, o) => a + o.lines.reduce((x, l) => x + l.qty, 0), 0);
  const warn = [b.skipped && `${C.fmt(b.skipped)} rows without an order number or SKU will be skipped`, b.zero && `${C.fmt(b.zero)} rows with a quantity of 0 or no quantity will be skipped`,
    b.merged && `${C.fmt(b.merged)} rows for the same SKU in the same order will be added together`, b.mixed && `${C.fmt(b.mixed)} of those merged rows have a different UOM: check the quantity column`,
    b.sci && `${C.fmt(b.sci)} barcodes were damaged by Excel (like 9.34516E+12) and were ignored; operators can scan or type the SKU instead`,
    b.noBarcode && `${C.fmt(b.noBarcode)} lines have no barcode, so operators scan or type the SKU for those`,
    b.shared && `${C.fmt(b.shared)} lines share a barcode with another SKU in the same order; the operator will be asked which SKU it is`].filter(Boolean);
  box.innerHTML = `<div class="banner ${b.list.length ? "ok" : "bad"}" style="margin-top:12px"><span>${b.list.length ? `${C.fmt(b.list.length)} order${b.list.length === 1 ? "" : "s"}, ${C.fmt(lines)} lines, ${C.fmt(units)} units ready to upload.` : "No usable rows. Each row needs an order number, a SKU and a quantity above 0."}</span></div>
    ${warn.length ? `<ul class="hint" style="margin:0 0 8px 18px;padding:0">${warn.map(w => `<li>${C.esc(w)}.</li>`).join("")}</ul>` : ""}
    ${b.list.length ? `<details style="margin-bottom:6px"><summary class="small">Preview orders</summary><div class="tablewrap"><table><thead><tr><th>Order</th><th>Storer</th><th>Customer</th><th class="n">Lines</th><th class="n">Units</th></tr></thead><tbody>${b.list.slice(0, 30).map(o => `<tr><td><strong>${C.esc(o.order_no)}</strong>${o.reference ? ` <span class="muted small">${C.esc(o.reference)}</span>` : ""}</td><td>${C.esc(o.storer || "–")}</td><td>${C.esc(o.customer || "–")}</td><td class="n">${o.lines.length}</td><td class="n">${C.fmt(o.lines.reduce((a, l) => a + l.qty, 0))}</td></tr>`).join("")}</tbody></table></div>${b.list.length > 30 ? `<p class="small muted">and ${C.fmt(b.list.length - 30)} more</p>` : ""}</details>` : ""}`;
}
async function doUpload(btn) {
  const p = V.pending, m = p.map;
  if (m.order_no < 0 || m.sku < 0 || m.qty < 0) return C.toast("Choose the columns for order number, SKU and order quantity.", true);
  const b = build();
  if (!b.list.length) return C.toast("No usable rows. Each row needs an order number, a SKU and a quantity above 0.", true);
  const panel = $("#uppanel");
  panel.innerHTML = `<h2>Uploading ${C.fmt(b.list.length)} orders</h2><div class="bigprog"><b id="upbar" style="width:0%"></b></div><p class="small muted" id="uptext">Starting…</p><p class="hint">Keep this page open until the upload finishes.</p>`;
  let orders = 0, lines = 0; const dupes = [];
  try {
    for (let i = 0; i < b.list.length;) {
      const part = []; let n = 0;
      while (i < b.list.length && (part.length < 200 && n < 4000)) { part.push(b.list[i]); n += b.list[i].lines.length; i++; }
      let tries = 0, res;
      for (;;) { try { res = await C.q(C.sb.rpc("qc_import", {p_orders: part, p_source_file: p.name, p_tote_mode: p.tote, p_allow_qty: p.allowQty})); break; } catch (e) { if (++tries > 2 || (e.code && /^[0-9A-Z]{5}$/.test(e.code) && e.code !== "PGRST301")) throw e; await new Promise(r => setTimeout(r, 1000 * tries)); } }
      orders += res.orders; lines += res.lines; dupes.push(...(res.duplicates || []));
      $("#upbar").style.width = Math.min(100, i / b.list.length * 100) + "%"; $("#uptext").textContent = `${C.fmt(i)} of ${C.fmt(b.list.length)} orders processed`;
    }
    V.pending = null;
    V.note = `${C.fmt(orders)} order${orders === 1 ? "" : "s"} with ${C.fmt(lines)} lines uploaded.${dupes.length ? ` ${C.fmt(dupes.length)} already uploaded and skipped: ${dupes.slice(0, 8).join(", ")}${dupes.length > 8 ? "…" : ""}. To load one again, cancel the old one first.` : ""}`;
    V.filter = "open"; V.search = "";
    C.toast(`${C.fmt(orders)} orders uploaded`);
    C.go("qc");
  } catch (e) {
    C.fail(e);
    $("#uptext").textContent = `Stopped after ${C.fmt(orders)} orders. Upload the same file again: orders already uploaded are skipped, so nothing is loaded twice.`;
  }
}

/* ---------- export ---------- */
async function exportRows(orderRows, name) {
  C.toast("Preparing the Excel file…");
  try {
    const ids = orderRows.map(o => o.id), lines = [];
    for (let i = 0; i < ids.length; i += 200) { let from = 0; for (;;) { const d = await C.q(C.sb.from("qc_line_v").select("*").in("order_id", ids.slice(i, i + 200)).order("order_id").order("line_no").range(from, from + 999)); lines.push(...d); if (d.length < 1000) break; from += 1000; } }
    const byId = new Map(orderRows.map(o => [o.id, o]));
    const X = window.XLSX, wb = X.utils.book_new();
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(orderRows.map(o => ({Order: o.order_no, Reference: o.reference, Storer: o.storer, Customer: o.customer, Status: statusLabel(o), Lines: N(o.lines_total), "Lines complete": N(o.lines_done),
      "Units ordered": N(o.units_expected), "Units scanned": N(o.units_scanned), "Units short": N(o.units_short), "Units set aside": N(o.units_over), "Tote scan": o.tote_mode, Operator: o.assigned_name || o.finished_by_name || "",
      Uploaded: o.created_at ? new Date(o.created_at) : "", Started: o.started_at ? new Date(o.started_at) : "", Finished: o.finished_at ? new Date(o.finished_at) : "", "Released / cancelled by": o.closed_by_name || "", Reason: o.closed_note || "", "Source file": o.source_file || ""}))), "Orders");
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(lines.map(l => ({Order: l.order_no, Reference: l.reference, Storer: l.storer, Customer: l.customer, "Order status": statusLabel(byId.get(l.order_id) || {status: l.order_status}), Line: l.line_no, SKU: l.sku, Barcode: l.barcode, Description: l.description,
      Batch: l.batch, UOM: l.uom, Ordered: N(l.expected_qty), Scanned: N(l.scanned_qty), Short: N(l.expected_qty) - N(l.scanned_qty), "Set aside": N(l.over_qty)}))), "Lines");
    const ex = lines.filter(l => (["short", "released"].includes(l.order_status) && N(l.expected_qty) > N(l.scanned_qty)) || N(l.over_qty) > 0).map(l => ({Order: l.order_no, Customer: l.customer, "Order status": statusLabel(byId.get(l.order_id) || {status: l.order_status}), SKU: l.sku, Description: l.description, Ordered: N(l.expected_qty), Scanned: N(l.scanned_qty), Short: N(l.expected_qty) - N(l.scanned_qty), "Set aside": N(l.over_qty)}));
    X.utils.book_append_sheet(wb, X.utils.json_to_sheet(ex.length ? ex : [{Note: "No short or extra units"}]), "Short and extra");
    C.saveWorkbook(wb, name);
  } catch (e) { C.fail(e); }
}

/* ---------- clicks ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-qa]"); if (!b || !C) return;
  if (b.tagName === "A") e.preventDefault();
  switch (b.dataset.qa) {
    case "filter": V.filter = b.dataset.f; pageList($("#main")); break;
    case "open": C.go("qc/" + b.dataset.id); break;
    case "act": act(b.dataset.a); break;
    case "do-upload": doUpload(b); break;
    case "cancel-upload": V.pending = null; pageUpload($("#main")); break;
    case "export-list": exportRows(C.cache.list || [], `order-qc-${new Date().toISOString().slice(0, 10)}.xlsx`); break;
    case "export-order": { const o = C.cache.order.o; exportRows([o], `order-qc-${o.order_no.replace(/[^\w\-]+/g, "_")}.xlsx`); break; }
  }
});

window.CCQc = {page, _test: {guessMap, build: () => build(), V}};
})();
