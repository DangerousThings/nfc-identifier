# Building from Source

## Prerequisites

- Node.js 20+
- Android SDK (API 36+, build-tools 36.0.0)
- JDK 17

## Android APK

```bash
npm install
ynpx expo prebuild --clean --platform android
cd android && ./gradlew assembleRelease
```

The APK will be at `android/app/build/outputs/apk/release/app-release.apk`.

## Development Build

```bash
npm install
npx expo prebuild --clean
npx expo run:android   # or npx expo run:ios
```

NFC cannot be tested in simulators. A physical device with NFC hardware is required.

## F-Droid

This project is structured for F-Droid inclusion:

- License: AGPL-3.0
- Metadata: `fastlane/metadata/android/en-US/`
- No proprietary SDKs or analytics
- Declared anti-feature: Tracking (UTM parameters on outbound product links)
- Version source: local (`app.json` versionCode)
