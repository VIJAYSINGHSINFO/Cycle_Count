/* Cycle Count Console: barcode labels. Upload a CSV/Excel file (or use a count's locations or products),
   choose a label style and paper layout, preview, and print on A4 or A5. */
(() => {
"use strict";
const STYLES = {
  loc:  {name: "Location label", desc: "Large location code with a barcode. For bins and rack beams.", types: ["code128", "code39", "qrcode", "datamatrix"], def: "code128"},
  rack: {name: "Rack levels", desc: "One label per rack, with a barcode for each level (A, B, C…).", types: ["code128", "code39", "qrcode", "datamatrix"], def: "code128"},
  prod: {name: "Product label", desc: "SKU, description and barcode, plus batch or expiry.", types: ["auto", "ean13", "code128", "code39", "qrcode", "datamatrix"], def: "auto"},
  qr:   {name: "QR label", desc: "QR or Data Matrix code with text beside it. Good for small bins.", types: ["qrcode", "datamatrix"], def: "qrcode"}
};
const TYPES = {auto: "Automatic (EAN-13 when valid, else Code 128)", code128: "Code 128", code39: "Code 39", ean13: "EAN-13", qrcode: "QR Code", datamatrix: "Data Matrix"};
const TWO_D = new Set(["qrcode", "datamatrix"]);
const PAPER = {A4: [210, 297], A5: [148, 210]};
const LAYOUTS = {A4: [[1, 1], [1, 2], [2, 2], [2, 4], [2, 6], [3, 7], [3, 8], [4, 10]], A5: [[1, 1], [1, 2], [2, 2], [2, 3], [2, 4], [3, 4]]};
const DEF = {style: "loc", type: "code128", paper: "A4", orient: "portrait", cols: 2, rows: 4, margin: 8, gap: 3, copies: 1, start: 1, border: true, arrow: "none", showText: false, textSize: "M", group: "last_char", reverse: false};

const L = {rows: [], source: "", table: null, map: null, cfg: load()};
let api;
function load() { try { return {...DEF, ...JSON.parse(localStorage.getItem("cc-labels") || "{}")}; } catch { return {...DEF}; } }
function save() { try { localStorage.setItem("cc-labels", JSON.stringify(L.cfg)); } catch {} }
const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------- barcode drawing ---------- */
const cache = new Map();
function ean13ok(t) { if (!/^\d{12,13}$/.test(t)) return false; if (t.length === 12) return true; let s = 0; for (let i = 0; i < 12; i++) s += +t[i] * (i % 2 ? 3 : 1); return (10 - s % 10) % 10 === +t[12]; }
function pickType(type, text) { return type === "auto" ? (ean13ok(text) ? "ean13" : "code128") : type; }
function barcode(type, text) {
  const t = type === "code39" ? String(text).toUpperCase() : String(text), key = type + "|" + t;
  if (cache.has(key)) return cache.get(key);
  let r;
  try {
    if (!window.bwipjs) throw new Error("Barcode library didn't load");
    const svg = bwipjs.toSVG({bcid: type, text: t, scale: 1, ...(TWO_D.has(type) ? {} : {height: 10}), includetext: false, paddingwidth: 0, paddingheight: 0});
    const vb = svg.match(/viewBox="0 0 ([\d.]+) ([\d.]+)"/);
    r = {svg: svg.replace("<svg ", `<svg preserveAspectRatio="${TWO_D.has(type) ? "xMidYMid meet" : "none"}" width="100%" height="100%" shape-rendering="crispEdges" `), modules: vb ? +vb[1] : 0};
  } catch (e) {
    const m = String(e && e.message || e).replace(/^bwipp\.\w+#\d+:\s*/, "");
    r = {err: m};
  }
  cache.set(key, r); return r;
}

/* ---------- label layout (all sizes in mm) ---------- */
function geometry(c) {
  let [W, H] = PAPER[c.paper]; if (c.orient === "landscape") [W, H] = [H, W];
  const lw = (W - 2 * c.margin - (c.cols - 1) * c.gap) / c.cols, lh = (H - 2 * c.margin - (c.rows - 1) * c.gap) / c.rows;
  return {W, H, lw, lh};
}
const TS = {S: .8, M: 1, L: 1.2};
let fontOk = null;
function condFactor() { if (fontOk === null) { try { fontOk = document.fonts && document.fonts.check('700 12px "Barlow Condensed"'); } catch { fontOk = false; } } return fontOk ? .5 : .64; }
if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fontOk = null; if (document.getElementById("lb-preview")) { try { renderStyles(); refresh(); } catch {} } });
let mctx;
function textRatio(text) {   // width of the text at font size 1, measured with the font the label actually uses
  try { mctx = mctx || document.createElement("canvas").getContext("2d"); mctx.font = '700 100px "Barlow Condensed","Arial Narrow",Arial,sans-serif'; return mctx.measureText(String(text)).width / 100; }
  catch { return String(text).length * condFactor(); }
}
function fit(text, w, h) { return Math.max(2, Math.min(h, w * 0.94 / Math.max(textRatio(text), 0.3))); }
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const ARROW = {up: "M12 3l8 9h-5v9H9v-9H4z", down: "M12 21l8-9h-5V3H9v9H4z"};
const arrowSvg = dir => `<svg viewBox="0 0 24 24" class="lb-arrow"><path d="${ARROW[dir]}" fill="#000"/></svg>`;
function codeBox(type, text, w, h, warn) {
  const b = barcode(type, text);
  if (b.err) { warn.push(`${text}: ${b.err}`); return `<div class="lb-err" style="width:${w}mm;height:${h}mm">Can't encode</div>`; }
  if (!TWO_D.has(type) && b.modules && w / b.modules < 0.19) warn.push(`${text}: bars too thin to scan reliably at this label size`);
  const s = TWO_D.has(type) ? Math.min(w, h) : 0;
  return `<div class="lb-code" style="width:${s || w}mm;height:${s || h}mm">${b.svg}</div>`;
}
function labelHTML(item, c, g, warn) {
  const k = TS[c.textSize] || 1, pad = Math.min(3, g.lh * .07, g.lw * .05), W = g.lw - 2 * pad, H = g.lh - 2 * pad;
  const small = t => t ? `<div class="lb-small" style="font-size:${Math.max(1.8, H * .08 * k)}mm">${esc(t)}</div>` : "";
  let inner = "";
  if (c.style === "loc") {
    const aw = c.arrow !== "none" ? Math.min(H * .7, W * .22) : 0, tw = W - (aw ? aw + pad : 0);
    const bh = H * .38, th = H - bh - (item.l2 ? H * .14 : 0) - (c.showText ? H * .1 : 0) - pad;
    inner = `<div class="lb-row">${aw ? `<div style="width:${aw}mm;height:${aw}mm;flex:none">${arrowSvg(c.arrow)}</div>` : ""}
      <div class="lb-col" style="width:${tw}mm"><div class="lb-big" style="font-size:${fit(item.l1, tw, th) * k}mm;height:${th}mm">${esc(item.l1)}</div>
      ${codeBox(pickType(c.type, item.code), item.code, TWO_D.has(c.type) ? bh : tw, bh, warn)}
      ${c.showText ? `<div class="lb-hr" style="font-size:${Math.max(1.8, H * .07)}mm">${esc(item.code)}</div>` : ""}${small(item.l2)}</div></div>`;
  } else if (c.style === "rack") {
    const lv = item.levels, head = H * .12, rowH = (H - head) / lv.length;
    inner = `<div class="lb-head" style="font-size:${Math.min(head * .75, fit("Rack " + item.rack, W, head)) * k}mm;height:${head}mm">Rack ${esc(item.rack)}</div>` + lv.map(r => {
      const lvl = String(r.code).slice(item.rack.length).replace(/^[-\/. _]/, "") || r.l1;
      const aw = c.arrow !== "none" ? Math.min(rowH * .7, W * .12) : 0, lw = Math.min(rowH * .9, W * .18), gapw = pad * (aw ? 3 : 2);
      const cw = W - aw - lw - gapw, ch = rowH * (TWO_D.has(c.type) ? .86 : .62), tx = rowH * .2;
      return `<div class="lb-level" style="height:${rowH}mm">${aw ? `<div style="width:${aw}mm;height:${aw}mm;flex:none">${arrowSvg(c.arrow)}</div>` : ""}
        <div class="lb-big" style="width:${lw}mm;justify-content:center;font-size:${fit(lvl, lw, rowH * .8) * k}mm">${esc(lvl)}</div>
        <div class="lb-col" style="width:${cw}mm;justify-content:center;gap:.6mm">${codeBox(c.type, r.code, TWO_D.has(c.type) ? ch : cw, ch, warn)}${TWO_D.has(c.type) ? "" : `<div class="lb-hr" style="font-size:${Math.min(tx, fit(r.code, cw, tx))}mm">${esc(r.code)}</div>`}</div></div>`;
    }).join("");
  } else if (c.style === "prod") {
    const t = pickType(c.type, item.code), hdr = H * .19, hasHr = c.showText || t === "ean13";
    const bh = H * (1 - .19 - (item.l2 ? .22 : 0) - (hasHr ? .1 : 0) - (item.l3 ? .11 : 0) - .04);
    inner = `<div class="lb-big" style="font-size:${fit(item.l1, W, hdr) * k}mm;height:${hdr}mm">${esc(item.l1)}</div>
      ${item.l2 ? `<div class="lb-desc" style="font-size:${Math.max(1.8, H * .085 * k)}mm">${esc(item.l2)}</div>` : ""}
      <div class="lb-grow"></div>${codeBox(t, item.code, TWO_D.has(t) ? bh : W, bh, warn)}
      ${hasHr ? `<div class="lb-hr" style="font-size:${Math.max(1.8, Math.min(H * .075, fit(item.code, W, H * .08)))}mm;margin-top:.6mm">${esc(item.code)}</div>` : ""}${small(item.l3)}`;
  } else {
    const s = Math.min(H, W * .45), tw = W - s - pad * 1.5;
    inner = `<div class="lb-row">${codeBox(c.type, item.code, s, s, warn)}<div class="lb-col" style="width:${tw}mm;justify-content:center">
      <div class="lb-big" style="font-size:${fit(item.l1, tw, H * .38) * k}mm">${esc(item.l1)}</div>
      ${item.l2 ? `<div class="lb-desc" style="font-size:${Math.max(1.8, H * .11 * k)}mm">${esc(item.l2)}</div>` : ""}${small(item.l3)}
      ${c.showText && item.code !== item.l1 ? `<div class="lb-hr" style="font-size:${Math.max(1.8, H * .08)}mm;text-align:left">${esc(item.code)}</div>` : ""}</div></div>`;
  }
  return `<div class="lb-label ${c.border ? "cut" : ""}" style="padding:${pad}mm">${inner}</div>`;
}
function rackKey(code, mode) { const k = String(code).toUpperCase(); if (mode === "last_char") return k.length > 3 && /[A-Z]$/.test(k) ? k.slice(0, -1) : k; const m = k.match(/^(.*)[-\/. _]([^-\/. _]+)$/); return m ? m[1] : k; }
function items(c) {
  if (c.style !== "rack") return L.rows;
  const g = new Map();
  L.rows.forEach(r => { const k = rackKey(r.code, c.group); if (!g.has(k)) g.set(k, {rack: String(r.code).slice(0, k.length), levels: [], copies: r.copies}); g.get(k).levels.push(r); });
  return [...g.values()].map(x => ({...x, levels: c.reverse ? x.levels.slice().reverse() : x.levels}));
}
function sheets(c, limitPages) {
  const g = geometry(c), per = c.cols * c.rows, warn = [], list = [];
  for (let i = 1; i < Math.min(c.start, per); i++) list.push(null);
  for (const it of items(c)) for (let n = 0; n < Math.max(1, Math.min(99, (it.copies || 1) * c.copies)); n++) list.push(it);
  const pages = [];
  for (let i = 0; i < list.length; i += per) pages.push(list.slice(i, i + per));
  const shown = limitPages ? pages.slice(0, limitPages) : pages;
  const html = shown.map(p => `<div class="lb-sheet" style="width:${g.W}mm;height:${g.H}mm;padding:${c.margin}mm;gap:${c.gap}mm;grid-template-columns:repeat(${c.cols},${g.lw}mm);grid-template-rows:repeat(${c.rows},${g.lh}mm)">
    ${p.map(it => it ? labelHTML(it, c, g, warn) : `<div class="lb-label blank"></div>`).join("")}</div>`).join("");
  return {html, pages: pages.length, labels: list.filter(Boolean).length, g, warn: [...new Set(warn)]};
}

/* ---------- data sources ---------- */
const DESC_BC = /^\s*(\d{8,14})\s*[-–|:]\s*(.+)$/;
function guess(h, style) {
  const f = re => h.findIndex(x => re.test(String(x).toLowerCase()));
  const bc = f(/barcode|^ean|^upc|gtin/), loc = f(/^loc$|^location|^bin/), sku = f(/^sku$|^item( code)?$|^sku/), desc = f(/^desc|description/), batch = f(/^batch/), exp = f(/^exp|expiry/), copies = f(/^cop(y|ies)$|labels? to print/), label = f(/^label|^text|^line ?1/);
  if (style === "prod") {
    let code = bc >= 0 ? bc : -1;
    if (code < 0 && desc >= 0 && L.table && L.table.slice(1, 200).filter(r => DESC_BC.test(r[desc] || "")).length > 0) code = desc;
    if (code < 0) code = sku >= 0 ? sku : 0;
    return {code, l1: sku >= 0 ? sku : -1, l2: desc, l3: batch >= 0 ? batch : exp, copies};
  }
  const code = [loc, bc, sku].find(i => i >= 0) ?? 0;
  return {code, l1: label, l2: -1, l3: -1, copies};
}
async function readFile(file) {
  let table;
  if (/\.xlsx?$/i.test(file.name)) { const wb = XLSX.read(await file.arrayBuffer(), {type: "array"}); table = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {header: 1, raw: false, defval: ""}); }
  else table = api.parseDelimited(await file.text());
  table = table.map(r => r.map(v => String(v).trim())).filter(r => r.some(Boolean));
  if (!table.length) throw new Error("The file has no rows.");
  L.table = table; L.map = guess(table[0], L.cfg.style); L.mapTouched = false; L.source = file.name; applyMap();
}
function applyMap() {
  const m = L.map, rows = L.table.slice(1), v = (r, i) => i >= 0 ? String(r[i] || "").trim() : "";
  const seen = new Set();
  L.dupes = 0;
  const textCode = rows.slice(0, 300).some(r => DESC_BC.test(v(r, m.code)));   // e.g. DESCR holds "barcode-description"
  L.rows = rows.map(r => {
    let code = v(r, m.code), l2 = v(r, m.l2);
    const mm = code.match(DESC_BC); if (mm) { code = mm[1]; if (m.l2 === m.code) l2 = mm[2].trim(); }
    else if (textCode && m.l1 >= 0 && v(r, m.l1)) code = v(r, m.l1);   // no barcode in the text: fall back to the SKU
    if (m.l2 !== m.code) { const m2 = l2.match(DESC_BC); if (m2) l2 = m2[2].trim(); }
    if (!code) return null;
    if (L.cfg.dedupe !== false) { const k = code.toUpperCase(); if (seen.has(k)) { L.dupes++; return null; } seen.add(k); }
    return {code, l1: v(r, m.l1) || code, l2, l3: v(r, m.l3), copies: Math.max(1, parseInt(v(r, m.copies)) || 1)};
  }).filter(Boolean);
}
async function fromCount(id, what) {
  const rows = []; let from = 0;
  for (;;) { const d = await api.q(api.sb.from("count_lines_v").select("location,sku,barcode,description,batch,expiry_date,session_name,is_found").eq("session_id", id).order("seq").order("id").range(from, from + 999)); rows.push(...d); if (d.length < 1000) break; from += 1000; }
  const seen = new Set();
  if (what === "loc") L.rows = rows.filter(r => !seen.has(r.location.toUpperCase()) && seen.add(r.location.toUpperCase())).map(r => ({code: r.location, l1: r.location, l2: "", l3: "", copies: 1}));
  else L.rows = rows.filter(r => { const k = (r.barcode || r.sku).toUpperCase(); return !seen.has(k) && seen.add(k); }).map(r => ({code: r.barcode || r.sku, l1: r.sku, l2: r.description, l3: r.batch ? `Batch ${r.batch}${r.expiry_date ? ", exp " + r.expiry_date : ""}` : "", copies: 1}));
  L.source = `${rows[0] ? rows[0].session_name : "Count"}: ${what === "loc" ? "locations" : "products"}`; L.table = null;
}

/* ---------- page ---------- */
async function page(main, helpers) {
  api = helpers;
  let counts = [];
  try { counts = await api.q(api.sb.from("session_list").select("id,name,status,lines_total").gt("lines_total", 0).order("created_at", {ascending: false}).limit(50)); } catch {}
  main.innerHTML = `<div class="pagehead"><div><h1>Barcode labels</h1><p class="muted small" style="margin:4px 0 0">Print location, rack, product or QR labels on A4 or A5 paper, or on label sheets.</p></div></div>
    <div class="lb-grid">
      <section class="panel"><h2 style="margin-bottom:10px">1. Data</h2>
        <div class="chips" style="margin-bottom:12px">${[["file", "Upload file"], ["count", "From a count"], ["type", "Type codes"]].map(([k, l]) => `<button class="chip" data-src="${k}" aria-pressed="${(L.srcTab || "file") === k}">${l}</button>`).join("")}</div>
        <div id="lb-src"></div><div id="lb-map"></div><p class="small" id="lb-sum" style="margin:10px 0 0"></p></section>
      <section class="panel"><h2 style="margin-bottom:10px">2. Label style</h2><div class="lb-styles" id="lb-styles"></div></section>
      <section class="panel"><h2 style="margin-bottom:10px">3. Paper and options</h2><div id="lb-opts"></div></section>
    </div>
    <div class="toolbar" style="margin-top:18px"><h2 id="lb-count">Preview</h2><div class="row"><span class="small muted" id="lb-size"></span><button class="btn go" id="lb-print">Print labels</button></div></div>
    <div id="lb-warn"></div><div class="lb-preview" id="lb-preview"></div>`;
  renderSrc(counts); renderStyles(); renderOpts(); refresh();
  main.addEventListener("click", e => {
    const s = e.target.closest("[data-src]"); if (s) { L.srcTab = s.dataset.src; $$("[data-src]").forEach(b => b.setAttribute("aria-pressed", b === s)); renderSrc(counts); }
    const st = e.target.closest("[data-style]"); if (st) { L.cfg.style = st.dataset.style; L.cfg.type = STYLES[L.cfg.style].def; if (L.table && !L.mapTouched) { L.map = guess(L.table[0], L.cfg.style); applyMap(); renderMap(); } save(); renderStyles(); renderOpts(); refresh(); }
  });
  $("#lb-print").onclick = printAll;
}
function renderSrc(counts) {
  const box = $("#lb-src"), tab = L.srcTab || "file"; $("#lb-map").innerHTML = "";
  if (tab === "file") {
    box.innerHTML = `<label class="drop" id="lb-drop"><input type="file" id="lb-file" accept=".csv,.txt,.tsv,.xlsx,.xls"><strong>Choose a CSV or Excel file</strong><br><span class="small muted">One row per label. A column with the barcode value is required; others add text.</span></label>`;
    const f = $("#lb-file"), d = $("#lb-drop");
    const go = async file => { try { await readFile(file); renderMap(); refresh(); } catch (e) { api.toast(e.message || "Couldn't read the file.", true); } };
    f.onchange = () => f.files[0] && go(f.files[0]);
    d.ondragover = e => { e.preventDefault(); d.classList.add("over"); }; d.ondragleave = () => d.classList.remove("over");
    d.ondrop = e => { e.preventDefault(); d.classList.remove("over"); e.dataTransfer.files[0] && go(e.dataTransfer.files[0]); };
    if (L.table) renderMap();
  } else if (tab === "count") {
    box.innerHTML = counts.length ? `<div class="grid-form"><label class="field">Count<select id="lb-cnt">${counts.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join("")}</select></label>
      <label class="field">Labels for<select id="lb-what"><option value="loc">Locations</option><option value="prod">Products</option></select></label></div>
      <button class="btn" id="lb-load" style="margin-top:10px">Load</button>` : `<p class="muted">No counts with lines yet.</p>`;
    const b = $("#lb-load"); if (b) b.onclick = async () => { b.disabled = true; try { const what = $("#lb-what").value; await fromCount($("#lb-cnt").value, what); if (what === "prod" && L.cfg.style !== "prod") { L.cfg.style = "prod"; L.cfg.type = "auto"; } if (what === "loc" && L.cfg.style === "prod") { L.cfg.style = "loc"; L.cfg.type = "code128"; } save(); renderStyles(); renderOpts(); refresh(); } catch (e) { api.toast(e.message || "Couldn't load the count.", true); } b.disabled = false; };
  } else {
    box.innerHTML = `<label class="field">One label per line. Add text after a tab or comma: <code>code, line 1, line 2</code><textarea id="lb-text" rows="8" placeholder="W2C2M0103A&#10;W2C2M0103B&#10;W2C2M0103C"></textarea></label>`;
    let t; $("#lb-text").oninput = e => { clearTimeout(t); t = setTimeout(() => { const rows = api.parseDelimited(e.target.value); L.rows = rows.filter(r => r[0]).map(r => ({code: r[0], l1: r[1] || r[0], l2: r[2] || "", l3: r[3] || "", copies: 1})); L.source = "typed codes"; L.table = null; refresh(); }, 300); };
  }
}
function renderMap() {
  if (!L.table) return;
  const h = L.table[0], opt = sel => `<option value="-1">(none)</option>` + h.map((x, i) => `<option value="${i}" ${sel === i ? "selected" : ""}>${esc(x || "Column " + (i + 1))}</option>`).join("");
  $("#lb-map").innerHTML = `<div class="map" style="margin-top:12px">${[["code", "Barcode value *"], ["l1", "Large text (blank = same as barcode)"], ["l2", "Line 2"], ["l3", "Line 3"], ["copies", "Copies"]].map(([k, l]) => `<label class="field">${l}<select data-lmap="${k}">${opt(L.map[k])}</select></label>`).join("")}</div>
    <label class="check small" style="margin-top:10px"><input type="checkbox" id="lb-dedupe" ${L.cfg.dedupe !== false ? "checked" : ""}> One label per barcode value (skip repeated rows)</label>
    <p class="hint">A barcode at the start of a text, like <code>9345156233829-Hair brush</code>, is split out automatically.</p>`;
  $("#lb-dedupe").onchange = e => { L.cfg.dedupe = e.target.checked; save(); applyMap(); refresh(); };
  $$("[data-lmap]").forEach(s => s.onchange = () => { L.map[s.dataset.lmap] = +s.value; L.mapTouched = true; applyMap(); refresh(); });
}
function sampleItem(style) {
  if (style === "rack") return {rack: "W2C2M0103", levels: ["C", "B", "A"].map(x => ({code: "W2C2M0103" + x, l1: "W2C2M0103" + x}))};
  if (style === "prod") return {code: "9345156233829", l1: "7000294", l2: "Hair brush, vent", l3: "Batch 52021052"};
  return {code: "W2C2M0103B", l1: "W2C2M0103B", l2: "", l3: ""};
}
function renderStyles() {
  const box = $("#lb-styles");
  box.innerHTML = Object.entries(STYLES).map(([k, s]) => {
    const c = {...L.cfg, style: k, type: STYLES[k].types.includes(L.cfg.type) ? L.cfg.type : s.def, arrow: k === "loc" ? "up" : "none", border: false};
    const g = {lw: 70, lh: k === "rack" ? 44 : 32};
    return `<button class="lb-style" data-style="${k}" aria-pressed="${L.cfg.style === k}"><div class="lb-thumb"><div class="lb-thumb-in" style="width:${g.lw}mm;height:${g.lh}mm">${labelHTML(sampleItem(k), c, g, [])}</div></div><strong>${s.name}</strong><span>${s.desc}</span></button>`;
  }).join("");
  $$(".lb-thumb-in", box).forEach(el => { const p = el.parentElement; el.style.zoom = Math.min(p.clientWidth / el.offsetWidth, 110 / el.offsetHeight); });
}
function renderOpts() {
  const c = L.cfg, lay = LAYOUTS[c.paper], isPreset = lay.some(([a, b]) => a === c.cols && b === c.rows);
  $("#lb-opts").innerHTML = `<div class="grid-form">
    <label class="field">Paper<select data-o="paper"><option ${c.paper === "A4" ? "selected" : ""}>A4</option><option ${c.paper === "A5" ? "selected" : ""}>A5</option></select></label>
    <label class="field">Orientation<select data-o="orient"><option value="portrait" ${c.orient === "portrait" ? "selected" : ""}>Portrait</option><option value="landscape" ${c.orient === "landscape" ? "selected" : ""}>Landscape</option></select></label>
    <label class="field">Labels per sheet<select data-o="layout">${lay.map(([a, b]) => `<option value="${a}x${b}" ${a === c.cols && b === c.rows ? "selected" : ""}>${a * b} (${a} × ${b})</option>`).join("")}<option value="custom" ${isPreset ? "" : "selected"}>Custom…</option></select></label>
    ${isPreset ? "" : `<label class="field">Columns<input type="number" min="1" max="8" data-o="cols" value="${c.cols}"></label><label class="field">Rows<input type="number" min="1" max="20" data-o="rows" value="${c.rows}"></label>`}
    <label class="field">Page margin (mm)<input type="number" min="0" max="30" step="0.5" data-o="margin" value="${c.margin}"></label>
    <label class="field">Gap between labels (mm)<input type="number" min="0" max="20" step="0.5" data-o="gap" value="${c.gap}"></label>
    <label class="field">Barcode type<select data-o="type">${STYLES[c.style].types.map(t => `<option value="${t}" ${c.type === t ? "selected" : ""}>${TYPES[t]}</option>`).join("")}</select></label>
    ${c.style === "loc" || c.style === "rack" ? `<label class="field">Arrow<select data-o="arrow">${[["none", "No arrow"], ["up", "Pointing up"], ["down", "Pointing down"]].map(([k, l]) => `<option value="${k}" ${c.arrow === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>` : ""}
    ${c.style === "rack" ? `<label class="field">Levels are<select data-o="group"><option value="last_char" ${c.group === "last_char" ? "selected" : ""}>The last letter (W2C2M0103A)</option><option value="last_segment" ${c.group === "last_segment" ? "selected" : ""}>The last part (A01-01-A)</option></select></label>` : ""}
    <label class="field">Text size<select data-o="textSize">${[["S", "Small"], ["M", "Medium"], ["L", "Large"]].map(([k, l]) => `<option value="${k}" ${c.textSize === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="field">Copies of each label<input type="number" min="1" max="99" data-o="copies" value="${c.copies}"></label>
    <label class="field">Start at label position<input type="number" min="1" max="200" data-o="start" value="${c.start}"></label>
  </div>
  <div class="row" style="margin-top:12px;gap:18px">
    <label class="check"><input type="checkbox" data-o="border" ${c.border ? "checked" : ""}> Cut lines</label>
    <label class="check"><input type="checkbox" data-o="showText" ${c.showText ? "checked" : ""}> Code under barcode</label>
    ${c.style === "rack" ? `<label class="check"><input type="checkbox" data-o="reverse" ${c.reverse ? "checked" : ""}> Reverse level order</label>` : ""}
  </div>
  <p class="hint" style="margin-top:10px">Use <strong>Start at label position</strong> to reuse a partly used label sheet. Print at <strong>100% / Actual size</strong> with margins set to <strong>None</strong>.</p>`;
  $$("[data-o]").forEach(el => el.onchange = () => {
    const k = el.dataset.o, v = el.type === "checkbox" ? el.checked : el.value;
    if (k === "layout") { if (v !== "custom") { const [a, b] = v.split("x").map(Number); c.cols = a; c.rows = b; } else { c.cols = Math.max(1, c.cols); } }
    else if (k === "paper") { c.paper = v; if (!LAYOUTS[v].some(([a, b]) => a === c.cols && b === c.rows)) [c.cols, c.rows] = LAYOUTS[v][3]; }
    else if (["cols", "rows", "copies", "start"].includes(k)) c[k] = Math.max(1, parseInt(v) || 1);
    else if (["margin", "gap"].includes(k)) c[k] = Math.max(0, parseFloat(v) || 0);
    else c[k] = v;
    save(); if (["paper", "layout", "cols", "rows"].includes(k)) renderOpts(); refresh();
  });
}
function refresh() {
  const c = L.cfg, g = geometry(c);
  $("#lb-size").textContent = g.lw > 5 && g.lh > 5 ? `Each label ${g.lw.toFixed(1)} × ${g.lh.toFixed(1)} mm` : "Labels too small: reduce margins or labels per sheet";
  const n = L.rows.length;
  $("#lb-sum").innerHTML = n ? `<strong>${n.toLocaleString()}</strong> label${n === 1 ? "" : "s"} from ${esc(L.source)}${L.dupes ? ` (${L.dupes.toLocaleString()} repeated rows skipped)` : ""}` : `<span class="muted">No data yet: showing sample labels.</span>`;
  const keep = L.rows; if (!n) L.rows = sampleRows(c.style);
  const r = g.lw > 5 && g.lh > 5 ? sheets(c, 2) : {html: "", pages: 0, labels: 0, warn: []};
  if (!n) L.rows = keep;
  $("#lb-count").textContent = n ? `Preview: ${r.labels.toLocaleString()} label${r.labels === 1 ? "" : "s"} on ${r.pages} sheet${r.pages === 1 ? "" : "s"}${r.pages > 2 ? " (first 2 shown)" : ""}` : "Preview (sample data)";
  $("#lb-print").disabled = !n || !r.pages;
  $("#lb-warn").innerHTML = r.warn.length ? `<div class="banner warn" style="flex-direction:column;align-items:flex-start"><strong>${r.warn.length} problem${r.warn.length === 1 ? "" : "s"}</strong><span class="small">${r.warn.slice(0, 5).map(esc).join("<br>")}${r.warn.length > 5 ? `<br>and ${r.warn.length - 5} more` : ""}</span></div>` : "";
  const pv = $("#lb-preview"); pv.innerHTML = r.html;
  requestAnimationFrame(() => { const w = pv.clientWidth; $$(".lb-sheet", pv).forEach(s => { const k = Math.min(1, (w / (c.cols > 2 || c.orient === "landscape" ? 1 : 2) - 16) / s.offsetWidth); s.style.zoom = k; }); });
}
function sampleRows(style) {
  if (style === "prod") return [{code: "9345156233829", l1: "7000294", l2: "My Beauty hair brush, vent", l3: "Batch 52021052"}, {code: "7000333", l1: "7000333", l2: "Hair and scalp massage brush", l3: ""}];
  return ["A", "B", "C"].flatMap(b => ["01", "02"].map(x => `W2C2M01${x}${b}`)).sort().map(x => ({code: x, l1: x, l2: "", l3: ""}));
}
function printAll() {
  const c = L.cfg, r = sheets(c);
  if (r.warn.length && !confirm(`${r.warn.length} label${r.warn.length === 1 ? "" : "s"} have problems (see the list above). Print anyway?`)) return;
  let box = $("#lb-print-area"); if (!box) { box = document.createElement("div"); box.id = "lb-print-area"; document.body.appendChild(box); }
  box.innerHTML = r.html;
  let st = $("#lb-page-style"); if (!st) { st = document.createElement("style"); st.id = "lb-page-style"; document.head.appendChild(st); }
  st.textContent = `@page { size: ${c.paper} ${c.orient}; margin: 0; }`;
  document.body.classList.add("lb-printing");
  const done = () => { document.body.classList.remove("lb-printing"); box.innerHTML = ""; window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  setTimeout(() => { window.print(); setTimeout(() => { if (document.body.classList.contains("lb-printing") && !matchMedia("print").matches) done(); }, 1500); }, 150);
}
window.CCLabels = {page, _test: {barcode, sheets, L, ean13ok, rackKey}};
})();
