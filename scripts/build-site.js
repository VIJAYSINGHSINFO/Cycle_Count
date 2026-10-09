// Builds the website published on GitHub Pages:  /  (start page),  /console/,  /mobile/
const fs = require("fs"), path = require("path");
const out = "_site";
const base = (process.env.SITE_URL || "").replace(/\/+$/, "");
const apk = process.env.APK_URL || "";
fs.rmSync(out, {recursive: true, force: true});
fs.cpSync("desktop", path.join(out, "console"), {recursive: true});
fs.cpSync("mobile/www", path.join(out, "mobile"), {recursive: true});
fs.cpSync("pass", path.join(out, "pass"), {recursive: true});
// Privacy policy (Google Play needs a public address): company and contact come from the repository variables COMPANY_NAME and PRIVACY_EMAIL
{ const co = process.env.COMPANY_NAME || "the company that operates this app", mail = process.env.PRIVACY_EMAIL || "";
  const h = s => String(s).replace(/[&<>"]/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;"}[c]));
  fs.mkdirSync(path.join(out, "privacy"), {recursive: true});
  fs.writeFileSync(path.join(out, "privacy", "index.html"), fs.readFileSync("docs/privacy-policy.html", "utf8").replace(/\{\{COMPANY\}\}/g, h(co)).replace(/\{\{EMAIL\}\}/g, h(mail || "your administrator")).replace(/\{\{DATE\}\}/g, new Date().toISOString().slice(0, 10))); }   // gate pass page sent to drivers on WhatsApp
fs.copyFileSync("brand/mark.svg", path.join(out, "icon.svg"));
let qr = "";
if (base) { try { require("qrcode").toString(base + "/mobile/", {type: "svg", margin: 1, color: {dark: "#13233F", light: "#FFFFFF"}}, (e, s) => { if (!e) qr = s; }); } catch { console.log("qrcode package not installed: start page will show the link without a QR code"); } }
const mark = fs.readFileSync("brand/mark.svg", "utf8").replace("<svg ", '<svg class="mark" ');
const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Stowra</title><link rel="icon" href="icon.svg" type="image/svg+xml">
<link rel="preconnect" href="https://fonts.googleapis.com"><link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Sans:wght@400;500;600&family=Sora:wght@700&display=swap" rel="stylesheet">
<style>
:root{--bg:#F5F7FA;--surface:#fff;--ink:#13233F;--muted:#5B6A80;--line:#D6DDE7;--navy:#13233F}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.5 "IBM Plex Sans",system-ui,sans-serif;min-height:100vh;display:grid;place-items:center;padding:20px}
main{width:100%;max-width:760px}.head{display:flex;gap:14px;align-items:center;margin-bottom:22px}.mark{width:56px;height:56px}
h1{font:700 2.4rem/1 "Barlow Condensed","Arial Narrow",sans-serif;margin:0}h2{font:700 1.5rem/1.1 "Barlow Condensed","Arial Narrow",sans-serif;margin:0 0 6px}
.grid{display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(260px,1fr))}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:20px;display:flex;flex-direction:column;gap:10px}
.card p{margin:0;color:var(--muted);font-size:.92rem}.btn{display:inline-block;text-align:center;padding:12px 16px;border-radius:8px;font-weight:600;text-decoration:none;background:var(--ink);color:var(--bg)}
.btn.go{background:var(--navy);color:#fff}.qr{width:170px;align-self:center;background:#fff;padding:8px;border-radius:8px}.qr svg{display:block;width:100%;height:auto}
.small{font-size:.85rem;color:var(--muted)}code{font-size:.85rem}
</style></head><body><main>
<div class="head">${mark}<div><h1 style="font-family:Sora,sans-serif;letter-spacing:-.02em">stowra</h1><span class="small">Every pallet, perfectly placed.</span></div></div>
<div class="grid">
  <section class="card"><h2>Supervisor console</h2><p>For desktop or laptop. Create counts, upload stock files, review variances and reconcile. In Chrome or Edge, use <strong>Install app</strong> in the address bar to add it as a desktop app.</p><a class="btn" href="console/">Open the console</a></section>
  <section class="card"><h2>Mobile app</h2><p>For counters. Scan the code with the phone camera to open it in Chrome, then use <strong>Add to Home screen</strong>.</p>
    ${qr ? `<div class="qr">${qr}</div>` : ""}<a class="btn go" href="mobile/">Open the mobile app</a>
    ${apk ? `<a class="small" href="${apk}">Download the Android app (APK)</a>` : ""}</section>
</div>
${base ? `<p class="small" style="margin-top:18px">Mobile link: <code>${base}/mobile/</code></p>` : ""}
</main></body></html>`;
setTimeout(() => { fs.writeFileSync(path.join(out, "index.html"), html); fs.writeFileSync(path.join(out, ".nojekyll"), ""); console.log("Site built in " + out); }, 200);
