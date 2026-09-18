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
 *         historical-byte signature; JavaCard `cplc` / `identityEvidence` /
 *         `credentials` / product name from the library's already-probed
 *         `.cplc` + `.aids`; `capabilities` from all of the above.
 *       - LIVE: the NTAG implant-name-in-memory read, re-homed onto the
 *         library transponder's `readUserMemory()`.
 *
 * Library command-surface GAPS flagged inline with `TODO(phase-5)`:
 *   - No substrate/`implementation` signal (native vs JavaCard-emulated), so
 *     the substrate capability tags can't be derived.
 *   - No `versionInfo` (GET_VERSION decode) on the public transponder.
 *   - JavaCardTransponder exposes present applet AIDs but the ISD probe does
 *     NOT cover PPSE/payment, nor read the JavaCard Memory applet's
 *     `persistentTotal`, so payment-card / Apex-Ring naming and the
 *     storage-only "J3R180" fallback can't be reproduced here.
 *   - The DESFire/Plus credential sweep, DESFire app enumeration, Spark 2 /
 *     NDEF implant reads, and the ISO 15693 Spark / NTAG5 sensor implant reads
 *     are not re-homed (the live `runCredentialSweep` dies with detector.ts;
 *     the others need their reads re-pointed at `sendApdu` /
 *     `readMultipleBlock`).
 */

import {Platform} from 'react-native';
import NfcManager, {
  type IdentifyOptions,
  type JavaCardTransponder as LibJavaCardTransponder,
  type Transponder as LibTransponder,
} from '@dangerousthings/react-native-nfc-manager';

import {
  CHIP_CLONEABILITY,
  CHIP_MEMORY_SIZES,
  CHIP_NAMES,
  ChipFamily,
  ChipType,
  type CplcInfo,
  type DetectedCredential,
  type Transponder,
} from '../../types/detection';
import {KNOWN_AIDS} from '../nfc/commands';
import {deriveCapabilities} from './capabilities';
import {credentialsForJavaCard} from './credentials';
import {identifyFabricator, identifyIcType, identifyJcopVersion} from './cplc';
import {matchDtHistoricalSignature} from './dtproducts';
import {getJavacardImplantName} from './javacardIdentity';
import {detectMifareClassic, isMifareClassicSak} from './mifare';
import {matchImplantNameInBytes} from './ntag';

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
 * The MIFARE Classic chip type a SAK advertises, or `undefined` if it
 * advertises none. Pure. Used to record a Classic credential on a JavaCard
 * whose SAK also advertises Classic (the SAK 0x28 emulation case).
 */
function classicChipTypeFromSak(sak: number | undefined): ChipType | undefined {
  if (sak === undefined || !isMifareClassicSak(sak)) {
    return undefined;
  }
  return detectMifareClassic(sak).chipType;
}

/** True when two AID byte arrays are byte-for-byte equal. */
function aidEquals(a: number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The applet AIDs (from app `KNOWN_AIDS`) whose presence we surface as a label,
 * in the order the old live `probeApplets` reported them. The library's
 * JavaCard probe answers with the raw AIDs that selected 0x9000; we map them
 * back to labels here (pure — no I/O).
 */
const JAVACARD_APPLET_LABELS: Array<{aid: readonly number[]; label: string}> = [
  {aid: KNOWN_AIDS.javacardMemory, label: 'JavaCard Memory'},
  {aid: KNOWN_AIDS.openPgp, label: 'OpenPGP'},
  {aid: KNOWN_AIDS.fido, label: 'FIDO U2F'},
  {aid: KNOWN_AIDS.fido2, label: 'FIDO2'},
  {aid: KNOWN_AIDS.fido2Instance, label: 'FIDO2'},
  {aid: KNOWN_AIDS.vivokeyOtp, label: 'VivoKey OTP'},
  {aid: KNOWN_AIDS.ndefTag, label: 'NDEF'},
  {aid: KNOWN_AIDS.oath, label: 'OATH (OTP)'},
  {aid: KNOWN_AIDS.piv, label: 'PIV'},
];

/** Fidesmo AIDs — any of these present marks a Fidesmo device (Apex platform). */
const FIDESMO_AIDS: ReadonlyArray<readonly number[]> = [
  KNOWN_AIDS.fidesmoApp,
  KNOWN_AIDS.fidesmoBatch,
  KNOWN_AIDS.fidesmoPlatform,
];

/**
 * Resolve the library JavaCard probe's raw present-applet AIDs into the label
 * set + Fidesmo flag that {@link getJavacardImplantName} consumes.
 *
 * NOTE: the library ISD probe does not cover PPSE / payment applets, so the
 * 'Payment (PPSE)' + network labels that name a payment card or an Apex Ring
 * are never present here — see the JavaCard gap in {@link enrich}.
 */
function javacardAppletLabels(aids: number[][]): {
  labels: string[];
  isFidesmo: boolean;
} {
  const labels = new Set<string>();
  let isFidesmo = false;
  for (const aid of aids) {
    if (FIDESMO_AIDS.some(f => aidEquals(aid, f))) {
      isFidesmo = true;
      continue;
    }
    const match = JAVACARD_APPLET_LABELS.find(m => aidEquals(aid, m.aid));
    if (match) {
      labels.add(match.label);
    }
  }
  if (isFidesmo) {
    labels.add('Fidesmo');
  }
  return {labels: Array.from(labels), isFidesmo};
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
 * Map the library's parsed CPLC onto the app's {@link CplcInfo}, folding in the
 * resolved silicon / fabricator / OS names (pure lookups). The library's
 * `CPLCData` is field-for-field compatible with `CplcInfo` minus those names.
 */
function toCplcInfo(cplc: NonNullable<LibJavaCardTransponder['cplc']>): CplcInfo {
  return {
    ...cplc,
    icTypeName: identifyIcType(cplc.icType),
    fabricatorName: identifyFabricator(cplc.icFabricator),
    osName: identifyJcopVersion(cplc.osId),
  };
}

/**
 * Apply the DT enrichment layer to an app `Transponder`, using the LIVE library
 * transponder (with its bound transport + already-probed data) still in hand.
 * Mutates `app` in place.
 */
export async function enrich(
  app: Transponder,
  lib: LibTransponder,
  _opts?: IdentifyOptions,
): Promise<void> {
  // 1. LIVE: NTAG implant name in user memory (Type 2 family only — the only
  //    family the old `detectImplantNameInMemory` had a memory layout for).
  if (app.family === ChipFamily.NTAG) {
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

  // 3. PURE(-ish): JavaCard product identity + CPLC, from the library's already-
  //    probed `.cplc` / `.aids` (its identification path leaves them in hand).
  if (app.family === ChipFamily.JAVACARD) {
    const jc = lib as Partial<LibJavaCardTransponder>;

    if (jc.cplc) {
      app.cplc = toCplcInfo(jc.cplc);
    }

    const {labels, isFidesmo} = javacardAppletLabels(jc.aids ?? []);
    if (labels.length > 0) {
      app.installedApplets = labels;
    }

    // Name the product from the same signals the old JavaCard branch used.
    // GAPS (library command surface): the ISD probe carries no PPSE/payment
    // applet, and does not read the JavaCard Memory applet's persistentTotal,
    // so the payment-card / Apex-Ring naming and the storage-only "J3R180"
    // fallback cannot be reproduced. The IC-type path (Apex / Apex 2 /
    // Fidesmo Wearable) still works from `.cplc` + Fidesmo AIDs.
    // TODO(phase-5): needs library JavaCardTransponder to (a) probe PPSE +
    // resolve the payment network, and (b) surface JavaCard Memory
    // persistentTotal (storage), to fully re-home JavaCard product naming.
    const identity = getJavacardImplantName(
      labels.length > 0 ? labels : undefined,
      isFidesmo,
      undefined, // storageInfo — see gap above
      app.cplc?.icTypeName,
    );
    if (identity.name && !app.implantName) {
      app.implantName = identity.name;
      app.productKind = identity.kind;
    }
    if (identity.evidence.length > 0) {
      app.identityEvidence = identity.evidence;
    }

    // Credentials the card carries (pure — from the ISD result + SAK). The
    // live DESFire/Plus credential sweep is NOT re-homed (it dies with
    // detector.ts), so a JavaCard that also emulates DESFire won't list that
    // DESFire credential here.
    // TODO(phase-5): needs a library-surfaced credential list to re-home the
    // full multi-credential sweep (DESFire EV3C, Plus emulation).
    const credentials: DetectedCredential[] = credentialsForJavaCard({
      sak: app.rawData.sak,
      classicChipType: classicChipTypeFromSak(app.rawData.sak),
      icTypeName: app.cplc?.icTypeName,
      osName: app.cplc?.osName,
      isdSelected: jc.isdSelected ?? false,
    });
    if (credentials.length > 0) {
      app.credentials = credentials;
    }
  }

  // 4. PURE: derive the capability set last, so it sees any credentials added
  //    above. `implementation` is unset — the library exposes no substrate
  //    signal (native vs JavaCard-emulated), so the substrate capability tags
  //    (`native-silicon` / `smartcard-substrate` / `crypto1-only`) can't be
  //    derived here.
  // TODO(phase-5): needs a library-surfaced substrate/implementation signal.
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
  const lib = await NfcManager.identify(opts);
  const app = libToAppTransponder(lib, opts);
  await enrich(app, lib, opts);
  return app;
}
