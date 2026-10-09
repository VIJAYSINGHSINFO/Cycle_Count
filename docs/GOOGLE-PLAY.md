# Putting Stowra on Google Play

Publishing needs your company's own Google Play developer account, so these steps are done by you. Everything else (signed app file, listing text, pictures, privacy policy) is prepared in this folder.

Google's rules change from time to time. Where this guide gives a figure (fee, testers, Android version), check the current value in Play Console when you get there.

---

## Step 1: Set up the signing key on GitHub (once, 5 minutes)

The app must be signed with the same key forever, or phones refuse updates. You received three values with this update: the **keystore (base64)**, the **password** and the **alias** (`stowra`).

In your GitHub repository: **Settings > Secrets and variables > Actions**.

**Secrets** tab, **New repository secret**, four times:

| Name | Value |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | the whole content of `keystore-base64.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | the password |
| `ANDROID_KEY_PASSWORD` | the same password |
| `ANDROID_KEY_ALIAS` | `stowra` |

**Variables** tab, **New repository variable**:

| Name | Value |
|---|---|
| `APP_ID` | the app's permanent ID, e.g. `global.rsa.stowra`. **It can never be changed after the first Play upload.** Letters, numbers, dots; at least two parts. |
| `COMPANY_NAME` | the company name shown in the privacy policy, e.g. your company's name (optional) |
| `PRIVACY_EMAIL` | the address people write to about their data, e.g. `it@yourcompany.com` |

Keep the keystore file and password somewhere safe outside GitHub too (for example the company password manager).

## Step 2: Build

Open the **Actions** tab, choose **Build Stowra**, click **Run workflow**. When it's green (about 6–8 minutes), open the run and download **stowra-android-1.0.N** at the bottom. It contains:

- `stowra-1.0.N-install.apk`: install this directly on phones.
- `stowra-1.0.N-google-play.aab`: upload this to Google Play.

A file name ending in `TEST-ONLY` means the secrets in step 1 weren't picked up. Check their names.

**Important for phones that already have the old app:** the new app is signed with the new key (and may have a new App ID), so Android can't install it over the old one. Uninstall the old Stowra / Cycle Count app first. Counts not yet synced on that phone are lost, so sync first (the top bar must say "Synced"). After this one-time change, updates install over the top.

## Step 3: Create the developer account (once)

1. Go to **play.google.com/console** with a shared company Google account (e.g. `apps@yourcompany.com`), not a personal one.
2. Choose **Organization**. You'll need the company's **D-U-N-S number** (free from Dun & Bradstreet if you don't have one; it can take several days), the one-time registration fee (25 US dollars at the time of writing), and identity verification.
3. Why Organization: Google requires new **personal** accounts to run a closed test with at least 12 testers for 14 days before going public. Organization accounts don't have that requirement, and a company app belongs to the company.

## Step 4: Create the app in Play Console

**Create app**: name `Stowra`, language English, type **App**, **Free**. Tick the declarations.

Then complete the **Dashboard > Set up your app** tasks:

| Task | What to enter |
|---|---|
| Privacy policy | `https://<your-github-name>.github.io/<repository>/privacy/` (your Stowra web address + `/privacy/`). Open it in a browser first to check it shows your company name. |
| App access | **All or some functionality is restricted.** Add instructions: create a test account in Stowra for Google (role Operator, approved), plus one open count and one order, and give Google the email and password. Write: "Sign in with the details below. Open the count 'Review count' to try counting, or the Order QC tab to try order checking." |
| Ads | No ads |
| Content rating | Category: Utility / productivity. Answer No to violence, sexual content, gambling, etc. User interaction: users can't communicate with each other publicly. |
| Target audience | 18 and over. Not designed for children. |
| News app | No |
| Data safety | See the table below |
| Government app | No |
| Financial features | None |
| Health | None |

**Data safety answers:**

| Question | Answer |
|---|---|
| Does the app collect or share user data? | Collects: Yes. Shares: No. |
| Encrypted in transit? | Yes |
| Can users request deletion? | Yes, by contacting the email in the privacy policy |
| Personal info | **Name**, **Email address**, **User IDs**: collected, required, for *App functionality* and *Account management*. **Other info** (driver ID and licence numbers, vehicle registration, mobile number, entered by gate staff): collected, optional, for *App functionality*. |
| Photos and videos | **Photos**: collected, optional, for *App functionality* (evidence of damaged stock) |
| App activity | **Other user-generated content** (counts, checks, notes): collected, required, *App functionality* |
| Device or other IDs | Yes: a device label is stored with each record for the audit trail. *App functionality*. |
| Location, contacts, financial, health, messages, files | Not collected |

## Step 5: Store listing (copy and paste)

**App name:** `Stowra`

**Short description** (max 80 characters):
> Warehouse cycle counts, order checks and gate control, made for scanners.

**Full description:**
> Stowra is a warehouse operations app for your team's phones and handheld scanners.
>
> CYCLE COUNTING
> • Blind counts: operators never see the system quantity
> • Scan the location, then each product; batch and expiry supported
> • Recounts show only the items that need recounting
> • Damaged stock recorded with a reason and photo
> • Wrong location, misplaced and excess stock detected as you scan
> • Works offline: counts sync when the network is back
>
> ORDER QC
> • Scan every unit of a picked order before dispatch
> • Extra units and wrong products are stopped immediately
> • Short orders go back for picking with a ready pick list
>
> GATE AND DOCKS
> • Gate in with document expiry checks and PPE confirmation
> • QR gate pass sent to the driver on WhatsApp
> • Dock in, dock out and gate out by scanning the pass
>
> Every action is recorded with who did it and when. Stowra is used with your company's Stowra account; ask your administrator for access.

**Category:** Business. **Tags:** inventory, warehouse, logistics, barcode scanner.
**Contact email:** the same as PRIVACY_EMAIL. **Website:** your Stowra web address.

**Graphics** (all in `docs/play-store/`):
- App icon: `app-icon-512.png`
- Feature graphic: `feature-graphic.png` (1024 × 500)
- Phone screenshots: `screenshot-1.png` to `screenshot-5.png` (1080 × 1920)

## Step 6: Upload and publish

1. **Test and release > Production > Create new release.**
2. When asked about **Play App Signing**, accept (Google manages the final signing key; your key becomes the "upload key", which Google can reset if it's ever lost).
3. Upload `stowra-1.0.N-google-play.aab`. Release name: `1.0.N`. Release notes: "First release."
4. **Countries/regions:** add United Arab Emirates (and any others where staff work).
5. **Review release > Start rollout to production.**

Google's review of a new app usually takes from a few days to about a week. You'll get an email when it's live. Then anyone can find it by searching "Stowra", or you share the Play link.

**Faster option for staff right away:** while the public review runs, use **Testing > Internal testing**: add up to 100 staff email addresses, upload the same `.aab`, and share the opt-in link. Internal testing is available within minutes and has no review wait.

## Updating the app later

Change the files, upload them to GitHub, wait for the build, then in Play Console create a new Production release with the new `.aab`. The version number goes up automatically with every build. Changes to the console or the database don't need a new app release; only changes in `mobile/www/` do.

## Private alternative

If the app should be visible only to your company (not in public search), make it a **private app** with Managed Google Play instead (Play Console > Advanced settings > Managed Google Play), and assign it to company devices through your device management tool (e.g. Intune). A private app can't be made public later with the same App ID.
