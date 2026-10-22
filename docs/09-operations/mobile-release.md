# Mobile release

> Status: **Approved** (Owner, 2026-10-21, as the skeleton (gate P1); final in P6) · Updated: 2026-10-22 (DR-239: the trunk is `dev`; earlier 2026-10-21: DR-228: Owner inputs are placeholders until the task that needs them; earlier: skeleton, P0-31) · DOC-73
> Depends on: original SDD §4.3, §21, [DR](../00-decision-register.md) (DR-37, 52, 60, 69, 70, 82, 94, 95, DR-167, 168, DR-228), [DOC-06](../02-glossary.md), [DOC-11](../03-architecture/tech-stack-and-versions.md) §6, [DOC-36](../06-design/building-configuration-and-demo.md) §9, [DOC-41](../06-design/configuration-reference.md) §7, §15, [DOC-50](../07-api/api-guidelines.md) §7, §16, [DOC-69](local-dev.md) §10, [DOC-71](ci-cd.md) §9
> Main readers: P1-17 (the first development builds), P6-10 (store builds and submission); the Owner (store accounts, review notes)

This document says how the two Expo apps are identified, configured, built, versioned, updated and submitted: `app.config.ts`, the EAS profiles and channels, the credentials, the version rules, the `MIN_APP_VERSION` procedure, the store checklist, the review accounts and the screenshots. It does not hold the app's design (DOC-55), the build jobs in CI (DOC-71 §9), local development with a development build (DOC-69 §10) or the push contract (DR-52, DOC-31).

**State of this document.** This is the **skeleton** the plan asks for in P1 (final in P6, P5-10 and P6-10). Sections 2 to 9 are final in structure and are the specification for P1-17; sections 10 to 12 (the store submission checklist, review accounts, screenshots) are complete as a list but hold values the Owner supplies (DOC-70 §2) and are verified by P6-10. Nothing here has been run: there is no app yet. Facts about EAS and the stores were read on 2026-10-20 (§14); a flag or field the sources did not confirm is marked **P1-17 checks** or **P6-10 checks**.

## 1. Purpose and scope

| Item | Where |
| --- | --- |
| The two apps: names, ids, schemes | §2 |
| `app.config.ts` | §3 |
| EAS profiles and builds | §4 |
| Environment variables and credentials | §5 |
| Push credentials | §6 |
| Version rules | §7 |
| Channels and updates | §8 |
| `MIN_APP_VERSION` | §9 |
| Store submission checklist | §10 |
| Review accounts | §11 |
| Screenshots and listing assets | §12 |
| Release smoke test | §13 |

## 2. The two apps

| | Resident app | Staff app |
| --- | --- | --- |
| Display name | Owner input (DOC-70 §2 row 7) | Owner input |
| Slug, EAS project | `rms-resident` | `rms-staff` |
| Directory, package | `apps/resident-app`, `@app/resident-app` | `apps/staff-app`, `@app/staff-app` |
| iOS bundle identifier, Android package | `<reverse-domain>.rms.resident` (DR-69) | `<reverse-domain>.rms.staff` |
| Development build identifier | `<reverse-domain>.rms.resident.dev` | `<reverse-domain>.rms.staff.dev` |
| URL scheme | `rms-resident://` | `rms-staff://` |
| `X-App-Id` | `resident` | `staff` |
| Users | Owners, family, tenants, helpers | Manager, Technician, Guard (the web CMS serves Admin and Manager) |
| First version | `1.0.0` | `1.0.0` |
| Owner of the store records | The company (DOC-70 §2 row 8) | The company |

The two apps are built, versioned and released **independently**: their `version`, runtime version, channels and store records never share a number (DR-167).

The development build has its own identifier (suffix `.dev`) so that a developer can keep the store app and the development client on one phone; it needs a third identifier in the Apple and Google accounts and, on iOS, the developer's device registered for internal distribution (`eas device:create`). **P1-17 checks** this against the EAS device-registration flow. The staging build uses the **production identifier** (DR-69: TestFlight and the Play internal track); a tester therefore cannot keep a staging and a production build side by side, which is accepted.

## 3. `app.config.ts`

One dynamic config per app reads the environment of §5 and nothing else. It is the only place an app's identity, native settings and runtime variables are set (Expo SDK 58, DOC-11 §6).

```ts
import type { ExpoConfig } from 'expo/config'

const APP_ENV = (process.env.APP_ENV ?? 'local') as 'local' | 'development' | 'staging' | 'production'
const API_BASE_URL = process.env.API_BASE_URL ?? 'http://localhost:3000/api/v1'
const ID = APP_ENV === 'local' || APP_ENV === 'development' ? '<reverse-domain>.rms.resident.dev' : '<reverse-domain>.rms.resident'

const config: ExpoConfig = {
  name: process.env.APP_DISPLAY_NAME ?? 'RMS Resident',
  slug: 'rms-resident',
  scheme: 'rms-resident',
  version: '1.0.0',                                  // bumped by hand, §7
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  newArchEnabled: true,                              // always on; the flag is ignored since React Native 0.82 (DOC-11 §6.1)
  runtimeVersion: { policy: 'appVersion' },          // DR-69, §7
  updates: {
    url: 'https://u.expo.dev/<eas-project-id>',
    checkAutomatically: 'ON_LOAD',
    fallbackToCacheTimeout: 0,                       // never block the first screen on the network
  },
  ios: {
    bundleIdentifier: ID,
    supportsTablet: false,                           // no iPad screenshots or layouts (§12)
    infoPlist: { ITSAppUsesNonExemptEncryption: false },
  },
  android: {
    package: ID,
    adaptiveIcon: { foregroundImage: './assets/adaptive-icon.png', backgroundColor: '#FFFFFF' },
    permissions: ['CAMERA', 'POST_NOTIFICATIONS'],   // the minimum; P1-17 confirms with `expo prebuild` output
  },
  locales: { vi: './locales/vi.json', en: './locales/en.json' },   // permission strings per language, §3.2
  plugins: [
    'expo-router',
    'expo-secure-store',
    ['expo-camera', { cameraPermission: false }],     // strings come from `locales`
    ['expo-image-picker', { photosPermission: false, cameraPermission: false }],
    ['expo-notifications', { defaultChannel: 'default' }],
    ['expo-build-properties', { android: { /* R8 keep rules, §3.3 */ } }],
  ],
  extra: { appEnv: APP_ENV, apiBaseUrl: API_BASE_URL, eas: { projectId: '<eas-project-id>' } },
}
export default config
```

### 3.1 Rules

- **`APP_ENV`, never `NODE_ENV`** (DOC-11 §6.4: Expo sets `NODE_ENV` from the command). The values are `local` (`bun run dev:resident`), `development`, `staging`, `production` (DR-69).
- **No secret in the config.** A bundle is public; `extra` holds the API base URL and the environment name only (DOC-41 §15).
- **`web` is not a target.** The apps have no web build; if `web.output` is ever set it is set explicitly (SDK 58 makes server output the default when it is unset, DOC-11 §6.4).
- **`X-App-Id` and `X-App-Version`** are derived from the slug and `version` by `@rms/mobile-core` (DOC-50 §5.1), not configured.
- **Icons, splash and the adaptive icon** come from the design owner (P0-02); the file names above are placeholders.

### 3.2 Permission strings (vi, en)

DR-69 asks for the permission strings in Vietnamese and English. They are shown by the operating system the first time a feature needs the permission, in the language of the device, so they live in the two `locales` files and are not part of the i18n catalog of the app. They are quoted exactly as the user will read them:

| Key (iOS `InfoPlist`) | Resident, `vi` | Resident, `en` |
| --- | --- | --- |
| `NSCameraUsageDescription` | Ứng dụng dùng camera để chụp ảnh yêu cầu hỗ trợ và giấy tờ xe. | The app uses the camera to take photos for your requests and vehicle papers. |
| `NSPhotoLibraryUsageDescription` | Ứng dụng cần truy cập ảnh để bạn đính kèm vào yêu cầu hoặc giấy tờ xe. | The app needs your photos so you can attach them to a request or to vehicle papers. |
| `NSPhotoLibraryAddUsageDescription` | Ứng dụng lưu mã QR của bạn vào thư viện ảnh. | The app saves your QR code to your photo library. |

| Key | Staff, `vi` | Staff, `en` |
| --- | --- | --- |
| `NSCameraUsageDescription` | Ứng dụng dùng camera để quét mã QR của cư dân và chụp ảnh công việc. | The app uses the camera to scan residents' QR codes and to take photos of work. |
| `NSPhotoLibraryUsageDescription` | Ứng dụng cần truy cập ảnh để bạn đính kèm vào công việc. | The app needs your photos so you can attach them to a job. |

The notification permission has no usage string on iOS (the system prompt is fixed); the app explains it on its own screen first (DOC-31). The localization mechanism (`locales` entries with the `InfoPlist` keys) and the plugin options set to `false` above are **P1-17 checks** against the Expo documentation on localizing the app and the SDK 58 plugin options; if a plugin insists on its own string, the plugin option carries the `vi` text and the `locales` file the `en` one.

### 3.3 Release-build settings that SDK 58 changes (DOC-11 §6.4)

| Setting | Rule |
| --- | --- |
| iOS scene lifecycle | Prebuild generates `SceneDelegate.swift`; the iOS 27 SDK requires it. **Do not hand-edit** `AppDelegate.swift` or the native folders: the apps are built from config plugins only (continuous native generation), and `ios/` and `android/` are not in Git |
| Android R8 | Enabled by default in release builds. Keep rules go through `expo-build-properties` for a library that uses reflection; the release smoke test (§13) is what finds a missing rule |
| `expo-notifications` | The foreground handler is set explicitly in code (the app decides per category); SDK 58 shows foreground notifications by default |
| `expo-file-system` | `File.write()` is asynchronous |
| Deep imports from `react-native/Libraries/*` | Type errors under the Strict TypeScript API; none are used |

## 4. EAS profiles and builds

`eas.json` in each app directory. The profiles are the three of DR-69 plus the development client:

```json
{
  "cli": { "version": ">= 25.2.0", "appVersionSource": "remote" },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal",
      "environment": "development",
      "env": { "APP_ENV": "development" }
    },
    "staging": {
      "distribution": "store",
      "channel": "staging",
      "environment": "preview",
      "autoIncrement": true,
      "env": { "APP_ENV": "staging" }
    },
    "production": {
      "distribution": "store",
      "channel": "production",
      "environment": "production",
      "autoIncrement": true,
      "env": { "APP_ENV": "production" }
    }
  },
  "submit": {
    "staging":    { "ios": { "ascAppId": "<app store connect id>" }, "android": { "track": "internal", "serviceAccountKeyPath": "./google-service-account.json" } },
    "production": { "ios": { "ascAppId": "<app store connect id>" }, "android": { "track": "production", "releaseStatus": "draft", "serviceAccountKeyPath": "./google-service-account.json" } }
  }
}
```

The structure (`build` profiles with `developmentClient`, `distribution`, `channel`, `env`, `autoIncrement`; `cli.appVersionSource`; `submit` with `ascAppId`, `track`, `serviceAccountKeyPath`) is the one in the EAS configuration reference read on 2026-10-20. Points to know:

- **`appVersionSource: remote`**: EAS holds the build number of iOS and the `versionCode` of Android and `autoIncrement` raises them on each build; nobody edits them by hand. The marketing `version` stays in `app.config.ts` (§7).
- **Staging builds are `store` distribution** so that they can go to TestFlight and the Play internal track (DR-69); the development profile is `internal` (an ad-hoc build for registered devices or an Android APK).
- **EAS environment names.** EAS Environment Variables use the environments `development`, `preview` and `production`; the profile `staging` therefore uses the environment `preview` (DR-167). **P1-17 checks** whether a custom environment named `staging` is available and, if it is, switches (the name is the only thing that changes).
- **Google service account key** `google-service-account.json` is a secret and is **not** committed; it is an EAS secret file used by `eas submit` (§5). The `track` of `staging` is `internal`; `production` submits as a **draft** to the production track, so a person releases it in the Play Console (a rollout step the Owner controls).

Commands (`eas-cli` 25.2.0, run with `bunx eas-cli@25.2.0`, DOC-69 §3):

```bash
cd apps/resident-app
bunx eas-cli@25.2.0 build --profile development --platform ios        # a development client (DOC-69 §10)
bunx eas-cli@25.2.0 build --profile staging --platform all            # TestFlight and Play internal candidates
bunx eas-cli@25.2.0 build --profile production --platform all
bunx eas-cli@25.2.0 submit --profile staging --platform ios --latest
bunx eas-cli@25.2.0 submit --profile production --platform android --latest
```

A build is started by a person or by `mobile-build.yml` (DOC-71 §2, `workflow_dispatch`), **never** by a push: a build takes minutes and uses EAS build credits. The result (the build page, the artifact) is recorded in the release record of §10.

## 5. Environment variables and credentials

### 5.1 Variables

| Variable | Set where | Values |
| --- | --- | --- |
| `APP_ENV` | `env` of the profile in `eas.json` | `development`, `staging`, `production` |
| `API_BASE_URL` | EAS Environment Variables, plain text visibility, per environment | `development`: `https://api-staging.<domain>/api/v1` (a development build normally talks to the local API; the developer overrides it with `.env.local`, DOC-69 §10); `preview`: `https://api-staging.<domain>/api/v1`; `production`: `https://api.<domain>/api/v1` |
| `APP_DISPLAY_NAME` | EAS Environment Variables | The company's display name (Owner input) |

Nothing here is a secret: a variable that an app reads at run time is in the bundle (DOC-41 §15). The values of `API_BASE_URL` are the ones of DOC-41 §15.

### 5.2 Credentials

| Credential | Where it lives | Held by | Notes |
| --- | --- | --- | --- |
| Apple Developer Program account, App Store Connect | Apple | The company (an Account Holder who is the Owner or a company officer) | Cannot be a developer's personal account (DOC-70 §2 row 8) |
| iOS distribution certificate and provisioning profiles | EAS credentials (managed) | EAS, created on the first build | `eas credentials` lists them; not exported unless the Owner decides to leave EAS |
| App Store Connect API key (for `eas submit`) | EAS credentials | The Owner creates it in App Store Connect with the *App Manager* role | Prefer it to an Apple ID password: no two-factor prompt in CI |
| Google Play Console account | Google | The company | A one-time registration fee applies; the Owner pays |
| Android upload keystore | EAS credentials (managed) | EAS | Play App Signing holds the app signing key; the upload key can be reset through Google, so losing it is recoverable |
| Google Play service account JSON | EAS secret file (`eas secret:create` with `--type file`; **P6-10 checks** the command name in `eas-cli` 25.2.0) | The Owner creates the service account with release permission on the two apps | Never in Git |
| Expo organization and `EXPO_TOKEN` | Expo; the token is the GitHub secret `EXPO_TOKEN` (DOC-71 §12) | The Owner owns the organization; a robot user with the `Developer` role owns the token | Rotated on staff change |
| FCM and APNs push credentials | §6 | | |

Apple and Google credentials are **never** in GitHub (DOC-71 §12); CI uses only `EXPO_TOKEN`.

## 6. Push credentials

The server sends push through the Expo Push API with `EXPO_ACCESS_TOKEN` (DR-52, DOC-41 §6); Expo then delivers through FCM (Android) and APNs (iOS), so each project needs credentials for both (DOC-70 §2 row 15).

| Platform | What the Owner provides | Where it goes |
| --- | --- | --- |
| Android | A Firebase project with Cloud Messaging; the **FCM v1 service account key** (JSON) | EAS credentials of each app (`eas credentials`, Android, push notifications) |
| iOS | An **APNs key** (`.p8`) from the Apple Developer account | EAS credentials of each app (managed by EAS when it creates the build, or uploaded) |
| Server | An Expo **access token** with push permission; "Enhanced Security for Push Notifications" on, so the Push API requires it | The host secret `expo-access-token` (DOC-70 §9.1) |

There are **separate push projects** for staging and production (DOC-07 §4.2: "a separate push project"): the staging build and the production build have different Expo projects only if their identifiers differ, which §2 says they do not; the separation is therefore at the **Firebase project and the Expo access token** level: staging uses one Firebase project and one token, production another, and each environment's host holds its own token. **P1-17 checks** that two EAS credential sets can be attached to one app by environment; if not, the staging build uses the production Firebase project and the server-side token is what separates the data (DR-167, open point).

A push token needs a **physical device**; a simulator has none (DOC-69 §10). The payload contains no personal text (DR-52).

## 7. Version rules

| Number | Meaning | Set by | Rule |
| --- | --- | --- | --- |
| `version` (in `app.config.ts`) | The app's semantic version `MAJOR.MINOR.PATCH`, the one users and stores see; sent as `X-App-Version` | A person, in the pull request | **Bump it whenever the native side changes** (a native module or SDK, a permission string, a plugin option, an icon). A JavaScript-only change does not bump it. A user-visible release bumps MINOR or PATCH as the Owner chooses |
| iOS build number, Android `versionCode` | One integer per binary | EAS (`appVersionSource: remote`, `autoIncrement`) | Never edited by hand |
| Runtime version | The compatibility key of updates | `runtimeVersion: { policy: 'appVersion' }` (DR-69) | Equals `version`; an update reaches only binaries with the same runtime version |
| Update group | One OTA publish | EAS | Printed in the CI job summary (DOC-71 §9.4) |

Rules:

1. **An OTA update never carries native changes.** With the `appVersion` policy the runtime version changes only when `version` changes, so forgetting the bump would let a JavaScript bundle that expects new native code reach an old binary. The pull-request checklist has a line for it (DOC-71 §11.3), and a reviewer treats a change to `package.json` dependencies of a native module, to `app.config.ts` plugins or to permission strings as a native change. A stricter policy (`fingerprint`) exists; it is not used (DR-69).
2. **The apps never share a number.** A resident release does not force a staff release.
3. **The API is compatible with every app version at or above `MIN_APP_VERSION`** (DOC-50 §16, DR-167): an endpoint a released app uses is not removed or changed incompatibly until that app version is below the minimum. Raising the minimum is the only way to retire one (§9).
4. A store build and the OTA updates that follow it are one release for the user; the release record (§10) lists the binary and the update groups together.

## 8. Channels and updates

| Channel | Binary | Published by | When |
| --- | --- | --- | --- |
| `staging` | Profile `staging` (TestFlight, Play internal) | `mobile-staging` job on a merge to `dev` (DR-239) that changes a mobile path (DOC-71 §9) | Every such merge |
| `production` | Profile `production` (the stores) | `mobile-production` job of a release, after the Owner approves (DOC-71 §7.4) | Every release tag whose mobile paths changed |

- A build is tied to its channel when it is built (`channel` in the profile); an update is published **to** a channel with `eas update --channel <name>` (DOC-71 §9.2). The runtime version keeps an update away from an incompatible binary (§7).
- `updates.checkAutomatically: ON_LOAD` and `fallbackToCacheTimeout: 0` (§3): the app starts with the bundle it has and downloads the new one in the background; the new bundle runs at the next start. A critical fix that must reach users at once is a raise of `MIN_APP_VERSION` after a store release, not an OTA trick.
- **Rollback** of an update: `eas update:republish` of the previous group onto the channel, or `eas update:rollback`; **P6-10 checks** both commands against `eas-cli` 25.2.0 (DOC-71 §7.6). A bad **binary** is replaced by a new build, never rolled back.
- Both channels keep **no more than 30 days** of update groups in the working set the Owner looks at; EAS keeps the rest (no purge is built).

## 9. `MIN_APP_VERSION` procedure (DR-69)

Purpose: retire an old app version that the API can no longer support, or force a fix. The server answers a call from a version below the minimum with **426 `upgrade_required`** and `details {minVersion, storeUrl}`; the app shows the update screen (UC-14 E6, DOC-50 §7 gate 5). The keys are `MIN_APP_VERSION_RESIDENT` and `MIN_APP_VERSION_STAFF` (DOC-41 §7); `GET /public/config` returns them (E-03) so an app can show the screen before a failing call.

| Step | Do | Check |
| --- | --- | --- |
| 1 | Release the new version to **both stores** (§10) and wait for the review | The version is live in the App Store and Google Play |
| 2 | Wait for adoption. Read `sum by (version) (rate(app_version_requests_total{app="resident"}[1d]))` in Grafana (the metric is proposed, DR-168) | At least **90 %** of the last day's requests come from the new version or later, and at least **7 days** have passed since the release (the iOS phased release lasts 7 days) |
| 3 | Announce in the app: a pinned notice (UC of notices) at least **7 days** before the change, wording "Please update the app before <date>" | The notice is published |
| 4 | Set the new minimum in `/opt/rms/env/app.env` (`MIN_APP_VERSION_RESIDENT=1.2.0`) and **redeploy the current tag** (`deploy.sh <current-tag>`: containers are recreated with the new environment; DOC-70 §6.5) | `deploy ok`; `GET /api/v1/public/config` shows `apps.resident.minVersion` `1.2.0` |
| 5 | Verify with an old build (a TestFlight build of the previous version): any call | 426 with the right `storeUrl` for its platform; the app shows the update screen |
| 6 | Watch `upgrade_required_total{app="resident"}` (DOC-50 §16) for a day | A bounded number that decays; the Manager hears from no one stranded (a resident who cannot update owns an old phone: see the Manager's script in DOC-103) |

Roll back by restoring the previous value and redeploying. The staff app is the same with its own key, and it is safe to raise sooner (staff are few and instructed by the Manager). The **web CMS has no minimum** (it is refreshed on every load; it sends no version, DOC-50 §5.1).

`MIN_APP_VERSION` is set in `app.env`, not in the database, so a change is a deploy and leaves a record in the deploy log (DOC-41 §2 rule 7).

## 10. Store submission checklist

The list a person ticks for each app and each store. A release record (a GitHub release note or a page the Owner keeps) holds the date, the version, the build numbers, the update groups and who approved. Values the Owner supplies are in DOC-70 §2.

### 10.1 Common

| # | Item | Done when |
| --- | --- | --- |
| 1 | Store records exist for both apps with the identifiers of §2 | The records are created in App Store Connect and Play Console |
| 2 | **Privacy policy URL**, **support contact**, **terms** (from P0-06) | URLs are live; the in-app text matches (DOC-35 §9) |
| 3 | Data disclosure forms | See 10.2 and 10.3 |
| 4 | Age rating and content questionnaire | Completed; no user-generated public content (tickets are private) |
| 5 | Review accounts and notes | §11 |
| 6 | Screenshots and listing text in Vietnamese (primary) and English | §12 |
| 7 | A **production** binary built from a tagged commit, installed from TestFlight or the Play internal track on two real devices; the smoke test of §13 passes | Written in the release record |
| 8 | The production API and the demo building are live and the review accounts sign in (DOC-103 pre-check) | Verified the day before submission |
| 9 | Export compliance: the app uses only the encryption of the operating system and HTTPS | `ITSAppUsesNonExemptEncryption: false` (§3); the store question is answered "No" |

### 10.2 App Store (iOS)

| # | Item |
| --- | --- |
| 1 | App Store Connect record: name, subtitle, primary language `vi`, category (Lifestyle for the resident app, Business for the staff app; the Owner decides), pricing Free |
| 2 | **App Privacy** details: contact info (name, phone number, email for staff), user content (photos in tickets), identifiers (device push token), diagnostics (client error reports); **not used for tracking**; linked to the user's identity |
| 3 | Screenshots: §12 |
| 4 | Review notes with the demo credentials (§11) and a sentence that the app needs the production demo building |
| 5 | TestFlight external testing is not required for a staging build; internal testers only (DR-69) |
| 6 | `eas submit --profile production --platform ios --latest`, then press *Add for review* in App Store Connect |
| 7 | Release method: manual, then **phased release** for automatic updates (7 days), so §9 step 2 has a ramp to watch |

### 10.3 Google Play

| # | Item |
| --- | --- |
| 1 | Play Console app record, default language `vi`, free app |
| 2 | **Data safety** form: same data types as 10.2 |
| 3 | App access: login required; the reviewer's credentials are given (§11) |
| 4 | Content rating questionnaire; target audience adults; ads: none |
| 5 | Screenshots, feature graphic and icon: §12 |
| 6 | `eas submit --profile production --platform android --latest` (a **draft** release, §4); in the Console choose a **staged rollout** (start at 20 %), then 100 % after 48 hours without a rise in `client_errors` |
| 7 | New personal Play developer accounts must run a closed test with testers for a period before production; a **company** account may not (the Owner's account type decides; **P6-10 checks** the current Google rule) |

## 11. Review accounts

The stores need a working login against the production backend (DR-60). Review accounts belong to the **demo building**, which exists in production and uses the fake payment driver, the fixed OTP and no SMS (DOC-36 §9, DR-37).

| App | Account | How the reviewer signs in |
| --- | --- | --- |
| Resident | `Store review` owner of `A-0101`, phone `+12025550108` | Phone `+12025550108` with the code `123456`. The phone field accepts any international number; the code is accepted only because the account is flagged `is_demo` (DR-37) |
| Staff | The demo Manager `manager@demo.rms.invalid` | Email and the password from the host secret `demo-staff-password` (`DEMO_STAFF_PASSWORD`, DOC-41 §6); the password is given **in the review notes only** and is changed after each review round (RB-12 style change of a host secret) |

Notes to paste in the review form:

```
This app is for residents of a managed apartment building and works only with accounts created by the building management.
Demo account (resident app): phone +1 202 555 0108, verification code 123456 (demo accounts accept this fixed code and send no SMS).
The demo data is reset every night at 04:00 Asia/Ho_Chi_Minh.
Payments in the demo use a simulated gateway; no real payment is made.
```

The staff notes say the same with the email and password and add: "Step-up actions (staff email change, payment gateway change) are disabled in the demo building." (DOC-36 §9.2.) The demo is reset every night; a review that spans the reset keeps working because the demo ids are fixed (DOC-36 §10.2). A reviewer who signs out and signs in after 04:00 signs in again with the same credentials.

## 12. Screenshots and listing assets

Specifications read on 2026-10-20 (Apple's App Store Connect reference and Google Play's graphic assets page); P6-10 re-reads them on the day it submits, because both change.

| Store | Required | Specification |
| --- | --- | --- |
| App Store, iPhone | At least one screenshot for an iPhone with Dynamic Island (medium display); up to 10 per size; JPEG or PNG; no alpha | Medium: 1179 × 2556 or 1206 × 2622 px (portrait). Large (optional): 1260 × 2736, 1290 × 2796 or 1320 × 2868 px; if absent, scaled ones are used |
| App Store, iPad | Not required: `supportsTablet: false` (§3) | |
| Google Play, phone | At least two screenshots across device types, up to 8 per type; JPEG or 24-bit PNG; each side 320 to 3,840 px and the long side at most twice the short side | For recommendation eligibility provide at least four at 1080 × 1920 px (9:16) or larger |
| Google Play, graphics | Feature graphic **1024 × 500 px**; app icon **512 × 512 px** 32-bit PNG up to 1,024 KB | |

The screens to capture (resident app: Home with fees due, a fee detail with the QR, a ticket, notices; staff app: Manager queue, Technician work, Guard scan screen), the text overlays and the languages are the design owner's (P0-02, DOC-53) and are made from the **demo building at its seed state** (never from real data). Every set is made in `vi` and in `en`. Source files are kept in the repository under `apps/<app>/store-assets/` (not in the app bundle).

## 13. Release smoke test

On two real devices (one iOS, one Android), with the **production profile build** installed from TestFlight or the internal track, before every store submission. R8 and the scene lifecycle (§3.3) are the reasons this is not skipped for a "small" release.

| # | Check | Expected |
| --- | --- | --- |
| 1 | Cold start; airplane mode then online | No crash; the offline banner then recovery |
| 2 | Resident: sign in with `+12025550108` and `123456`; switch unit (if two) | Home shows the unit; the previous unit's cached data is gone |
| 3 | Resident: open a fee, open the QR screen | The QR renders; brightness rises; renews before 15 minutes |
| 4 | Resident: take a photo for a ticket and send it | Upload succeeds (presigned `PUT`), thumbnail appears |
| 5 | Staff (Guard role account in the demo): scan a QR with the camera | A valid scan shows the unit; an old code shows "invalid code" with no personal data |
| 6 | Both: push token registered (a physical device) and a push received | The notification arrives and its tap opens the right screen (deep link `rms-resident://…`) |
| 7 | An OTA update published to `staging`, then the app restarted twice | The second start runs the new bundle; `expo-updates` reports the update id |
| 8 | An old build below the minimum, with a raised `MIN_APP_VERSION` on staging | 426 and the update screen with the correct store link |
| 9 | Release build only: every screen reached once with R8 on | No missing-class crash (a reflection-based library without a keep rule) |

The same flows exist as Maestro tests (DOC-88 §11, stage `mobile`); the manual run covers what a simulator cannot (camera, push, store install).

## 14. Sources read (2026-10-20)

Expo EAS: `eas.json` reference (profiles, `appVersionSource`, `autoIncrement`, `submit` fields), runtime versions (`appVersion` policy; the page shows it under a platform key, so a top-level `runtimeVersion` is **P1-17 checks**), the channel and `eas update --channel` model. Apple: App Store Connect screenshot specifications. Google Play: graphic asset requirements. DOC-11 §6 for the SDK 58 changes. Anything not covered by these sources is marked **P1-17 checks** or **P6-10 checks**.

## 15. Decisions made while writing

Every new decision in this document is recorded as a DR (decided, Claude delegated by the Owner).

| ID | Title | State | Where used |
| --- | --- | --- | --- |
| DR-167 | The two apps are built, versioned and updated independently, and the development client has its own `.dev` identifier; the `staging` profile uses the EAS environment `preview` unless a custom `staging` environment exists; staging and production push use separate Firebase projects and Expo access tokens; the API stays compatible with every app version at or above `MIN_APP_VERSION` | Decided | §2, §4, §6, §7 |
| DR-168 | The metric `app_version_requests_total{app,version}` (native apps only) measures adoption for the `MIN_APP_VERSION` procedure; owed to DOC-40 §4.1 and DOC-50 §16 | Decided | §9 |

## 16. Not in this document

| Topic | Lives in |
| --- | --- |
| The build and update jobs, `EXPO_TOKEN` | DOC-71 §9, §12 |
| Local development with a development build, `API_BASE_URL` for a device | DOC-69 §10 |
| The push contract and payload privacy | DR-52, DOC-31 |
| The app architecture, navigation, offline | DOC-55 |
| Tokens, components, icons | DOC-54 |
| The demo data and reset | DOC-36 §9, §10 |
| The final go-live checklist and UAT | DOC-103 |
| The version pins | DOC-11 §6 |

## 17. Traceability

| Section | Decisions | Requirements and tasks |
| --- | --- | --- |
| §2, §3 identity, config | DR-69, DR-82, DR-94 | P1-17 |
| §4, §5 profiles, credentials | DR-69, DR-83 item 9, DR-95 | P1-17, P6-10 |
| §6 push | DR-52, DR-58 | NFR-04; P1-17 |
| §7, §8 versions, channels | DR-69 | P1-17, P6-10 |
| §9 `MIN_APP_VERSION` | DR-69, DR-145 | FR-45; UC-14 E6; AG-07 |
| §10, §11, §12 stores, review accounts, screenshots | DR-60, DR-69 | P6-10 |
| §13 smoke test | DR-82 rule 5 | P6-10 |

## Open questions

- **App display names, store accounts, the Expo organization, the push credentials and the privacy-policy URL** are Owner inputs, decided as placeholders until the task that needs them (DR-228, Owner, 2026-10-21; DOC-70 §2, column *Blocking?*): `<app-name>` and `<reverse-domain>` until the first EAS build of P1-17; the Expo organization at P1-17; the Apple Developer account only for an iOS device build or a store build, the Google Play account only for the store build (P6-10), and the Android development build and the simulators need neither; the push credentials for the acceptance of P1-17 on a real device. The skeleton does not block on them.
- **P1-17 checks:** the `locales` mechanism for iOS permission strings and the plugin options set to `false`; whether a custom EAS environment `staging` exists; whether two push credential sets can be attached by environment (§6 fallback); a top-level `runtimeVersion` policy; the minimal Android permission list.
- **P6-10 checks:** `eas update:republish` and `eas update:rollback`; the command for a secret file; Google's testing requirement for the account type; the store screenshot rules on the day.
- **`app_version_requests_total`** (DR-168) and the `appId`/`appVersion` fields of the request line are owed to DOC-40 and DOC-42 §8.1 when those documents next change.
- Decisions made while writing: DR-167 and DR-168.
