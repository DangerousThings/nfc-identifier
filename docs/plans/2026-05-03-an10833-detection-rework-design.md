# AN10833-Aligned Detection Rework — Design

**Date:** 2026-05-03
**Author:** ops@dangerousthings.com (with Claude)
**Status:** Design / pre-implementation
**Related:** AN10833 rev 3.9 (NXP, 2025-12-15)

## Goals

1. Distinguish **real MIFARE Classic** from **SmartMX / Plus EV1 / JCOP cards emulating Classic**, so users know whether xMagic-style cloning will actually work.
2. Distinguish **MIFARE DUOX** from DESFire EVx, and **NTAG X DNA** from NTAG 424 DNA (HW Major `0xA0`).
3. Identify **MIFARE 2GO** virtual cards (cloud-backed, never cloneable).
4. Replace ad-hoc Plus historical-byte heuristics with the AN10833-defined signatures (Figure 1, ISO 14443-4 leaves).
5. Restructure [src/services/detection/detector.ts](src/services/detection/detector.ts) so its shape mirrors AN10833 Figure 1 — auditable against the spec.
6. Refactor the matcher to be **capability-driven**, so future smart-card implants (DT roadmap) plug in by declaring capabilities, not by editing matcher logic.
7. Ship 100% via Expo Updates — no native module changes.

## Non-goals

- Implant detection logic (Spark, Spark 2, Apex, flexSecure, NTAG5 sensor probes, in-memory implant signatures) is out of scope. Those run *after* chip ID and don't change.
- ATQA-based identification stays explicitly de-emphasized; AN10833 §2.2 says don't trust it. We already mostly avoid this.
- Reading MIFARE Classic sectors on iOS — still impossible, still surfaced as a platform note.

## Current state vs AN10833 — gap analysis

| AN10833 element | Current handling | Gap |
|---|---|---|
| GetVersion byte 1 lower nibble (product family) | `desfire.ts` PRODUCT_TYPES checks 0x01/0x04/0x05/0x08 | ✅ correct, but only matches lower nibble accidentally because all current values have upper nibble `0x0` |
| GetVersion byte 1 **upper nibble** (native/SmartMX/JavaCard/2GO) | Not parsed at all | ❌ Missing — root cause of SmartMX-not-detected bug |
| GetVersion at Layer 3 on SAK 0x08/0x18 cards | Not attempted; we go straight to "Classic 1K/4K" | ❌ Missing — root cause of Plus EV1 SL1 misclassification |
| HW Major `0xA0` (DUOX vs DESFire, X DNA vs 4xx) | Not checked | ❌ Misclassified |
| MIFARE Plus historical-byte table (Figure 1, 5+ specific signatures) | Substring match on `"C1"` / `"80:02"` | ❌ Loose — e.g. confuses Plus SE 4K SL1 with Plus 2K SL1 |
| Multi-implementation SAKs (Table 5: 0x28/0x38/0x60/0x68/0x78) | Only 0x28 is recognized as DESFire+Classic | ❌ Partial |
| Bit-by-bit SAK decode (Figure 1 tree) | Sequential `if (sak === 0xXX)` checks | ❌ Hard to audit against spec |

## Design

### 1. Type taxonomy — hybrid (flat enum + composite implementation field)

Add to `ChipType`:

```typescript
// Genuinely-different products → first-class enum members
MIFARE_DUOX = 'MIFARE_DUOX',
NTAG_X_DNA = 'NTAG_X_DNA',
MIFARE_2GO = 'MIFARE_2GO',
MIFARE_PLUS_EV2 = 'MIFARE_PLUS_EV2',  // distinct from existing MIFARE_PLUS_EV1
```

Add to `Transponder`:

```typescript
/**
 * Implementation flavor for the chip's interface family.
 * `native` = real silicon of the named family (e.g. true MIFARE Classic 1K)
 * `smartmx_emulation` = SmartMX or Plus EV1 in SL1 emulating the family
 * `javacard_emulation` = JavaCard applet emulating the family
 * `mifare_2go_virtual` = MIFARE 2GO cloud-backed virtual instance
 */
implementation?: 'native' | 'smartmx_emulation' | 'javacard_emulation' | 'mifare_2go_virtual';

/**
 * Encoded GetVersion byte 1 upper nibble, if known. Source of truth for
 * `implementation`. Useful for debugging / display when implementation is
 * non-native.
 */
implementationByte?: number;
```

Why composite for emulation but flat for DUOX/X DNA/2GO:

- DUOX, X DNA, 2GO are products users buy as products. They deserve their own enum entry, their own product-matcher entry, their own UI label.
- SmartMX/Plus-EV1/JCOP-emulating-Classic are *labels on top of* an existing chip type. The Classic memory layout is real, the SAK is the same, our existing Classic handling code is correct — we just need to annotate "this is sitting on a smartcard substrate."

### 2. Orchestrator: SAK-bit decision tree

Replace the current sequential waterfall in `detector.ts` with a tree mirroring AN10833 Figure 1:

```
detectChip(rawData):
  if iso15693Tech: → detectIso15693Branch()
  if nfcBTech:     → ChipType.ISO14443B_UNKNOWN

  // ISO 14443-A path — decode SAK bit by bit
  switch on bit 6 (0x20) of SAK:
    bit6=0 (ISO 14443-3 only):
      switch on bit 4 (0x08):
        bit4=0:
          # Type 2 family — try Layer 3 GetVersion
          tryNtagGetVersion() → NTAG 21x / Ultralight EV1 / Ultralight AES / NTAG I2C
          if NAK: → MIFARE Ultralight (original) or NTAG_UNKNOWN
        bit4=1:
          # MIFARE Classic family — try Layer 3 GetVersion (NEW)
          tryClassicGetVersion():
            if answers and byte1 upper nibble = 0x8:
              → MIFARE Classic 1K/4K, implementation = 'smartmx_emulation'
              → if byte1 = 0x82 specifically: tag UI as "MIFARE Plus EV1 (SL1)"
            if answers and byte1 upper nibble = 0x9:
              → JCOP applet, implementation = 'javacard_emulation'
            if NAK:
              → real MIFARE Classic 1K/4K/Mini per SAK + size hint
    bit6=1 (ISO 14443-4 / T=CL):
      tryDesfireGetVersion() (Layer 4):
        if answers:
          decodeProductFamily(byte1.lowerNibble):
            0x1: DESFire family → check HW Major:
                   0xA0 → MIFARE_DUOX
                   else → DESFIRE_EV1/2/3 per existing map
            0x2: → MIFARE_PLUS_EV2 (distinct from EV1)
            0x4: NTAG DNA family → check HW Major:
                   0xA0 → NTAG_X_DNA
                   else → NTAG_413_DNA / 424_DNA / 424_DNA_TT per subtype
            0x7: → NTAG_I2C (per existing storage-size logic)
            0x8: → DESFIRE_LIGHT
          decodeImplementation(byte1.upperNibble):
            0x0: implementation = 'native'
            0x8: implementation = 'smartmx_emulation'
            0x9: implementation = 'javacard_emulation'
            0xA: if not DUOX/X DNA → implementation = 'mifare_2go_virtual', type = MIFARE_2GO
        if NAK:
          tryHistoricalBytePlusSignatures() → MIFARE Plus S/X/SE/EV1 by AN10833 table
          else → tryJavaCardCplc() → JCOP4 / JAVACARD_UNKNOWN
          else → ISO14443A_UNKNOWN
```

Each leaf calls a typed handler in the existing module (`ntag.ts`, `desfire.ts`, `javacard.ts`, `iso15693.ts`). The orchestrator becomes a **decision tree only** — no chip-specific decode lives there.

### 3. New module: `src/services/detection/getversion.ts`

Centralizes GetVersion-response parsing for both Layer 3 and Layer 4. One function, one source of truth:

```typescript
interface GetVersionDecoded {
  vendorId: number;
  productFamily: ProductFamily;       // from byte 1 lower nibble
  implementation: ImplementationKind; // from byte 1 upper nibble
  subtype: number;
  hwMajor: number;
  hwMinor: number;
  storageSize: number;
  protocol: number;
  raw: number[];
}

enum ProductFamily {
  DESFIRE = 0x1,
  PLUS = 0x2,
  ULTRALIGHT = 0x3,
  NTAG = 0x4,
  NTAG_I2C = 0x7,
  DESFIRE_LIGHT = 0x8,
}

enum ImplementationKind {
  NATIVE = 0x0,
  SMARTMX = 0x8,
  JAVACARD = 0x9,
  MIFARE_2GO = 0xA,
}

decodeGetVersion(bytes: number[]): GetVersionDecoded;
```

Both `detectNtag()` and `detectDesfire()` call this instead of re-parsing bytes. The new `tryClassicGetVersion()` flow also uses it.

### 4. MIFARE Plus historical-byte signatures

Add to `mifare.ts`:

```typescript
const PLUS_HISTORICAL_SIGNATURES: Array<{
  prefix: number[];           // exact bytes to match at start of historical bytes
  chipType: ChipType;
  securityLevel: 1 | 2 | 3;
  memoryK: 2 | 4;
  variant: 'S' | 'X' | 'SE';
}> = [
  // From AN10833 Figure 1, ISO 14443-4 leaves
  { prefix: [0xC1, 0x05, 0x2F, 0x2F, 0x90, 0x35, 0xC7], chipType: MIFARE_PLUS_X, securityLevel: 1, memoryK: 4, variant: 'X' },
  { prefix: [0xC1, 0x05, 0x2F, 0x2F, 0x91, 0x35, 0xC8], chipType: MIFARE_PLUS_X, securityLevel: 1, memoryK: 2, variant: 'X' },
  { prefix: [0xC1, 0x05, 0x2F, 0x2F, 0x00, 0x35, 0xC7], chipType: MIFARE_PLUS_SE, securityLevel: 1, memoryK: 4, variant: 'SE' },
  { prefix: [0xC1, 0x05, 0x2F, 0x2F, 0x01, 0x35, 0xC8], chipType: MIFARE_PLUS_SE, securityLevel: 1, memoryK: 2, variant: 'SE' },
  { prefix: [0xC1, 0x05, 0x2F, 0x2F, 0x0B, 0xC8, 0xC8], chipType: MIFARE_PLUS_SE, securityLevel: 1, memoryK: 2, variant: 'SE' },
  // EV1 variants — historical bytes start C105 2130 ...
  { prefix: [0xC1, 0x05, 0x21, 0x30, 0x0F, 0x8F, 0xD1], chipType: MIFARE_PLUS_EV1, securityLevel: 1, memoryK: 2, variant: 'X' },
  { prefix: [0xC1, 0x05, 0x21, 0x30, 0x1F, 0x8F, 0xD1], chipType: MIFARE_PLUS_EV1, securityLevel: 1, memoryK: 4, variant: 'X' },
];
```

Removed: the loose `historicalBytes.includes('C1')` check in `detectSakSwap`. That was producing false positives.

### 5. Multi-implementation SAK table (AN10833 Table 5)

| Resultant SAK | Implementations exposed |
|---|---|
| 0x28 | Classic 1K + DESFire |
| 0x38 | Classic 4K + DESFire |
| 0x60 | DESFire + ISO 14443-4 only |
| 0x68 | Classic 1K + DESFire + ISO 14443-4 |
| 0x78 | Classic 4K + DESFire + ISO 14443-4 |

Encoded as a small lookup in `mifare.ts` for `describeMultiImplementation(sak)`. Surfaced in detection metadata but doesn't change the `chipType` returned (we always pick the highest-fidelity implementation — DESFire wins because we can address it via ISO-DEP).

### 6. Capability-driven matcher refactor

Today `data/products.ts` has `compatibleChips: ChipType[]` per product. Replace with capability tags.

New types in `src/types/products.ts`:

```typescript
export type ChipCapability =
  // Interface shape
  | 'ntag-type2'
  | 'classic-emulation'      // exposes MIFARE Classic command set
  | 'desfire-emulation'      // exposes DESFire command set
  | 'iso15693-shape'
  | 'iso7816-substrate'      // can run JavaCard applets
  // Substrate
  | 'native-silicon'
  | 'smartcard-substrate'    // SmartMX / JCOP / Plus EV1
  // Sensor / I2C
  | 'i2c-sensor-bus'
  // Specific datapoints
  | 'aes-protected'
  | 'crypto1-only'
  | 'cloneable-via-magic';

export interface Product {
  id: string;
  name: string;
  // ... existing fields ...

  /** Capabilities this implant exposes — used for capability-driven matching */
  exposedCapabilities: ChipCapability[];

  /** Capabilities required of a source card for this product to be a meaningful suggestion */
  requiredSourceCapabilities?: ChipCapability[];
}
```

Each detected `Transponder` exposes a derived `capabilities: ChipCapability[]` field (computed from `type` + `implementation` + raw data). The matcher then picks products where every `requiredSourceCapabilities` entry is in the source's `capabilities`.

Worked example — user scans a SmartMX-emulating-Classic 1K:

- Detected: `type=MIFARE_CLASSIC_1K, implementation='smartmx_emulation'`
- Derived capabilities: `['classic-emulation', 'smartcard-substrate', 'iso7816-substrate']`
- Matches:
  - **xMagic** (`requires=['classic-emulation', 'cloneable-via-magic']`): partial match — `classic-emulation` present, but `cloneable-via-magic` is a property of the *destination*, not source. Adjusted: `requires=['classic-emulation']`. → matches with warning "source is on smartcard substrate; clone may not preserve issuer keys"
  - **Apex** (`requires=['iso7816-substrate']`): matches with warning "we can't detect the source card's applets, so functional parity isn't guaranteed"
  - **flexSecure** (`requires=['iso7816-substrate']`): matches with same warning

Future smart-card implants: declare `exposedCapabilities` and (if applicable) `requiredSourceCapabilities`. No matcher code changes.

### 7. Warning system extension

Add to `MatchResult`:

```typescript
interface ProductMatchWithWarnings {
  product: Product;
  warnings: MatchWarning[];
}

interface MatchWarning {
  severity: 'info' | 'caution' | 'warning';
  code: string;       // e.g. 'smartcard-substrate-uncertainty'
  message: string;
}

interface MatchResult {
  exactMatches: ProductMatchWithWarnings[];   // was Product[]
  cloneTargets: ProductMatchWithWarnings[];   // was Product[]
  familyMatches: ProductMatchWithWarnings[];  // was Product[]
  // ... rest unchanged
}
```

Existing warnings (`getMifareClassicCapacityWarning`, `getDesfireEvMismatchWarning`) move into a unified pipeline — the matcher returns `ProductMatchWithWarnings` and each warning function contributes 0 or more entries.

UI: results screen renders the existing warning chip pattern per warning. Severity controls color (cyan info / yellow caution / red warning).

### 8. Test fixtures

We have **zero detection tests today**. The restructure makes them necessary.

Create `src/services/detection/__fixtures__/` with one JSON file per real card we have:

```json
{
  "name": "real-mifare-classic-1k-blue-hotel-keycard",
  "rawData": {
    "uid": "AABBCCDD",
    "sak": 8,
    "atqa": "00:04",
    "techTypes": ["NfcA", "MifareClassic"]
  },
  "apduResponses": {
    "60": null  // GetVersion → no response (NAK) — confirms real Classic
  },
  "expectedDetection": {
    "type": "MIFARE_CLASSIC_1K",
    "implementation": "native",
    "confidence": "high"
  }
}
```

For ISO-DEP cards, `apduResponses` is keyed by hex APDU and value is hex response. The detector under test is invoked with a mock `sendIsoDepCommand` that looks up responses in the fixture.

Initial fixture set (need physical cards):
- Real MIFARE Classic 1K and 4K (NAK on GetVersion)
- SmartMX-emulating-Classic 1K and 4K (e.g. transit cards, hotel keys with smartcard backing)
- MIFARE Plus EV1 in SL1 (4K)
- DESFire EV2 / EV3 (each)
- DESFire Light
- NTAG 424 DNA (Spark 2 implant)
- MIFARE DUOX (if obtainable)
- NTAG X DNA (if obtainable)
- JCOP4 / J3R180 (Apex/flexSecure implants)
- NTAG213 / 215 / 216 (flexNT, xNT, etc.)
- NTAG5 Boost / Link (sensor implants)
- SLIX / SLIX2 (Spark 1)

Tests live in `src/services/detection/__tests__/detector.test.ts` using Jest. No native NFC required — pure data-driven.

## Implementation order (single OTA release)

The whole rework ships as **one OTA update** after all milestones land and fixtures pass. Milestones below are internal dev checkpoints — useful for reviewable PRs and a stable build at every commit — but users only see the change once, when the final OTA goes out.

| # | Milestone | Est | Notes |
|---|---|---|---|
| 1 | New types: `ChipType` additions, `implementation` field on `Transponder`, capability enums in `products.ts` | 0.5 day | Additive — no behavior change yet |
| 2 | New `getversion.ts` module + refactor `desfire.ts` and `ntag.ts` to use it | 1 day | Pure refactor — same outputs, fixtures lock in parity |
| 3 | Orchestrator restructure: replace `detector.ts` waterfall with SAK-bit tree | 1.5 days | Behavior should remain identical until later milestones; fixtures verify |
| 4 | Layer 3 GetVersion probe for SAK 0x08/0x18 (the SmartMX detection) | 0.5 day | First behavior change — sets `implementation` on Classic detections |
| 5 | Plus historical-byte signature table | 0.5 day | Replaces the loose substring match |
| 6 | DUOX / X DNA / 2GO detection (HW Major 0xA0 + upper nibble 0xA) | 0.5 day | New chip types start being returned |
| 7 | Capability-driven matcher refactor + product data migration | 1 day | Matcher now consumes `implementation` + capabilities |
| 8 | `MatchWarning` pipeline + UI integration | 0.5 day | Surfaces substrate-uncertainty warnings |
| 9 | Fixture infrastructure + first batch (5+ fixtures from cards on hand) | 0.5 day | Test-only, but blocks ship until green |
| 10 | Capture remaining fixtures from real cards | as cards available | Some (DUOX, X DNA, 2GO) may slip past ship — see Risks |

Total: ~6.5 dev days plus fixture capture. Recommended development pattern:

- Each milestone is its own PR onto a long-lived `an10833-rework` branch (not main).
- Branch must build, type-check, and pass tests at every PR merge.
- Final ship = merge `an10833-rework` → main → OTA push.
- If a milestone (e.g. #6 DUOX/X DNA) has no fixture by ship time, that branch ships behind a `__DEV__`-gated logging-only path (detect and log the upper-nibble 0xA case but return the conservative existing chip type). Flipping that gate later is a *single-line* code change and a second OTA — accepted cost.

## Expo Updates compatibility

Confirmed safe — no native module changes required:

- All work lives under `src/` (TypeScript only).
- `react-native-nfc-manager` already exposes the APIs we need (`NfcTech.IsoDep`, `NfcTech.NfcA`, `transceive` for Layer 3 commands on Android, `sendCommandAPDU` for ISO 7816 on iOS, `sendMifareCommand` for Classic on iOS).
- No new permissions, no new entitlements (we're already declared for ISO 7816 and ISO 15693 select identifiers).
- Type system additions are pure TypeScript — bundled into the JS output.
- Test fixtures and Jest tests don't ship to device.

The `expo-updates ~29.0.16` channel already configured in `app.json` and `eas.json` is the delivery mechanism. The whole rework ships as **one OTA push** at the end — no intermediate user-visible releases. This gives us:

- A single rollback point if a regression slips through.
- Internal consistency at the moment of release (no transient state where, say, the matcher knows about new capabilities but the detector hasn't been restructured yet).
- One round of user-visible behavior change to communicate, not ten.

### Release target: `beta` channel

Per [eas.json](eas.json), the `beta` channel feeds:

- `development`, `preview`, `preview-apk`, and `beta` build profiles
- `submit.beta` → Google Play **Internal** track

Production users on the `production` channel are unaffected by this rework until we explicitly promote it. F-Droid users get nothing (F-Droid builds exclude `expo-updates` per [app.config.ts](app.config.ts)) and will only see this change in the next full F-Droid release.

### Rollback plan

The OTA push command:

```bash
eas update --branch beta --message "AN10833 detection rework v1 — see docs/plans/2026-05-03-an10833-detection-rework-design.md"
```

**Pre-flight (must do before publishing):**

1. Capture the current "known-good" update group ID:
   ```bash
   eas update:list --branch beta --limit 1
   ```
   Record the `Update group ID` shown — this is our rollback target. Save it in [docs/plans/2026-05-03-an10833-detection-rework-design.md](docs/plans/2026-05-03-an10833-detection-rework-design.md) before pushing.

   **Pre-flight outcome (2026-05-10):** No prior OTA update existed on
   the `beta` branch — this rework is the first OTA. Rollback strategy
   therefore becomes "rollback to no update", which makes clients fall
   back to the JS bundle baked into their installed v1.2.0 APK.

2. Verify the build that will receive this OTA has runtime version compatible with SDK 54 (current). The `runtimeVersion: { policy: 'sdkVersion' }` setting means any beta-channel build on SDK 54 will pick this up.

**Rollback options, fastest first:**

- **Option 1 — `eas update:rollback` (preferred, ≤30 s):**
  ```bash
  eas update:rollback --branch beta
  ```
  EAS CLI prompts for the update to roll back from. The next time clients check for updates (next launch), they get the previous bundle. Effective immediately for new launches; users mid-session keep the broken bundle until they restart the app.

- **Option 2 — Republish the known-good update group:**
  ```bash
  eas update:republish --branch beta --group <known-good-group-id>
  ```
  Functionally equivalent; useful if `update:rollback` misbehaves or we need to roll back further than one revision.

- **Option 3 — Push an empty/no-op OTA that disables the new detector behind a kill switch.** Not recommended unless options 1 and 2 fail — requires landing a config-flag commit first, which means we have to plan the kill switch into the rework. **Decision: skip the kill switch.** Options 1 and 2 are sufficient for a beta-channel rollback, and a code-level kill switch adds dead-code complexity to a rework whose whole point is structural cleanup.

**Detection of regressions:**

- Beta-channel users are internal/QA only. We rely on direct reports rather than telemetry for the first 24–48 hours.
- The new orchestrator wraps each detection in try/catch (existing behavior preserved); if it throws unexpectedly, the result is `success: false` with an error string — same as today. So worst-case regression is "scan fails" rather than "app crashes."
- Before pushing, run the full fixture suite locally (`npm test`). Any fixture failure blocks the push.

**What can go wrong even with rollback:**

- A user who scanned a card during the broken window and saved the (incorrect) result locally will still see the bad result in their history — but we don't currently persist scan history, so this is moot.
- Updates only apply on next app launch. Users mid-scan when the rollback ships finish on the broken bundle.
- F-Droid users never got the bad bundle — they're naturally insulated.

## Risks

1. **iOS Layer 3 GetVersion on Classic-SAK cards.** Sending `[0x60]` to a tag that iOS has typed as MIFARE Classic may be gated by CoreNFC. If it returns "not supported" rather than a NAK, we'll need to interpret that as "real Classic, GetVersion unavailable" — same outcome but different error path. Fixture-test both Android and iOS responses.

2. **MIFARE 2GO virtual cards.** These are issued by NXP's Trusted Service Manager and behave like ephemeral DESFire/Plus instances on phones. Real-world prevalence in DT's user base is low, but a misclassification would have us suggesting Apex/flexSecure for a virtual transit card — wrong. The `0xA` upper nibble check is the gate.

3. **Real card fixtures.** Without DUOX, X DNA, or 2GO cards in hand, those branches are unverified. Phase 6 ships behind a logging-only path until fixtures arrive — i.e., we *detect and log* the upper nibble = 0xA case but still report the underlying chip type until we've validated the new types against a real card.

4. **Capability matrix completeness.** If a future implant has a capability we haven't named, we'll have to extend the enum and audit. Keep the enum small (~10 entries) and add as needed.

## Open questions for follow-up

- Specs for the new smart-card implants DT is releasing — when available, fold their `exposedCapabilities` declarations into Phase 7.
- Whether to surface the raw GetVersion bytes in the "Advanced" section of the results screen (debugging value vs UI noise).
- Whether `cloneabilityNote` should become structured (one-string note → list of `MatchWarning`-shaped entries) for consistency with the new warning pipeline. Probably yes, but separate cleanup.
