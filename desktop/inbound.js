/* Stowra console: inbound. Upload ASNs, watch receiving on the phones, check short / extra / damaged goods,
   close the ASN and print the goods received note (GRN). */
(() => {
"use strict";
let C = null;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const N = v => Number(v) || 0;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const d8 = s => s ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, {day: "2-digit", month: "short", year: "numeric"}) : "–";
const STATUS = {open: "Expected", receiving: "Receiving", received: "Received, to close", closed: "Closed", cancelled: "Cancelled"};
const PILL = {open: "draft", receiving: "open", received: "closed", closed: "reconciled", cancelled: "draft"};
const FLAG = {excess: "Extra", not_on_asn: "Not on ASN", short_life: "Short shelf life", expired: "Expired"};
const V = {f: "open", q: "", client: "", up: null, result: null};

function page(main, ctx, id) {
  C = ctx;
  if (id === "upload") return pageUpload(main);
  if (id) return pageAsn(main, id);
  return pageList(main);
}
const term = s => String(s || "").replace(/[,()%*\\]/g, " ").trim();
let clientsCache = null;
async function clients() { if (!clientsCache) { try { clientsCache = await C.q(C.sb.from("clients").select("id,code,name").order("code")); } catch { clientsCache = []; } } return clientsCache; }

/* ---------- list ---------- */
async function pageList(main) {
  await clients();
  let rows = [], open = [];
  try {
    let qq = C.sb.from("asn_list").select("*").order("created_at", {ascending: false}).limit(300);
    if (V.f === "open") qq = qq.in("status", ["open", "receiving", "received"]); else if (V.f !== "all") qq = qq.eq("status", V.f);
    if (V.client) qq = qq.eq("client_code", V.client);
    const t = term(V.q); if (t) qq = qq.or(`asn_no.ilike.%${t}%,ext_ref.ilike.%${t}%,supplier.ilike.%${t}%`);
    [rows, open] = await Promise.all([C.q(qq), C.q(C.sb.from("asn_list").select("status,short_qty,excess_qty,damaged_qty,flagged_pallets").in("status", ["open", "receiving", "received"]).limit(5000))]);
  } catch (e) { C.fail(e); }
  const cnt = s => open.filter(a => a.status === s).length;
  main.innerHTML = `
    <div class="pagehead"><div><h1>Inbound</h1><p class="muted small" style="margin:4px 0 0">ASNs expected from clients. Operators receive them in the phone's Inbound tab: scan the product, enter quantity, batch and expiry, and each pallet goes into stock in the receiving location, ready to put away.</p></div>
      <div class="row"><a class="btn go" href="#/inbound/upload">Upload ASNs</a></div></div>
    ${V.result ? `<div class="banner ok"><span>${esc(V.result)}</span></div>` : ""}
    <div class="stats">
      <div class="stat"><div class="l">Expected</div><div class="v">${C.fmt(cnt("open"))}</div></div>
      <div class="stat"><div class="l">Receiving now</div><div class="v">${C.fmt(cnt("receiving"))}</div></div>
      <div class="stat"><div class="l">Received, to close</div><div class="v ${cnt("received") ? "warnc" : ""}">${C.fmt(cnt("received"))}</div></div>
      <div class="stat"><div class="l">Open ASNs with differences</div><div class="v ${open.some(a => N(a.excess_qty) || N(a.damaged_qty) || N(a.flagged_pallets)) ? "var-neg" : ""}">${C.fmt(open.filter(a => a.status !== "open" && (N(a.short_qty) || N(a.excess_qty) || N(a.damaged_qty) || N(a.flagged_pallets))).length)}</div></div>
    </div>
    <div class="toolbar" style="gap:8px;justify-content:flex-start;flex-wrap:wrap">
      <div class="chips">${[["open", "Open"], ["receiving", "Receiving"], ["received", "To close"], ["closed", "Closed"], ["cancelled", "Cancelled"], ["all", "All"]].map(([k, l]) => `<button class="chip" aria-pressed="${V.f === k}" data-ia="filter" data-f="${k}">${l}</button>`).join("")}</div>
      <select id="inclient" class="search" style="max-width:200px"><option value="">All clients</option>${clientsCache.map(c => `<option ${c.code === V.client ? "selected" : ""}>${esc(c.code)}</option>`).join("")}</select>
      <input class="search" id="insearch" placeholder="Search ASN, PO or supplier" value="${esc(V.q)}"></div>
    ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>ASN</th><th>Client</th><th>Supplier</th><th>Expected</th><th>Status</th><th>Progress</th><th class="n">Short</th><th class="n">Extra</th><th class="n">Damaged</th><th class="n">Pallets</th><th>Last scan</th></tr></thead><tbody>
      ${rows.map(a => { const p = N(a.expected_qty) ? Math.min(100, (N(a.received_qty) + N(a.damaged_qty)) / N(a.expected_qty) * 100) : 0, started = a.status !== "open";
        return `<tr style="cursor:pointer" data-ia="open" data-id="${esc(a.id)}"><td><strong>${esc(a.asn_no)}</strong>${a.ext_ref ? `<br><span class="small muted">${esc(a.ext_ref)}</span>` : ""}</td><td>${esc(a.client_code)}</td><td class="small">${esc(a.supplier || "–")}</td><td class="small">${d8(a.expected_date)}</td>
          <td><span class="pill ${PILL[a.status]}">${STATUS[a.status]}</span></td>
          <td style="min-width:150px"><div class="progress"><b style="width:${p}%"></b></div><span class="small muted">${C.fmt(N(a.received_qty) + N(a.damaged_qty))} of ${C.fmt(a.expected_qty)} units, ${C.fmt(a.lines)} lines</span></td>
          <td class="n ${started && N(a.short_qty) ? "var-neg" : ""}">${started ? C.fmt(a.short_qty) : "–"}</td><td class="n ${N(a.excess_qty) ? "warnc" : ""}">${C.fmt(a.excess_qty)}</td><td class="n ${N(a.damaged_qty) ? "var-neg" : ""}">${C.fmt(a.damaged_qty)}</td>
          <td class="n">${C.fmt(a.pallets)}${N(a.flagged_pallets) ? ` <span class="xs-crit">${C.fmt(a.flagged_pallets)} flagged</span>` : ""}</td><td class="small">${a.last_at ? C.dt(a.last_at) : "–"}</td></tr>`; }).join("")}
      </tbody></table></div>` : `<div class="empty" style="margin-top:12px"><h2>No ASNs here</h2><p>${V.f === "open" && !V.q ? `Upload the ASNs you expect. <a href="#/inbound/upload">Upload ASNs</a>` : "Try another filter or search."}</p></div>`}`;
  V.result = null;
  $("#inclient").onchange = e => { V.client = e.target.value; pageList(main); };
  const s = $("#insearch"); let t; s.oninput = () => { clearTimeout(t); t = setTimeout(() => { V.q = s.value; pageList(main).then(() => { const x = $("#insearch"); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }); }, 350); };
  C.setTimer(() => { if (C.route()[0] === "inbound" && !C.route()[1] && document.activeElement !== $("#insearch")) pageList(main); }, 20000);
}

/* ---------- one ASN ---------- */
async function pageAsn(main, id) {
  let a, lines, recs;
  try {
    [a, lines, recs] = await Promise.all([C.q(C.sb.from("asn_list").select("*").eq("id", id).single()), C.q(C.sb.from("asn_line_v").select("*").eq("asn_id", id).order("line_no")),
      C.q(C.sb.from("receipt_v").select("*").eq("asn_id", id).order("created_at", {ascending: false}))]);
  } catch (e) { main.innerHTML = `<div class="empty"><h2>ASN not found</h2><p><a href="#/inbound">Back to Inbound</a></p></div>`; return; }
  C.cache.asn = {a, lines, recs};
  const live = recs.filter(r => !r.cancelled), flagged = live.filter(r => r.flags.length || r.condition === "damaged"), notAway = live.filter(r => !r.put_away && r.current_location);
  const started = a.status !== "open", openish = ["open", "receiving", "received"].includes(a.status);
  const banner = a.status === "received" ? `<div class="banner warn"><span>Unloading finished on ${C.dt(a.received_at)}. Check the differences below, then close the ASN.</span></div>`
    : a.status === "closed" ? `<div class="banner ok"><span>Closed by ${esc(a.closed_by_name || "–")} on ${C.dt(a.closed_at)}.${a.close_note ? ` Note: ${esc(a.close_note)}` : ""}</span></div>`
    : a.status === "cancelled" ? `<div class="banner"><span>Cancelled by ${esc(a.closed_by_name || "–")} on ${C.dt(a.closed_at)}. Reason: ${esc(a.close_note || "–")}</span></div>` : "";
  main.innerHTML = `
    <div class="pagehead"><div><a href="#/inbound" class="small">Inbound</a><h1 style="margin-top:6px">${esc(a.asn_no)}</h1>
      <span class="muted small">${esc([a.client_code, a.ext_ref && "PO " + a.ext_ref, a.supplier].filter(Boolean).join(" · "))}. Expected ${d8(a.expected_date)}. Uploaded ${C.dt(a.created_at)}${a.source_file ? ` from ${esc(a.source_file)}` : ""}.</span></div>
      <div class="row"><span class="pill ${PILL[a.status]}">${STATUS[a.status]}</span>
        ${started ? `<button class="btn" data-ia="grn">Print GRN</button>` : ""}<button class="btn" data-ia="export">Export</button>
        ${a.status === "open" ? `<button class="btn danger" data-ia="status" data-s="cancelled">Cancel ASN</button>` : ""}
        ${openish && started ? `<button class="btn go" data-ia="status" data-s="closed">Close ASN</button>` : ""}
        ${a.status === "closed" || a.status === "received" ? `<button class="btn ghost" data-ia="status" data-s="receiving">Reopen</button>` : ""}</div></div>
    ${banner}
    ${flagged.length ? `<div class="banner bad"><span>${C.fmt(flagged.length)} pallet${flagged.length === 1 ? "" : "s"} flagged: ${esc([...new Set(flagged.flatMap(r => r.flags.map(f => FLAG[f] || f).concat(r.condition === "damaged" ? ["Damaged"] : [])))].join(", "))}. Flagged pallets are on hold except extras and items not on the ASN.</span></div>` : ""}
    <div class="stats">
      <div class="stat"><div class="l">Received</div><div class="v">${C.fmt(N(a.received_qty) + N(a.damaged_qty))}<span class="muted" style="font-size:1.1rem"> / ${C.fmt(a.expected_qty)}</span></div><div class="progress" style="margin-top:8px"><b style="width:${N(a.expected_qty) ? Math.min(100, (N(a.received_qty) + N(a.damaged_qty)) / N(a.expected_qty) * 100) : 0}%"></b></div></div>
      <div class="stat"><div class="l">Short</div><div class="v ${started && N(a.short_qty) ? "var-neg" : ""}">${C.fmt(a.short_qty)}</div></div>
      <div class="stat"><div class="l">Extra</div><div class="v ${N(a.excess_qty) ? "warnc" : ""}">${C.fmt(a.excess_qty)}</div></div>
      <div class="stat"><div class="l">Damaged</div><div class="v ${N(a.damaged_qty) ? "var-neg" : ""}">${C.fmt(a.damaged_qty)}</div></div>
      <div class="stat"><div class="l">Pallets</div><div class="v">${C.fmt(live.length)}</div></div>
      <div class="stat"><div class="l">Waiting for putaway</div><div class="v">${C.fmt(notAway.length)}</div></div>
    </div>
    <div class="tablewrap"><table><thead><tr><th class="n">#</th><th>SKU</th><th>Description</th><th>Expected batch / expiry</th><th class="n">Expected</th><th class="n">Received good</th><th class="n">Damaged</th><th class="n">Short</th><th class="n">Extra</th><th>Status</th></tr></thead><tbody>
      ${lines.map(l => { const got = N(l.received_qty) + N(l.damaged_qty), e = N(l.expected_qty), st = l.not_on_asn ? ["s-out", "Not on ASN"] : got === e && !N(l.damaged_qty) ? ["s-match", "Complete"] : got > e ? ["s-accepted", "Extra"] : got ? ["s-accepted", N(l.damaged_qty) && got >= e ? "Damaged" : "Part received"] : ["s-uncounted", "Not received"];
        return `<tr><td class="n">${l.line_no}</td><td><a href="#/stock/item/${esc(l.item_id)}"><strong>${esc(l.sku)}</strong></a>${l.barcode ? `<br><span class="small muted">${esc(l.barcode)}</span>` : ""}</td><td class="desc">${esc(l.description)}</td>
          <td class="small">${esc([l.batch, l.expiry_date && d8(l.expiry_date)].filter(Boolean).join(" · ") || "–")}</td><td class="n">${C.fmt(e)}</td><td class="n">${C.fmt(l.received_qty)}</td><td class="n ${N(l.damaged_qty) ? "var-neg" : ""}">${C.fmt(l.damaged_qty)}</td>
          <td class="n ${started && N(l.short_qty) ? "var-neg" : ""}">${C.fmt(l.short_qty)}</td><td class="n ${N(l.excess_qty) ? "warnc" : ""}">${C.fmt(l.excess_qty)}</td><td><span class="status ${st[0]}">${st[1]}</span></td></tr>`; }).join("")}
    </tbody></table></div>
    <h3 style="margin:18px 0 0">Pallets received</h3>
    ${recs.length ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>LPN</th><th>SKU</th><th>Batch</th><th>Expiry</th><th class="n">Qty</th><th>Condition / flags</th><th>Received at</th><th>Now in</th><th></th></tr></thead><tbody>
      ${recs.map(r => `<tr class="${r.cancelled ? "muted" : ""}"><td class="small">${C.dt(r.created_at)}</td><td>${esc(r.user_name || "–")}</td><td class="small">${esc(r.lpn)}</td><td><strong>${esc(r.sku)}</strong><br><span class="small muted desc">${esc(r.description)}</span></td>
        <td class="small">${esc(r.batch || "–")}</td><td class="small">${r.expiry_date ? d8(r.expiry_date) : "–"}</td><td class="n">${C.fmt(r.qty)}</td>
        <td class="small">${r.cancelled ? "Undone" : `${r.condition === "damaged" ? `<span class="status s-out">Damaged</span> ${esc(r.damage_reason)}` : "Good"}${r.flags.map(f => ` <span class="xs-crit">${FLAG[f] || esc(f)}</span>`).join("")}${r.stock_status === "hold" && r.hold_reason ? `<br><span class="muted">On hold: ${esc(r.hold_reason)}</span>` : ""}`}</td>
        <td>${r.location ? `<span class="tag">${esc(r.location)}</span>` : ""}</td><td>${r.cancelled ? "" : r.current_location ? `<span class="tag">${esc(r.current_location)}</span>${r.put_away ? "" : `<br><span class="small muted">to put away</span>`}` : `<span class="small muted">no longer in stock</span>`}</td>
        <td>${!r.cancelled && openish ? `<button class="linkbtn small" data-ia="undo" data-id="${esc(r.id)}">Undo</button>` : ""}</td></tr>`).join("")}
    </tbody></table></div>` : `<p class="muted">Nothing received yet. Operators find this ASN in the phone's Inbound tab, or by scanning the driver's gate pass.</p>`}`;
  C.setTimer(() => { if (C.route()[0] === "inbound" && C.route()[1] === id && !document.querySelector("dialog[open]")) pageAsn(main, id); }, 15000);
}
function statusDialog(s) {
  const {a, lines} = C.cache.asn;
  const diff = lines.some(l => N(l.received_qty) !== N(l.expected_qty) || N(l.damaged_qty) > 0);
  const T = {closed: ["Close this ASN", `${diff ? "This ASN has short, extra or damaged lines, so a note is required (for example what the client was told)." : "Everything was received as expected."} Closing locks the ASN; pallets stay in stock.`, "Close ASN", "primary", diff],
    cancelled: ["Cancel this ASN", "Use this for an ASN that won't arrive or was uploaded by mistake.", "Cancel ASN", "danger", true],
    receiving: ["Reopen this ASN", "Operators can receive on it again.", "Reopen", "primary", false]}[s];
  let d = $("#indlg"); if (d) d.remove();
  d = document.createElement("dialog"); d.id = "indlg";
  d.innerHTML = `<form method="dialog"><h2 style="margin-bottom:6px">${T[0]}</h2><p class="hint">${T[1]}</p>
    <label class="field" style="margin-bottom:14px">Note${T[4] ? "" : " (optional)"}<textarea name="note" rows="3" style="min-height:70px;font-family:var(--sans)" ${T[4] ? "required" : ""}></textarea></label>
    <div class="row"><button class="btn ${T[3]}" value="ok">${T[2]}</button><button class="btn ghost" value="cancel" formnovalidate>Back</button></div></form>`;
  document.body.appendChild(d); d.showModal();
  d.onclose = async () => { if (d.returnValue !== "ok") return;
    if (await C.run(() => C.q(C.sb.rpc("asn_set_status", {p_asn: a.id, p_status: s, p_note: d.querySelector("textarea").value})), {closed: "ASN closed", cancelled: "ASN cancelled", receiving: "ASN reopened"}[s])) pageAsn($("#main"), a.id); };
}
function undoDialog(rid) {
  const r = C.cache.asn.recs.find(x => String(x.id) === String(rid)); if (!r) return;
  let d = $("#indlg"); if (d) d.remove();
  d = document.createElement("dialog"); d.id = "indlg";
  d.innerHTML = `<form method="dialog"><h2 style="margin-bottom:6px">Undo this receipt?</h2><p class="hint">${esc(r.sku)} · ${C.fmt(r.qty)} · LPN ${esc(r.lpn)}. The pallet is removed from stock. This only works while the pallet hasn't been moved.</p>
    <label class="field" style="margin-bottom:14px">Reason<input name="note" required placeholder="e.g. scanned the wrong product"></label>
    <div class="row"><button class="btn danger" value="ok">Undo receipt</button><button class="btn ghost" value="cancel" formnovalidate>Back</button></div></form>`;
  document.body.appendChild(d); d.showModal();
  d.onclose = async () => { if (d.returnValue !== "ok") return; const note = d.querySelector("input").value.trim(); if (!note) return C.toast("Enter a reason.", true);
    if (await C.run(() => C.q(C.sb.rpc("asn_undo_receipt", {p_receipt: r.id, p_note: note})), "Receipt undone")) pageAsn($("#main"), C.cache.asn.a.id); };
}
function printGrn() {
  const {a, lines, recs} = C.cache.asn, live = recs.filter(r => !r.cancelled);
  let p = $("#qcprint"); if (!p) { p = document.createElement("div"); p.id = "qcprint"; document.body.appendChild(p); }
  p.innerHTML = `<h1>Goods received note</h1><p><strong>${esc(a.asn_no)}</strong> · ${esc(a.client_code)}${a.client_name ? " (" + esc(a.client_name) + ")" : ""}${a.ext_ref ? ` · PO ${esc(a.ext_ref)}` : ""}${a.supplier ? ` · ${esc(a.supplier)}` : ""}<br>
    Status: ${STATUS[a.status]} · Received ${a.started_at ? C.dt(a.started_at) : "–"}${a.received_at ? " to " + C.dt(a.received_at) : ""} · Printed ${esc(new Date().toLocaleString())} by ${esc(C.me.full_name || "")}</p>
    <table><thead><tr><th>#</th><th>SKU</th><th>Description</th><th class="n">Expected</th><th class="n">Good</th><th class="n">Damaged</th><th class="n">Short</th><th class="n">Extra</th></tr></thead><tbody>
    ${lines.map(l => `<tr><td>${l.line_no}</td><td>${esc(l.sku)}</td><td>${esc(l.description)}${l.not_on_asn ? " (not on ASN)" : ""}</td><td class="n">${C.fmt(l.expected_qty)}</td><td class="n">${C.fmt(l.received_qty)}</td><td class="n">${C.fmt(l.damaged_qty)}</td><td class="n">${C.fmt(l.short_qty)}</td><td class="n">${C.fmt(l.excess_qty)}</td></tr>`).join("")}
    <tr><td></td><td colspan="2"><strong>Total</strong></td><td class="n"><strong>${C.fmt(a.expected_qty)}</strong></td><td class="n"><strong>${C.fmt(a.received_qty)}</strong></td><td class="n"><strong>${C.fmt(a.damaged_qty)}</strong></td><td class="n"><strong>${C.fmt(a.short_qty)}</strong></td><td class="n"><strong>${C.fmt(a.excess_qty)}</strong></td></tr></tbody></table>
    <h2>Pallets</h2><table><thead><tr><th>LPN</th><th>SKU</th><th>Batch</th><th>Expiry</th><th class="n">Qty</th><th>Condition</th></tr></thead><tbody>
    ${live.map(r => `<tr><td>${esc(r.lpn)}</td><td>${esc(r.sku)}</td><td>${esc(r.batch || "")}</td><td>${r.expiry_date ? d8(r.expiry_date) : ""}</td><td class="n">${C.fmt(r.qty)}</td><td>${r.condition === "damaged" ? "Damaged: " + esc(r.damage_reason) : "Good"}${r.flags.length ? " · " + r.flags.map(f => FLAG[f] || f).join(", ") : ""}</td></tr>`).join("")}</tbody></table>
    ${a.close_note ? `<p><strong>Note:</strong> ${esc(a.close_note)}</p>` : ""}
    <p class="sign" style="margin-top:28px">Received by (warehouse): ____________________ &nbsp; Driver: ____________________ &nbsp; Signature / stamp: ____________________</p>`;
  document.body.classList.add("qc-printing");
  const done = () => { document.body.classList.remove("qc-printing"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  try { window.print(); } catch { C.toast("Your browser blocked printing here. Open the console in its own tab to print.", true); }
  setTimeout(done, 60000);
}
async function exportAsn() {
  const {a, lines, recs} = C.cache.asn;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(lines.map(l => ({ASN: a.asn_no, Client: a.client_code, Line: l.line_no, SKU: l.sku, Description: l.description, "Expected batch": l.batch, "Expected expiry": l.expiry_date || "", Expected: N(l.expected_qty), "Received good": N(l.received_qty), Damaged: N(l.damaged_qty), Short: N(l.short_qty), Extra: N(l.excess_qty), "Not on ASN": l.not_on_asn ? "Yes" : ""}))), "Lines");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(recs.map(r => ({When: new Date(r.created_at), Who: r.user_name || "", LPN: r.lpn, SKU: r.sku, Description: r.description, Batch: r.batch, "Mfg date": r.mfg_date || "", "Expiry date": r.expiry_date || "", Qty: N(r.qty), Condition: r.condition, "Damage reason": r.damage_reason, Flags: r.flags.map(f => FLAG[f] || f).join(", "), "Received at": r.location || "", "Now in": r.current_location || "", Undone: r.cancelled ? "Yes" : ""}))), "Pallets");
  await C.saveWorkbook(wb, `Stowra_ASN_${a.asn_no}_${new Date().toISOString().slice(0, 10)}.xlsx`);
}

/* ---------- upload ASNs ---------- */
const FIELDS = [
  ["client", "Client code", ["STORERKEY", "STORER", "CLIENT", "CLIENT CODE", "OWNER", "PRINCIPAL"]],
  ["client_name", "Client name", ["COMPANY", "CLIENT NAME", "STORER NAME"]],
  ["asn_no", "ASN number", ["ASN", "ASN NO", "ASN NUMBER", "RECEIPTKEY", "RECEIPT KEY", "RECEIPT", "SHIPMENT", "SHIPMENT NO", "DELIVERY NO"], true],
  ["ext_ref", "PO / client reference", ["EXTERNRECEIPTKEY", "EXTERNAL ASN", "EXTERNAL_ASN", "PO", "PO NO", "PO NUMBER", "EXTERNAL REF", "CLIENT REF", "REFERENCE"]],
  ["supplier", "Supplier", ["SUPPLIER", "VENDOR", "SUPPLIER NAME", "VENDOR NAME", "SHIPPER"]],
  ["expected_date", "Expected date", ["EXPECTED DATE", "EXPECTEDRECEIPTDATE", "ETA", "ARRIVAL DATE", "DELIVERY DATE"]],
  ["sku", "SKU", ["SKU", "ITEM", "ITEM CODE", "MATERIAL", "PRODUCT CODE", "ARTICLE"], true],
  ["descr", "Description", ["DESCR", "DESCRIPTION", "ITEM DESCRIPTION", "PRODUCT NAME"]],
  ["qty", "Expected quantity", ["QTYEXPECTED", "QTY EXPECTED", "EXPECTED QTY", "QTY", "QUANTITY", "ORDER QTY", "SHIPPED QTY"], true],
  ["batch", "Batch", ["BATCH", "BATCH NO", "LOT", "LOT NO", "LOTTABLE02"]],
  ["expiry_date", "Expiry date", ["EXP_DATE", "EXPIRY", "EXPIRY DATE", "LOTTABLE05"]]
];
const normH = h => String(h || "").toUpperCase().replace(/[_\s.]+/g, " ").trim();
const guess = header => { const H = header.map(normH), m = {}; FIELDS.forEach(([k, , names]) => { m[k] = H.findIndex(h => names.map(normH).includes(h)); }); return m; };
const pad = n => String(n).padStart(2, "0");
function toDate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return isNaN(v) ? "" : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === "number") { if (v < 1000 || v > 80000) return ""; const d = new Date(Math.round((v - 25569) * 864e5)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return "";
}
const clean = v => { const s = String(v ?? "").trim(); return /^(NA|N\/A|-|NULL)$/i.test(s) ? "" : s; };
async function readFile(file) {
  let table;
  if (/\.(xlsx?|xlsm|xml)$/i.test(file.name)) { const wb = XLSX.read(await file.arrayBuffer(), {type: "array", cellDates: true}); table = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, raw: true, defval: ""}).filter(r => r.some(v => v !== "" && v != null)); }
  else table = await C.readTable(file);
  const hi = table.slice(0, 15).findIndex(r => { const g = guess(r); return g.sku >= 0 && g.asn_no >= 0; }); if (hi > 0) table = table.slice(hi);
  if (table.length < 2) throw new Error("The file has no ASN lines.");
  return table;
}
function buildRows() {
  const U = V.up, m = U.map, g = (r, k) => m[k] >= 0 ? r[m[k]] : "", rows = [], skip = [];
  U.table.slice(1).forEach((r, i) => {
    const client = m.client >= 0 ? clean(g(r, "client")).toUpperCase() : U.client, asn_no = clean(g(r, "asn_no")).toUpperCase(), sku = clean(g(r, "sku")).toUpperCase(), qty = Number(String(g(r, "qty")).replace(/,/g, "")) || 0;
    if (!asn_no && !sku) return;
    if (!client || !asn_no || !sku || qty <= 0) { skip.push(i + 2); return; }
    rows.push({client, client_name: clean(g(r, "client_name")), asn_no, ext_ref: clean(g(r, "ext_ref")), supplier: clean(g(r, "supplier")), expected_date: toDate(g(r, "expected_date")) || null, sku, descr: clean(g(r, "descr")), qty, batch: clean(g(r, "batch")), expiry_date: toDate(g(r, "expiry_date")) || null});
  });
  return {rows, skip};
}
async function pageUpload(main) {
  await clients();
  main.innerHTML = `<div class="pagehead"><div><a href="#/inbound" class="small">Inbound</a><h1 style="margin-top:6px">Upload ASNs</h1><p class="muted small" style="margin:4px 0 0">An Excel or CSV file with one row per ASN line: ASN number, SKU and expected quantity (and the client, unless the file is for one client). One file can hold many ASNs. An ASN uploaded again replaces the earlier one, as long as nothing has been received on it.</p></div>
    <div class="row"><button class="btn" data-ia="template">Download template</button></div></div>
    <div id="upbox"><label class="drop" id="indrop"><input type="file" id="infile" accept=".xlsx,.xls,.xml,.csv,.txt"><strong>Choose the ASN file</strong><br><span class="small muted">or drop it here</span></label></div>`;
  const inp = $("#infile"), drop = $("#indrop");
  inp.onchange = () => inp.files[0] && pick(inp.files[0]);
  drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); }; drop.ondragleave = () => drop.classList.remove("over");
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) pick(e.dataTransfer.files[0]); };
}
async function pick(file) {
  try { const table = await readFile(file); V.up = {table, name: file.name, map: guess(table[0]), client: "", create: false, missing: null}; await renderMap(); }
  catch (e) { C.fail(e); }
}
async function renderMap() {
  const U = V.up, H = U.table[0], box = $("#upbox");
  const opts = sel => `<option value="-1">(not in the file)</option>` + H.map((h, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(h || `Column ${i + 1}`)}</option>`).join("");
  const {rows, skip} = buildRows();
  // which SKUs are new
  const byClient = new Map(); rows.forEach(r => { if (!byClient.has(r.client)) byClient.set(r.client, new Set()); byClient.get(r.client).add(r.sku); });
  const missing = [];
  for (const [code, skus] of byClient) { const cl = clientsCache.find(c => c.code === code); if (!cl) { missing.push(...[...skus].map(s => code + " " + s)); continue; }
    const list = [...skus], have = new Set(); for (let i = 0; i < list.length; i += 150) (await C.q(C.sb.from("items").select("sku").eq("client_id", cl.id).in("sku", list.slice(i, i + 150)))).forEach(x => have.add(x.sku));
    list.filter(s => !have.has(s)).forEach(s => missing.push(code + " " + s)); }
  const asns = new Map(); rows.forEach(r => { const k = r.client + " " + r.asn_no; const x = asns.get(k) || {client: r.client, asn_no: r.asn_no, ext_ref: r.ext_ref, supplier: r.supplier, lines: 0, qty: 0}; x.lines++; x.qty += r.qty; asns.set(k, x); });
  box.innerHTML = `<div class="panel"><h3 style="margin-bottom:4px">${esc(U.name)}</h3><p class="hint" style="margin-top:0">${C.fmt(U.table.length - 1)} rows. Check the columns; recognised ones are already chosen.</p>
    ${U.map.client < 0 ? `<label class="field" style="max-width:320px;margin-bottom:10px">The file has no client column. Which client is it for?<select id="upclient"><option value="">Choose…</option>${clientsCache.map(c => `<option ${c.code === U.client ? "selected" : ""}>${esc(c.code)}</option>`).join("")}</select></label>` : ""}
    <div class="map">${FIELDS.map(([k, label, , req]) => `<label class="field">${label}${req ? " *" : ""}<select data-map="${k}">${opts(U.map[k])}</select></label>`).join("")}</div></div>
    ${rows.length ? `<div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Client</th><th>ASN</th><th>PO / reference</th><th>Supplier</th><th class="n">Lines</th><th class="n">Units</th></tr></thead><tbody>
      ${[...asns.values()].slice(0, 100).map(x => `<tr><td>${esc(x.client)}</td><td><strong>${esc(x.asn_no)}</strong></td><td>${esc(x.ext_ref)}</td><td>${esc(x.supplier)}</td><td class="n">${C.fmt(x.lines)}</td><td class="n">${C.fmt(x.qty)}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${skip.length ? `<div class="banner warn" style="margin-top:12px"><span>${C.fmt(skip.length)} row${skip.length === 1 ? "" : "s"} without a client, ASN, SKU or quantity will be skipped (row ${skip.slice(0, 8).join(", ")}${skip.length > 8 ? "…" : ""}).</span></div>` : ""}
    ${missing.length ? `<div class="banner warn" style="margin-top:12px"><span>${C.fmt(missing.length)} SKU${missing.length === 1 ? " isn't" : "s aren't"} in the item master yet (${esc(missing.slice(0, 6).join(", "))}${missing.length > 6 ? "…" : ""}).</span><label class="small"><input type="checkbox" id="upcreate" ${U.create ? "checked" : ""}> Create them from this file</label></div>` : ""}
    <div class="row" style="margin-top:14px"><button class="btn go" data-ia="up-go" ${rows.length && (!missing.length || U.create) ? "" : "disabled"}>Upload ${C.fmt(asns.size)} ASN${asns.size === 1 ? "" : "s"}</button><button class="btn ghost" data-ia="up-cancel">Choose another file</button></div>`;
  $$("[data-map]").forEach(s => s.onchange = () => { U.map[s.dataset.map] = +s.value; renderMap(); });
  const uc = $("#upclient"); if (uc) uc.onchange = () => { U.client = uc.value; renderMap(); };
  const cr = $("#upcreate"); if (cr) cr.onchange = () => { U.create = cr.checked; const b = $("[data-ia=up-go]"); if (b) b.disabled = !cr.checked; };
}
async function runUpload() {
  const {rows} = buildRows(), b = $("[data-ia=up-go]"); if (b) b.disabled = true;
  const r = await C.run(() => C.q(C.sb.rpc("asn_import", {p: {file: V.up.name, create_items: V.up.create, rows}})));
  if (!r) { if (b) b.disabled = false; return; }
  V.result = `${C.fmt(r.new)} new ASN${r.new === 1 ? "" : "s"}${r.replaced ? `, ${C.fmt(r.replaced)} replaced` : ""}, ${C.fmt(r.lines)} lines${r.new_items ? `, ${C.fmt(r.new_items)} new items created` : ""}.`;
  V.up = null; V.f = "open"; clientsCache = null; C.go("inbound");
}
async function template() {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["Client", "ASN number", "PO", "Supplier", "Expected date", "SKU", "Description", "Qty", "Batch", "Expiry date"],
    ["TGD", "ASN-70001", "PO-88001", "Chemist Warehouse AU", new Date().toISOString().slice(0, 10), "7015687", "Data Strip Fragrance 540mm Clear", 400, "", ""],
    ["TGD", "ASN-70001", "PO-88001", "Chemist Warehouse AU", new Date().toISOString().slice(0, 10), "7015689", "Dispensary T-Profile 465mm", 450, "", ""]]), "ASNs");
  await C.saveWorkbook(wb, "Stowra_ASN_template.xlsx");
}

/* ---------- clicks ---------- */
document.addEventListener("click", e => {
  const b = e.target.closest("[data-ia]"); if (!b || !C) return;
  const main = $("#main");
  switch (b.dataset.ia) {
    case "filter": V.f = b.dataset.f; pageList(main); break;
    case "open": C.go("inbound/" + b.dataset.id); break;
    case "status": statusDialog(b.dataset.s); break;
    case "undo": undoDialog(b.dataset.id); break;
    case "grn": printGrn(); break;
    case "export": exportAsn(); break;
    case "template": template(); break;
    case "up-go": runUpload(); break;
    case "up-cancel": V.up = null; pageUpload(main); break;
  }
});

window.CCInbound = {page};
})();
