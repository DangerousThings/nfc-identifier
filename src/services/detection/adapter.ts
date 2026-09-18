/**
 * identify() adapter + DT enrichment
 *
 * Bridges the DT fork's library identification result
 * (`NfcManager.identify()` → a library `Transponder`) to the app's own
 * `Transponder` shape (see `src/types/detection.ts`), and re-homes the DT
 * product ENRICHMENT the old `detector.ts` used to run on every result.
 *
 * Two layers:
 *
 *  1. {@link libToAppTransponder} — the pure, side-effect-free base mapping
 *     from the library's base transponder onto the app interface (chip type,
 *     raw data, cloneability, the UG4/magic hook the matcher keys off).
 *
 *  2. {@link enrich} — the DT layer, run while the LIVE library transponder
 *     (with its bound transport) is still in hand. Fills the optional DT
 *     fields the base map leaves empty:
 *       - PURE: `dtProduct` / `implantName` / `productKind` from the ATS
 *         historical-byte signature; `capabilities` from all of the above.
 *       - LIVE (Type 2): the NTAG implant-name-in-memory read, re-homed onto
 *         the library transponder's `readUserMemory()`.
 *       - LIVE (ISO-DEP): version + implementation substrate, JavaCard payment
 *         (PPSE) + storage, the DESFire / MIFARE Plus credential sweep, DESFire
 *         app enumeration, and the Spark 2 / NDEF implant name — all re-homed
 *         onto the library's `sendApdu` / `isoGetVersion` / `enumerateApps` in
 *         {@link enrichIsoDep} (see `dtEnrich.ts`).
 *
 *       - LIVE (NfcV / ISO 15693): NTAG5 VK Thermo product naming (AFI/DSFID
 *         from GET_SYSTEM_INFO) and the ISO 15693 Spark 1 implant name (NDEF
 *         vivokey.co URL), re-homed onto the library's `getSystemInfo` /
 *         `readSingleBlock` in {@link enrichNfcV} (see `dtEnrich.ts`). The
 *         NTAG5 sensor *temperature* / Temptress reads are a flagged FORK GAP
 *         (they need NXP custom commands the library does not expose).
 *
 * Remaining library command-surface GAPS are flagged inline in `dtEnrich.ts`
 * with `FORK GAP:` — chiefly that `DesfireTransponder` drops the GET_VERSION
 * implementation nibble (forcing a re-issue of GET_VERSION), and that the
 * library's ISO-DEP waterfall never runs its JavaCard ISD/applet probe for a
 * card it already typed as DESFire (so a JavaCard emulating DESFire has to be
 * re-probed here over `sendApdu`).
 */

import {Platform} from 'react-native';
import NfcManager from '@dangerousthings/react-native-nfc-manager';
// Transponder types, the `IsoDepTransponder` base class (needed for
// `instanceof`), and the `identify()` options all come from the standalone,
// side-effect-free `@dangerousthings/transponders` package. See `dtEnrich.ts`
// for the same pattern.
import {
  type IdentifyOptions,
  type Transponder as LibTransponder,
  IsoDepTransponder,
} from '@dangerousthings/transponders';

import {
  CHIP_CLONEABILITY,
  CHIP_MEMORY_SIZES,
  CHIP_NAMES,
  ChipFamily,
  type Transponder,
} from '../../types/detection';
import {deriveCapabilities} from './capabilities';
import {matchDtHistoricalSignature} from './dtproducts';
import {enrichIsoDep, enrichNfcV, matchImplantNameInBytes} from './dtEnrich';

/**
 * Format a byte array as colon-separated, upper-case hex — the string form the
 * rest of the app (raw-data display, matcher, DT signature matching) expects
 * for `rawData` fields (matches `NFCManager.bytesToHex`). Returns `undefined`
 * for a missing or empty array so optional fields stay absent rather than `''`.
 */
function bytesToHex(bytes?: number[]): string | undefined {
  if (!bytes || bytes.length === 0) {
    return undefined;
  }
  return bytes
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

/**
 * Normalise the library's ATQA byte order to the app's big-endian convention.
 *
 * ATQA endianness (Task-3 flag #3): `NfcManager.identify()` builds its transport
 * from `getTag()` and passes the tag's `atqa` through verbatim — no reversal
 * (see the fork's `tagToTransport`). On Android that `atqa` is `NfcA.getAtqa()`,
 * which returns SENS_RES **little-endian** (e.g. `[0x04, 0x00]` for ATQA
 * `0x0004`); the fork's own magic integration test carries exactly that raw
 * order. The app's display/heuristic convention is **big-endian** — the old
 * `NFCManager.parseAtqa` reversed the Android bytes to produce "00:04". So we
 * reverse here on Android to keep that convention (iOS/CoreNFC does not surface
 * ATQA, so this path is Android-only in practice).
 */
function normalizeAtqa(
  atqa: number[] | undefined,
  platform: 'ios' | 'android',
): number[] | undefined {
  if (!atqa || atqa.length === 0) {
    return undefined;
  }
  return platform === 'android' ? [...atqa].reverse() : atqa;
}

/**
 * Map a library `Transponder` onto the app's `Transponder` shape.
 *
 * Split out from {@link identifyTransponder} so it can be unit-tested against
 * hand-built library transponders without touching native NFC. This is the pure
 * base mapping only — the DT layer is applied by {@link enrich}.
 */
export function libToAppTransponder(
  lib: LibTransponder,
  opts?: IdentifyOptions,
): Transponder {
  const chip = lib.chip;
  const cloneability = CHIP_CLONEABILITY[chip];
  const platform = opts?.platform ?? (Platform.OS as 'ios' | 'android');

  const transponder: Transponder = {
    type: chip,
    family: lib.family,
    chipName: CHIP_NAMES[chip] ?? String(chip),
    isCloneable: cloneability?.cloneable ?? false,
    cloneabilityNote: cloneability?.note,
    memorySize: CHIP_MEMORY_SIZES[chip],
    rawData: {
      uid: bytesToHex(lib.uid) ?? '',
      sak: lib.sak,
      atqa: bytesToHex(normalizeAtqa(lib.atqa, platform)),
      ats: bytesToHex(lib.ats),
      historicalBytes: bytesToHex(lib.historicalBytes),
      // The library transponder does not surface the platform tech-type list;
      // useScan still carries the raw scan's techTypes separately. Left empty
      // here and flagged for Task 5.
      techTypes: [],
    },
    // The library does not (yet) express a chip-identification confidence.
    // Default to 'high' — the library's waterfall is authoritative when it
    // names a chip. Flagged for Task 5 to thread a real confidence through.
    confidence: 'high',
    detectedOn: platform,
  };

  // UG4 / magic surfacing. Per CLAUDE.md, a Gen4 ("Ultimate") magic hit sets
  // cardModeInfo.modeType='ultimate_gen4'; the matcher short-circuits on this
  // to list only UG4 implants. Only mapped when the library ran its magic
  // sweep (probeMagic) and bound a gen4 handle. Other magic gens are left
  // unmapped (not mapped here to avoid inventing product behaviour).
  if (lib.magic?.gen === 'gen4') {
    transponder.cardModeInfo = {
      hasMultipleModes: true,
      modeType: 'ultimate_gen4',
      confidence: 'high',
      description:
        'Ultimate Magic (Gen4) tag — answered the vendor backdoor command.',
      notes: [lib.magic.label].filter(Boolean),
    };
  }

  return transponder;
}

/**
 * Re-home the NTAG implant-name-in-memory read onto the library transponder's
 * `readUserMemory()`.
 *
 * The old detector read the last user-memory pages via a Type 2 `READ` and
 * scanned the ASCII for a DT implant name. `readUserMemory()` dumps the whole
 * user area (sector-aware) — a superset — so we flatten it and run the same
 * pure name match. Best-effort: a tag-lost / unsupported read yields no name.
 */
async function readNtagImplantName(
  lib: LibTransponder,
): Promise<string | undefined> {
  try {
    const sectors = await lib.readUserMemory();
    const bytes = sectors.flatMap(s => s.blocks.flatMap(b => b.bytes));
    return matchImplantNameInBytes(bytes);
  } catch (e) {
    console.warn('[adapter] NTAG implant-name read failed:', e);
    return undefined;
  }
}

/**
 * Apply the DT enrichment layer to an app `Transponder`, using the LIVE library
 * transponder (with its bound transport + already-probed data) still in hand.
 * Mutates `app` in place.
 *
 * The ISO-DEP DT probes (version + implementation substrate, JavaCard payment +
 * storage, the DESFire / MIFARE Plus credential sweep, DESFire app enumeration,
 * and the Spark 2 / NDEF implant name) live in {@link enrichIsoDep}, driven off
 * the library's `sendApdu` / `isoGetVersion` / `enumerateApps` surface.
 */
export async function enrich(
  app: Transponder,
  lib: LibTransponder,
  _opts?: IdentifyOptions,
): Promise<void> {
  const isIsoDep = lib instanceof IsoDepTransponder;

  // 1. LIVE: NTAG implant name in user memory. Type 2 tags only — an NTAG DNA
  //    reports `family === NTAG` but is ISO-DEP (its `readUserMemory()` is
  //    empty); its implant name comes from the Spark 2 / NDEF probe instead.
  if (app.family === ChipFamily.NTAG && !isIsoDep) {
    const name = await readNtagImplantName(lib);
    if (name) {
      app.implantName = name;
      app.productKind = 'implant';
    }
  }

  // 2. PURE: official DT product signature (ATS historical bytes). A positive
  //    match raises confidence, flags the card as official (`dtProduct`), and —
  //    for implants — names it when nothing else did (the flexSecure-vs-bare-
  //    J3R180 tiebreaker).
  const dtMatch = matchDtHistoricalSignature(app.rawData.historicalBytes);
  if (dtMatch) {
    app.dtProduct = {name: dtMatch.name, kind: dtMatch.kind};
    app.confidence = 'high';
    if (!app.implantName && dtMatch.kind === 'implant') {
      app.implantName = dtMatch.name;
      app.productKind = 'implant';
    }
  }

  // 3. LIVE: ISO-DEP DT enrichment — version + implementation, JavaCard
  //    payment/storage, credential sweep, DESFire apps, Spark 2 / NDEF. Keyed
  //    on the JavaCard family (so a hand-built JavaCard fixture is enriched
  //    from its `.cplc`/`.aids`) or an ISO-DEP transponder instance.
  if (isIsoDep || app.family === ChipFamily.JAVACARD) {
    await enrichIsoDep(app, lib);
  }

  // 3b. LIVE: NfcV (ISO 15693) DT enrichment — NTAG5 VK Thermo product naming
  //     (AFI/DSFID from GET_SYSTEM_INFO) and the ISO 15693 Spark 1 implant name
  //     (NDEF vivokey.co URL), re-homed onto the library's `getSystemInfo` /
  //     `readSingleBlock` in {@link enrichNfcV}. The NTAG5 VK Thermo /
  //     Temptress temperature is read app-side there via the NXP custom
  //     commands over the generic raw NfcV primitive (see `nxpCommands.ts`).
  if (app.family === ChipFamily.ISO15693) {
    await enrichNfcV(app, lib);
  }

  // 4. PURE: derive the capability set last, so it sees the implementation
  //    substrate and any credentials added above.
  app.capabilities = deriveCapabilities({
    type: app.type,
    implementation: app.implementation,
    credentials: app.credentials,
  });
}

/**
 * Run the library identification against the tag in the field, then apply the
 * DT enrichment layer, and return an app `Transponder`.
 *
 * Options (`onProgress`, `onExchange`, `probeMagic`, `platform`,
 * `rawAvailable`, `magicPassword`) are forwarded verbatim to
 * `NfcManager.identify`. Enrichment runs while the returned library transponder
 * is still bound to its live transport, so its command methods
 * (`readUserMemory`, …) still reach the tag.
 */
export async function identifyTransponder(
  opts?: IdentifyOptions,
): Promise<Transponder> {
  // `NfcManager.identify` is typed against the package-root `Transponder`
  // (whose `ChipType` is a separately-declared enum); cast to the leaf `base`
  // type so it lines up with the concrete leaf classes the enrichment narrows
  // to. Same runtime object, matching structural surface.
  const lib = (await NfcManager.identify(opts)) as unknown as LibTransponder;
  const app = libToAppTransponder(lib, opts);
  await enrich(app, lib, opts);
  return app;
}
