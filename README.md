# Dangerous Things NFC Identifier

Scan any NFC transponder with your phone and find out which [Dangerous Things](https://dangerousthings.com) implant is compatible with it. If your card or fob can be replaced with an implant, this app will tell you which one.

## What It Does

1. **Scan** - Hold your phone to any NFC card, fob, or tag
2. **Identify** - The app detects the exact chip type (NTAG, MIFARE Classic, DESFire, etc.)
3. **Match** - See which Dangerous Things implant products are compatible
4. **Learn** - Get details about the chip, cloneability, and implant options

## Supported Chip Types

| Chip Family | Types Detected |
|---|---|
| **NTAG** | NTAG213, NTAG215, NTAG216, NTAG I2C |
| **NTAG DNA** | NTAG 413 DNA, NTAG 424 DNA, NTAG 424 DNA TT |
| **MIFARE Classic** | Classic 1K, Classic 4K, Classic Mini |
| **MIFARE DESFire** | EV1, EV2, EV3, DESFire Light |
| **MIFARE Ultralight** | Ultralight, Ultralight C, EV1, Nano, AES |
| **MIFARE Plus** | Plus S, Plus X, Plus SE, Plus EV1 |
| **ISO 15693** | ICODE SLIX, SLIX2, SLIX-S, SLIX-L, NTAG 5 |
| **JavaCard** | JCOP4 / J3R180 (Apex, flexSecure) |

## Implant Products

The app matches scanned chips to current Dangerous Things products including:

- **xNT** / **flexNT** - NTAG216 NFC implants
- **xSIID** / **NExT v2** - NTAG I2C with LED
- **NExT** / **dNExT** - Dual-frequency (NFC + 125kHz)
- **xMagic** / **xM1** / **flexM1 v2** - Magic MIFARE Classic (cloneable UID)
- **flexUG4** / **dUG4T** - Ultimate Gen4 magic MIFARE
- **xDF3** / **flexDF2** - DESFire secure NFC
- **Apex Flex** / **flexSecure** - JavaCard secure element
- **VivoKey Spark 2** - Cryptobionic identity
- **xSLX** - ICODE SLIX NFC Type 5

If no matching implant is found, the app directs you to the [Dangerous Things conversion service](https://dngr.us/conversion).

## Platform Notes

- **Android** - Full chip detection support including MIFARE Classic sector operations
- **iOS** - Full detection for most chip types. MIFARE Classic is detected but sector-level cloning operations require Android

## Building From Source

Requires Node.js 20+ and the React Native development environment.

```bash
npm install
npx expo prebuild

# Android
npx expo run:android

# iOS
cd ios && pod install && cd ..
npx expo run:ios
```

NFC cannot be tested in simulators. A physical device is required.

## License

Copyright Dangerous Things LLC. All rights reserved.
