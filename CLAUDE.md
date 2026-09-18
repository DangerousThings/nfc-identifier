# CLAUDE.md - Project Intelligence for Dangerous Things NFC Identifier

## Project Overview

React Native app that scans NFC transponders and matches them to Dangerous Things implant products. Target users are prospective customers who want to know which implant can replace their existing cards/fobs.

## Critical Context

### NFC Detection Strategy

The app must identify transponders using a **waterfall detection approach**:

```
1. Read basic tag info (UID, ATQA, SAK for 14443-A)
2. Determine tag technology class
3. Run technology-specific identification:
   - NTAG: Send GET_VERSION (0x60) command
   - MIFARE Classic: SAK identifies 1K (0x08) vs 4K (0x18)
   - ISO 14443-4: Parse ATS/historical bytes, then:
     - DESFire: Check for DESFire ATS signature
     - MIFARE Plus: Check for Plus ATS signature
     - JavaCard: GET DATA for CPLC, probe known AIDs
   - ISO 15693: Get system info for SLIX identification
```

### Platform Differences

**Android** - Full access via `NfcA`, `NfcB`, `IsoDep`, `NfcV`, `MifareClassic` tech classes. Can send raw commands.

**iOS** - CoreNFC with `NFCISO7816Tag` and `NFCISO15693Tag`. Provides:
- `historicalBytes` (from ATS) - use for card platform identification
- `identifier` (UID)
- APDU commands via `sendCommand()`
- NO access to MIFARE Classic sectors (no crypto support)

**iOS MIFARE Classic limitation**: iOS cannot read MIFARE Classic as a distinct technology. It appears as an ISO 14443-3A tag. Detection relies on SAK value (0x08 or 0x18) but sector-level operations are Android-only.

### JavaCard (J3R180) Detection

For JCOP4/J3R180 identification:
1. Check `historicalBytes` for JCOP signatures (`4A434F50` = "JCOP")
2. GET DATA for CPLC: `80 CA 9F 7F 00`
3. Parse CPLC for IC fabricator (NXP = 4790), card type, OS ID
4. Probe AIDs for installed applets (user may provide DT-specific AIDs)

### Ultimate Gen4 (UG4) Magic Detection

Gen4 / GTU "Ultimate" magic tags emulate MIFARE Classic **or** Type 2
(NTAG / Ultralight) over ISO 14443-3A, and answer a vendor backdoor command
genuine chips do not:

```
CF <4-byte password> <cmd>
CF 00 00 00 00 C6   # get-configuration, factory-default password 00000000
```

The reader appends CRC_A, so on the air it is `CF 00 00 00 00 C6 <crc>`. A
genuine UG4 returns its config block; anything else NAKs / loses the tag. **Any
non-error response ⇒ UG4.** (Default-password probe only — a UG4 whose password
was changed answers nothing and is missed.)

**Probe: `src/services/detection/gen4.ts` → `probeGen4Ultimate()`.** Wired into
both the Type 2 branch (all three exits) and the plain-MIFARE-Classic path in
`detector.ts`, run **last** in each branch (a non-UG4 tag NAKs the unknown
command, which can halt it — do every other read first).

**The critical gotcha — send it on a *fresh* connection.** By the time a branch
probes, its own GET_VERSION / page reads have left the scan's NfcA connection
dirty, and the UG4 backdoor only answers on a clean connection:

- Reusing the scan connection (`sendType2Command`) → `TagLostException`.
- Bare `connect(['NfcA'])` on top of the still-open scan connection → native
  `transceive` reads a **null tech → NullPointerException (`String.hashCode`)**,
  which also corrupts native state and breaks the next SEND RAW until app
  restart.
- **Correct:** `NfcManager.close()` (drop the dirty connection) → `connect(['NfcA'])`
  → `transceive(CF…C6)` → `close()`. This is the same clean-connection state
  SEND RAW sends from, which is why SEND RAW worked while in-scan detection did
  not. iOS reuses its existing modal session (`sendType2Command`).

**Result surfacing:** a hit sets `cardModeInfo.modeType = 'ultimate_gen4'`
(supersedes the keyless SAK-mirror magic guess). The UI shows a yellow **`UG4`**
chip in the CHIP IDENTIFIED card (before the confidence chip), *not* the bottom
multi-mode container. The matcher (`matchChipToProducts`) short-circuits for a
UG4 and lists **only UG4 implants** — `dUG4T`, `flexUG4`, keyed on the
`Ultimate Gen4` feature string — skipping the emulated-chip matches.

### Raw command sending (SEND RAW) & fire-on-demand

`SEND RAW` (Settings → dev tool) and the UG4 probe both need to transceive to a
tag **already in the field, on demand** — not wait for a fresh tap. The plumbing:

- **Reader mode, not foreground dispatch.** Foreground dispatch lets the OS run
  its own NDEF check (a `READBLOCK` on the air) before the app sees the tag.
  Reader mode with `FLAG_READER_SKIP_NDEF_CHECK | FLAG_READER_NO_PLATFORM_SOUNDS`
  suppresses that and the scan chirp. Flags must cover every tech polled
  (`A|B|V`) or those tags stop being discovered.
- **Presence check.** `EXTRA_READER_PRESENCE_CHECK_DELAY` (`readerModeDelay`)
  defaults to 250 ms; on a Type 2 tag each presence check is an on-air `READ`,
  so one lands between `connect()` and the command. The **SEND RAW** session
  sets it to `0x7fffffff` (effectively off). The **normal scan keeps the
  default** — turning it off app-wide stops the scan from ever re-discovering a
  tag (`beginPresentTagSession`/`endPresentTagSession` in `NFCManager.ts` scope
  the presence-off session to the open dialog only; it is deliberately **not**
  app-wide).
- **Fire-on-demand primitive:** the DT fork
  (`@dangerousthings/react-native-nfc-manager`, vendored tgz) adds
  **`transceiveToPresentTag(bytes, tech = NfcA)`** = `connect([tech])` →
  `transceive` → `close`, connecting to the tag the reader session already
  discovered (`this.tag`) with no wait for a new discovery. `nfcManager.sendRawNfcA()`
  uses it on Android; iOS uses its modal per-send session. Updating the fork
  means bumping its version, `npm pack`, dropping the tgz in `vendor/`, and
  pointing `package.json` + `package-lock.json` at it (the other `@dangerousthings/*`
  packages resolve from local sources, so a full `npm install` fails — unpack
  the tgz over `node_modules/...` instead).

### Product Matching Logic

```typescript
interface Transponder {
  type: ChipType;
  subtype?: string;        // e.g., "NTAG215" vs "NTAG216"
  memorySize?: number;
  isCloneable: boolean;
  rawData: {
    uid: string;
    sak?: number;
    atqa?: string;
    ats?: string;
    historicalBytes?: string;
    cplc?: CPLCData;
  };
}

interface Product {
  id: string;
  name: string;
  compatibleChips: ChipType[];
  description: string;
  features: string[];
}
```

**Cloneable chips**:
- NTAG213/215/216 (data can be written to compatible implant)
- MIFARE Classic 1K/4K (requires key knowledge; Android only for sector ops)
- SLIX/SLIX2 (data can be written)

**Non-cloneable**: DESFire, MIFARE Plus, JavaCard (crypto prevents duplication)

When no match found, direct to: `dngr.us/conversion`

## Design System

Base theme on `/home/work/WebstormProjects/dt-shopify-storefront/app/styles/app.css`

### Colors (CSS variables → RN)
```typescript
const DTColors = {
  dark: '#000000',
  light: '#FFFFFF',
  modeNormal: '#00FFFF',      // Cyan - primary actions
  modeNormalSelected: 'rgba(0, 255, 255, 0.7)',
  modeEmphasis: '#FFFF00',    // Yellow - highlights
  modeEmphasisSelected: 'rgba(255, 255, 0, 0.7)',
  modeWarning: '#FF0000',     // Red - errors/warnings
  modeSuccess: '#00FF00',     // Green - success states
  modeOther: '#FF00FF',       // Magenta - misc
};
```

### Typography
- Primary font: "Tektur" (variable font, weights 100-900)
- Fallback: System default

### UI Patterns
- **Beveled corners**: Use `clip-path` equivalent or custom shapes
- **Cards**: Black background, colored borders, beveled bottom-right
- **Buttons**: Outlined with mode color, filled on hover/press
- **Emphasis**: Yellow for important actions, cyan for standard
- **Settings, to do**: present settings the NDEF Commander way, which MIDI Commander now follows too. The home screen's outlined `variant="other"` SETTINGS button should open a Settings screen (SETTINGS title, `DTSettingsPanel`, this app's motion-data consent and fixture-capture switches, BACK) instead of today's SETTINGS `DTModal` (decided 2026-09-15).

## Tech Stack Decisions

| Concern | Choice | Rationale |
|---------|--------|-----------|
| NFC | react-native-nfc-manager | Industry standard, good iOS/Android support |
| UI | React Native Paper | Material Design 3, easy theming |
| State | React Context | Simple app, no complex state needs |
| Navigation | React Navigation | Standard choice |
| Types | TypeScript strict | Prevent NFC data handling bugs |

## File Organization

```
src/
├── App.tsx                 # Entry point, providers
├── components/
│   ├── ui/                 # Themed RNP components
│   │   ├── DTCard.tsx
│   │   ├── DTButton.tsx
│   │   └── DTChip.tsx
│   ├── scan/               # Scan-related components
│   │   ├── ScanButton.tsx
│   │   └── ScanAnimation.tsx
│   └── results/            # Result display components
│       ├── TransponderInfo.tsx
│       ├── ProductMatch.tsx
│       └── NoMatchFound.tsx
├── screens/
│   ├── HomeScreen.tsx
│   ├── ScanScreen.tsx
│   └── ResultScreen.tsx
├── services/
│   ├── nfc/
│   │   ├── NFCManager.ts       # Wrapper around react-native-nfc-manager
│   │   ├── commands.ts         # APDU command builders
│   │   └── platforms.ts        # Platform-specific logic
│   ├── detection/
│   │   ├── detector.ts         # Main detection orchestrator
│   │   ├── ntag.ts             # NTAG identification
│   │   ├── mifare.ts           # MIFARE Classic/Plus/DESFire
│   │   ├── iso15693.ts         # SLIX detection
│   │   └── javacard.ts         # J3R180/JCOP detection
│   └── matching/
│       └── matcher.ts          # Product matching logic
├── data/
│   ├── products.ts             # Hardcoded product catalog
│   └── chipProfiles.ts         # Chip identification signatures
├── theme/
│   ├── colors.ts
│   ├── typography.ts
│   └── paperTheme.ts           # RNP theme configuration
├── types/
│   ├── nfc.ts                  # NFC-related types
│   ├── products.ts             # Product types
│   └── detection.ts            # Detection result types
├── hooks/
│   ├── useNFC.ts
│   └── useScan.ts
└── utils/
    ├── hex.ts                  # Hex string utilities
    ├── apdu.ts                 # APDU parsing utilities
    └── platform.ts             # Platform detection
```

## Development Phases (Context-Optimized)

### Phase 1: Foundation (Single Session)
**Goal**: Bootable app with theme and navigation
- Initialize RN project with TypeScript
- Install dependencies (RNP, react-native-nfc-manager, navigation)
- Create theme system from DT colors
- Set up basic navigation (Home → Scan → Results)
- Create placeholder screens

**Deliverable**: App runs on both platforms with DT styling

### Phase 2: NFC Infrastructure (Single Session)
**Goal**: NFC scanning works on both platforms
- Implement NFCManager wrapper
- Handle permissions (Android manifest, iOS entitlements)
- Create useScan hook with states (idle, scanning, success, error)
- Test basic tag detection (just read UID)

**Deliverable**: App can detect NFC tag presence

### Phase 3: Chip Detection - Basic (Single Session)
**Goal**: Identify common chip types
- Implement NTAG detection (GET_VERSION)
- Implement MIFARE Classic detection (SAK-based)
- Create detection result types
- Display raw detection results

**Deliverable**: App identifies NTAG and MIFARE Classic

### Phase 4: Chip Detection - Advanced (Single Session)
**Goal**: Full chip identification suite
- Implement ISO 14443-4 detection (DESFire, Plus)
- Implement ISO 15693 detection (SLIX)
- Implement JavaCard detection (CPLC + AID probing)
- Handle platform differences gracefully

**Deliverable**: App identifies all target chip types

### Phase 5: Product Matching (Single Session)
**Goal**: Match transponders to products
- Create product data structure
- Populate with DT product catalog
- Implement matching algorithm
- Create result UI components
- Add "no match" handling with conversion link

**Deliverable**: Full transponder-to-implant flow complete

### Phase 6: Polish (Single Session)
**Goal**: Production-ready UX
- Add scan animations
- Implement error handling UI
- Add educational chip info
- Test edge cases
- Performance optimization

**Deliverable**: App ready for release

## Common Patterns

### APDU Command Structure
```typescript
// Command APDU: CLA INS P1 P2 [Lc] [Data] [Le]
const GET_CPLC = [0x80, 0xCA, 0x9F, 0x7F, 0x00];
const SELECT_AID = (aid: number[]) => [0x00, 0xA4, 0x04, 0x00, aid.length, ...aid, 0x00];

// DESFire GET_VERSION (ISO-wrapped for cross-platform support)
// Response byte 3 = HW major: 0x00=EV0, 0x01=EV1, 0x10=EV2, 0x30=EV3
const DESFIRE_GET_VERSION = [0x90, 0x60, 0x00, 0x00, 0x00];
```

### Platform-Safe NFC Code
```typescript
import { Platform } from 'react-native';
import NfcManager, { NfcTech } from 'react-native-nfc-manager';

async function detectTag() {
  if (Platform.OS === 'ios') {
    // iOS: Use ISO 7816 for everything 14443-4
    await NfcManager.requestTechnology(NfcTech.Iso7816);
  } else {
    // Android: Can be more specific
    await NfcManager.requestTechnology([
      NfcTech.IsoDep,
      NfcTech.NfcA,
      NfcTech.MifareClassic,
    ]);
  }
}
```

### Error Boundaries for NFC
Always wrap NFC operations in try/catch. Common errors:
- Tag lost during read
- Unsupported tag type
- Permission denied
- NFC disabled on device

## Testing Notes

### Physical Test Cards Needed
- NTAG213, NTAG215, NTAG216
- MIFARE Classic 1K, 4K
- MIFARE DESFire EV1/EV2/EV3
- MIFARE Plus
- SLIX/SLIX2
- J3R180/JCOP4 card

### Simulator Limitations
NFC cannot be tested in simulators. Use physical devices only.

## Known Issues & Workarounds

1. **iOS MIFARE Classic**: Cannot do sector operations. Only detect via SAK, inform user of Android requirement for cloning.

2. **iOS Background Reading**: Not supported. App must be foregrounded.

3. **Android NFC Intent Handling**: May need to handle `onNewIntent` for tags scanned while app is open.

4. **react-native-nfc-manager quirks**: Always call `NfcManager.cancelTechnologyRequest()` in finally blocks.

## Reference Links

- [react-native-nfc-manager docs](https://github.com/revtel/react-native-nfc-manager)
- [NXP MIFARE product selector](https://www.nxp.com/products/rfid-nfc/mifare-hf:MIFARE)
- [ISO 14443 overview](https://www.iso.org/standard/73599.html)
- [JCOP CPLC parsing](https://www.openscdp.org/scripts/tutorial/emv/CPLC.html)
- [Dangerous Things conversion service](https://dngr.us/conversion)

## Commands

```bash
# Development
npm start                    # Start Metro bundler
npm run android              # Run on Android
npm run ios                  # Run on iOS

# Type checking
npm run typecheck            # Run TypeScript compiler

# Linting
npm run lint                 # ESLint
npm run lint:fix             # ESLint with auto-fix

# Testing (when tests exist)
npm test                     # Run Jest tests
```

## Environment Setup Checklist

### Android
- [ ] `android/app/src/main/AndroidManifest.xml` has NFC permissions
- [ ] Min SDK 21+ (for robust NFC support)
- [ ] NFC intent filters configured

### iOS
- [ ] NFC capability added in Xcode
- [ ] `NFCReaderUsageDescription` in Info.plist
- [ ] `com.apple.developer.nfc.readersession.iso7816.select-identifiers` for AID selection
- [ ] `com.apple.developer.nfc.readersession.iso15693.select-identifiers` for SLIX

## AID Reference (For JavaCard Profiling)

Dangerous Things may provide specific AIDs for their applets. Common AIDs:
```typescript
const KNOWN_AIDS = {
  // Global Platform Card Manager
  cardManager: [0xA0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00],

  // VivoKey-specific (placeholder - get actual AIDs from DT)
  // vivoKeyAuth: [...],
  // vivoKeyOTP: [...],

  // Standard applets
  openPGP: [0xD2, 0x76, 0x00, 0x01, 0x24, 0x01],
  fido: [0xA0, 0x00, 0x00, 0x06, 0x47, 0x2F, 0x00, 0x01],
};
```

## Conversation Starters for Future Sessions

When resuming work, start with:
1. "Continue from Phase N of the roadmap"
2. "The current blocker is..."
3. "Need to implement [specific detector/component]"

Always check `package.json` and run `npm install` if dependencies seem missing.

## Migrate to @dangerousthings/react-native (Monorepo)

The `react-native-dt-theme` package has been consolidated into the `dt-design-system`
monorepo and published to npm as `@dangerousthings/react-native` (v0.1.0).

**Full plan:** See `/home/work/dt-web-theme/MONOREPO_PLAN.md`

**Migration steps for this project:**

1. Update dependency in `package.json`:
   ```diff
   - "react-native-dt-theme": "^0.3.0"
   + "@dangerousthings/react-native": "^0.1.0"
   ```

2. Update all imports:
   ```diff
   - import { DTButton, DTCard, ... } from 'react-native-dt-theme';
   + import { DTButton, DTCard, ... } from '@dangerousthings/react-native';
   ```

3. Component names and props remain unchanged — this is a dependency swap only.

4. Run `npm install && npm run typecheck` to verify.

**Status:** Ready to migrate — packages are published on npm under `@dangerousthings` scope.
