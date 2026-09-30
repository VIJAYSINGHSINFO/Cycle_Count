/* Database connection: uses config.js (filled in at build time), or details saved on this device from the setup screen. */
(() => {
"use strict";
const C = window.CONFIG || (window.CONFIG = {});
const get = k => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
try { const o = JSON.parse(get("cc-config") || "null"); if (o && o.SUPABASE_URL && o.SUPABASE_ANON_KEY) { C.SUPABASE_URL = o.SUPABASE_URL; C.SUPABASE_ANON_KEY = o.SUPABASE_ANON_KEY; C.FROM_DEVICE = true; } } catch {}
if (get("cc-demo") === "1") { C.DEMO = true; C.DEMO_FROM_DEVICE = true; }
C.isPlaceholder = () => !C.SUPABASE_URL || /YOUR-PROJECT/.test(C.SUPABASE_URL) || !C.SUPABASE_ANON_KEY || /YOUR-ANON/.test(C.SUPABASE_ANON_KEY);

window.CC_resetConnection = () => { set("cc-config", null); set("cc-demo", null); location.reload(); };
window.CC_startDemo = () => { set("cc-demo", "1"); location.reload(); };

window.CC_showSetup = () => {
  const root = document.getElementById("root");
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  root.innerHTML = `<div class="auth"><form class="panel" id="cc-setup" style="max-width:460px" novalidate>
    <div class="brand-big"><svg class="mark" viewBox="-6 -6 76 76" aria-hidden="true"><path d="M0 0H64V16.7H16.7V32H0Z" fill="#13233F"/><path d="M64 64H0V47.3H47.3V32H64Z" fill="#1FA38A"/><rect x="23.4" y="23.4" width="17.2" height="17.2" rx="2.6" fill="#F2A33A"/></svg><span>stowra</span></div>
    <h2 style="margin-bottom:6px">Connect to your database</h2>
    <p class="hint">In Supabase, open <strong>Project Settings &gt; API</strong> and copy the Project URL and the <strong>anon public</strong> (or <strong>publishable</strong>) key. They're saved on this device only.</p>
    <label class="field" style="margin-bottom:10px">Project URL<input name="url" type="url" placeholder="https://abcdefgh.supabase.co" autocomplete="off" spellcheck="false" value="${esc(C.FROM_DEVICE ? C.SUPABASE_URL : "")}"></label>
    <label class="field" style="margin-bottom:6px">Anon public key<textarea name="key" rows="4" placeholder="eyJhbGciOi…" spellcheck="false" style="font-family:ui-monospace,monospace;font-size:.8rem"></textarea></label>
    <p class="small" id="cc-setup-err" style="color:var(--bad);min-height:1.3em;margin:4px 0 8px"></p>
    <button class="btn primary" style="width:100%;min-height:48px" type="submit">Connect</button>
    <p class="small muted" style="margin:14px 0 0">Just looking? <a href="#" id="cc-demo">Try the demo with sample data</a>. Nothing is saved.</p>
  </form></div>`;
  const f = document.getElementById("cc-setup"), err = document.getElementById("cc-setup-err");
  document.getElementById("cc-demo").onclick = e => { e.preventDefault(); window.CC_startDemo(); };
  f.onsubmit = async e => {
    e.preventDefault();
    const url = f.elements.namedItem("url").value.trim().replace(/\/+$/, ""), key = f.elements.namedItem("key").value.replace(/\s+/g, "");
    if (!/^https:\/\/[^\s/]+$/.test(url)) { err.textContent = "Enter the Project URL, starting with https://"; return; }
    if (key.length < 30) { err.textContent = "Paste the whole anon public key."; return; }
    if (/^sb_secret_/.test(key) || /service_role/.test(atobSafe(key.split(".")[1] || ""))) { err.textContent = "That's a secret key. Use the anon public or publishable key; secret keys must never be put in an app."; return; }
    const btn = f.querySelector("button[type=submit]"); btn.disabled = true; btn.textContent = "Checking…"; err.textContent = "";
    try {
      const r = await fetch(url + "/auth/v1/health", {headers: {apikey: key}});
      if (r.status === 401 || r.status === 403) throw new Error("The key was rejected. Check that you copied the anon public key for this project.");
      if (!r.ok) throw new Error("Couldn't reach the database. Check the Project URL.");
      set("cc-config", JSON.stringify({SUPABASE_URL: url, SUPABASE_ANON_KEY: key})); set("cc-demo", null);
      location.reload();
    } catch (x) { err.textContent = x && x.message && !/fetch/i.test(x.message) ? x.message : "Couldn't reach the database. Check the URL and your internet connection."; btn.disabled = false; btn.textContent = "Connect"; }
  };
};
function atobSafe(s) { try { return atob(s.replace(/-/g, "+").replace(/_/g, "/")); } catch { return ""; } }
})();
