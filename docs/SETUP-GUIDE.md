# Setup guide: your own Cycle Count system

At the end of this guide you'll have:

| What | Where it lives | How people open it |
|---|---|---|
| **Database** | Your Supabase project | Nobody opens it directly; both apps connect to it |
| **Desktop console** | Your website on GitHub Pages | A normal link in Chrome or Edge, which can be installed as a desktop app |
| **Mobile app** | The same website, plus an Android APK | Scan a QR code in Chrome, or install the APK |

No Claude account is needed by anyone who uses the apps. You need two free accounts: **Supabase** (database) and **GitHub** (builds the website and the APK). Allow about 45 minutes the first time.

> Before going live with real stock data, check with your IT team that storing it in Supabase (a cloud database) fits company policy. Supabase can also be self-hosted on your own servers.

---

## Part 1: Create the database (15 minutes)

1. Go to **supabase.com**, sign up, and click **New project**.
   - Name: `cycle-count`
   - Database password: create a strong one and save it somewhere safe.
   - Region: the one closest to your warehouse.
2. Wait until the project says it's ready (about 2 minutes).
3. In the left menu open **SQL Editor** and click **New query**.
4. Open `supabase/schema.sql` from this folder in Notepad, select everything, copy it, paste it into the SQL Editor, and click **Run**. You should see **Success. No rows returned**.
5. Open **Authentication > Sign In / Providers** and check that **Email** is turned on.
   - For a first test you can turn **Confirm email** off, so accounts work immediately. Turn it back on before going live.
6. Open **Project Settings > API** (on newer projects: **Project Settings > API Keys**). Copy and keep two values:
   - **Project URL**, for example `https://abcdefgh.supabase.co`
   - The **anon public** key (a long text starting with `eyJ`), or the **Publishable** key (starting with `sb_publishable_`)

> Never use the `service_role` or `sb_secret_` key. It bypasses every security rule. The apps refuse it.

---

## Part 2: Put the project on GitHub (10 minutes)

1. Go to **github.com**, sign up, and click **New repository** (the **+** at the top right).
   - Name: `cycle-count`
   - Choose **Private** if you only want your team to see the code. The website still works either way on paid plans; on a free GitHub account, Pages websites need a **Public** repository.
   - Tick **Add a README file**, then click **Create repository**.
2. Unzip `cycle-count-suite.zip` on your computer.
3. In the repository, click **Add file > Upload files**. Open the unzipped `cycle-count-suite` folder, select **everything inside it**, and drag it into the page. Click **Commit changes**.
4. **Check that the build file arrived.** Windows and some browsers skip folders whose names start with a dot. In the repository, look for a folder named `.github`. If it's missing:
   1. Click **Add file > Create new file**.
   2. Type the name `.github/workflows/build.yml`. Typing the slashes creates the folders.
   3. Open `github-workflow-build.yml` from the unzipped folder, copy everything, paste it in, and click **Commit changes**.

---

## Part 3: Connect GitHub to your database (5 minutes)

1. In the repository, open **Settings > Secrets and variables > Actions**, then the **Variables** tab.
2. Click **New repository variable** and add:

| Name | Value |
|---|---|
| `SUPABASE_URL` | Your Project URL from Part 1 |
| `SUPABASE_ANON_KEY` | Your anon public (or publishable) key from Part 1 |
| `APP_ID` | Optional. Your Android app ID, for example `ae.yourcompany.cyclecount`. Choose it once and never change it, because it's the app's identity on phones and in Google Play. |

3. Open **Settings > Pages**. Under **Build and deployment > Source**, choose **GitHub Actions**.

---

## Part 4: Build everything (10 minutes, mostly waiting)

1. Open the **Actions** tab. If GitHub asks, click **I understand my workflows, go ahead and enable them**.
2. Click **Build Cycle Count** on the left, then **Run workflow > Run workflow**.
3. Wait for both jobs, **website** and **android**, to turn green. The Android build takes about 5–8 minutes.
4. **Your website:** click the finished run, then the link under **website**. It looks like `https://yourname.github.io/cycle-count/`. The start page has:
   - **Open the console** for laptops.
   - A **QR code** for phones, which opens the mobile app in Chrome.
5. **Your APK:** on the same run page, scroll to **Artifacts** and download **cycle-count-android**. Unzip it; inside is the APK, `app-debug.apk`.

From now on, **every change you upload to the repository rebuilds both automatically.**

---

## Part 5: First sign-in and users (5 minutes)

1. On your laptop, open the console link and click **Create an account**. **The first account becomes the administrator** automatically, so create yours first.
2. In Supabase, open **Authentication > URL Configuration** and set **Site URL** to your console link. Email confirmation links then open the right place.
3. Counters create their own accounts from the mobile app. In the console, go to **Users**, set each person's role, tick **Active**, and click **Save**. Until then they can't see anything.

---

## Part 6: Install on devices

**Desktop app (Windows or Mac):** open the console link in Chrome or Edge and click the **Install** icon at the right end of the address bar. Cycle Count then opens in its own window from the Start menu or desktop, like a normal program.

**Phones, quickest way:** scan the QR code on the start page, open the link in Chrome, and use **menu > Add to Home screen**.

**Phones, Android app (APK):**
1. Send `app-debug.apk` to the phone (email, WhatsApp, USB or Google Drive) and tap it.
2. Android asks to allow installing from that source. Allow it once, then tap **Install**.
3. The app is already connected to your database, because the build added your Supabase details.

**Company handhelds (Zebra, Honeywell):** give the APK to your IT team to push through device management. Set the scanner to keyboard output with an Enter key after each scan; on Zebra that's a DataWedge profile with *Keystroke output* and *Send ENTER key* turned on.

---

## Part 7 (optional): A signed APK for Google Play or company distribution

The APK from Part 4 is a *debug* build. It's fine for testing and for installing directly, but Google Play needs a signed release. Once you add a signing key, the same build produces a signed APK and an `.aab` file for Google Play.

1. **Create a key once**, on any computer with Java installed. You can also ask IT to do this, or create it in Android Studio under **Build > Generate Signed Bundle**:
   ```
   keytool -genkeypair -v -keystore release.keystore -alias cyclecount -keyalg RSA -keysize 2048 -validity 10000
   ```
   Keep `release.keystore` and its passwords safe. **If you lose them, you can never update the app under the same identity.**
2. **Turn the key file into text:**
   - Windows (PowerShell): `[Convert]::ToBase64String([IO.File]::ReadAllBytes("release.keystore")) | Set-Clipboard`
   - Mac: `base64 -i release.keystore | pbcopy`
3. **Add it to GitHub.** In the repository, open **Settings > Secrets and variables > Actions**, then the **Secrets** tab, and add:

| Secret | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | The text from step 2 |
| `ANDROID_KEYSTORE_PASSWORD` | The keystore password |
| `ANDROID_KEY_ALIAS` | `cyclecount` (or the alias you chose) |
| `ANDROID_KEY_PASSWORD` | The key password |

4. **Run the build again.** The artifact now contains `app-release.apk` and `app-release.aab`. See `docs/GOOGLE-PLAY.md` for publishing.

---

## Everyday use

1. **Console:** click **New count**, upload the WMS stock export (Excel or CSV) and click **Open for counting**.
2. **Phones:** counters sign in, pick the count, go to the suggested location, scan the location label, and scan each product.
3. **Console:** open **Variances**, recount or accept, **Close count**, then **Reconcile** with your WMS adjustment reference. The count is saved permanently in **Reconciliation history**.

## Printing barcode labels

1. In the console, open **Barcode labels**.
2. **Choose the data.** Upload a CSV or Excel file with one row per label (see `docs/label-file-template.csv`), load the locations or products of a count, or type the codes.
   - Only the **Barcode value** column is required.
   - Repeated rows are skipped, so a stock file with many SKUs per location still gives one label per location.
   - A barcode at the start of a description (`9345156233829-Hair brush`) is split out automatically.
3. **Pick a style:**
   - **Location label:** a large location code with a barcode and an optional arrow.
   - **Rack levels:** one label per rack, with a row and barcode for each level (A, B, C…).
   - **Product label:** SKU, description and barcode. EAN-13 is used automatically when the barcode is valid.
   - **QR label:** a QR or Data Matrix code with text, for small bins.
   - **Beam label:** QR code, aisle above bay-level-bin (for example `J1` over `04-04-B`), and an arrow.
   - **Upright label:** a grid with aisle, bay-level, bin and QR code, plus a bay header label (such as `60 ↑`) before each rack.
   - **Detailed location label:** aisle, bay, level and bin in large outlined text, with a Code 128 barcode, a QR code and an UP/DOWN arrow.

   The last three need the **location parts**. Either add columns called Aisle, Bay, Level, Bin (and optionally Zone and Arrow) to the file, or enter a **location pattern**: one letter per character, with Z = zone, A = aisle, B = bay, L = level and P = bin. For example, `ZZZZABBLLP` splits `W2C2M0103B` into aisle M, bay 01, level 03, bin B. The pattern is suggested automatically for common formats. An **Arrow** column (up/down) sets the arrow per label.
4. **Choose the paper:** A4 or A5, portrait or landscape, and labels per sheet (1 up to 40, or custom rows and columns). The screen shows each label's size in mm. For label sheets, set the page margin and gap to match the sheet.
5. Click **Print labels**. In the print window set **Scale: 100% / Actual size**, **Margins: None**, and turn off **Headers and footers**. To keep a file instead, choose **Save as PDF** as the printer.
   - **Start at label position** lets you reuse a partly used label sheet.
   - If a code can't be encoded in the chosen barcode type (for example letters in EAN-13), or the bars would be too thin to scan, the console lists it before printing.

## Order QC (checking picked orders before dispatch)

Order QC checks that each picked order has exactly the right quantity of every product before it leaves.

**Adding it to an existing setup (once):** in Supabase open **SQL Editor > New query**, paste the whole of the new `supabase/schema.sql` and click **Run**. It keeps your existing counts and only adds what's missing. Then upload the new files to GitHub as usual; the website and the APK rebuild by themselves. Install the new APK on the phones.

**Supervisor, in the console:**
1. Open **Order QC** and click **Upload orders**. Choose the WMS export of picked orders (Excel or CSV, one row per order line; see `docs/order-file-template.csv`). Needed: order number, SKU and order quantity. Helpful: barcode, description, storer, customer, UOM.
2. Check the columns the console picked. Operators check against the column chosen as **Order quantity**.
3. Choose **Tote scan** (off, optional or required) and whether operators **may type a quantity** for full cases. Click **Upload orders**. Orders already uploaded are skipped.
4. Watch progress on the Order QC page. Orders **Short: waiting for pick** need the missing units picked. If they can't be supplied, open the order and click **Release short** with the reason. **Unlock** frees an order left open on someone's phone; **Reset scans** starts it again; **Cancel order** closes it so it can be uploaded again.

**Operator, on the phone:**
1. Tap **Order QC** at the top, then scan the order number on the pick list.
2. Scan every unit. The screen shows each product as scanned / ordered.
3. A red screen stops the operator when a unit is more than the order needs, or when a product isn't in the order. Nothing is counted; the operator puts the item aside and taps to continue.
4. Tap **Finish QC**. If anything is missing, the phone lists it. Check the tote and packing table, scan anything found, or tap **Send back for picking**. When the missing units arrive, scan the order number again and scan them.

**What the system won't allow:** counting more than the order quantity, passing an order with missing units (unless a supervisor releases it with a reason), two people checking the same order at once, uploading the same order twice, or changing a passed order. Every scan, refused scan and removed unit is kept in the order's activity history.

**What it can't detect:** the same physical unit scanned twice. Spot-check orders from the activity history, and look at the **Units removed** and **Refused scans** figures for patterns.

## Something not working?

| Problem | Fix |
|---|---|
| The app shows **Connect to your database** | The build didn't get your Supabase details. Check the two repository variables in Part 3 (no spaces), then rerun the build. You can also paste the URL and key on that screen; they're saved on that device only. |
| **Waiting for approval** after signing in | An administrator must tick **Active** for that user in the console's **Users** page. |
| The **android** job fails | Open the failed step and read the last lines. The most common cause is a mistake in `APP_ID`: letters, numbers, dots and underscores only, at least two parts (`ae.company.cyclecount`). |
| The website link shows 404 | **Settings > Pages > Source** must be **GitHub Actions**, and the **website** job must have finished. |
| Barcodes look like `9.34516E+12` | The CSV was saved through Excel. Export it from the WMS again and upload it without opening it in Excel. |
| Operator sees **no longer assigned to you** | A supervisor unlocked, reset or closed the order. Go back to the order list and scan the order number again; scans that were rejected can be sent again or discarded. |
| Order QC says **Order not found** | The order hasn't been uploaded, or the number on the pick list is a different field. Try the reference number, or check which column was chosen as Order number. |
| **Try the demo** | Every connection screen has a demo link with sample data. Nothing is saved. Use **Exit demo** in the yellow bar to leave. |
