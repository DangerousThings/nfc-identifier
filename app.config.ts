import { ExpoConfig, ConfigContext } from 'expo/config';

const IS_FDROID = process.env.FDROID === '1';

export default ({ config }: ConfigContext): ExpoConfig => ({
  name: 'DT NFC Transponder Identifier',
  slug: 'dt-nfc-transponder-identifier',
  version: '1.3.1',
  orientation: 'portrait',
  icon: './assets/icon.png',
  userInterfaceStyle: 'dark',
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
    versionCode: 18,
    adaptiveIcon: {
      foregroundImage: './assets/adaptive-icon.png',
      backgroundColor: '#000000',
    },
    package: 'com.dangerousthings.nfcidentifier',
    permissions: ['android.permission.NFC'],
    blockedPermissions: ['android.permission.ACTIVITY_RECOGNITION'],
  },
  plugins: [
    [
      'expo-splash-screen',
      {
        backgroundColor: '#000000',
      },
    ],
    [
      '@dangerousthings/react-native-nfc-manager',
      {
        nfcPermission:
          'This app uses NFC to scan transponders and identify compatible Dangerous Things implants.',
        // Every AID the detector SELECTs (`KNOWN_AIDS` in
        // src/services/nfc/commands.ts). iOS blocks a SELECT for any AID not
        // listed here, so anything missing is simply invisible on iPhone —
        // that's how FIDO2 went unreported. CoreNFC also runs a SELECT for
        // each entry, in this order, when a tag is discovered, so identity
        // AIDs come first and payment last; keep each AID 5–16 bytes.
        selectIdentifiers: [
          'A000000003000000', // GP Card Manager (ISD)
          'A000000151000000', // GP Security Domain (Fidesmo ISD)
          'A0000006472F0001', // FIDO2 / CTAP (spec AID)
          'A0000006472F000101', // FIDO2 — DT FIDO2.cap instance
          'A0000006472F0002', // FIDO U2F
          'D27600012401', // OpenPGP
          'D2760000850101', // NDEF Type 4 tag
          'A0000008466D656D6F727901', // JavaCard Memory
          'A0000005272101014150455801', // VivoKey OTP
          'A0000005272101', // OATH
          'A000000527200101', // YubiKey HMAC
          'A000000617020002000001', // Fidesmo App
          'A000000617020002000002', // Fidesmo Batch
          'A00000061702000900010101', // Fidesmo Platform
          'A000000308', // PIV
          '5361746F4368697000', // SatoChip
          '536565644B656570657200', // SeedKeeper
          'A0000008040001', // Keycard
          '325041592E5359532E4444463031', // PPSE
          'A0000000031010', // Visa
          'A0000000041010', // Mastercard
          'A0000000043060', // Maestro
          'A000000025010801', // American Express
          'A0000001523010', // Discover
        ],
        systemCodes: [],
      },
    ],
    [
      'react-native-edge-to-edge',
      {
        android: {
          parentTheme: 'Default',
          enforceNavigationBarContrast: false,
        },
      },
    ],
    'expo-status-bar',
    ...(IS_FDROID ? [] : ['expo-updates']),
  ],
  updates: IS_FDROID
    ? undefined
    : {
      url: 'https://u.expo.dev/7a861d96-e2ff-4bfd-92ec-f9e792d739e6',
      enabled: true,
    },
  runtimeVersion: IS_FDROID ? undefined : { policy: 'sdkVersion' as const },
  extra: {
    eas: {
      projectId: '7a861d96-e2ff-4bfd-92ec-f9e792d739e6',
    },
  },
});
