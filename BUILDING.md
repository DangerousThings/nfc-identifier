# Building from Source

## Prerequisites

- Node.js 20+
- Android SDK (API 36+, build-tools 36.0.0)
- JDK 17

## Play Store Build (with OTA updates)

```bash
npm install
npx expo prebuild --clean --platform android
cd android && ./gradlew bundleRelease
```

The AAB will be at `android/app/build/outputs/bundle/release/app-release.aab`.

Play Store builds include `expo-updates` for over-the-air JS bundle updates. Updates are delivered via Expo's update service (`u.expo.dev`) in the background and applied on next app launch. Only JS/asset changes can be delivered this way — native changes still require a new binary submission.

## F-Droid Build (no OTA updates)

```bash
npm install
FDROID=1 npx expo prebuild --clean --platform android
cd android && ./gradlew assembleRelease
```

The APK will be at `android/app/build/outputs/apk/release/app-release.apk`.

Setting `FDROID=1` excludes `expo-updates` from the build entirely:
- The `expo-updates` native module is not linked
- No network calls to Expo servers
- No `NonFreeNet` anti-feature — the F-Droid build has no proprietary network dependencies
- All updates come through F-Droid's own repository

## Development Build

```bash
npm install
npx expo prebuild --clean
npx expo run:android   # or npx expo run:ios
```

NFC cannot be tested in simulators. A physical device with NFC hardware is required.

## F-Droid Compliance

This project is structured for F-Droid inclusion:

- License: AGPL-3.0
- Metadata: `fastlane/metadata/android/en-US/`
- No proprietary SDKs or analytics in F-Droid builds
- `expo-updates` excluded from F-Droid builds via `FDROID=1` env var
- Declared anti-feature: Tracking (UTM parameters on outbound product links)
- Version source: local (`app.config.ts` versionCode)

## Build Configuration

App configuration is in `app.config.ts` (dynamic Expo config). The `FDROID` environment variable controls build variants:

| Feature | Play Store | F-Droid |
|---|---|---|
| OTA updates | Yes (background) | No |
| expo-updates plugin | Included | Excluded |
| Expo server calls | u.expo.dev | None |
| Update delivery | Expo Update Service | F-Droid repo |
