# Getting the mobile app onto staff phones

## First, pick the right route

This is an internal tool for your own staff, so a public Play Store listing is usually not the best fit. It would be visible to anyone, needs a public privacy policy and store listing, and goes through full public review. There are three routes:

| Route | Best for | What you need |
|---|---|---|
| **A. Private app (Managed Google Play)** | Company phones or handhelds managed with Intune, Workspace or another device management tool | A Google Play developer account in the company's name, plus device management. The app appears only in your organisation's managed Play Store. |
| **B. Direct install (APK)** | Zebra/Honeywell handhelds, a small fleet, or a pilot | The signed APK. Push it with your device management tool (for example Intune, SOTI or Zebra StageNow), or install it manually. |
| **C. Public Play Store listing** | Only if people outside the company will use the app | Everything in route A plus the public listing requirements below |

Most warehouses use **A** or **B**. Since your company already uses Microsoft 365, ask IT whether Intune manages your devices. If it does, route A is usually the cleanest.

## Create the developer account (routes A and C)

1. Go to play.google.com/console and sign up as an **Organization**, not Personal. Use a shared company Google account (for example `mobile-apps@yourcompany.com`) rather than someone's personal account.
2. An organisation account needs a **D-U-N-S number** for the company. If you don't have one, it can be requested free from Dun & Bradstreet, which takes some days.
3. Pay the one-time registration fee and complete Google's identity verification.

Why Organization matters: personal accounts created after November 2023 must run a closed test with at least 12 testers for 14 continuous days before they can publish to production. That requirement is documented for personal accounts, and an organisation account is also the right owner for a company app.

## Build the release file

Follow step 6 of the README. Use **Android App Bundle (.aab)** for Play and **APK** for direct install. Keep the signing keystore safe: losing it means you can't publish updates under the same app.

For Play, it's also recommended to enrol in **Play App Signing** when you upload the first release. Google then holds the app signing key, and your keystore becomes an upload key that can be reset if lost.

## Route A: private app

1. In Play Console, create the app: name "Cycle Count", type App, Free.
2. In **Advanced settings > Managed Google Play**, turn on **Private app** and add your organisation's Managed Google Play ID. Your device management admin can find this ID.
3. Complete the required sections (App content, Data safety). They are short for a private app.
4. Upload the .aab to **Production** and roll it out.
5. In your device management tool (for example Intune: *Apps > Android > Managed Google Play*), approve the app and assign it to the warehouse user or device group.

Note: once an app is made private, it can't be made public later with the same package name.

## Route B: direct install

1. Build a signed **APK**.
2. Upload it to your device management tool as a line-of-business app, or copy it to the device and open it. For manual installs, the phone asks you to allow installs from that source.
3. For updates, increase the version in Android Studio (`versionCode` in `android/app/build.gradle`), build again with the same keystore, and push the new APK.

Google has announced developer verification requirements for apps installed outside the Play Store on certified Android devices. Check the current status in the Android developer documentation before relying on route B at scale, and register your organisation for verification if required.

## Route C: public listing checklist

- **Store listing:** app name, short and full description, 512×512 icon (`mobile/www/icons/icon-512.png`), phone screenshots, feature graphic (1024×500).
- **Privacy policy URL:** a public web page explaining what the app collects. It collects sign-in email, name, count entries, and a device label used in the audit trail.
- **Data safety form:** declare the email, name and app activity data; data is encrypted in transit (HTTPS); users can ask the company to delete their account.
- **Content rating questionnaire:** it's a business tool with no user-generated public content.
- **Target audience:** adults. Not designed for children.
- **Target API level:** Google requires recent Android API levels. The Capacitor 8 project targets a current level; accept Android Studio's update prompts before each release.
- **App access for reviewers:** Google's reviewers need a working test login. Create a counter account and an open demo count for them, and enter the details under *App content > App access*.

## Updating the app

1. Change the files in `mobile/www/`.
2. Run `npm run android:sync`.
3. Increase `versionCode` (and `versionName`) in `android/app/build.gradle`.
4. Build a signed bundle or APK with the same key and upload it.

Changes to the database (`schema.sql`) and the desktop console don't need a new app release.
