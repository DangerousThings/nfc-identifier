# Non-NXP Detection Extension — Design

**Date:** 2026-05-10
**Author:** ops@dangerousthings.com (with Claude)
**Status:** Design / pre-implementation
**Depends on:** [2026-05-03 AN10833 detection rework](./2026-05-03-an10833-detection-rework-design.md) — must be merged to main before this extension lands.

## Goals

1. Correctly identify ST25 (TN, TA, TB, TV) and Infineon (my-d move, my-d Vicinity / SRF55V, SECORA / SLE77) chips that today fall through to `*_UNKNOWN`.
2. Feed those identifications into the AN10833 rework's capability-driven matcher so DT product suggestions work for users with non-NXP source cards.
3. Stay on the OTA-only, single-PR-onto-long-lived-branch ship pattern established by the AN10833 rework.

## Non-goals

- PM3-style probes, magic-card detection, sniff/replay. Out of scope.
- Crypto auth or memory dumping on these chips beyond what's needed for ID (e.g., we won't try to authenticate to ST25TA's signature command).
- Vendor-specific advanced diagnostics (NDEF parsing, CC parsing) past identification. Those can land later.
- iOS Type B parity with Android — surfaced as a known limitation, not closed.
- Apex variant discrimination (xSeries does not exist; Mega + 3× Flex variants are chip-identical and cannot be told apart in software).

## Structural fit

Per the "manufacturer-aware tree" decision: each leaf of the AN10833 SAK-bit tree gets a small UID-byte-0 dispatch added at the point where it currently returns `*_UNKNOWN`. The tree shape is unchanged; only the leaves grow.

```
typeTwo_layer3_NAK_leaf():
  switch(uidByte0):
    0x04: → existing path (Ultralight original / NTAG_UNKNOWN)
    0x02: → detectSt25TypeTwo()
    0x05: → detectInfineonMyd()
    default: → ISO14443A_TYPE2_UNKNOWN
```

Two new modules join the detection folder: `vendors/st25.ts` and `vendors/infineon.ts`. The 15693 branch gets the same dispatch pattern. `javacard.ts` already supports Infineon's CPLC fabricator code (`0x4090`); we just need to wire its result to `ChipType.INFINEON_SECORA`.

## Design

### 1. Type taxonomy additions

New `ChipType` enum members:

```typescript
ST25TN = 'ST25TN',                            // Type 2 family
ST25TA = 'ST25TA',                            // Type 4A
ST25TB = 'ST25TB',                            // Type B memory tag
ST25TV = 'ST25TV',                            // ISO 15693
ST_LRI = 'ST_LRI',                            // legacy ST 15693
INFINEON_MYD_MOVE = 'INFINEON_MYD_MOVE',      // Type 2 family
INFINEON_MYD_VICINITY = 'INFINEON_MYD_VICINITY', // ISO 15693
INFINEON_SRF55 = 'INFINEON_SRF55',            // ISO 15693 (legacy)
INFINEON_SECORA = 'INFINEON_SECORA',          // smartcard substrate
ISO14443A_TYPE2_UNKNOWN = 'ISO14443A_TYPE2_UNKNOWN', // narrowed unknown
```

Two new `ChipCapability` entries (others reused from AN10833 rework):

```typescript
| 'ndef-only-iso7816'   // ST25TA: speaks Type 4 SELECT, but only the NFC Forum
                        // NDEF Tag Application is available — NOT a JavaCard substrate
| 'type-b-shape'        // ST25TB: ISO 14443-3 Type B memory tag, no Type 4
```

`iso7816-substrate` keeps its existing meaning (full smartcard, can host applets). The split matters because the matcher should not suggest Apex/flexSecure for an ST25TA — that card cannot host arbitrary applets even though it speaks ISO 7816 SELECT.

### 2. Type 2 family detection (ST25TN + Infineon my-d move)

Lands at the `bit6=0, bit4=0, NAK on GetVersion` leaf — Type-2-shaped tags that didn't answer NXP's GetVersion command.

```typescript
// vendors/st25.ts
async function detectSt25TypeTwo(ctx: DetectionContext): Promise<Transponder | null> {
  if (ctx.uidByte0 !== 0x02) return null;
  const cc = await ctx.readType2Page(3);   // standard READ command 0x30
  if (!cc) return makeTransponder(ChipType.ST25_UNKNOWN_TYPE2, ctx);
  const subtype = classifyST25TypeTwoByCC(cc);
  return makeTransponder(ChipType.ST25TN, ctx, { subtype, ccBytes: cc });
}
```

Infineon dispatch follows PM3's UID-byte-1 upper-nibble logic ([cmdhf14a.c:2843](../../proxmark3/client/src/cmdhf14a.c#L2843)):

| `uid[1] & 0xF0` | Subtype |
|---|---|
| `0x10` | SLE 66R04/16/32P |
| `0x20` | SLE 66R01/16/32P (Type 2) |
| `0x30` | my-d move lean SLE 66R01P/PN |
| `0x70` | my-d move lean SLE 66R01L |
| (special) SAK `0x88` | Infineon MIFARE Classic 1K |

Identification uses standard NFC Forum Type 2 CC reads, not vendor-proprietary commands. The subtype lookup is a small static table keyed on `(uidByte0, uidByte1NibbleOrCcBytes)`. Future ST/Infineon Type 2 chips with unfamiliar CC values fall back to `ST25_UNKNOWN_TYPE2` / `INFINEON_MYD_UNKNOWN` rather than false-matching.

### 3. ISO 14443-4 path: ST25TA + Infineon SECORA/SLE77

Lands at the `bit6=1` (T=CL) branch's NAK leaf — `tryDesfireGetVersion()` got no response and `tryHistoricalBytePlusSignatures()` matched nothing.

**ST25TA — NDEF AID probe** (PM3-aligned, replaces speculative historical-byte signatures):

```typescript
const NDEF_T4T_AID = [0xD2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01];
const SELECT_NDEF_AID = [0x00, 0xA4, 0x04, 0x00, 0x07, ...NDEF_T4T_AID, 0x00];

async function detectSt25Ta(ctx: DetectionContext): Promise<Transponder | null> {
  if (ctx.uidByte0 !== 0x02) return null;
  const r = await ctx.sendIsoDep(SELECT_NDEF_AID);
  if (!isSuccess(r)) return null;
  const sysFile = await ctx.readNdefSystemFile();
  const subtype = classifyST25TaBySystemFile(sysFile);
  return makeTransponder(ChipType.ST25TA, ctx, { subtype, sysFileBytes: sysFile });
}
```

Concrete byte values for `classifyST25TaBySystemFile` come from datasheet + fixture verification.

**Infineon SECORA / SLE77** — extend existing `javacard.ts`. The current code already has Infineon CPLC fabricator code (`0x4090`) in [`IC_FABRICATORS`](../../src/services/detection/javacard.ts#L35-L42). The change is small: when the existing CPLC parser sees `icFabricator === 0x4090`, return `ChipType.INFINEON_SECORA` instead of leaving the chip type unset.

Active probe list for smartcard applet enumeration (kept small — each probe is a round-trip):

```typescript
const SMARTCARD_PROBE_AIDS = [
  { aid: [0xA0,0x00,0x00,0x01,0x51,0x00,0x00], name: 'GlobalPlatform Card Manager', kind: 'cardmanager' },
  { aid: [0xA0,0x00,0x00,0x00,0x03,0x00,0x00,0x00], name: 'Visa GP Card Manager', kind: 'cardmanager' },
  { aid: [0xA0,0x00,0x00,0x00,0x04,0x00], name: 'MasterCard Card Manager', kind: 'cardmanager' },
  { aid: [0xA0,0x00,0x00,0x08,0x46,0x00,0xCC,0x68,0xE8,0x8C,0x01,0x01], name: 'VivoKey Apex', kind: 'dt-product' },
  { aid: [0xA0,0x00,0x00,0x06,0x47,0x2F,0x00,0x01], name: 'FIDO2/U2F', kind: 'applet' },
  { aid: [0xD2,0x76,0x00,0x01,0x24,0x01], name: 'OpenPGP', kind: 'applet' },
];
```

PM3's `aidlist.json` is the consolidation source for the descriptions; the AIDs themselves come from primary specs (GP, EMV, NFC Forum) plus the VivoKey Apex AID. Header-comment attribution in `data/aids.ts` credits PM3 for the consolidation.

### 4. ISO 15693 + ISO 14443 Type B

**ISO 15693 — port PM3's UID-prefix-with-mask table** ([cmdhf15.c:103+](../../proxmark3/client/src/cmdhf15.c#L103)):

```typescript
const ISO15693_UID_SIGNATURES = [
  // ST (0x02) — from PM3 cmdhf15.c
  { prefix: [0xE0, 0x02, 0x23], chipType: ChipType.ST25TV, subtype: 'ST25TV02K-or-512' },
  { prefix: [0xE0, 0x02, 0x08], chipType: ChipType.ST25TV, subtype: 'ST25TV02KC-or-512C' },
  { prefix: [0xE0, 0x02, 0x35], chipType: ChipType.ST25TV, subtype: 'ST25TV04K-P' },
  { prefix: [0xE0, 0x02, 0x48], chipType: ChipType.ST25TV, subtype: 'ST25TV16K-or-64K' },
  { prefix: [0xE0, 0x02, 0x05], chipType: ChipType.ST_LRI, subtype: 'LRI64' },
  { prefix: [0xE0, 0x02, 0x44], chipType: ChipType.ST_LRI, subtype: 'LRIS64K' },
  // Infineon (0x05) — from PM3 cmdhf15.c, includes SRF55Vxx and SLE66r01P
  { prefix: [0xE0, 0x05, 0xA1], chipType: ChipType.INFINEON_SRF55, subtype: 'SRF55V01P-1k' },
  { prefix: [0xE0, 0x05, 0x40], chipType: ChipType.INFINEON_SRF55, subtype: 'SRF55V02P-2k' },
  { prefix: [0xE0, 0x05, 0x10], chipType: ChipType.INFINEON_SRF55, subtype: 'SRF55V10S-secure-10k' },
  { prefix: [0xE0, 0x05, 0x1E], chipType: ChipType.INFINEON_MYD_VICINITY, subtype: 'SLE66r01P-myd-move-NFC' },
  { prefix: [0xE0, 0x05, 0x20], chipType: ChipType.INFINEON_MYD_VICINITY, subtype: 'SLE66r01P-myd-move-NFC' },
];
```

After UID-prefix lookup, `GetSystemInformation (0x2B)` confirms memory size — but identification is decided by UID prefix. The full table from PM3 is ported wholesale; only ST25 and Infineon entries are shown above for brevity.

**ST25TB — chip-id-byte map** ([cmdhf14b.c:527+](../../proxmark3/client/src/cmdhf14b.c#L527)):

| chip-id byte | Model |
|---|---|
| `0x1B` | ST25TB512-AC |
| `0x33` | ST25TB512-AT |
| `0x3F` | ST25TB02K |
| `0x1F` | ST25TB04K |

Plus SRIxxx legacy: `0x3`→SRIX4K, `0x4`→SRIX512, `0x6`→SRI512, `0x7`→SRI4K, `0xC`→SRT512.

**iOS limitation surfaced, not closed**: CoreNFC Type B support is limited to ISO 7816-compliant Type B cards (Type 4B). Pure ISO 14443-3 Type B memory tags (ST25TB) may not be exposed by `react-native-nfc-manager`'s iOS binding. This branch is effectively Android-only until iOS support is verified — surfaced in detection metadata as `platformLimitation: 'ios-type-b-unsupported'`.

### 5. Capability mapping for new chips

| Chip type | Capabilities | Primary matcher target |
|---|---|---|
| `ST25TN` / `INFINEON_MYD_MOVE` (Type 2) | `ntag-type2`, `native-silicon` | xNT / flexNT / NExT (Type 2 cloning targets) |
| `ST25TA` (Type 4A) | `ndef-only-iso7816`, `native-silicon` | No direct DT clone target; informational only |
| `ST25TB` (Type B) | `type-b-shape`, `native-silicon` | No DT match; informational + iOS limitation note |
| `ST25TV` / `INFINEON_MYD_VICINITY` / `INFINEON_SRF55` (15693) | `iso15693-shape`, `native-silicon` | Spark 1 (SLIX-based) — with cross-family warning |
| `INFINEON_SECORA` / `SLE77` (smartcard) | `iso7816-substrate`, `smartcard-substrate` | Apex / flexSecure — with applet-enumeration-uncertain warning |

### 6. Apex matcher behavior

**Detection side: no changes.** Existing [`FIDESMO_PERSISTENT_TOTAL === 84336`](../../src/services/detection/javacard.ts#L58) check is correct. All Apex variants (Mega, Flex Narrow, Flex Spectrum, Flex Module) share the same chip configuration and cannot be discriminated in software.

**Matcher behavior on Apex detection:**
- **Identify what was scanned** → label it "Apex" (single name, no variant).
- **Similar / suggested products list** → enumerate all active Apex SKUs (Mega, Flex Narrow, Flex Spectrum, Flex Module) so the user can choose by form factor.

This is purely a `data/products.ts` + matcher tweak. No detection-side code changes.

### 7. New `MatchWarning` codes

Using the AN10833 rework's warning pipeline:

| Code | Severity | Fires when | Message |
|---|---|---|---|
| `cross-vendor-15693-family` | info | Source is ST25TV/Infineon-15693, target is Spark 1 | "Same RF protocol, different chip family — only feasible for UID-only or NDEF use cases." |
| `applet-enumeration-incomplete` | caution | SECORA/SLE77 detected but no DT-known applets responded | "Couldn't confirm what applets are on this card — recommendation assumes you need functional parity." |
| `vivokey-apex-detected` | info | Apex AID select succeeded AND `persistentTotal === 84336` | "This card already runs the VivoKey Apex applet — Apex implant is a direct functional match." |
| `ios-type-b-unsupported` | warning | ST25TB on iOS | "iOS doesn't fully support this card type — try with an Android device." |

The Apex-detected case is the most interesting outcome: it's the one branch where probing actually unlocks a *better* match than substrate-only inference.

## Implementation order (single OTA release)

| # | Milestone | Est | Notes |
|---|---|---|---|
| 1 | New `ChipType` enum members + 2 new capabilities (`ndef-only-iso7816`, `type-b-shape`) | 0.5d | Additive — no behavior change yet |
| 2 | Type 2 NAK-leaf: UID-byte-0 dispatch + `vendors/st25.ts` + `vendors/infineon.ts` | 0.5d | First behavior change |
| 3 | ISO 14443-4 NAK-leaf: ST25TA via NDEF AID select + system-file read | 0.5d | New behavior |
| 4 | Type B leaf: ST25TB chip-id-byte map + iOS limitation surfacing | 0.5d | Android-only |
| 5 | ISO 15693 UID-prefix table extension (port from PM3 cmdhf15.c) | 0.5d | Extends existing iso15693.ts |
| 6 | Wire Infineon `0x4090` CPLC result to `ChipType.INFINEON_SECORA` | 0.25d | Tiny — fabricator already in table |
| 7 | Matcher: capability map for new chips + Apex family behavior + new warnings | 0.5d | data/products.ts + matcher.ts |
| 8 | Fixtures captured + tests green | as captures complete | Blocks ship |

Total: ~3.25 dev days plus fixture capture.

**Branch / release pattern** mirrors the AN10833 rework exactly:
- Long-lived branch `non-nxp-detection-extension`, one PR per milestone, builds + types + fixtures green at every merge.
- Final ship = merge → main → `eas update --branch beta`.
- Rollback: `eas update:rollback --branch beta` (preferred) or `eas update:republish` to known-good group ID. No kill-switch.
- F-Droid users unaffected until next full F-Droid release.

## Test fixtures

Uses the AN10833 rework's existing infrastructure (`fixtureRecorder.ts` + `__fixtures__/`). One JSON fixture per physical sample:

| Chip family | Min fixtures | Notes |
|---|---|---|
| ST25TN | 1+ | Type 2; locks CC byte interpretation |
| ST25TA | 1+ | Captures NDEF AID select success + system file bytes |
| ST25TB | 1+ | Android-only fixture; iOS path stays in `platformLimitation` |
| ST25TV | 1+ | ISO 15693 UID prefix verification |
| Infineon my-d move | 1+ | UID byte 1 upper-nibble verification per PM3 logic |
| Infineon SECORA / SLE77 | 1+ | CPLC `0x4090` verification + AID probe responses |
| Infineon my-d Vicinity / SRF55V | If available | Nice to have, not blocking |

All four families confirmed available — no logging-only gates needed. All branches ship in the final OTA.

## Risks

1. **iOS Type B unsupported** — surfaced as `platformLimitation: 'ios-type-b-unsupported'`. Not a blocker; UX hint only.
2. **VivoKey Apex AID false-positive** — `A00000084600CC68E88C0101` selecting successfully on a non-Apex card would mis-suggest Apex. The existing `persistentTotal === 84336` fingerprint mitigates this — Apex matching requires *both* the AID hit AND the storage match.
3. **PM3 attribution** — the ISO 15693 UID-prefix table is the largest PM3-derived asset. Data is factually public (vendor IC-reference codes from datasheets), but worth a header comment in `iso15693.ts` crediting PM3's `cmdhf15.c` as the consolidation source.
4. **AN10833 rework slips** — this extension slips with it. Hard dependency.

## Open questions for follow-up

- iOS Type B support: revisit once `react-native-nfc-manager` exposes a stable Type B path.
- Infineon my-d Vicinity fixtures if obtainable.
- Whether ST25TA results should optionally surface NDEF-record content in the "Advanced" section (debugging value vs UI noise).
- Whether to extend SECORA-substrate detection with additional vendor-specific applet AIDs as DT publishes them.
