import {ExpoConfig, ConfigContext} from 'expo/config';

const IS_FDROID = process.env.FDROID === '1';

export default ({config}: ConfigContext): ExpoConfig => ({
  name: 'DT NFC Transponder Identifier',
  slug: 'dt-nfc-transponder-identifier',
  version: '1.0.0',
  orientation: 'default',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
  newArchEnabled: true,
  splash: {
    backgroundColor: '#000000',
  },
  ios: {
    supportsTablet: false,
    bundleIdentifier: 'com.dangerousthings.nfcidentifier',
    infoPlist: {
      NFCReaderUsageDescription:
        'This app uses NFC to scan transponders and identify compatible Dangerous Things implants.',
      ITSAppUsesNonExemptEncryption: false,
    },
  },
  android: {
    versionCode: 11,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#000000',
    },
    package: 'com.dangerousthings.nfcidentifier',
    permissions: ['android.permission.NFC'],
  },
  plugins: [
    [
      'react-native-nfc-manager',
      {
        nfcPermission:
          'This app uses NFC to scan transponders and identify compatible Dangerous Things implants.',
        selectIdentifiers: [
          'A0000000030000',
          'D27600012401',
          'A0000006472F0001',
        ],
        systemCodes: [],
      },
    ],
    ...(IS_FDROID ? [] : ['expo-updates']),
  ],
  updates: IS_FDROID
    ? undefined
    : {
        url: 'https://u.expo.dev/7a861d96-e2ff-4bfd-92ec-f9e792d739e6',
        enabled: true,
      },
  runtimeVersion: IS_FDROID ? undefined : {policy: 'sdkVersion' as const},
  extra: {
    eas: {
      projectId: '7a861d96-e2ff-4bfd-92ec-f9e792d739e6',
    },
  },
});
