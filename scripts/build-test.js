// Builds the one-file test page (both apps in demo mode, with a shared test database when hosted as a claude.ai artifact).
// Usage: node scripts/build-test.js [output.html]
const fs = require("fs"), path = require("path");
const r = f => fs.readFileSync(path.join(__dirname, "..", f), "utf8");
const mark = r("brand/mark.svg").replace("<svg ", '<svg class="mark" ');
const P = {
  theme: r("shared/theme.css"), shell: r("test/shell.css"), mark, demo: r("shared/demo.js"),
  desktop: {css: r("desktop/desktop.css"), lib: r("desktop/lib/bwip-js-min.js"), js: [r("desktop/labels.js"), r("desktop/qc.js"), r("desktop/app.js")].join("\n;\n")},
  mobile: {css: r("mobile/www/mobile.css"), js: [r("mobile/www/qc.js"), r("mobile/www/app.js")].join("\n;\n")}
};
const json = JSON.stringify(P).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\!--");
const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Cycle Count test</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet">
</head><body>
<div id="root"><div class="loading">Loading…</div></div>
<div class="toast" id="toast" role="status" aria-live="polite"></div>
<script type="application/json" id="payload">${json}</script>
<script>${r("test/test-shell.js")}</script>
</body></html>`;
const out = process.argv[2] || path.join(__dirname, "..", "test", "index.html");
fs.writeFileSync(out, html);
console.log("Test page written to " + out + " (" + Math.round(html.length / 1024) + " KB)");
