/* Stowra console: stock. Stowra's own stock record (one row per pallet / LPN), loaded from the WMS stock report
   and kept up to date by moves, holds and adjustments. Also the client, item and location masters. */
(() => {
"use strict";
let C = null;
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
const N = v => Number(v) || 0;
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]));
const d8 = s => s ? new Date(String(s).slice(0, 10) + "T12:00:00").toLocaleDateString(undefined, {day: "2-digit", month: "short", year: "numeric"}) : "–";
const PAGE = 200;
const KIND = {storage: "Storage", pick: "Pick face", staging: "Staging", outbound: "Outbound", dock: "Dock", damage: "Damage", short: "Short", quarantine: "Quarantine"};
const MOVE = {import: "Stock file", move: "Moved", adjust: "Adjusted", hold: "Put on hold", release: "Released", receive: "Received", pick: "Picked", ship: "Shipped"};
const REASONS = ["Count variance", "Found stock", "Damaged, written off", "Expired, disposed", "Data correction", "Returned to client", "Other"];
const V = {client: "", q: "", f: "all", view: "pallets", page: 0, sel: new Set(), showEmpty: false, mk: "all", mq: "", mpage: 0, iq: "", ipage: 0, lq: "", lk: "all", lpage: 0, lsel: new Set(), checked: false};
let clientsCache = null;

function page(main, ctx, sub, id) {
  C = ctx;
  if (sub === "import") return pageImport(main);
  if (sub === "item") return pageItem(main, id);
  if (sub === "moves") return pageMoves(main);
  if (sub === "clients") return id ? pageClient(main, id) : pageClients(main);
  if (sub === "skus") return pageSkus(main);
  if (sub === "locations") return pageLocations(main);
  return pageStock(main);
}
async function clients(force) {
  if (!clientsCache || force) { try { clientsCache = await C.q(C.sb.from("clients").select("*").order("code")); } catch (e) { C.fail(e); clientsCache = []; } }
  return clientsCache;
}
const clientSelect = (id, val, all = "All clients") => `<select id="${id}" class="search" style="max-width:220px">${all ? `<option value="">${all}</option>` : ""}${(clientsCache || []).map(c => `<option value="${esc(c.code)}" ${c.code === val ? "selected" : ""}>${esc(c.code)}${c.name ? " · " + esc(c.name) : ""}</option>`).join("")}</select>`;
const term = s => String(s || "").replace(/[,()%*\\]/g, " ").trim();
function qtyCell(v, k = "qty") {
  const q = N(v[k]), cs = N(v.case_qty);
  return `${C.fmt(q)}${cs > 1 && q ? `<br><span class="small muted">${C.fmt(Math.round(q / cs * 100) / 100)} ${esc(v.case_uom || "cases")}</span>` : ""}`;
}
function expCell(v) {
  if (!v.expiry_date) return `<span class="muted">–</span>`;
  const d = N(v.days_to_expiry), cls = v.expiry_state === "expired" ? "var-neg" : v.expiry_state === "near" ? "warnc" : "";
  return `<span class="${cls}">${d8(v.expiry_date)}</span><br><span class="small ${cls || "muted"}">${v.expiry_state === "expired" ? `expired ${C.fmt(-d)} d ago` : `${C.fmt(d)} days${v.life_left_pct != null ? ` · ${v.life_left_pct}% life` : ""}`}</span>`;
}
function statusCell(v) {
  if (v.status === "hold" || v.location_hold) return `<span class="status s-out">On hold</span>${v.hold_reason ? `<br><span class="small muted">${esc(v.hold_reason)}</span>` : ""}`;
  if (v.expiry_state === "expired") return `<span class="status s-out">Expired</span>`;
  return `<span class="status s-match">Available</span>`;
}
function dialog(id, html, onOk) {
  let d = $("#" + id); if (d) d.remove();
  d = document.createElement("dialog"); d.id = id; d.innerHTML = `<form method="dialog">${html}</form>`;
  document.body.appendChild(d); d.showModal();
  const f = d.querySelector("form");
  f.onsubmit = async e => {
    const btn = e.submitter; if (!btn || btn.value !== "ok") return;
    e.preventDefault(); btn.disabled = true;
    try { if (await onOk(f, d) !== false) d.close(); } finally { btn.disabled = false; }
  };
  return d;
}
async function pageAll(build) { const out = []; for (let from = 0; ; from += 1000) { const d = await C.q(build().range(from, from + 999)); out.push(...d); if (d.length < 1000) break; } return out; }

/* =====================================================================
   Stock list
   ===================================================================== */
function stockQuery(cols, count) {
  let qq = C.sb.from(V.view === "items" ? "item_stock_v" : "inventory_v").select(cols, count ? {count: "exact"} : undefined);
  if (V.client) qq = qq.eq("client_code", V.client);
  const t = term(V.q);
  if (V.view === "items") {
    if (!V.showEmpty) qq = qq.gt("qty", 0);
    if (t) qq = qq.or(`sku.ilike.%${t}%,description.ilike.%${t}%,barcode.ilike.%${t}%`);
    if (V.f === "available") qq = qq.gt("available_qty", 0); else if (V.f === "hold") qq = qq.gt("hold_qty", 0); else if (V.f === "allocated") qq = qq.gt("allocated_qty", 0);
    return qq.order("client_code").order("sku");
  }
  if (t) qq = qq.or(`sku.ilike.%${t}%,description.ilike.%${t}%,location.ilike.%${t}%,lpn.ilike.%${t}%,batch.ilike.%${t}%,barcode.ilike.%${t}%`);
  if (V.f === "available") qq = qq.gt("available_qty", 0); else if (V.f === "hold") qq = qq.eq("status", "hold");
  else if (V.f === "expired") qq = qq.eq("expiry_state", "expired"); else if (V.f === "near") qq = qq.eq("expiry_state", "near"); else if (V.f === "allocated") qq = qq.gt("allocated_qty", 0);
  return qq.order("location").order("sku");
}
async function pageStock(main) {
  await clients();
  if (!V.checked) { V.checked = true; try { const n = await C.q(C.sb.rpc("stock_hold_expired")); if (N(n)) C.toast(`${n} expired pallet${n === 1 ? "" : "s"} put on hold`); } catch {} }
  let sum = {}, rows = [], total = 0;
  try {
    const [s, r] = await Promise.all([C.q(C.sb.rpc("stock_summary", {p_client: V.client || null})), C.q(stockQuery("*", true).range(V.page * PAGE, V.page * PAGE + PAGE - 1))]);
    sum = s || {}; rows = r.data || r; total = r.count != null ? r.count : rows.length;
  } catch (e) { C.fail(e); }
  const staff = true;
  const chips = V.view === "items" ? [["all", "All"], ["available", "Available"], ["hold", "With stock on hold"], ["allocated", "Allocated"]]
    : [["all", "All"], ["available", "Available"], ["hold", "On hold"], ["expired", "Expired"], ["near", "Near expiry"], ["allocated", "Allocated"]];
  if (!chips.some(c => c[0] === V.f)) V.f = "all";
  const empty = !clientsCache.length;
  main.innerHTML = `
    <div class="pagehead"><div><h1>Stock</h1><p class="muted small" style="margin:4px 0 0">Stowra's stock record, pallet by pallet. Load your WMS stock report to refresh it; moves, holds and adjustments made here are recorded in the stock history.</p></div>
      <div class="row"><a class="btn" href="#/stock/moves">Stock history</a><button class="btn" data-sa="found" ${empty ? "disabled" : ""}>Add found stock</button><button class="btn" data-sa="export" ${total ? "" : "disabled"}>Export to Excel</button><a class="btn go" href="#/stock/import">Load stock file</a></div></div>
    ${empty ? `<div class="empty"><h2>No stock yet</h2><p>Load your WMS stock report (Excel or CSV, one row per pallet or location). Stowra creates the clients, items and locations from it. <a href="#/stock/import">Load stock file</a></p></div>` : `
    <div class="stats">
      <div class="stat"><div class="l">Units in stock</div><div class="v">${C.fmt(sum.qty)}</div><div class="small muted">${C.fmt(sum.rows)} pallets / lines</div></div>
      <div class="stat"><div class="l">Available</div><div class="v">${C.fmt(sum.available)}</div><div class="small muted">${C.fmt(N(sum.allocated) + N(sum.picked))} allocated or picked</div></div>
      <div class="stat"><div class="l">On hold</div><div class="v ${N(sum.hold_rows) ? "var-neg" : ""}">${C.fmt(sum.hold_qty)}</div><div class="small muted">${C.fmt(sum.hold_rows)} lines</div></div>
      <div class="stat"><div class="l">Expired</div><div class="v ${N(sum.expired_rows) ? "var-neg" : ""}">${C.fmt(sum.expired_qty)}</div><div class="small muted">${C.fmt(sum.expired_rows)} lines</div></div>
      <div class="stat"><div class="l">Near expiry</div><div class="v">${C.fmt(sum.near_qty)}</div><div class="small muted">${C.fmt(sum.near_rows)} lines (client setting)</div></div>
      <div class="stat"><div class="l">Items · locations</div><div class="v">${C.fmt(sum.items)}</div><div class="small muted">in ${C.fmt(sum.locations)} locations</div></div>
    </div>
    <div class="toolbar" style="flex-wrap:wrap;gap:8px;justify-content:flex-start">
      <div class="chips"><button class="chip" aria-pressed="${V.view === "pallets"}" data-sa="view" data-v="pallets">By pallet</button><button class="chip" aria-pressed="${V.view === "items"}" data-sa="view" data-v="items">By item</button></div>
      ${clientSelect("stclient", V.client)}
      <div class="chips">${chips.map(([k, l]) => `<button class="chip" aria-pressed="${V.f === k}" data-sa="filter" data-f="${k}">${l}</button>`).join("")}</div>
      <input class="search" id="stsearch" placeholder="${V.view === "items" ? "Search SKU, description or barcode" : "Search SKU, description, location, LPN or batch"}" value="${esc(V.q)}">
      ${V.view === "items" ? `<label class="small"><input type="checkbox" id="stempty" ${V.showEmpty ? "checked" : ""}> Include items without stock</label>` : ""}
    </div>
    ${V.view === "pallets" && V.sel.size ? `<div class="banner"><span>${V.sel.size} selected</span><span class="row"><button class="btn sm" data-sa="hold">Put on hold</button><button class="btn sm" data-sa="release">Release</button><button class="btn sm ghost" data-sa="clear-sel">Clear</button></span></div>` : ""}
    ${rows.length ? (V.view === "items" ? itemsTable(rows) : palletsTable(rows, true)) : `<div class="empty" style="margin-top:12px"><h2>Nothing found</h2><p>Try another filter or search.</p></div>`}
    ${total > PAGE ? `<div class="pager"><span>${C.fmt(V.page * PAGE + 1)}–${C.fmt(Math.min(total, V.page * PAGE + PAGE))} of ${C.fmt(total)}</span><button class="btn sm" data-sa="page" data-d="-1" ${V.page ? "" : "disabled"}>Previous</button><button class="btn sm" data-sa="page" data-d="1" ${(V.page + 1) * PAGE < total ? "" : "disabled"}>Next</button></div>` : ""}`}`;
  C.cache.stockRows = rows;
  const sel = $("#stclient"); if (sel) sel.onchange = () => { V.client = sel.value; V.page = 0; V.sel.clear(); pageStock(main); };
  const se = $("#stempty"); if (se) se.onchange = () => { V.showEmpty = se.checked; V.page = 0; pageStock(main); };
  const s = $("#stsearch"); if (s) { let t; s.oninput = () => { clearTimeout(t); t = setTimeout(() => { V.q = s.value; V.page = 0; V.sel.clear(); pageStock(main).then(() => { const x = $("#stsearch"); if (x) { x.focus(); x.setSelectionRange(x.value.length, x.value.length); } }); }, 350); }; }
  $$("[data-sel]").forEach(cb => cb.onchange = () => { cb.checked ? V.sel.add(cb.dataset.sel) : V.sel.delete(cb.dataset.sel); pageStock(main); });
  const all = $("#selall"); if (all) all.onchange = () => { rows.forEach(r => all.checked ? V.sel.add(String(r.id)) : V.sel.delete(String(r.id))); pageStock(main); };
}
function palletsTable(rows, selectable) {
  return `<div class="tablewrap"><table><thead><tr>${selectable ? `<th><input type="checkbox" id="selall" aria-label="Select all on this page" ${rows.every(r => V.sel.has(String(r.id))) ? "checked" : ""}></th>` : ""}<th>Location</th><th>Client</th><th>SKU</th><th>LPN</th><th>Batch</th><th>Expiry</th><th class="n">Qty</th><th class="n">Allocated / picked</th><th class="n">Available</th><th>Status</th><th></th></tr></thead><tbody>
    ${rows.map(v => `<tr>${selectable ? `<td><input type="checkbox" data-sel="${esc(v.id)}" ${V.sel.has(String(v.id)) ? "checked" : ""} aria-label="Select"></td>` : ""}
      <td><span class="tag">${esc(v.location)}</span>${v.location_kind !== "storage" ? `<br><span class="small muted">${KIND[v.location_kind] || ""}</span>` : v.zone ? `<br><span class="small muted">${esc(v.zone)}</span>` : ""}</td>
      <td>${esc(v.client_code)}</td>
      <td><a href="#/stock/item/${esc(v.item_id)}"><strong>${esc(v.sku)}</strong></a><br><span class="small muted desc">${esc(v.description)}</span></td>
      <td class="small">${esc(v.lpn || "–")}</td>
      <td class="small">${v.batch ? `${esc(v.batch)}${v.batch_label && v.batch_label !== "Batch" ? `<br><span class="muted">${esc(v.batch_label)}</span>` : ""}` : "–"}${v.ref2 ? `<br><span class="muted" title="${esc(v.ref2_label)}">${esc(v.ref2)}</span>` : ""}</td>
      <td class="small">${expCell(v)}</td>
      <td class="n">${qtyCell(v)}</td>
      <td class="n">${N(v.allocated_qty) || N(v.picked_qty) ? `${C.fmt(v.allocated_qty)} / ${C.fmt(v.picked_qty)}` : "–"}</td>
      <td class="n"><strong>${C.fmt(v.available_qty)}</strong></td>
      <td>${statusCell(v)}</td>
      <td style="white-space:nowrap">${N(v.qty) - N(v.allocated_qty) - N(v.picked_qty) > 0 ? `<button class="linkbtn small" data-sa="move" data-id="${esc(v.id)}">Move</button>` : `<span class="small muted" title="All of it is allocated or picked for orders">Picked</span>`} <button class="linkbtn small" data-sa="adjust" data-id="${esc(v.id)}">Adjust</button></td></tr>`).join("")}
  </tbody></table></div>`;
}
function itemsTable(rows) {
  return `<div class="tablewrap"><table><thead><tr><th>Client</th><th>SKU</th><th>Description</th><th class="n">In stock</th><th class="n">Available</th><th class="n">On hold</th><th class="n">Allocated / picked</th><th class="n">Locations</th><th>First expiry</th></tr></thead><tbody>
    ${rows.map(v => `<tr style="cursor:pointer" data-sa="item" data-id="${esc(v.item_id)}"><td>${esc(v.client_code)}</td><td><strong>${esc(v.sku)}</strong>${v.barcode ? `<br><span class="small muted">${esc(v.barcode)}</span>` : ""}</td><td class="desc">${esc(v.description)}</td>
      <td class="n">${qtyCell(v)}</td><td class="n"><strong>${C.fmt(v.available_qty)}</strong></td><td class="n ${N(v.hold_qty) ? "var-neg" : ""}">${C.fmt(v.hold_qty)}</td>
      <td class="n">${N(v.allocated_qty) || N(v.picked_qty) ? `${C.fmt(v.allocated_qty)} / ${C.fmt(v.picked_qty)}` : "–"}</td><td class="n">${C.fmt(v.locations)}</td><td class="small">${v.first_expiry ? d8(v.first_expiry) : "–"}</td></tr>`).join("")}
  </tbody></table></div>`;
}
const rowById = id => (C.cache.stockRows || []).concat(C.cache.itemRows || []).find(r => String(r.id) === String(id));
function moveDialog(v, after) {
  const free = N(v.qty) - N(v.allocated_qty) - N(v.picked_qty);
  dialog("stdlg", `<h2 style="margin-bottom:6px">Move stock</h2>
    <p class="hint">${esc(v.sku)} · ${esc(v.description)}<br>From <strong>${esc(v.location)}</strong>${v.lpn ? `, LPN ${esc(v.lpn)}` : ""}${v.batch ? `, ${esc(v.batch_label || "batch")} ${esc(v.batch)}` : ""}. ${C.fmt(free)} of ${C.fmt(v.qty)} can be moved.</p>
    <label class="field" style="margin-bottom:10px">To location<input name="to" required autocapitalize="characters" autocomplete="off"></label>
    <div class="grid2"><label class="field" style="margin-bottom:10px">Quantity<input name="qty" type="number" step="any" min="0" max="${free}" value="${free}"></label>
    <label class="field" style="margin-bottom:10px">New LPN (only for part of a pallet)<input name="lpn" autocomplete="off"></label></div>
    <p class="hint">Moving into a damage, short or quarantine location puts the stock on hold.</p>
    <div class="row"><button class="btn primary" value="ok">Move</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div>`, async f => {
    const qty = N(f.qty.value);
    const r = await C.run(() => C.q(C.sb.rpc("stock_move", {p_inv: v.id, p_to: f.to.value.trim(), p_qty: qty === N(v.qty) ? null : qty, p_device: "Console", p_client_id: crypto.randomUUID ? crypto.randomUUID() : null, p_lpn: f.lpn.value.trim() || null})), "Stock moved");
    if (!r) return false; after();
  });
}
function adjustDialog(v, after) {
  dialog("stdlg", `<h2 style="margin-bottom:6px">Adjust quantity</h2>
    <p class="hint">${esc(v.sku)} · ${esc(v.description)}<br>${esc(v.location)}${v.lpn ? `, LPN ${esc(v.lpn)}` : ""}. Now ${C.fmt(v.qty)} ${esc(v.base_uom || "")}${N(v.allocated_qty) + N(v.picked_qty) ? `, of which ${C.fmt(N(v.allocated_qty) + N(v.picked_qty))} allocated or picked` : ""}.</p>
    <div class="grid2"><label class="field" style="margin-bottom:10px">New quantity<input name="qty" type="number" step="any" min="0" required value="${esc(v.qty)}"></label>
    <label class="field" style="margin-bottom:10px">Reason<select name="reason" required><option value="">Choose…</option>${REASONS.map(r => `<option>${r}</option>`).join("")}</select></label></div>
    <label class="field" style="margin-bottom:14px">Note<input name="note" placeholder="e.g. count ref, who approved"></label>
    <p class="hint">Setting 0 removes the line. The change, your name and the reason are kept in the stock history.</p>
    <div class="row"><button class="btn primary" value="ok">Save</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div>`, async f => {
    const r = await C.run(() => C.q(C.sb.rpc("stock_adjust", {p: {inventory_id: v.id, qty: f.qty.value, reason: f.reason.value, note: f.note.value}})), "Quantity adjusted");
    if (!r) return false; after();
  });
}
function statusDialog(ids, status, after) {
  dialog("stdlg", `<h2 style="margin-bottom:6px">${status === "hold" ? "Put on hold" : "Release"} ${ids.length} line${ids.length === 1 ? "" : "s"}</h2>
    <p class="hint">${status === "hold" ? "Stock on hold can't be picked or moved to orders until it's released." : "Released stock becomes available again. Expired stock, and stock in damage, short or quarantine locations, can't be released."}</p>
    <label class="field" style="margin-bottom:14px">Reason<input name="reason" required placeholder="${status === "hold" ? "e.g. QC check, client request, damaged packaging" : "e.g. QC passed, client approved"}"></label>
    <div class="row"><button class="btn ${status === "hold" ? "danger" : "primary"}" value="ok">${status === "hold" ? "Put on hold" : "Release"}</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div>`, async f => {
    const r = await C.run(() => C.q(C.sb.rpc("stock_set_status", {p_ids: ids, p_status: status, p_reason: f.reason.value})), status === "hold" ? "Put on hold" : "Released");
    if (r === false) return false; after();
  });
}
async function foundDialog(after) {
  await clients();
  dialog("stdlg", `<h2 style="margin-bottom:6px">Add found stock</h2>
    <p class="hint">Stock found in a location that isn't in the record (for example after a count). The SKU must be in the item master.</p>
    <div class="grid2"><label class="field" style="margin-bottom:10px">Client<select name="client" required>${(clientsCache || []).map(c => `<option value="${esc(c.code)}" ${c.code === V.client ? "selected" : ""}>${esc(c.code)}</option>`).join("")}</select></label>
    <label class="field" style="margin-bottom:10px">SKU<input name="sku" required autocapitalize="characters"></label>
    <label class="field" style="margin-bottom:10px">Location<input name="location" required autocapitalize="characters"></label>
    <label class="field" style="margin-bottom:10px">LPN (optional)<input name="lpn"></label>
    <label class="field" style="margin-bottom:10px">Batch<input name="batch"></label>
    <label class="field" style="margin-bottom:10px">Quantity<input name="qty" type="number" step="any" min="0" required></label>
    <label class="field" style="margin-bottom:10px">Mfg date<input name="mfg" type="date"></label>
    <label class="field" style="margin-bottom:10px">Expiry date<input name="exp" type="date"></label></div>
    <div class="grid2"><label class="field" style="margin-bottom:10px">Reason<select name="reason">${REASONS.map(r => `<option ${r === "Found stock" ? "selected" : ""}>${r}</option>`).join("")}</select></label>
    <label class="field" style="margin-bottom:14px">Note<input name="note"></label></div>
    <div class="row"><button class="btn primary" value="ok">Add stock</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div>`, async f => {
    const r = await C.run(() => C.q(C.sb.rpc("stock_adjust", {p: {client: f.client.value, sku: f.sku.value, location: f.location.value, lpn: f.lpn.value, batch: f.batch.value, qty: f.qty.value, mfg_date: f.mfg.value || null, expiry_date: f.exp.value || null, reason: f.reason.value, note: f.note.value}})), "Stock added");
    if (!r) return false; after();
  });
}
async function exportStock() {
  C.toast("Preparing the Excel file…");
  try {
    const rows = await pageAll(() => stockQuery("*"));
    const data = V.view === "items" ? rows.map(v => ({Client: v.client_code, SKU: v.sku, Description: v.description, Barcode: v.barcode, UOM: v.base_uom, "Case qty": N(v.case_qty), "In stock": N(v.qty), Available: N(v.available_qty), "On hold": N(v.hold_qty), Allocated: N(v.allocated_qty), Picked: N(v.picked_qty), Locations: N(v.locations), "First expiry": v.first_expiry || ""}))
      : rows.map(v => ({Client: v.client_code, Location: v.location, Zone: v.zone, "Location type": KIND[v.location_kind] || v.location_kind, SKU: v.sku, Description: v.description, LPN: v.lpn, [v.batch_label || "Batch"]: v.batch, "Lot ref 2": v.ref2, "Mfg date": v.mfg_date || "", "Expiry date": v.expiry_date || "", "Days to expiry": v.days_to_expiry ?? "", "Life left %": v.life_left_pct ?? "",
        UOM: v.base_uom, Qty: N(v.qty), Cases: N(v.case_qty) > 1 ? Math.round(N(v.qty) / N(v.case_qty) * 100) / 100 : "", Allocated: N(v.allocated_qty), Picked: N(v.picked_qty), Available: N(v.available_qty), Status: v.status === "hold" || v.location_hold ? "On hold" : v.expiry_state === "expired" ? "Expired" : "Available", "Hold reason": v.hold_reason, ASN: v.asn, "External ref": v.ext_ref, Received: v.received_at ? String(v.received_at).slice(0, 10) : ""}));
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(data), "Stock");
    await C.saveWorkbook(wb, `Stowra_stock_${V.client || "all"}_${new Date().toISOString().slice(0, 10)}.xlsx`);
  } catch (e) { C.fail(e); }
}

/* =====================================================================
   One item: totals, pallets, history
   ===================================================================== */
async function pageItem(main, id) {
  let it, rows, moves;
  try {
    [it, rows, moves] = await Promise.all([C.q(C.sb.from("item_stock_v").select("*").eq("item_id", isNaN(id) ? id : +id).single()),
      C.q(C.sb.from("inventory_v").select("*").eq("item_id", isNaN(id) ? id : +id).order("expiry_date").order("location")),
      C.q(C.sb.from("stock_move_list").select("*").eq("item_id", isNaN(id) ? id : +id).order("created_at", {ascending: false}).limit(300))]);
  } catch (e) { main.innerHTML = `<div class="empty"><h2>Item not found</h2><p><a href="#/stock">Back to stock</a></p></div>`; return; }
  C.cache.itemRows = rows;
  main.innerHTML = `
    <div class="pagehead"><div><a href="#/stock" class="small">Stock</a><h1 style="margin-top:6px">${esc(it.sku)}</h1><span class="muted small">${esc(it.client_code)} · ${esc(it.description)}${it.barcode ? ` · barcode ${esc(it.barcode)}` : ""} · ${esc(it.base_uom)}${N(it.case_qty) > 1 ? `, ${C.fmt(it.case_qty)} per ${esc(it.case_uom)}` : ""}${N(it.shelf_life_days) ? ` · shelf life ${C.fmt(it.shelf_life_days)} days` : ""}</span></div>
      <div class="row"><a class="btn" href="#/skus">Item master</a></div></div>
    <div class="stats">
      <div class="stat"><div class="l">In stock</div><div class="v">${C.fmt(it.qty)}</div></div>
      <div class="stat"><div class="l">Available</div><div class="v">${C.fmt(it.available_qty)}</div></div>
      <div class="stat"><div class="l">On hold</div><div class="v ${N(it.hold_qty) ? "var-neg" : ""}">${C.fmt(it.hold_qty)}</div></div>
      <div class="stat"><div class="l">Allocated / picked</div><div class="v">${C.fmt(N(it.allocated_qty) + N(it.picked_qty))}</div></div>
      <div class="stat"><div class="l">Locations</div><div class="v">${C.fmt(it.locations)}</div></div>
      <div class="stat"><div class="l">First expiry</div><div class="v" style="font-size:1.3rem">${it.first_expiry ? d8(it.first_expiry) : "–"}</div></div>
    </div>
    <h3 style="margin:6px 0 0">Pallets, first to expire first</h3>
    ${rows.length ? palletsTable(rows, false) : `<p class="muted">No stock.</p>`}
    <h3 style="margin:18px 0 0">History</h3>
    ${movesTable(moves, false)}`;
}
function movesTable(moves, showItem) {
  return moves.length ? `<div class="tablewrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th>${showItem ? "<th>Client</th><th>SKU</th>" : ""}<th>From</th><th>To</th><th>LPN / batch</th><th class="n">Qty</th><th class="n">Before → after</th><th>Reason / note</th></tr></thead><tbody>
    ${moves.map(m => `<tr><td class="small">${C.dt(m.created_at)}</td><td>${esc(m.user_name || "–")}</td><td>${MOVE[m.kind] || esc(m.kind)}</td>${showItem ? `<td>${esc(m.client_code || "")}</td><td>${m.item_id ? `<a href="#/stock/item/${esc(m.item_id)}">${esc(m.sku || "")}</a>` : ""}</td>` : ""}
      <td>${m.from_loc ? `<span class="tag">${esc(m.from_loc)}</span>` : ""}</td><td>${m.to_loc ? `<span class="tag">${esc(m.to_loc)}</span>` : ""}</td>
      <td class="small">${esc([m.lpn, m.batch].filter(Boolean).join(" · "))}</td>
      <td class="n ${m.kind !== "move" && N(m.qty) < 0 ? "var-neg" : ""}">${m.qty == null ? "" : (m.kind !== "move" && N(m.qty) > 0 && m.kind !== "hold" && m.kind !== "release" ? "+" : "") + C.fmt(m.qty)}</td>
      <td class="n small">${m.kind === "move" || m.kind === "hold" || m.kind === "release" ? "" : `${C.fmt(m.qty_before)} → ${C.fmt(m.qty_after)}`}</td>
      <td class="small" style="white-space:normal;min-width:160px">${esc([m.reason, m.note, m.ref].filter(Boolean).join(" · "))}${m.device ? `<br><span class="muted">${esc(m.device)}</span>` : ""}</td></tr>`).join("")}
  </tbody></table></div>` : `<p class="muted">No history yet.</p>`;
}

/* =====================================================================
   Stock history (all moves)
   ===================================================================== */
function movesQuery(count) {
  let qq = C.sb.from("stock_move_list").select("*", count ? {count: "exact"} : undefined);
  if (V.client) qq = qq.eq("client_code", V.client);
  if (V.mk !== "all") qq = qq.eq("kind", V.mk);
  const t = term(V.mq); if (t) qq = qq.or(`sku.ilike.%${t}%,lpn.ilike.%${t}%,from_loc.ilike.%${t}%,to_loc.ilike.%${t}%,batch.ilike.%${t}%,reason.ilike.%${t}%`);
  return qq.order("created_at", {ascending: false});
}
async function pageMoves(main) {
  await clients();
  let rows = [], total = 0;
  try { const r = await C.q(movesQuery(true).range(V.mpage * PAGE, V.mpage * PAGE + PAGE - 1)); rows = r.data || r; total = r.count ?? rows.length; } catch (e) { C.fail(e); }
  main.innerHTML = `
    <div class="pagehead"><div><a href="#/stock" class="small">Stock</a><h1 style="margin-top:6px">Stock history</h1><p class="muted small" style="margin:4px 0 0">Every move, hold, release and adjustment, and every change from a stock file, with who did it and when. Nothing here can be edited or deleted.</p></div>
      <div class="row"><button class="btn" data-sa="export-moves" ${total ? "" : "disabled"}>Export to Excel</button></div></div>
    <div class="toolbar" style="flex-wrap:wrap;gap:8px;justify-content:flex-start">${clientSelect("mvclient", V.client)}
      <div class="chips">${[["all", "All"], ["move", "Moves"], ["adjust", "Adjustments"], ["hold", "Holds"], ["release", "Releases"], ["import", "Stock files"]].map(([k, l]) => `<button class="chip" aria-pressed="${V.mk === k}" data-sa="mfilter" data-f="${k}">${l}</button>`).join("")}</div>
      <input class="search" id="mvsearch" placeholder="Search SKU, LPN, location, batch or reason" value="${esc(V.mq)}"></div>
    ${movesTable(rows, true)}
    ${total > PAGE ? `<div class="pager"><span>${C.fmt(V.mpage * PAGE + 1)}–${C.fmt(Math.min(total, V.mpage * PAGE + PAGE))} of ${C.fmt(total)}</span><button class="btn sm" data-sa="mpage" data-d="-1" ${V.mpage ? "" : "disabled"}>Previous</button><button class="btn sm" data-sa="mpage" data-d="1" ${(V.mpage + 1) * PAGE < total ? "" : "disabled"}>Next</button></div>` : ""}`;
  $("#mvclient").onchange = e => { V.client = e.target.value; V.mpage = 0; pageMoves(main); };
  const s = $("#mvsearch"); let t; s.oninput = () => { clearTimeout(t); t = setTimeout(() => { V.mq = s.value; V.mpage = 0; pageMoves(main).then(() => { const x = $("#mvsearch"); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }); }, 350); };
}

/* =====================================================================
   Load a stock file (WMS stock report)
   ===================================================================== */
const FIELDS = [
  ["client", "Client / storer code", ["STORERKEY", "STORER", "STORER KEY", "CLIENT", "CLIENT CODE", "OWNER", "OWNER CODE", "PRINCIPAL"]],
  ["client_name", "Client name", ["COMPANY", "CLIENT NAME", "STORER NAME", "OWNER NAME"]],
  ["sku", "SKU", ["SKU", "ITEM", "ITEM CODE", "ITEM NO", "MATERIAL", "PRODUCT CODE", "ARTICLE", "PART NO"], true],
  ["descr", "Description", ["DESCR", "DESCRIPTION", "ITEM DESCRIPTION", "PRODUCT NAME", "ITEM NAME", "MATERIAL DESCRIPTION"]],
  ["loc", "Location", ["LOC", "LOCATION", "BIN", "LOCATION CODE", "BIN LOCATION"], true],
  ["zone", "Zone", ["ZONE", "PUTAWAYZONE", "PUTAWAY ZONE", "AREA"]],
  ["lpn", "LPN / pallet ID", ["ID", "LPN", "PALLET", "PALLET ID", "LICENSE PLATE", "LICENCE PLATE", "SSCC", "TOID"]],
  ["batch", "Batch", ["BATCH", "BATCH NO", "BATCH NUMBER", "LOT NO", "LOT NUMBER", "LOTTABLE02"]],
  ["ref2", "Lot ref 2", ["LOTTABLE07", "LOT REF", "LOT REFERENCE"]],
  ["mfg", "Mfg date", ["MFG_DATE", "MFG DATE", "MANUFACTURING DATE", "PRODUCTION DATE", "LOTTABLE04"]],
  ["exp", "Expiry date", ["EXP_DATE", "EXP DATE", "EXPIRY", "EXPIRY DATE", "BEST BEFORE", "BBD", "LOTTABLE05"]],
  ["qty", "Quantity (base unit)", ["SYSTEM_QTY", "SYSTEM QTY", "QTY", "QUANTITY", "ON HAND", "ONHAND", "QTY ON HAND", "STOCK QTY", "SOH"], true],
  ["alloc", "Allocated qty", ["ALLOCATED_QTY", "ALLOCATED QTY", "ALLOCATED", "QTYALLOCATED"]],
  ["picked", "Picked qty", ["PICKED_QTY", "PICKED QTY", "PICKED", "QTYPICKED"]],
  ["status", "Status (OK / HOLD)", ["STATUS", "INV STATUS", "INVENTORY STATUS", "HOLD STATUS"]],
  ["in_date", "Received date", ["IN_DATE", "IN DATE", "RECEIVED DATE", "RECEIPT DATE", "DATE RECEIVED"]],
  ["asn", "ASN / receipt", ["ASN", "RECEIPT", "RECEIPT KEY", "RECEIPTKEY"]],
  ["ext_ref", "External ref (PO)", ["EXTERNAL_ASN", "EXTERNAL ASN", "PO", "PO NUMBER", "EXTERNAL REF", "CLIENT REF"]],
  ["case_qty", "Units per case", ["CASECNT", "CASE QTY", "CASE COUNT", "UNITS PER CASE", "PACK SIZE", "CASE SIZE"]],
  ["uom", "Base unit", ["SYSTEM_UOM", "SYSTEM UOM", "UOM", "BASE UOM", "UNIT"]],
  ["case_uom", "Case unit", ["SECOND UOM", "CASE UOM"]],
  ["group1", "Item group", ["ITEM_GROUP", "ITEM GROUP", "ITEM CLASS", "CATEGORY"]],
  ["group2", "Item group 2", ["ITEM_GROUP2", "ITEM GROUP2", "ITEM GROUP 2", "SUB CATEGORY"]],
  ["shelf_life", "Total shelf life (days)", ["TOTAL_SHELF_LIFE", "TOTAL SHELF LIFE", "SHELF LIFE", "SHELF LIFE DAYS"]],
  ["barcode", "Barcode", ["BARCODE", "EAN", "UPC", "GTIN", "EAN CODE"]]
];
const normH = h => String(h || "").toUpperCase().replace(/[_\s.]+/g, " ").trim();
const IM = {table: null, name: "", map: {}, client: "", busy: false, result: null};
function guess(header) {
  const H = header.map(normH), m = {};
  FIELDS.forEach(([k, , names]) => { const i = H.findIndex(h => names.map(normH).includes(h)); m[k] = i; });
  return m;
}
const pad = n => String(n).padStart(2, "0");
function toDate(v) {
  if (v == null || v === "") return "";
  if (v instanceof Date) return isNaN(v) ? "" : `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  if (typeof v === "number") { if (v < 1000 || v > 80000) return ""; const d = new Date(Math.round((v - 25569) * 864e5)); return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`; }
  const s = String(v).trim(); let m;
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/))) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`;
  if ((m = s.match(/^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/))) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;   // day first (UAE)
  if ((m = s.match(/^(\d{1,2})[\/.\-\s]([A-Za-z]{3})[A-Za-z]*[\/.\-\s](\d{2,4})/))) { const mo = "JANFEBMARAPRMAYJUNJULAUGSEPOCTNOVDEC".indexOf(m[2].toUpperCase()) / 3 + 1; if (mo > 0) return `${m[3].length === 2 ? "20" + m[3] : m[3]}-${pad(mo)}-${pad(m[1])}`; }
  return "";
}
const clean = v => { const s = String(v ?? "").trim(); return /^(NA|N\/A|-|NULL|NONE)$/i.test(s) ? "" : s; };
const num = v => { if (typeof v === "number") return v; const n = Number(String(v ?? "").replace(/,/g, "").trim()); return isNaN(n) ? 0 : n; };
async function readStockFile(file) {
  let table;
  if (/\.(xlsx?|xlsm|xml)$/i.test(file.name)) {
    const wb = XLSX.read(await file.arrayBuffer(), {type: "array", cellDates: true});
    table = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, raw: true, defval: ""}).filter(r => r.some(v => v !== "" && v != null));
  } else table = (await C.readTable(file));
  if (table.length < 2) throw new Error("The file has no stock rows.");
  // the header is the first row that names a SKU and a location
  const hi = table.slice(0, 15).findIndex(r => { const g = guess(r); return g.sku >= 0 && g.loc >= 0; });
  if (hi > 0) table = table.slice(hi);
  return table;
}
function buildRows() {
  const m = IM.map, body = IM.table.slice(1), get = (r, k) => m[k] >= 0 ? r[m[k]] : "";
  const rows = [], skip = {noKey: 0, zero: 0};
  body.forEach(r => {
    const client = m.client >= 0 ? clean(get(r, "client")).toUpperCase() : IM.client, sku = clean(get(r, "sku")).toUpperCase(), loc = clean(get(r, "loc")).toUpperCase();
    if (!client || !sku || !loc) { skip.noKey++; return; }
    const qty = num(get(r, "qty")); if (qty <= 0) { skip.zero++; return; }
    let barcode = clean(get(r, "barcode")); const ref2 = clean(get(r, "ref2")), descr = clean(get(r, "descr"));
    if (!barcode && /^\d{8,14}$/.test(ref2)) barcode = ref2;
    if (!barcode) { const mm = descr.match(/^(\d{8,14})\s*-/); if (mm) barcode = mm[1]; }
    rows.push({client, client_name: clean(get(r, "client_name")), sku, descr, loc, zone: clean(get(r, "zone")), lpn: clean(get(r, "lpn")), batch: clean(get(r, "batch")), ref2,
      mfg: toDate(get(r, "mfg")), exp: toDate(get(r, "exp")), qty, alloc: num(get(r, "alloc")), picked: num(get(r, "picked")), status: clean(get(r, "status")) || "OK", in_date: toDate(get(r, "in_date")),
      asn: clean(get(r, "asn")), ext_ref: clean(get(r, "ext_ref")), case_qty: num(get(r, "case_qty")) || 1, uom: clean(get(r, "uom")), case_uom: clean(get(r, "case_uom")), group1: clean(get(r, "group1")), group2: clean(get(r, "group2")),
      shelf_life: Math.round(num(get(r, "shelf_life"))) || 0, barcode});
  });
  return {rows, skip};
}
async function pageImport(main) {
  await clients();
  let past = [];
  try { past = await C.q(C.sb.from("stock_imports").select("*").eq("status", "done").order("created_at", {ascending: false}).limit(15)); } catch {}
  main.innerHTML = `
    <div class="pagehead"><div><a href="#/stock" class="small">Stock</a><h1 style="margin-top:6px">Load stock file</h1><p class="muted small" style="margin:4px 0 0">Your WMS stock report, one row per pallet or per location and batch (Excel or CSV). For each client in the file, Stowra's stock is <strong>replaced</strong> by the file. New clients, items and locations are created automatically.</p></div></div>
    <div id="imbox">${IM.result ? resultHtml(IM.result) : `<label class="drop" id="imdrop"><input type="file" id="imfile" accept=".xlsx,.xls,.xml,.csv,.txt"><strong>Choose the stock file</strong><br><span class="small muted">or drop it here. Infor-style reports (STORERKEY, SKU, LOC, ID, LOT, EXP_DATE…) are recognised automatically.</span></label>`}</div>
    ${past.length ? `<h3 style="margin:22px 0 0">Recent files</h3><div class="tablewrap"><table><thead><tr><th>When</th><th>File</th><th>Clients</th><th class="n">Lines</th><th class="n">Units</th><th class="n">Items changed</th><th class="n">New items</th><th class="n">New locations</th></tr></thead><tbody>
      ${past.map(p => `<tr><td class="small">${C.dt(p.finished_at || p.created_at)}</td><td>${esc(p.file_name)}</td><td>${esc((p.summary.clients || []).join(", "))}</td><td class="n">${C.fmt(p.summary.rows)}</td><td class="n">${C.fmt(p.summary.qty)}</td><td class="n">${C.fmt(p.summary.changed_items)}</td><td class="n">${C.fmt(p.summary.new_items)}</td><td class="n">${C.fmt(p.summary.new_locations)}</td></tr>`).join("")}
    </tbody></table></div>` : ""}`;
  IM.result = null;
  const inp = $("#imfile"), drop = $("#imdrop");
  if (inp) {
    inp.onchange = () => inp.files[0] && pickFile(inp.files[0]);
    drop.ondragover = e => { e.preventDefault(); drop.classList.add("over"); }; drop.ondragleave = () => drop.classList.remove("over");
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove("over"); if (e.dataTransfer.files[0]) pickFile(e.dataTransfer.files[0]); };
  }
}
async function pickFile(file) {
  C.toast(`Reading ${file.name}…`);
  try { IM.table = await readStockFile(file); IM.name = file.name; IM.map = guess(IM.table[0]); IM.client = V.client || ""; renderMapping(); }
  catch (e) { C.fail(e); }
}
function renderMapping() {
  const H = IM.table[0], m = IM.map, box = $("#imbox");
  const opts = sel => `<option value="-1">(not in the file)</option>` + H.map((h, i) => `<option value="${i}" ${i === sel ? "selected" : ""}>${esc(h || `Column ${i + 1}`)}</option>`).join("");
  const {rows, skip} = buildRows();
  const byClient = new Map();
  rows.forEach(r => { let c = byClient.get(r.client); if (!c) byClient.set(r.client, c = {rows: 0, qty: 0, skus: new Set(), locs: new Set(), hold: 0, expired: 0, noExp: 0}); c.rows++; c.qty += r.qty; c.skus.add(r.sku); c.locs.add(r.loc); if (/^(HOLD|H|BLOCKED|QC)$/i.test(r.status)) c.hold++; if (r.exp && r.exp < new Date().toISOString().slice(0, 10)) c.expired++; if (!r.exp) c.noExp++; });
  const known = new Set((clientsCache || []).map(c => c.code));
  box.innerHTML = `<div class="panel"><h3 style="margin-bottom:4px">${esc(IM.name)}</h3><p class="hint" style="margin-top:0">${C.fmt(IM.table.length - 1)} rows. Check the columns below; the ones Stowra recognised are already chosen.</p>
    ${m.client < 0 ? `<label class="field" style="max-width:320px;margin-bottom:10px">The file has no client column. Which client is it for?<select id="imclient"><option value="">Choose…</option>${(clientsCache || []).map(c => `<option ${c.code === IM.client ? "selected" : ""}>${esc(c.code)}</option>`).join("")}</select></label><p class="hint">For a new client, add it first under <a href="#/clients">Clients</a>, or use a file with a client column.</p>` : ""}
    <div class="map">${FIELDS.map(([k, label, , req]) => `<label class="field">${label}${req ? " *" : ""}<select data-map="${k}">${opts(m[k])}</select></label>`).join("")}</div></div>
    ${rows.length ? `<div class="tablewrap" style="margin-top:12px"><table><thead><tr><th>Client</th><th class="n">Lines</th><th class="n">Units</th><th class="n">SKUs</th><th class="n">Locations</th><th class="n">On hold</th><th class="n">Expired</th><th class="n">No expiry date</th><th></th></tr></thead><tbody>
      ${[...byClient].map(([code, c]) => `<tr><td><strong>${esc(code)}</strong></td><td class="n">${C.fmt(c.rows)}</td><td class="n">${C.fmt(c.qty)}</td><td class="n">${C.fmt(c.skus.size)}</td><td class="n">${C.fmt(c.locs.size)}</td><td class="n">${C.fmt(c.hold)}</td><td class="n ${c.expired ? "var-neg" : ""}">${C.fmt(c.expired)}</td><td class="n">${C.fmt(c.noExp)}</td>
        <td class="small">${known.has(code) ? "Replaces this client's stock" : "New client"}</td></tr>`).join("")}</tbody></table></div>` : ""}
    ${skip.noKey || skip.zero ? `<div class="banner warn" style="margin-top:12px"><span>${[skip.noKey && `${C.fmt(skip.noKey)} rows without a client, SKU or location`, skip.zero && `${C.fmt(skip.zero)} rows with quantity 0`].filter(Boolean).join(" and ")} will be skipped.</span></div>` : ""}
    ${[...byClient.values()].some(c => c.expired) ? `<div class="banner" style="margin-top:12px"><span>Expired stock is put on hold automatically (client setting).</span></div>` : ""}
    <div class="row" style="margin-top:14px"><button class="btn go" data-sa="im-go" ${rows.length ? "" : "disabled"}>Load ${C.fmt(rows.length)} lines</button><button class="btn ghost" data-sa="im-cancel">Choose another file</button></div>
    <div id="improg"></div>`;
  $$("[data-map]").forEach(s => s.onchange = () => { IM.map[s.dataset.map] = +s.value; renderMapping(); });
  const ic = $("#imclient"); if (ic) ic.onchange = () => { IM.client = ic.value; renderMapping(); };
}
async function runImport() {
  if (IM.busy) return; const {rows} = buildRows(); if (!rows.length) return;
  IM.busy = true; const prog = $("#improg"), btn = $("[data-sa=im-go]"); if (btn) btn.disabled = true;
  const say = t => { if (prog) prog.innerHTML = `<p class="hint">${t}</p>`; };
  try {
    say("Preparing…");
    const imp = await C.q(C.sb.from("stock_imports").insert({file_name: IM.name}).select().single());
    for (let i = 0; i < rows.length; i += 500) {
      say(`Uploading ${C.fmt(Math.min(i + 500, rows.length))} of ${C.fmt(rows.length)} lines…`);
      await C.q(C.sb.from("stock_import_rows").insert(rows.slice(i, i + 500).map((d, j) => ({import_id: imp.id, row_no: i + j + 1, data: d}))));
    }
    say("Updating the stock…");
    IM.result = await C.q(C.sb.rpc("stock_import_finish", {p_import: imp.id}));
    IM.table = null; clientsCache = null; V.checked = true;
    pageImport($("#main"));
  } catch (e) { C.fail(e); say(""); if (btn) btn.disabled = false; }
  finally { IM.busy = false; }
}
function resultHtml(r) {
  return `<div class="banner ok"><span>Stock loaded for ${esc((r.clients || []).join(", "))}: ${C.fmt(r.rows)} lines, ${C.fmt(r.qty)} units.</span></div>
    <div class="stats"><div class="stat"><div class="l">Items with a changed total</div><div class="v">${C.fmt(r.changed_items)}</div></div><div class="stat"><div class="l">New items</div><div class="v">${C.fmt(r.new_items)}</div></div>
      <div class="stat"><div class="l">New locations</div><div class="v">${C.fmt(r.new_locations)}</div></div><div class="stat"><div class="l">Lines on hold</div><div class="v">${C.fmt(r.hold_rows)}</div></div><div class="stat"><div class="l">Expired, put on hold now</div><div class="v">${C.fmt(r.expired_held)}</div></div></div>
    <div class="row"><a class="btn go" href="#/stock">View stock</a>${N(r.new_locations) ? `<a class="btn" href="#/locations">Check new locations</a>` : ""}<a class="btn" href="#/clients">Client rules</a><button class="btn ghost" data-sa="im-again">Load another file</button></div>`;
}

/* =====================================================================
   Clients and their rules
   ===================================================================== */
async function pageClients(main) {
  const list = await clients(true);
  let sums = new Map();
  try { (await pageAll(() => C.sb.from("item_stock_v").select("client_code,qty").gt("qty", 0))).forEach(r => { const s = sums.get(r.client_code) || {items: 0, qty: 0}; s.items++; s.qty += N(r.qty); sums.set(r.client_code, s); }); } catch {}
  main.innerHTML = `
    <div class="pagehead"><div><h1>Clients</h1><p class="muted small" style="margin:4px 0 0">Each client (storer) has its own rules: batch and expiry tracking, shelf life on receipt and dispatch, near-expiry warning and how stock is picked (FEFO or FIFO).</p></div>
      <div class="row"><button class="btn go" data-sa="client-new">Add client</button></div></div>
    ${list.length ? `<div class="tablewrap"><table><thead><tr><th>Code</th><th>Name</th><th>Picking</th><th>Batch</th><th>Expiry</th><th class="n">Near expiry</th><th class="n">Min. life to dispatch</th><th class="n">Items in stock</th><th class="n">Units</th><th>Active</th></tr></thead><tbody>
      ${list.map(c => { const s = sums.get(c.code) || {}; const T = {off: "Not tracked", optional: "Optional", required: "Required"};
        return `<tr style="cursor:pointer" data-sa="client" data-id="${esc(c.id)}"><td><strong>${esc(c.code)}</strong></td><td>${esc(c.name || "–")}</td><td>${esc(c.allocation)}</td><td class="small">${T[c.track_batch]}${c.batch_label !== "Batch" ? ` (${esc(c.batch_label)})` : ""}</td><td class="small">${T[c.track_expiry]}</td>
          <td class="n">${C.fmt(c.near_expiry_days)} d</td><td class="n">${N(c.min_life_ship_days) ? C.fmt(c.min_life_ship_days) + " d" : "–"}</td><td class="n">${C.fmt(s.items || 0)}</td><td class="n">${C.fmt(s.qty || 0)}</td><td>${c.active ? "Yes" : "No"}</td></tr>`; }).join("")}</tbody></table></div>`
    : `<div class="empty"><h2>No clients yet</h2><p>Load a stock file and the clients in it are created, or add one now.</p></div>`}`;
}
async function pageClient(main, id) {
  const list = await clients(true), c = list.find(x => String(x.id) === String(id));
  if (!c) { main.innerHTML = `<div class="empty"><h2>Client not found</h2><p><a href="#/clients">Back to clients</a></p></div>`; return; }
  const tri = (name, val) => `<select name="${name}">${[["off", "Not tracked"], ["optional", "Optional"], ["required", "Required"]].map(([k, l]) => `<option value="${k}" ${val === k ? "selected" : ""}>${l}</option>`).join("")}</select>`;
  main.innerHTML = `
    <div class="pagehead"><div><a href="#/clients" class="small">Clients</a><h1 style="margin-top:6px">${esc(c.code)}</h1><span class="muted small">${esc(c.name || "")}</span></div>
      <div class="row"><a class="btn" href="#/stock" data-sa="client-stock" data-code="${esc(c.code)}">View stock</a></div></div>
    <form id="clf" class="panel" style="max-width:860px">
      <h3>Details</h3>
      <div class="grid2"><label class="field">Name<input name="name" value="${esc(c.name)}"></label><label class="field">Active<select name="active"><option value="1" ${c.active ? "selected" : ""}>Yes</option><option value="0" ${c.active ? "" : "selected"}>No</option></select></label></div>
      <h3 style="margin-top:18px">What is recorded for each pallet</h3>
      <div class="grid2"><label class="field">Batch${tri("track_batch", c.track_batch)}</label><label class="field">Name of the batch field<input name="batch_label" value="${esc(c.batch_label)}" placeholder="e.g. Batch, Container no."></label>
        <label class="field">Expiry date${tri("track_expiry", c.track_expiry)}</label><label class="field">Manufacturing date${tri("track_mfg", c.track_mfg)}</label>
        <label class="field">Name of the second lot field<input name="ref2_label" value="${esc(c.ref2_label)}" placeholder="e.g. EAN, serial, PO line"></label></div>
      <p class="hint">"Required" means receiving and found stock can't be saved without it.</p>
      <h3 style="margin-top:18px">Shelf life and picking</h3>
      <div class="grid2"><label class="field">Pick stock by<select name="allocation"><option value="FEFO" ${c.allocation === "FEFO" ? "selected" : ""}>FEFO: first to expire, first out</option><option value="FIFO" ${c.allocation === "FIFO" ? "selected" : ""}>FIFO: first received, first out</option></select></label>
        <label class="field">Near-expiry warning (days before expiry)<input name="near_expiry_days" type="number" min="0" value="${esc(c.near_expiry_days)}"></label>
        <label class="field">Minimum shelf life left to receive (%)<input name="min_life_receive_pct" type="number" min="0" max="100" value="${esc(c.min_life_receive_pct)}"></label>
        <label class="field">Minimum days left to dispatch<input name="min_life_ship_days" type="number" min="0" value="${esc(c.min_life_ship_days)}"></label>
        <label class="field">Expired stock<select name="auto_hold_expired"><option value="1" ${c.auto_hold_expired ? "selected" : ""}>Put on hold automatically</option><option value="0" ${c.auto_hold_expired ? "" : "selected"}>Leave available</option></select></label></div>
      <p class="hint">Receiving uses the minimum shelf life to warn or refuse; picking (coming next) uses the picking rule and minimum days to dispatch.</p>
      <label class="field" style="margin-top:12px">Notes<textarea name="notes" rows="3" style="min-height:60px;font-family:var(--sans)">${esc(c.notes)}</textarea></label>
      <div class="row" style="margin-top:14px"><button class="btn primary" type="submit">Save</button></div>
    </form>`;
  $("#clf").onsubmit = async e => {
    e.preventDefault(); const f = e.target, n = k => Math.max(0, Math.round(N(f[k].value)));
    const p = {name: f.name.value.trim(), active: f.active.value === "1", track_batch: f.track_batch.value, track_expiry: f.track_expiry.value, track_mfg: f.track_mfg.value,
      batch_label: f.batch_label.value.trim() || "Batch", ref2_label: f.ref2_label.value.trim() || "Lot ref 2", allocation: f.allocation.value, near_expiry_days: n("near_expiry_days"),
      min_life_receive_pct: Math.min(100, n("min_life_receive_pct")), min_life_ship_days: n("min_life_ship_days"), auto_hold_expired: f.auto_hold_expired.value === "1", notes: f.notes.value, updated_at: new Date().toISOString()};
    if (await C.run(() => C.q(C.sb.from("clients").update(p).eq("id", c.id)), "Saved")) { clientsCache = null; if (p.auto_hold_expired) { try { await C.q(C.sb.rpc("stock_hold_expired")); } catch {} } }
  };
}
function newClientDialog() {
  dialog("stdlg", `<h2 style="margin-bottom:12px">Add client</h2>
    <label class="field" style="margin-bottom:10px">Code (as in your WMS, e.g. the storer key)<input name="code" required autocapitalize="characters"></label>
    <label class="field" style="margin-bottom:14px">Name<input name="name"></label>
    <div class="row"><button class="btn primary" value="ok">Add</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div>`, async f => {
    const r = await C.run(() => C.q(C.sb.from("clients").insert({code: f.code.value.trim().toUpperCase(), name: f.name.value.trim()}).select().single()), "Client added");
    if (!r) return false; clientsCache = null; C.go("clients/" + r.id);
  });
}

/* =====================================================================
   Item master
   ===================================================================== */
function skuQuery(count) {
  let qq = C.sb.from("item_stock_v").select("*", count ? {count: "exact"} : undefined);
  if (V.client) qq = qq.eq("client_code", V.client);
  const t = term(V.iq); if (t) qq = qq.or(`sku.ilike.%${t}%,description.ilike.%${t}%,barcode.ilike.%${t}%,item_group2.ilike.%${t}%`);
  return qq.order("client_code").order("sku");
}
async function pageSkus(main) {
  await clients();
  let rows = [], total = 0;
  try { const r = await C.q(skuQuery(true).range(V.ipage * PAGE, V.ipage * PAGE + PAGE - 1)); rows = r.data || r; total = r.count ?? rows.length; } catch (e) { C.fail(e); }
  C.cache.skuRows = rows;
  main.innerHTML = `
    <div class="pagehead"><div><h1>Item master</h1><p class="muted small" style="margin:4px 0 0">Every SKU per client, with barcode, units and shelf life. Items arrive with stock files; add or correct them here.</p></div>
      <div class="row"><button class="btn" data-sa="export-skus" ${total ? "" : "disabled"}>Export to Excel</button><button class="btn go" data-sa="sku-new" ${clientsCache.length ? "" : "disabled"}>Add item</button></div></div>
    <div class="toolbar" style="gap:8px;justify-content:flex-start">${clientSelect("skclient", V.client)}<input class="search" id="sksearch" placeholder="Search SKU, description, barcode or group" value="${esc(V.iq)}"></div>
    ${rows.length ? `<div class="tablewrap"><table><thead><tr><th>Client</th><th>SKU</th><th>Description</th><th>Barcode</th><th>Unit</th><th class="n">Per case</th><th>Group</th><th class="n">Shelf life</th><th class="n">In stock</th><th>Active</th><th></th></tr></thead><tbody>
      ${rows.map(v => `<tr><td>${esc(v.client_code)}</td><td><a href="#/stock/item/${esc(v.item_id)}"><strong>${esc(v.sku)}</strong></a></td><td class="desc">${esc(v.description)}</td><td class="small">${esc(v.barcode || "–")}</td><td>${esc(v.base_uom)}</td><td class="n">${C.fmt(v.case_qty)}</td>
        <td class="small">${esc([v.item_group, v.item_group2].filter(Boolean).join(" · ") || "–")}</td><td class="n">${N(v.shelf_life_days) ? C.fmt(v.shelf_life_days) + " d" : "–"}</td><td class="n">${C.fmt(v.qty)}</td><td>${v.active ? "Yes" : "No"}</td>
        <td><button class="linkbtn small" data-sa="sku-edit" data-id="${esc(v.item_id)}">Edit</button></td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty" style="margin-top:12px"><h2>No items</h2><p>${V.iq || V.client ? "Try another search." : "Load a stock file, or add items."}</p></div>`}
    ${total > PAGE ? `<div class="pager"><span>${C.fmt(V.ipage * PAGE + 1)}–${C.fmt(Math.min(total, V.ipage * PAGE + PAGE))} of ${C.fmt(total)}</span><button class="btn sm" data-sa="ipage" data-d="-1" ${V.ipage ? "" : "disabled"}>Previous</button><button class="btn sm" data-sa="ipage" data-d="1" ${(V.ipage + 1) * PAGE < total ? "" : "disabled"}>Next</button></div>` : ""}`;
  $("#skclient").onchange = e => { V.client = e.target.value; V.ipage = 0; pageSkus(main); };
  const s = $("#sksearch"); let t; s.oninput = () => { clearTimeout(t); t = setTimeout(() => { V.iq = s.value; V.ipage = 0; pageSkus(main).then(() => { const x = $("#sksearch"); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }); }, 350); };
}
function skuDialog(v) {
  const isNew = !v; v = v || {base_uom: "Each", case_qty: 1, case_uom: "Case", active: true};
  dialog("stdlg", `<h2 style="margin-bottom:12px">${isNew ? "Add item" : `Edit ${esc(v.client_code)} · ${esc(v.sku)}`}</h2>
    <div class="grid2">${isNew ? `<label class="field" style="margin-bottom:10px">Client<select name="client" required>${clientsCache.map(c => `<option value="${esc(c.id)}" ${c.code === V.client ? "selected" : ""}>${esc(c.code)}</option>`).join("")}</select></label><label class="field" style="margin-bottom:10px">SKU<input name="sku" required autocapitalize="characters"></label>` : ""}
      <label class="field" style="margin-bottom:10px;grid-column:1/-1">Description<input name="description" value="${esc(v.description || "")}"></label>
      <label class="field" style="margin-bottom:10px">Barcode<input name="barcode" value="${esc(v.barcode || "")}"></label>
      <label class="field" style="margin-bottom:10px">Base unit<input name="base_uom" value="${esc(v.base_uom || "Each")}"></label>
      <label class="field" style="margin-bottom:10px">Units per case<input name="case_qty" type="number" min="1" step="any" value="${esc(v.case_qty || 1)}"></label>
      <label class="field" style="margin-bottom:10px">Case unit<input name="case_uom" value="${esc(v.case_uom || "Case")}"></label>
      <label class="field" style="margin-bottom:10px">Item group<input name="item_group" value="${esc(v.item_group || "")}"></label>
      <label class="field" style="margin-bottom:10px">Item group 2<input name="item_group2" value="${esc(v.item_group2 || "")}"></label>
      <label class="field" style="margin-bottom:10px">Total shelf life (days)<input name="shelf_life_days" type="number" min="0" value="${esc(v.shelf_life_days || 0)}"></label>
      <label class="field" style="margin-bottom:10px">Unit cost<input name="unit_cost" type="number" min="0" step="any" value="${esc(v.unit_cost || 0)}"></label>
      <label class="field" style="margin-bottom:14px">Active<select name="active"><option value="1" ${v.active ? "selected" : ""}>Yes</option><option value="0" ${v.active ? "" : "selected"}>No</option></select></label></div>
    <div class="row"><button class="btn primary" value="ok">Save</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div>`, async f => {
    const p = {description: f.description.value.trim(), barcode: f.barcode.value.trim(), base_uom: f.base_uom.value.trim() || "Each", case_qty: Math.max(N(f.case_qty.value), 1), case_uom: f.case_uom.value.trim() || "Case",
      item_group: f.item_group.value.trim(), item_group2: f.item_group2.value.trim(), shelf_life_days: Math.max(0, Math.round(N(f.shelf_life_days.value))), unit_cost: Math.max(0, N(f.unit_cost.value)), active: f.active.value === "1", updated_at: new Date().toISOString()};
    const r = isNew ? await C.run(() => C.q(C.sb.from("items").insert({...p, client_id: f.client.value, sku: f.sku.value.trim().toUpperCase()})), "Item added")
      : await C.run(() => C.q(C.sb.from("items").update(p).eq("id", v.item_id)), "Saved");
    if (!r) return false; pageSkus($("#main"));
  });
}

/* =====================================================================
   Locations
   ===================================================================== */
function locQuery(count) {
  let qq = C.sb.from("locations").select("*", count ? {count: "exact"} : undefined);
  if (V.lk !== "all") qq = V.lk === "off" ? qq.eq("active", false) : qq.eq("kind", V.lk);
  const t = term(V.lq); if (t) qq = qq.or(`code.ilike.%${t}%,zone.ilike.%${t}%`);
  return qq.order("code");
}
async function pageLocations(main) {
  let rows = [], total = 0, sites = [];
  try { const [r, s] = await Promise.all([C.q(locQuery(true).range(V.lpage * PAGE, V.lpage * PAGE + PAGE - 1)), C.q(C.sb.from("sites").select("id,name").order("name"))]); rows = r.data || r; total = r.count ?? rows.length; sites = s; } catch (e) { C.fail(e); }
  C.cache.locRows = rows; C.cache.sites = sites;
  main.innerHTML = `
    <div class="pagehead"><div><h1>Locations</h1><p class="muted small" style="margin:4px 0 0">Storage, staging, outbound and hold locations. Stock in damage, short and quarantine locations is always on hold. New locations from stock files get a type guessed from the code; check them here.</p></div>
      <div class="row"><button class="btn" data-sa="export-locs" ${total ? "" : "disabled"}>Export to Excel</button><button class="btn go" data-sa="loc-new">Add locations</button></div></div>
    <div class="toolbar" style="flex-wrap:wrap;gap:8px;justify-content:flex-start"><div class="chips">${[["all", "All"], ...Object.entries(KIND).filter(([k]) => k !== "pick"), ["off", "Turned off"]].map(([k, l]) => `<button class="chip" aria-pressed="${V.lk === k}" data-sa="lfilter" data-f="${k}">${l}</button>`).join("")}</div>
      <input class="search" id="lcsearch" placeholder="Search code or zone" value="${esc(V.lq)}"></div>
    ${V.lsel.size ? `<div class="banner"><span>${V.lsel.size} selected</span><span class="row"><select id="lbulk" class="search" style="max-width:200px"><option value="">Change type to…</option>${Object.entries(KIND).map(([k, l]) => `<option value="${k}">${l}</option>`).join("")}</select><button class="btn sm" data-sa="loc-off">Turn off</button><button class="btn sm" data-sa="loc-on">Turn on</button><button class="btn sm ghost" data-sa="lclear">Clear</button></span></div>` : ""}
    ${rows.length ? `<div class="tablewrap"><table><thead><tr><th><input type="checkbox" id="lselall" aria-label="Select all on this page" ${rows.every(r => V.lsel.has(String(r.id))) ? "checked" : ""}></th><th>Code</th><th>Zone</th><th>Type</th><th>Stock is</th><th>Mixed SKUs</th><th>Site</th><th>Active</th><th></th></tr></thead><tbody>
      ${rows.map(l => `<tr class="${l.active ? "" : "muted"}"><td><input type="checkbox" data-lsel="${esc(l.id)}" ${V.lsel.has(String(l.id)) ? "checked" : ""} aria-label="Select"></td><td><span class="tag">${esc(l.code)}</span></td><td>${esc(l.zone || "–")}</td><td>${KIND[l.kind] || esc(l.kind)}</td>
        <td>${l.hold ? `<span class="status s-out">On hold</span>` : "Available"}</td><td>${l.mixed_allowed ? "Allowed" : "One SKU only"}</td><td class="small">${esc((sites.find(s => s.id === l.site_id) || {}).name || "–")}</td><td>${l.active ? "Yes" : "No"}</td>
        <td style="white-space:nowrap"><button class="linkbtn small" data-sa="loc-edit" data-id="${esc(l.id)}">Edit</button> <button class="linkbtn small" data-sa="loc-stock" data-code="${esc(l.code)}">Stock</button></td></tr>`).join("")}</tbody></table></div>`
    : `<div class="empty" style="margin-top:12px"><h2>No locations</h2><p>${V.lq || V.lk !== "all" ? "Try another filter." : "Load a stock file, or add locations."}</p></div>`}
    ${total > PAGE ? `<div class="pager"><span>${C.fmt(V.lpage * PAGE + 1)}–${C.fmt(Math.min(total, V.lpage * PAGE + PAGE))} of ${C.fmt(total)}</span><button class="btn sm" data-sa="lpage" data-d="-1" ${V.lpage ? "" : "disabled"}>Previous</button><button class="btn sm" data-sa="lpage" data-d="1" ${(V.lpage + 1) * PAGE < total ? "" : "disabled"}>Next</button></div>` : ""}`;
  const s = $("#lcsearch"); let t; s.oninput = () => { clearTimeout(t); t = setTimeout(() => { V.lq = s.value; V.lpage = 0; pageLocations(main).then(() => { const x = $("#lcsearch"); x.focus(); x.setSelectionRange(x.value.length, x.value.length); }); }, 350); };
  $$("[data-lsel]").forEach(cb => cb.onchange = () => { cb.checked ? V.lsel.add(cb.dataset.lsel) : V.lsel.delete(cb.dataset.lsel); pageLocations(main); });
  const all = $("#lselall"); if (all) all.onchange = () => { rows.forEach(r => all.checked ? V.lsel.add(String(r.id)) : V.lsel.delete(String(r.id))); pageLocations(main); };
  const bulk = $("#lbulk"); if (bulk) bulk.onchange = async () => { const k = bulk.value; if (!k) return; const ids = [...V.lsel].map(x => isNaN(x) ? x : +x);
    if (await C.run(() => C.q(C.sb.from("locations").update({kind: k, hold: ["damage", "short", "quarantine"].includes(k)}).in("id", ids)), `${ids.length} location${ids.length === 1 ? "" : "s"} changed to ${KIND[k]}`)) { V.lsel.clear(); pageLocations(main); } };
}
function locDialog(l) {
  const sites = C.cache.sites || [];
  dialog("stdlg", `<h2 style="margin-bottom:12px">Location ${esc(l.code)}</h2>
    <div class="grid2"><label class="field" style="margin-bottom:10px">Zone<input name="zone" value="${esc(l.zone)}"></label>
      <label class="field" style="margin-bottom:10px">Type<select name="kind">${Object.entries(KIND).map(([k, x]) => `<option value="${k}" ${l.kind === k ? "selected" : ""}>${x}</option>`).join("")}</select></label>
      <label class="field" style="margin-bottom:10px">Stock here is<select name="hold"><option value="0" ${l.hold ? "" : "selected"}>Available</option><option value="1" ${l.hold ? "selected" : ""}>On hold</option></select></label>
      <label class="field" style="margin-bottom:10px">Mixed SKUs<select name="mixed"><option value="1" ${l.mixed_allowed ? "selected" : ""}>Allowed</option><option value="0" ${l.mixed_allowed ? "" : "selected"}>One SKU only</option></select></label>
      <label class="field" style="margin-bottom:10px">Site<select name="site"><option value="">–</option>${sites.map(s => `<option value="${esc(s.id)}" ${s.id === l.site_id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
      <label class="field" style="margin-bottom:10px">Active<select name="active"><option value="1" ${l.active ? "selected" : ""}>Yes</option><option value="0" ${l.active ? "" : "selected"}>No</option></select></label></div>
    <label class="field" style="margin-bottom:14px">Notes<input name="notes" value="${esc(l.notes || "")}"></label>
    <p class="hint">Damage, short and quarantine locations are always on hold. Changing "on hold" doesn't change stock already there; hold or release that stock from the Stock page.</p>
    <div class="row"><button class="btn primary" value="ok">Save</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div>`, async f => {
    const kind = f.kind.value, p = {zone: f.zone.value.trim(), kind, hold: ["damage", "short", "quarantine"].includes(kind) || f.hold.value === "1", mixed_allowed: f.mixed.value === "1", site_id: f.site.value || null, active: f.active.value === "1", notes: f.notes.value.trim()};
    const r = await C.run(() => C.q(C.sb.from("locations").update(p).eq("id", l.id)), "Saved"); if (!r) return false; pageLocations($("#main"));
  });
}
function newLocDialog() {
  dialog("stdlg", `<h2 style="margin-bottom:6px">Add locations</h2><p class="hint">One code per line, or a range: a start code and an end code with the same pattern, e.g. <code>W2C2C0101A</code> to <code>W2C2C0120A</code>.</p>
    <label class="field" style="margin-bottom:10px">Codes<textarea name="codes" rows="5" style="min-height:90px;font-family:var(--mono, monospace)" placeholder="W2C2C0101A&#10;W2C2C0102A"></textarea></label>
    <div class="grid2"><label class="field" style="margin-bottom:10px">Or range from<input name="from" autocapitalize="characters"></label><label class="field" style="margin-bottom:10px">to<input name="to" autocapitalize="characters"></label>
      <label class="field" style="margin-bottom:10px">Zone<input name="zone"></label><label class="field" style="margin-bottom:14px">Type<select name="kind">${Object.entries(KIND).map(([k, x]) => `<option value="${k}">${x}</option>`).join("")}</select></label></div>
    <div class="row"><button class="btn primary" value="ok">Add</button><button class="btn ghost" value="cancel" formnovalidate>Cancel</button></div>`, async f => {
    let codes = f.codes.value.split(/[\n,;]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    const a = f.from.value.trim().toUpperCase(), b = f.to.value.trim().toUpperCase();
    if (a && b) { const r = expandRange(a, b); if (!r) { C.toast("The range must have the same pattern, with one number part that changes (up to 2000 codes).", true); return false; } codes = codes.concat(r); }
    codes = [...new Set(codes)]; if (!codes.length) { C.toast("Enter at least one code.", true); return false; }
    const kind = f.kind.value, zone = f.zone.value.trim();
    let existing = []; try { for (let i = 0; i < codes.length; i += 150) existing.push(...(await C.q(C.sb.from("locations").select("code").in("code", codes.slice(i, i + 150)))).map(x => x.code)); } catch {}
    const add = codes.filter(c => !existing.includes(c));
    if (!add.length) { C.toast("All these locations already exist.", true); return false; }
    for (let i = 0; i < add.length; i += 500) if (!await C.run(() => C.q(C.sb.from("locations").insert(add.slice(i, i + 500).map(code => ({code, zone, kind, hold: ["damage", "short", "quarantine"].includes(kind)})))))) return false;
    C.toast(`${add.length} location${add.length === 1 ? "" : "s"} added${existing.length ? `, ${existing.length} already existed` : ""}`); pageLocations($("#main"));
  });
}
function expandRange(a, b) {   // W2C2C0101A .. W2C2C0120A: exactly one number part differs
  const ta = a.match(/\d+|\D+/g), tb = b.match(/\d+|\D+/g);
  if (!ta || !tb || ta.length !== tb.length) return null;
  const diff = ta.map((x, i) => x !== tb[i] ? i : -1).filter(i => i >= 0);
  if (diff.length !== 1 || !/^\d+$/.test(ta[diff[0]]) || ta[diff[0]].length !== tb[diff[0]].length) return null;
  const i = diff[0], w = ta[i].length, lo = Math.min(+ta[i], +tb[i]), hi = Math.max(+ta[i], +tb[i]);
  if (hi - lo > 2000) return null;
  const out = []; for (let n = lo; n <= hi; n++) { const t = ta.slice(); t[i] = String(n).padStart(w, "0"); out.push(t.join("")); }
  return out;
}

/* =====================================================================
   Exports and clicks
   ===================================================================== */
async function exportRows(build, map, sheet, name) {
  C.toast("Preparing the Excel file…");
  try { const rows = await pageAll(build); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.map(map)), sheet); await C.saveWorkbook(wb, name); } catch (e) { C.fail(e); }
}
document.addEventListener("click", async e => {
  const b = e.target.closest("[data-sa]"); if (!b || !C) return;
  const main = $("#main"), id = b.dataset.id;
  switch (b.dataset.sa) {
    case "view": V.view = b.dataset.v; V.page = 0; V.sel.clear(); pageStock(main); break;
    case "filter": V.f = b.dataset.f; V.page = 0; V.sel.clear(); pageStock(main); break;
    case "page": V.page += +b.dataset.d; pageStock(main); break;
    case "item": C.go("stock/item/" + id); break;
    case "clear-sel": V.sel.clear(); pageStock(main); break;
    case "hold": case "release": statusDialog([...V.sel].map(x => isNaN(x) ? x : +x), b.dataset.sa === "hold" ? "hold" : "ok", () => { V.sel.clear(); pageStock(main); }); break;
    case "move": { const v = rowById(id); if (v) moveDialog(v, () => C.route()[1] === "item" ? pageItem(main, C.route()[2]) : pageStock(main)); break; }
    case "adjust": { const v = rowById(id); if (v) adjustDialog(v, () => C.route()[1] === "item" ? pageItem(main, C.route()[2]) : pageStock(main)); break; }
    case "found": foundDialog(() => pageStock(main)); break;
    case "export": exportStock(); break;
    case "mfilter": V.mk = b.dataset.f; V.mpage = 0; pageMoves(main); break;
    case "mpage": V.mpage += +b.dataset.d; pageMoves(main); break;
    case "export-moves": exportRows(() => movesQuery(), m => ({When: new Date(m.created_at), Who: m.user_name || "", What: MOVE[m.kind] || m.kind, Client: m.client_code || "", SKU: m.sku || "", Description: m.description || "", From: m.from_loc, To: m.to_loc, LPN: m.lpn, Batch: m.batch, "Expiry date": m.expiry_date || "", Qty: m.qty == null ? "" : N(m.qty), Before: m.qty_before == null ? "" : N(m.qty_before), After: m.qty_after == null ? "" : N(m.qty_after), Reason: m.reason, Note: m.note, Reference: m.ref, Device: m.device || ""}), "Stock history", `Stowra_stock_history_${new Date().toISOString().slice(0, 10)}.xlsx`); break;
    case "im-go": runImport(); break;
    case "im-cancel": IM.table = null; pageImport(main); break;
    case "im-again": IM.result = null; pageImport(main); break;
    case "client": C.go("clients/" + id); break;
    case "client-new": newClientDialog(); break;
    case "client-stock": e.preventDefault(); V.client = b.dataset.code; V.page = 0; C.go("stock"); break;
    case "sku-new": skuDialog(null); break;
    case "sku-edit": { const v = (C.cache.skuRows || []).find(r => String(r.item_id) === String(id)); if (v) skuDialog(v); break; }
    case "ipage": V.ipage += +b.dataset.d; pageSkus(main); break;
    case "export-skus": exportRows(() => skuQuery(), v => ({Client: v.client_code, SKU: v.sku, Description: v.description, Barcode: v.barcode, "Base unit": v.base_uom, "Units per case": N(v.case_qty), "Case unit": v.case_uom, "Item group": v.item_group, "Item group 2": v.item_group2, "Shelf life (days)": N(v.shelf_life_days), "Unit cost": N(v.unit_cost), "In stock": N(v.qty), Active: v.active ? "Yes" : "No"}), "Items", `Stowra_items_${new Date().toISOString().slice(0, 10)}.xlsx`); break;
    case "lfilter": V.lk = b.dataset.f; V.lpage = 0; pageLocations(main); break;
    case "lpage": V.lpage += +b.dataset.d; pageLocations(main); break;
    case "lclear": V.lsel.clear(); pageLocations(main); break;
    case "loc-new": newLocDialog(); break;
    case "loc-edit": { const l = (C.cache.locRows || []).find(r => String(r.id) === String(id)); if (l) locDialog(l); break; }
    case "loc-stock": V.q = b.dataset.code; V.view = "pallets"; V.f = "all"; V.client = ""; V.page = 0; C.go("stock"); break;
    case "loc-off": case "loc-on": { const ids = [...V.lsel].map(x => isNaN(x) ? x : +x); if (await C.run(() => C.q(C.sb.from("locations").update({active: b.dataset.sa === "loc-on"}).in("id", ids)), "Saved")) { V.lsel.clear(); pageLocations(main); } break; }
    case "export-locs": exportRows(() => locQuery(), l => ({Code: l.code, Zone: l.zone, Type: KIND[l.kind] || l.kind, "Stock is": l.hold ? "On hold" : "Available", "Mixed SKUs": l.mixed_allowed ? "Allowed" : "One SKU only", Active: l.active ? "Yes" : "No", Notes: l.notes}), "Locations", `Stowra_locations_${new Date().toISOString().slice(0, 10)}.xlsx`); break;
  }
});

window.CCStock = {page};
})();
