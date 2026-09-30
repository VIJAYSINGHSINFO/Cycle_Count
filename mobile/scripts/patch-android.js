// Run after "npx cap add android". Applies the scanner setting, portrait mode,
// automatic version numbers and (when a signing key is provided) release signing.
const fs = require("fs");
const man = "android/app/src/main/AndroidManifest.xml", gradle = "android/app/build.gradle";
if (!fs.existsSync(man) || !fs.existsSync(gradle)) { console.error("Android project not found. Run: npx cap add android"); process.exit(1); }

let x = fs.readFileSync(man, "utf8");
if (!x.includes("com.google.mlkit.vision.DEPENDENCIES"))
  x = x.replace(/<application([^>]*)>/, m => `${m}\n        <meta-data android:name="com.google.mlkit.vision.DEPENDENCIES" android:value="barcode_ui"/>`);
if (!x.includes("android:screenOrientation")) x = x.replace(/<activity\b/, '<activity android:screenOrientation="portrait"');
if (!x.includes("android:windowSoftInputMode")) x = x.replace(/<activity\b/, '<activity android:windowSoftInputMode="adjustResize"');
fs.writeFileSync(man, x);

let g = fs.readFileSync(gradle, "utf8");
if (!g.includes("CC_VERSION_CODE")) {
  g = g.replace(/versionCode\s+\d+/, 'versionCode((System.getenv("CC_VERSION_CODE") ?: "1") as Integer)')
       .replace(/versionName\s+"[^"]*"/, 'versionName(System.getenv("CC_VERSION_NAME") ?: "1.0")');
}
if (!g.includes("signingConfigs")) {
  g = g.replace(/\n(\s*)buildTypes\s*\{/, (m, sp) => `
${sp}signingConfigs {
${sp}    release {
${sp}        if (System.getenv("CC_KEYSTORE")) {
${sp}            storeFile file(System.getenv("CC_KEYSTORE"))
${sp}            storePassword System.getenv("CC_KEYSTORE_PASSWORD")
${sp}            keyAlias System.getenv("CC_KEY_ALIAS")
${sp}            keyPassword System.getenv("CC_KEY_PASSWORD")
${sp}        }
${sp}    }
${sp}}
${sp}buildTypes {`);
  g = g.replace(/(buildTypes\s*\{\s*release\s*\{)/, `$1\n            if (System.getenv("CC_KEYSTORE")) { signingConfig signingConfigs.release }`);
}
fs.writeFileSync(gradle, g);
console.log("Android project updated.");
