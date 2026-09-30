/* Cycle Count Console: barcode labels. Upload a CSV/Excel file (or use a count's locations or products),
   choose a label style and paper layout, preview, and print on A4 or A5. */
(() => {
"use strict";
const STYLES = {
  loc:  {name: "Location label", desc: "Large location code with a barcode. For bins and rack beams.", types: ["code128", "code39", "qrcode", "datamatrix"], def: "code128"},
  rack: {name: "Rack levels", desc: "One label per rack, with a barcode for each level (A, B, C…).", types: ["code128", "code39", "qrcode", "datamatrix"], def: "code128"},
  prod: {name: "Product label", desc: "SKU, description and barcode, plus batch or expiry.", types: ["auto", "ean13", "code128", "code39", "qrcode", "datamatrix"], def: "auto"},
  qr:   {name: "QR label", desc: "QR or Data Matrix code with text beside it. Good for small bins.", types: ["qrcode", "datamatrix"], def: "qrcode"},
  beam: {name: "Beam label", desc: "QR code, aisle over bay-level-bin, and an arrow. For rack beams.", types: ["qrcode", "datamatrix"], def: "qrcode", parts: true, layout: ["A4", 2, 10]},
  upright: {name: "Upright label", desc: "Aisle, bay-level, bin and QR in a grid, with a bay header per rack. For rack uprights.", types: ["qrcode", "datamatrix"], def: "qrcode", parts: true, layout: ["A4", 3, 8]},
  detail: {name: "Detailed location label", desc: "Aisle, bay, level and bin in large outlined text, with a barcode, QR code and arrow.", types: ["code128", "code39"], def: "code128", parts: true, layout: ["A4", 2, 8]}
};
const PARTS = [["zone", "Zone"], ["aisle", "Aisle"], ["bay", "Bay"], ["level", "Level"], ["bin", "Bin"], ["arrow", "Arrow (up/down)"]];
const TYPES = {auto: "Automatic (EAN-13 when valid, else Code 128)", code128: "Code 128", code39: "Code 39", ean13: "EAN-13", qrcode: "QR Code", datamatrix: "Data Matrix"};
const TWO_D = new Set(["qrcode", "datamatrix"]);
const PAPER = {A4: [210, 297], A5: [148, 210]};
const LAYOUTS = {A4: [[1, 1], [1, 2], [2, 2], [2, 4], [2, 6], [3, 7], [3, 8], [4, 10]], A5: [[1, 1], [1, 2], [2, 2], [2, 3], [2, 4], [3, 4]]};
const DEF = {style: "loc", type: "code128", paper: "A4", orient: "portrait", cols: 2, rows: 4, margin: 8, gap: 3, copies: 1, start: 1, border: true, arrow: "none", showText: false, textSize: "M", group: "last_char", reverse: false, mask: "", header: true};

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
function textRatio(text, face) {   // width of the text at font size 1, measured with the font the label actually uses
  try { mctx = mctx || document.createElement("canvas").getContext("2d"); mctx.font = "700 100px " + (face || '"Barlow Condensed","Arial Narrow",Arial,sans-serif'); return mctx.measureText(String(text)).width / 100; }
  catch { return String(text).length * condFactor(); }
}
function fit(text, w, h, face) { return Math.max(2, Math.min(h, w * 0.94 / Math.max(textRatio(text, face), 0.3))); }
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
function splitParts(code, mask) {
  if (!mask) return null;
  const K = {Z: "zone", A: "aisle", B: "bay", L: "level", P: "bin"}, out = {zone: "", aisle: "", bay: "", level: "", bin: ""}, t = String(code);
  if (t.length !== mask.length) return null;
  for (let i = 0; i < mask.length; i++) { const k = K[mask[i].toUpperCase()]; if (k) out[k] += t[i]; }
  return out;
}
function suggestMask(codes) {
  const s = codes.slice(0, 200);
  if (s.length && s.every(x => /^[A-Z0-9]{4}[A-Z]\d{4}[A-Z]$/i.test(x))) return "ZZZZABBLLP";                // W2C2M0103B
  if (s.length && s.every(x => /^[A-Z]\d?-?\d{2}-\d{2}-[A-Z]$/i.test(x))) { const x = s[0]; return x.replace(/^([A-Z]\d?)(-?)(\d{2})-(\d{2})-([A-Z])$/i, (m, a, d, b, l, p) => "A".repeat(a.length) + d + "BB-LL-P"); }
  if (s.length && s.every(x => /^[A-Z]{1,2}\d{2,3}-[A-Z]$/i.test(x) && x.length === s[0].length)) { const m = s[0].match(/^([A-Z]{1,2})(\d{2,3})-([A-Z])$/i); return "A".repeat(m[1].length) + "B".repeat(m[2].length) + "-L"; }
  return "";
}
function parts(item, c) {   // part columns from the file win; the pattern fills in whatever they leave empty
  const m = splitParts(item.code, c.mask) || {};
  const p = {}; ["zone", "aisle", "bay", "level", "bin"].forEach(k => p[k] = item[k] || m[k] || "");
  p.ok = !!(p.aisle || p.bay || p.level || p.bin);
  return p;
}
function arrowOf(item, c) { const a = String(item.arrow || "").trim().toLowerCase(); if (/^(u|up|↑|top|above)$/.test(a)) return "up"; if (/^(d|down|↓|bottom|below)$/.test(a)) return "down"; if (/^(n|no|none|-)$/.test(a)) return "none"; return c.arrow; }
const join = (...a) => a.filter(Boolean).join("-");
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
  } else if (c.style === "beam") {
    const P = parts(item, c); if (!P.ok) warn.push(`${item.code}: location parts not found (set the pattern or part columns)`);
    const top = P.ok ? join(P.zone && !P.aisle ? P.zone : "", P.aisle) || item.l1 : "", bottom = P.ok ? join(P.bay, P.level, P.bin) || item.code : item.l1;
    const ar = arrowOf(item, c), s2 = H, aw = ar !== "none" ? H * .75 : 0, tw = W - s2 - aw - pad * 2, lh = top ? H * .46 : H * .8;
    inner = `<div class="lb-row" style="gap:${pad}mm">${codeBox(c.type, item.code, s2, s2, warn)}
      <div class="lb-col" style="width:${tw}mm;justify-content:center;align-items:center;gap:${H * .04}mm">
        ${top ? `<div class="lb-big" style="font-size:${fit(top, tw, lh) * k}mm">${esc(top)}</div>` : ""}<div class="lb-big" style="font-size:${fit(bottom, tw, lh) * k}mm">${esc(bottom)}</div></div>
      ${aw ? `<div style="width:${aw}mm;height:${H * .85}mm;flex:none">${arrowSvg(ar)}</div>` : ""}</div>`;
  } else if (c.style === "upright") {
    if (item.header) {
      const ar = arrowOf(item, c), aw = ar !== "none" ? Math.min(H * .9, W * .35) : 0, tw = W - aw - pad;
      inner = `<div class="lb-row" style="justify-content:center;gap:${pad}mm"><div class="lb-big" style="font-size:${fit(item.text, tw, H * .85) * k}mm;justify-content:center">${esc(item.text)}</div>${aw ? `<div style="width:${aw}mm;height:${H * .9}mm;flex:none">${arrowSvg(ar)}</div>` : ""}</div>`;
    } else {
      const P = parts(item, c); if (!P.ok) warn.push(`${item.code}: location parts not found (set the pattern or part columns)`);
      const ar = arrowOf(item, c), lw = W * .3, rw = W - lw, th = H * .4, bh = H - th;
      const tl = P.ok ? P.aisle || P.zone : "", tr = P.ok ? join(P.bay, P.level) : item.l1, bl = P.ok ? P.bin : "";
      const qs = bh * .86, aw = ar !== "none" ? Math.min(bh * .8, rw - qs - pad * 2) : 0;
      inner = `<div class="lb-upr" style="grid-template-columns:30fr 70fr;grid-template-rows:40fr 60fr">
        <div class="lb-cell"><div class="lb-big" style="font-size:${fit(tl, lw * .9, th * .8) * k}mm">${esc(tl)}</div></div>
        <div class="lb-cell l"><div class="lb-big" style="font-size:${fit(tr, rw * .9, th * .8) * k}mm">${esc(tr)}</div></div>
        <div class="lb-cell t"><div class="lb-big" style="font-size:${fit(bl, lw * .9, bh * .7) * k}mm">${esc(bl)}</div></div>
        <div class="lb-cell t l" style="gap:${pad}mm">${codeBox(c.type, item.code, qs, qs, warn)}${aw ? `<div style="width:${aw}mm;height:${aw}mm;flex:none">${arrowSvg(ar)}</div>` : ""}</div></div>`;
    }
  } else if (c.style === "detail") {
    const P = parts(item, c); if (!P.ok) warn.push(`${item.code}: location parts not found (set the pattern or part columns)`);
    const ar = arrowOf(item, c), c1 = W * .22, c2 = W * .56, c3 = W - c1 - c2, hh = H * .1, r1 = H * .43, r2 = H - 2 * hh - r1;
    const cap = t => `<div class="lb-cap" style="font-size:${hh * .72}mm">${t}</div>`, hol = (t, w, h) => { const fs = fit(t, w, h / 1.05, 'Arial,"Helvetica Neue",sans-serif') * Math.min(k, 1); return `<div class="lb-big lb-hollow" style="font-size:${fs}mm;-webkit-text-stroke-width:${Math.max(.25, fs * .03)}mm">${esc(t)}</div>`; };
    const mid = P.ok ? join(P.level, P.bin) : item.l1, bwid = c2 * .86, bht = r2 * .62;
    inner = `<div class="lb-det" style="grid-template-columns:22fr 28fr 28fr 22fr;grid-template-rows:10fr 43fr 37fr 10fr">
      <div class="lb-cell b">${cap("AISLE")}</div><div class="lb-cell b l">${cap("LEVEL")}</div><div class="lb-cell b l">${cap("BIN")}</div><div class="lb-cell b l">${cap(ar === "none" ? "" : ar.toUpperCase())}</div>
      <div class="lb-cell">${hol(P.ok ? P.aisle || P.zone : "", c1 * .9, r1 * .92)}</div>
      <div class="lb-cell l" style="grid-column:span 2">${hol(mid, c2 * .92, r1 * .92)}</div>
      <div class="lb-cell l">${ar !== "none" ? `<div style="width:${Math.min(c3, r1) * .8}mm;height:${r1 * .85}mm">${arrowSvg(ar)}</div>` : ""}</div>
      <div class="lb-cell t">${hol(P.ok ? P.bay : "", c1 * .9, r2 * .92)}</div>
      <div class="lb-cell t l" style="grid-column:span 2;flex-direction:column;gap:.6mm">${codeBox(c.type, item.code, bwid, bht, warn)}<div class="lb-hr" style="font-size:${Math.min(r2 * .17, fit(item.code, bwid, r2 * .2))}mm;font-weight:700">${esc(item.code)}</div></div>
      <div class="lb-cell t l">${codeBox("qrcode", item.code, Math.min(c3, r2) * .86, Math.min(c3, r2) * .86, warn)}</div>
      <div class="lb-cell t">${cap("BAY")}</div><div class="lb-cell t l" style="grid-column:span 2">${cap("LOCATION")}</div><div class="lb-cell t l">${cap("LOCATION")}</div></div>`;
    return `<div class="lb-label ${c.border ? "cut" : ""}" style="padding:${pad * .6}mm"><div class="lb-frame">${inner}</div></div>`;
  } else {
    const s = Math.min(H, W * .45), tw = W - s - pad * 1.5;
    inner = `<div class="lb-row">${codeBox(c.type, item.code, s, s, warn)}<div class="lb-col" style="width:${tw}mm;justify-content:center">
      <div class="lb-big" style="font-size:${fit(item.l1, tw, H * .38) * k}mm">${esc(item.l1)}</div>
      ${item.l2 ? `<div class="lb-desc" style="font-size:${Math.max(1.8, H * .11 * k)}mm">${esc(item.l2)}</div>` : ""}${small(item.l3)}
      ${c.showText && item.code !== item.l1 ? `<div class="lb-hr" style="font-size:${Math.max(1.8, H * .08)}mm;text-align:left">${esc(item.code)}</div>` : ""}</div></div>`;
  }
  return `<div class="lb-label ${c.border ? "cut" : ""}" style="padding:${pad}mm">${inner}</div>`;
}
function groupRev(rows, c) {   // keep racks in order, reverse the levels inside each rack (top level first)
  const g = new Map(); rows.forEach(r => { const P = parts(r, c), k = P.ok ? [P.zone, P.aisle, P.bay].join("|") : rackKey(r.code, c.group); if (!g.has(k)) g.set(k, []); g.get(k).push(r); });
  return [].concat(...[...g.values()].map(a => a.slice().reverse()));
}
function rackKey(code, mode) { const k = String(code).toUpperCase(); if (mode === "last_char") return k.length > 3 && /[A-Z]$/.test(k) ? k.slice(0, -1) : k; const m = k.match(/^(.*)[-\/. _]([^-\/. _]+)$/); return m ? m[1] : k; }
function items(c) {
  if (c.style === "upright" && c.header) {
    const out = []; let last = null;
    const ordered = c.reverse ? groupRev(L.rows, c) : L.rows;
    for (const r of ordered) { const P = parts(r, c), key = P.ok ? [P.zone, P.aisle, P.bay].join("|") : rackKey(r.code, c.group); if (key !== last) { out.push({header: true, text: P.ok ? P.bay || P.aisle : rackKey(r.code, c.group), arrow: r.arrow, copies: 1}); last = key; } out.push(r); }
    return out;
  }
  if (c.style === "upright" && c.reverse) return groupRev(L.rows, c);
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
  const pz = {zone: f(/^zone$|^area$|^warehouse$/), aisle: f(/^aisle$|^row$/), bay: f(/^bay$|^column$|^col$/), level: f(/^level$|^lvl$|^shelf$/), bin: f(/^bin$|^position$|^pos$|^slot$/), arrow: f(/^arrow$|direction/)};
  return {code, l1: label, l2: -1, l3: -1, copies, ...pz};
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
    return {code, l1: v(r, m.l1) || code, l2, l3: v(r, m.l3), copies: Math.max(1, parseInt(v(r, m.copies)) || 1),
      zone: v(r, m.zone ?? -1), aisle: v(r, m.aisle ?? -1), bay: v(r, m.bay ?? -1), level: v(r, m.level ?? -1), bin: v(r, m.bin ?? -1), arrow: v(r, m.arrow ?? -1)};
  }).filter(Boolean);
  if (!L.cfg.maskTouched) { const sm = suggestMask(L.rows.map(r => r.code)); if (sm) L.cfg.mask = sm; }
}
async function fromCount(id, what) {
  const rows = []; let from = 0;
  for (;;) { const d = await api.q(api.sb.from("count_lines_v").select("location,sku,barcode,description,batch,expiry_date,session_name,is_found").eq("session_id", id).order("seq").order("id").range(from, from + 999)); rows.push(...d); if (d.length < 1000) break; from += 1000; }
  const seen = new Set();
  if (what === "loc") L.rows = rows.filter(r => !seen.has(r.location.toUpperCase()) && seen.add(r.location.toUpperCase())).map(r => ({code: r.location, l1: r.location, l2: "", l3: "", copies: 1}));
  else L.rows = rows.filter(r => { const k = (r.barcode || r.sku).toUpperCase(); return !seen.has(k) && seen.add(k); }).map(r => ({code: r.barcode || r.sku, l1: r.sku, l2: r.description, l3: r.batch ? `Batch ${r.batch}${r.expiry_date ? ", exp " + r.expiry_date : ""}` : "", copies: 1}));
  L.source = `${rows[0] ? rows[0].session_name : "Count"}: ${what === "loc" ? "locations" : "products"}`; L.table = null;
  if (!L.cfg.maskTouched) { const sm = suggestMask(L.rows.map(r => r.code)); if (sm) L.cfg.mask = sm; }
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
    const st = e.target.closest("[data-style]"); if (st) { L.cfg.style = st.dataset.style; L.cfg.type = STYLES[L.cfg.style].def;
      const lay = STYLES[L.cfg.style].layout; if (lay) { [L.cfg.paper, L.cfg.cols, L.cfg.rows] = lay; L.cfg.orient = "portrait"; if (L.cfg.arrow === "none") L.cfg.arrow = L.cfg.style === "detail" ? "down" : "up"; }
      if ($("#lb-parts")) renderParts(); if (L.table && !L.mapTouched) { L.map = guess(L.table[0], L.cfg.style); applyMap(); renderMap(); } save(); renderStyles(); renderOpts(); refresh(); }
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
  renderParts();
  $$("[data-lmap]").forEach(s => s.onchange = () => { L.map[s.dataset.lmap] = +s.value; L.mapTouched = true; applyMap(); refresh(); });
}
function renderParts() {
  let box = $("#lb-parts"); if (!box) { box = document.createElement("div"); box.id = "lb-parts"; $("#lb-map").after(box); }
  const c = L.cfg, h = L.table ? L.table[0] : null;
  const opt = sel => `<option value="-1">(none)</option>` + (h || []).map((x, i) => `<option value="${i}" ${sel === i ? "selected" : ""}>${esc(x || "Column " + (i + 1))}</option>`).join("");
  const ex = L.rows[0] ? parts(L.rows[0], c) : null;
  box.innerHTML = `<details class="lb-partbox" ${STYLES[c.style].parts ? "open" : ""}><summary><strong>Location parts</strong> <span class="small muted">for the beam, upright and detailed styles</span></summary>
    <label class="field" style="margin-top:10px">Location pattern<input id="lb-mask" value="${esc(c.mask)}" placeholder="e.g. ZZZZABBLLP" autocapitalize="characters" spellcheck="false"></label>
    <p class="hint">One letter per character of the location code: <strong>Z</strong> zone, <strong>A</strong> aisle, <strong>B</strong> bay, <strong>L</strong> level, <strong>P</strong> bin (position). Anything else is skipped. <code>W2C2M0103B</code> with <code>ZZZZABBLLP</code> gives aisle M, bay 01, level 03, bin B.</p>
    ${ex ? `<p class="small" style="margin:0 0 8px">${ex.ok ? `First label <code>${esc(L.rows[0].code)}</code>: ${[["Zone", ex.zone], ["Aisle", ex.aisle], ["Bay", ex.bay], ["Level", ex.level], ["Bin", ex.bin]].filter(x => x[1]).map(([a, b]) => `${a} <strong>${esc(b)}</strong>`).join(", ") || "no parts"}` : `<span style="color:var(--bad)">The pattern doesn't match <code>${esc(L.rows[0].code)}</code>: it must have the same number of characters.</span>`}</p>` : ""}
    ${h ? `<p class="small muted" style="margin:0 0 4px">Or take the parts from columns in your file (these win over the pattern):</p><div class="map">${PARTS.map(([k, l]) => `<label class="field">${l}<select data-lmap="${k}">${opt(L.map[k] ?? -1)}</select></label>`).join("")}</div>` : ""}</details>`;
  const mi = $("#lb-mask"); let t;
  mi.oninput = () => { clearTimeout(t); t = setTimeout(() => { c.mask = mi.value.trim(); c.maskTouched = true; save(); renderParts(); $("#lb-mask").focus(); const e = $("#lb-mask"); e.setSelectionRange(e.value.length, e.value.length); refresh(); }, 400); };
  $$("[data-lmap]", box).forEach(s => s.onchange = () => { L.map[s.dataset.lmap] = +s.value; L.mapTouched = true; applyMap(); renderParts(); refresh(); });
}
function sampleItem(style) {
  if (style === "beam") return {code: "J104-04-B", aisle: "J1", bay: "04", level: "04", bin: "B", arrow: "up"};
  if (style === "upright") return {code: "T0960C", aisle: "T", bay: "60", level: "C", bin: "09", arrow: "up"};
  if (style === "detail") return {code: "W2C2M0103B", zone: "W2C2", aisle: "M", bay: "01", level: "03", bin: "B", arrow: "down"};
  if (style === "rack") return {rack: "W2C2M0103", levels: ["C", "B", "A"].map(x => ({code: "W2C2M0103" + x, l1: "W2C2M0103" + x}))};
  if (style === "prod") return {code: "9345156233829", l1: "7000294", l2: "Hair brush, vent", l3: "Batch 52021052"};
  return {code: "W2C2M0103B", l1: "W2C2M0103B", l2: "", l3: ""};
}
function renderStyles() {
  const box = $("#lb-styles");
  box.innerHTML = Object.entries(STYLES).map(([k, s]) => {
    const c = {...L.cfg, style: k, type: STYLES[k].types.includes(L.cfg.type) ? L.cfg.type : s.def, arrow: k === "loc" ? "up" : "none", border: false, textSize: "M"};
    const g = {lw: 70, lh: k === "rack" ? 44 : k === "detail" ? 26 : k === "upright" ? 36 : 22};
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
    ${["loc", "rack", "beam", "upright", "detail"].includes(c.style) ? `<label class="field">Arrow<select data-o="arrow">${[["none", "No arrow"], ["up", "Pointing up"], ["down", "Pointing down"]].map(([k, l]) => `<option value="${k}" ${c.arrow === k ? "selected" : ""}>${l}</option>`).join("")}</select><span class="small muted" style="font-weight:400">An Arrow column in the file overrides this per label.</span></label>` : ""}
    ${c.style === "rack" ? `<label class="field">Levels are<select data-o="group"><option value="last_char" ${c.group === "last_char" ? "selected" : ""}>The last letter (W2C2M0103A)</option><option value="last_segment" ${c.group === "last_segment" ? "selected" : ""}>The last part (A01-01-A)</option></select></label>` : ""}
    <label class="field">Text size<select data-o="textSize">${[["S", "Small"], ["M", "Medium"], ["L", "Large"]].map(([k, l]) => `<option value="${k}" ${c.textSize === k ? "selected" : ""}>${l}</option>`).join("")}</select></label>
    <label class="field">Copies of each label<input type="number" min="1" max="99" data-o="copies" value="${c.copies}"></label>
    <label class="field">Start at label position<input type="number" min="1" max="200" data-o="start" value="${c.start}"></label>
  </div>
  <div class="row" style="margin-top:12px;gap:18px">
    <label class="check"><input type="checkbox" data-o="border" ${c.border ? "checked" : ""}> Cut lines</label>
    <label class="check"><input type="checkbox" data-o="showText" ${c.showText ? "checked" : ""}> Code under barcode</label>
    ${c.style === "rack" || c.style === "upright" ? `<label class="check"><input type="checkbox" data-o="reverse" ${c.reverse ? "checked" : ""}> Top level first</label>` : ""}
    ${c.style === "upright" ? `<label class="check"><input type="checkbox" data-o="header" ${c.header ? "checked" : ""}> Bay header label before each rack</label>` : ""}
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
  if (style === "beam") return ["A", "B"].flatMap(p => ["03", "04"].map(l => ({code: `J104-${l}-${p}`, aisle: "J1", bay: "04", level: l, bin: p, arrow: "up"})));
  if (style === "upright") return ["C", "B", "A"].map(l => ({code: `T0960${l}`, aisle: "T", bay: "60", level: l, bin: "09", arrow: "up"}));
  if (style === "detail") return ["A", "B", "C"].flatMap(b => ["01", "03"].map(l => ({code: `W2C2M01${l}${b}`, zone: "W2C2", aisle: "M", bay: "01", level: l, bin: b, arrow: l === "01" ? "up" : "down"})));
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
