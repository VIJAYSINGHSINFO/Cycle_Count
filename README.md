# Stowra

*Every pallet, perfectly placed.* Warehouse platform by RSA Global: Order QC, cycle counting and barcode labels. Logo files are in `brand/` (navy #13233F, teal #1FA38A, amber #F2A33A). The apps use a light white-and-navy look.

> **Setting it up for real?** Follow `docs/SETUP-GUIDE.md`. It creates your database, a website for the console and mobile app, and the Android APK, using GitHub to build everything, so no Android Studio is needed. The steps below describe the same pieces for technical readers.

Two apps sharing one database:

| App | Who uses it | What it does |
|---|---|---|
| **Desktop console** (`desktop/`) | Supervisors and administrators | Upload orders for QC and handle short orders, print barcode labels, create counts, upload stock files (50,000+ lines), open and close counts, review variances, request recounts, accept variances, reconcile, export to Excel, search history, manage users |
| **Mobile app** (`mobile/`) | Counters | Sign in, pick an open count, go to the suggested location, scan the location label, scan each product, record excess and misplaced stock with batch and dates, keep counting offline |
| **Database** (`supabase/schema.sql`) | Both apps | Stores every count permanently with a full audit trail and reconciliation records |

## Try it first: demo mode

Open `desktop/index.html` or `mobile/www/index.html` in a browser before setting anything up. While `config.js` still has the placeholder URL, both apps run on built-in sample data (a 24-location aisle with racks, batches and expiry dates). The mobile demo has a **Test scanner** panel so you can tap labels instead of scanning. Nothing is saved, and reloading resets the data.

## How counting works on the phone

1. The app suggests the next location. The operator goes there and **scans the location label**. Scanning a product first shows an error.
2. The operator **scans each product**. The expected product list is never shown, so it's a true blind count.
3. After each scan they enter the quantity. Scanning the same product again adds to it. With **Each scan = 1** switched on, every scan adds one unit.
4. If a product has several batches at that location, the app asks which batch.
5. If a product doesn't belong at that location, the app shows an error:
   - **Another level of the same rack** (for example it belongs to A01-01-B while the operator is at A01-01-A): the app says which level and offers to switch there.
   - **Another rack**: the app shows where the system has it and offers **Record as misplaced here**.
   - **Not in the stock file at all**: the app offers **Record as excess**.
6. Misplaced and excess stock need the product details. Batch number, manufacturing date and expiry date can each be set per count to required, optional or not asked; by default expiry is required.
7. **Location complete** saves anything expected but not scanned as 0 (not found), after asking the operator to confirm. The next location then comes up automatically.

## Order QC

Picked orders are uploaded on the console and checked unit by unit on the phone before dispatch. Extra units and products not in the order are refused with a full-screen stop; missing units send the order back for picking until they're scanned, or until a supervisor releases it short with a reason. The database enforces these rules itself (see the Order QC section of `supabase/schema.sql`). Setup and daily use: `docs/SETUP-GUIDE.md`, section **Order QC**.

Order file columns: order number, SKU and order quantity are required; reference, storer, customer, product barcode, description, UOM and batch are optional. WMS exports such as `ORDERKEY, EXTERNORDERKEY, STORERKEY, C_COMPANY, SKU, DESCR, ORIGINALQTY, UOM` are recognised automatically. Rows for the same SKU in one order are added together.

## Stock file columns

| Column | Needed | Notes |
|---|---|---|
| Location | Yes | For racks, use a code whose last part is the level, e.g. `A01-01-A`, `A01-01-B`. |
| SKU | Yes | |
| System qty | Yes | On-hand quantity at export time |
| Product barcode | Recommended | EAN/UPC on the product. Operators can scan either the barcode or the SKU. |
| Batch number | If you track batches | One row per batch per location |
| Manufacturing date, Expiry date | Optional | Excel dates, `dd/mm/yyyy`, `yyyy-mm-dd` or `31-Jan-2027` |
| Description, UOM, Unit cost | Optional | Unit cost adds value variance. If the barcode is at the start of the description (`9345156233829-Hair brush`), tick the option on the upload screen to split it out. |

WMS exports such as `LOC, SKU, DESCR, BATCH, MFG_DATE, EXP_DATE, SYSTEM_QTY, SYSTEM_UOM` are recognised automatically. Counters enter quantities in the same unit as the system quantity (for example Each). Location codes without separators, such as `W2C2M0103B`, are detected on upload and the last letter is treated as the rack level. Open CSV exports straight from the WMS rather than saving them through Excel first, because Excel turns long barcodes into values like `9.34516E+12`.

## How the pieces fit

```
 Desktop console (browser)            Mobile app (Android / browser)
          │                                      │
          └──────────────► Supabase ◄────────────┘
                       (PostgreSQL database,
                        sign-in, security rules)
```

The database enforces the rules itself, not just the apps:

- Counters can only record counts in open counts. They can't change system quantities, and on blind counts they never receive them.
- Every count, recount request, acceptance and status change is written to an audit log that the apps can't edit or delete.
- Once a count is reconciled it is frozen and can't be deleted.
- A count saved offline and sent twice is stored once.
- New accounts can't do anything until an administrator approves them.

---

## Step 1: Create the database (about 10 minutes)

1. Create an account at supabase.com and create a new project. Choose the region closest to your warehouse and save the database password somewhere safe.
2. In the project, open **SQL Editor**, click **New query**, paste the whole of `supabase/schema.sql`, and click **Run**. It should finish with "Success".
3. Open **Authentication > Sign In / Providers** and make sure **Email** is enabled. For a first test you can turn off "Confirm email"; turn it back on for production.
4. Open **Project Settings > API** and copy two values: the **Project URL** and the **anon public** key.

> Never use the `service_role` key in the apps. It bypasses all security rules.

**Plan choice:** the free plan is fine for testing, but free projects are paused after a period of inactivity and have limited backups. For daily warehouse use, move to a paid plan with daily backups. Check Supabase's current pricing page.

**Data location:** if company policy requires the data to stay in the UAE or on your own servers, Supabase can be self-hosted, or `schema.sql` can run on any PostgreSQL 15+ server with a Supabase-compatible sign-in service. Ask your IT team which option fits your policy before going live.

## Step 2: Connect the apps

Put the two values from step 1 into **both** config files:

- `desktop/config.js`
- `mobile/www/config.js`

```js
window.CONFIG = {
  SUPABASE_URL: "https://abcdefgh.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOi..."
};
```

## Step 3: Run the desktop console

The console is a set of static files, so any web server that serves HTTPS works:

- **Quick test on your PC:** in the `desktop` folder run `npx http-server -p 8080`, then open http://localhost:8080.
- **For the team:** upload the `desktop` folder to your company web server (IIS), Azure Static Web Apps, Netlify or similar, behind HTTPS.

The **first account created becomes the administrator** automatically. Create yours first. Anyone with the link can create an account, but it can't see or do anything until an administrator approves it. To stop self sign-up completely, turn off **Allow new users to sign up** in Supabase (Authentication settings) and invite people instead.

## Step 4: Add users

1. People create an account from the sign-in screen of either app, or you invite them from Supabase (**Authentication > Users > Invite**).
2. In the console, go to **Users**, set each person's role (Counter, Supervisor or Administrator), tick **Active**, and click **Save**.

Counters without company email can use addresses like `ali.counter@yourcompany.com`, as long as your email setup accepts them for confirmation. Alternatively, turn off email confirmation and create the accounts yourself.

## Step 5: Run a count, start to finish

1. **Console:** click **New count** and set the name, site, zone, tolerance, blind count and location scan options.
2. **Stock file:** export on-hand stock from your WMS as Excel or CSV and upload it. Check the column matching, choose the walking order (sorted by location, or the order in your file if it follows your pick path), and upload.
3. Click **Open for counting**. The count now appears in the mobile app.
4. **Mobile:** counters pick the count and work through it. The first location appears; they scan the location label, enter quantities, and **the next location opens automatically**. The app skips locations where another counter is currently working, so several people can count one zone without overlapping.
5. **Console, Variances tab:** filter by *Out of tolerance*, select lines, and click **Recount selected**. Recount locations show a red banner in the mobile app with a button to go straight to them. Accept variances you've investigated.
6. Click **Close count**, then **Reconcile**. Post the adjustments in your WMS (the Excel export has an *Adjustments* sheet) and enter the WMS reference. The count is frozen and added to **Reconciliation history**.

**Item history** lets you look up any SKU or location across all past counts, which is useful for spotting repeat problem locations.

## Step 6: Build the Android app

You need Node.js 20+ and Android Studio (with an Android SDK) on a Windows or Mac PC.

```bash
cd mobile
npm install
npm run android:add     # creates the android/ project and applies the scanner settings
npm run icons           # makes launcher icons from resources/
npm run android:open    # opens Android Studio
```

In Android Studio:

1. Wait for Gradle to finish syncing.
2. To try it, plug in a phone with USB debugging on and press **Run**.
3. For release, choose **Build > Generate Signed App Bundle or APK**:
   - Use **Android App Bundle (.aab)** for Google Play.
   - Use **APK** for installing directly or through device management.
4. Create a new keystore when asked and **keep the keystore file and passwords safe**. You need the same key for every future update.

Before building, change `appId` in `mobile/capacitor.config.json` from `com.yourcompany.cyclecount` to your own reverse domain, for example `ae.rsalogistics.cyclecount`. It can't be changed after publishing.

**After changing anything in `www/`**, run `npm run android:sync`, then rebuild in Android Studio.

### Scanners

- **Zebra, Honeywell and other handhelds:** set the built-in scanner to keyboard output with an Enter key after each scan. On Zebra this is a DataWedge profile with *Keystroke output* on and *Send ENTER key* on. Scans then go straight into the app's scan box.
- **Phones:** the 📷 button uses Google's barcode scanner on Android. The first time, the phone may download the scanner module.

### Offline counting

Counts are saved on the device first and sent every few seconds when there's a connection. The top bar shows **Synced**, **Syncing 3**, or **Offline, 12 waiting**. Lines are cached on the device, so a counter can reopen a count and keep working in a Wi-Fi dead spot. If the server rejects entries (for example, the count was closed meanwhile), the app shows them and keeps them until the counter or supervisor decides.

The mobile app also works in Chrome on any phone: host `mobile/www` the same way as the console, and it can be installed from the browser menu (**Add to Home screen**).

## Step 7: Google Play

See `docs/GOOGLE-PLAY.md`. The short version: for a staff-only warehouse app, publish it as a **private app** through Managed Google Play or install the APK through your device management, rather than listing it publicly.

---

## Files

```
supabase/schema.sql          database: tables, security rules, functions, views
brand/                       logo files (app icon, foreground for Android adaptive icon, horizontal logo)
desktop/                     supervisor console (static web app)
  index.html  app.js  desktop.css  theme.css  config.js  demo.js  icon.svg
mobile/                      counter app (Capacitor project for Android)
  www/                       the app itself (also works in a phone browser)
    index.html  app.js  mobile.css  theme.css  config.js  demo.js  sw.js  manifest.webmanifest
    lib/supabase.js          Supabase client library (MIT licence), bundled for offline use
    icons/
  resources/                 source images for launcher icons and splash screen
  scripts/patch-android.js   applies scanner settings to the Android project
  capacitor.config.json  package.json
docs/GOOGLE-PLAY.md          publishing options and checklist
shared/theme.css, demo.js     master copies of the shared styles and demo data (copy into both apps after editing)
```

`scripts/build-test.js` builds a single-file test page with both apps in demo mode (`node scripts/build-test.js`).

## Maintenance

- **Backups:** on a paid Supabase plan, daily backups are automatic. You can also export any count to Excel from the console.
- **Updating the database:** `schema.sql` is safe to run again, including on a database made with the first version. It adds the new columns and replaces the functions.
- **Demo mode in production:** once `config.js` has your real Supabase URL, demo mode is off. You can also delete `demo.js` from both apps.
- **Capacity:** the database handles hundreds of thousands of lines per count. Upload and mobile download are done in pages of 1,000 lines.
- **Changing styles:** edit `shared/theme.css`, then copy it to `desktop/theme.css` and `mobile/www/theme.css`.
- **Fonts:** the apps use Barlow Condensed and IBM Plex Sans when online and fall back to system fonts offline. To bundle the fonts in the Android app, add the font files to `www/` and reference them with `@font-face`.
