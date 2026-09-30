// Writes the database connection into both apps' config.js.
// Used by the GitHub build (from repository variables) or locally:
//   SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=eyJ... node scripts/write-config.js
const fs = require("fs");
const url = (process.env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
const key = (process.env.SUPABASE_ANON_KEY || "").trim();
if (!url || !key) {
  console.log("SUPABASE_URL / SUPABASE_ANON_KEY not set: the apps will show the connection screen on first start.");
  process.exit(0);
}
if (!/^https:\/\//.test(url)) { console.error("SUPABASE_URL must start with https://"); process.exit(1); }
if (/^sb_secret_/.test(key)) { console.error("That is a secret key. Use the anon public or publishable key."); process.exit(1); }
try {
  const payload = JSON.parse(Buffer.from(key.split(".")[1], "base64").toString());
  if (payload.role === "service_role") { console.error("That is the service_role key. Use the anon public key."); process.exit(1); }
} catch {}
const body = `/* Written by scripts/write-config.js. The anon key is public by design; the database's security rules protect the data. */
window.CONFIG = {
  SUPABASE_URL: ${JSON.stringify(url)},
  SUPABASE_ANON_KEY: ${JSON.stringify(key)}
};
`;
for (const p of ["desktop/config.js", "mobile/www/config.js"]) fs.writeFileSync(p, body);
console.log("Connection written to desktop/config.js and mobile/www/config.js");
