/**
 * DT enrichment — the STAYING home for the DT product-identification logic that
 * the identify() adapter layers on top of the library's chip identification.
 *
 * Two kinds of thing live here:
 *
 *  1. **Pure interpretation helpers relocated out of the chip-ID modules** that
 *     `detector.ts` / `desfire.ts` / `javacard.ts` / `cplc.ts` / `mifare.ts` /
 *     `ntag.ts` own and that Task 6 will delete — so the adapter no longer
 *     imports from a soon-deleted module:
 *       - `matchImplantNameInBytes` (+ `KNOWN_IMPLANT_NAMES`) — from `ntag.ts`.
 *       - `classicChipTypeFromSak` — re-homed onto the library's
 *         `chipForClassicSak` (replaces `mifare.ts`
 *         `isMifareClassicSak`/`detectMifareClassic`).
 *       - CPLC lookups (`identifyIcType` / `identifyFabricator` /
 *         `identifyJcopVersion` / `identifyJcopPlatform`) — imported from the
 *         library's pure `isodep/cplc` (verbatim ports of the app's `cplc.ts`).
 *       - The pure credential builders (`credentialsForJavaCard`,
 *         `emulatedCredentials`) — from `credentials.ts`.
 *
 *  2. **The re-homed ISO-DEP DT probes** (phase 5 task 5b). Task 5 mapped the
 *     pure enrichment but flagged that the live ISO-DEP probes regressed
 *     because `runCredentialSweep` / the DESFire / JavaCard live reads died with
 *     `detector.ts`. Those probes are re-homed here, driven off the LIVE library
 *     `Transponder`'s exported command surface (`sendApdu`, `isoGetVersion`,
 *     `enumerateApps`) rather than raw transceive:
 *       - version + implementation substrate (GET_VERSION decode).
 *       - JavaCard payment (PPSE) naming + JavaCard Memory `persistentTotal`.
 *       - ISO-DEP credential derivation (DESFire EV3C Classic-emulation,
 *         MIFARE Plus emulation, GlobalPlatform ISD).
 *       - DESFire application enumeration; Spark 2 / NDEF implant name.
 *
 *  3. **The re-homed NfcV (ISO 15693) DT probes** (phase 5 task 5c), driven off
 *     the library's `Iso15693Transponder` command surface (`getSystemInfo`,
 *     `readSingleBlock`) rather than raw transceive:
 *       - NTAG5 VK Thermo product naming (AFI/DSFID from GET_SYSTEM_INFO).
 *       - ISO 15693 Spark (Spark 1) implant name from the NDEF vivokey.co URL.
 *     The NTAG5 VK Thermo / Temptress *temperature* read (task 5c-fix) is also
 *     wired into {@link enrichNfcV}, but APP-SIDE: it needs NXP proprietary
 *     custom commands that are DT custom hardware and do NOT belong in the
 *     library, so it goes through `nxpCommands.ts` over the library's GENERIC
 *     raw NfcV primitive `nfcManager.sendRawNfcV` rather than a library method.
 *
 * Everything live is best-effort: a probe failure leaves the field undefined
 * and never throws out of enrichment.
 *
 * FORK GAPS flagged inline with `FORK GAP:` — points where the library command
 * surface forces a workaround (a redundant re-transceive) or cannot express the
 * DT need at all.
 */

import {
  ChipType,
  ChipFamily,
  CHIP_NAMES,
  CHIP_MEMORY_SIZES,
  CHIP_CLONEABILITY,
  type CplcInfo,
  type DesfireVersionInfo,
  type DetectedCredential,
  type Transponder,
} from '../../types/detection';
import {KNOWN_AIDS} from '../nfc/commands';
import {formatDesfireAidLabel, isHiddenAid} from '../../data/desfireAids';
import {getJavacardImplantName} from './javacardIdentity';
import {readNtag5Temperatures} from './nxpCommands';

// ── Library command surface ──────────────────────────────────────────────────
// The concrete transponder classes (needed for `instanceof`), the pure helpers,
// and the `Transponder` base type all come from the standalone
// `@dangerousthings/transponders` package. It is side-effect-free and
// dependency-free, so importing from its root is safe under Jest (no native
// module is pulled in). See `src/types/detection.ts` for the same pattern.
import {
  type Transponder as LibTransponder,
  IsoDepTransponder,
  DesfireTransponder,
  JavaCardTransponder,
  matchPlusHistoricalSignature,
  chipForClassicSak,
  Iso15693Transponder,
  selectAid,
  isSuccess,
  GET_CPLC,
  type ApduResponse,
  parseCPLC,
  identifyIcType,
  identifyFabricator,
  identifyJcopVersion,
  identifyJcopPlatform,
  type CPLCData,
  implementationToTransponderField,
} from '@dangerousthings/transponders';

// Re-export the CPLC lookups so the rest of the app has a single, staying
// import site for them (they used to live in the soon-deleted `cplc.ts`).
export {identifyIcType, identifyFabricator, identifyJcopVersion};

// ============================================================================
// Pure helpers relocated out of soon-deleted chip-ID modules
// ============================================================================

/**
 * Known Dangerous Things implant names that may be written to Type 2 tag
 * memory. Relocated verbatim from `ntag.ts` (`KNOWN_IMPLANT_NAMES`). Only
 * Type 2 (NTAG / Ultralight) based implants; 4+ character partial match,
 * case-insensitive.
 */
export const KNOWN_IMPLANT_NAMES = [
  'xNT',
  'xSIID',
  'NExT',
  'dNExT',
  'flexNT',
  'VivoKey',
  'Dangerous',
  'DNGRTHNG',
  'DNGR',
];

/** Printable-ASCII decode of a byte array (relocated from `ntag.ts`). */
function bytesToAscii(bytes: number[]): string {
  return bytes
    .filter(b => b >= 0x20 && b <= 0x7e)
    .map(b => String.fromCharCode(b))
    .join('');
}

/**
 * Scan a raw memory byte array for a Dangerous Things implant name. Pure.
 * Relocated from `ntag.ts` (`matchImplantNameInBytes`).
 */
export function matchImplantNameInBytes(bytes: number[]): string | undefined {
  const upperAscii = bytesToAscii(bytes).toUpperCase();
  for (const name of KNOWN_IMPLANT_NAMES) {
    if (name.length >= 4 && upperAscii.includes(name.toUpperCase())) {
      return name;
    }
  }
  return undefined;
}

/**
 * The MIFARE Classic chip type a SAK advertises, or `undefined` if none.
 *
 * Re-homed onto the library's pure `chipForClassicSak` (replaces `mifare.ts`
 * `isMifareClassicSak` + `detectMifareClassic`). Used to record a Classic
 * credential on a card whose SAK also advertises Classic (the SAK 0x28
 * DESFire-EV3C / JavaCard-emulation cases).
 */
export function classicChipTypeFromSak(sak: number | undefined): ChipType | undefined {
  if (sak === undefined) {
    return undefined;
  }
  return chipForClassicSak(sak)?.chip;
}

/**
 * Map the library's parsed CPLC onto the app's {@link CplcInfo}, folding in the
 * resolved silicon / fabricator / OS names (pure lookups). Relocated from the
 * adapter's `toCplcInfo`.
 */
export function toCplcInfo(cplc: CPLCData): CplcInfo {
  return {
    ...cplc,
    icTypeName: identifyIcType(cplc.icType),
    fabricatorName: identifyFabricator(cplc.icFabricator),
    osName: identifyJcopVersion(cplc.osId),
  };
}

// ============================================================================
// Credential interpretation (relocated pure logic from credentials.ts)
// ============================================================================

/** DESFire chip types that represent a genuine DESFire credential. */
const DESFIRE_CHIP_TYPES: ChipType[] = [
  ChipType.DESFIRE_EV1,
  ChipType.DESFIRE_EV2,
  ChipType.DESFIRE_EV3,
  ChipType.DESFIRE_EV3C,
  ChipType.DESFIRE_LIGHT,
  ChipType.DESFIRE_UNKNOWN,
];

/**
 * Which credential kind a chip type's headline identity represents. Relocated
 * from `credentials.ts` (`credentialKindForChipType` / `primaryCredentialKind`
 * merged — they only differed in default).
 */
function credentialKindForChipType(
  chipType: ChipType,
): DetectedCredential['kind'] {
  switch (chipType) {
    case ChipType.MIFARE_PLUS_S:
    case ChipType.MIFARE_PLUS_X:
    case ChipType.MIFARE_PLUS_SE:
    case ChipType.MIFARE_PLUS_EV1:
    case ChipType.MIFARE_PLUS_EV2:
    case ChipType.MIFARE_PLUS:
      return 'mifare-plus';
    default:
      return 'desfire';
  }
}

/** The credential kind that corresponds to a chip type's headline identity. */
function primaryCredentialKind(
  chipType: ChipType | undefined,
): DetectedCredential['kind'] | undefined {
  switch (chipType) {
    case ChipType.MIFARE_CLASSIC_1K:
    case ChipType.MIFARE_CLASSIC_4K:
    case ChipType.MIFARE_CLASSIC_MINI:
      return 'mifare-classic';
    case ChipType.MIFARE_PLUS_S:
    case ChipType.MIFARE_PLUS_X:
    case ChipType.MIFARE_PLUS_SE:
    case ChipType.MIFARE_PLUS_EV1:
    case ChipType.MIFARE_PLUS_EV2:
    case ChipType.MIFARE_PLUS:
      return 'mifare-plus';
    case ChipType.DESFIRE_EV1:
    case ChipType.DESFIRE_EV2:
    case ChipType.DESFIRE_EV3:
    case ChipType.DESFIRE_EV3C:
    case ChipType.DESFIRE_LIGHT:
    case ChipType.DESFIRE_UNKNOWN:
      return 'desfire';
    case ChipType.JCOP4:
    case ChipType.JAVACARD_UNKNOWN:
      return 'javacard';
    default:
      return undefined;
  }
}

/**
 * Credentials the card exposes *in addition to* its headline identity — what
 * the "Emulation Supported" UI block lists. Relocated verbatim from
 * `credentials.ts` (`emulatedCredentials`).
 */
export function emulatedCredentials(
  credentials: DetectedCredential[] | undefined,
  chipType?: ChipType,
): DetectedCredential[] {
  if (!credentials) {
    return [];
  }
  const primary = primaryCredentialKind(chipType);
  return credentials.filter(c => {
    if (c.kind === 'javacard') {
      return false;
    }
    return c.kind !== primary;
  });
}

/** Substrate a credential runs on, from the transponder's implementation flavor. */
function substrateFromImpl(
  implementation: Transponder['implementation'],
): DetectedCredential['substrate'] {
  if (
    implementation === 'javacard_emulation' ||
    implementation === 'smartmx_emulation'
  ) {
    return 'smartcard';
  }
  if (implementation === 'native') {
    return 'native';
  }
  return 'unknown';
}

/**
 * Build the credential list for a card identified through the JavaCard branch,
 * without re-running any probes. Relocated from `credentials.ts`
 * (`credentialsForJavaCard`).
 */
export function credentialsForJavaCard(options: {
  sak?: number;
  classicChipType?: ChipType;
  icTypeName?: string;
  osName?: string;
  isdSelected: boolean;
}): DetectedCredential[] {
  const credentials: DetectedCredential[] = [];

  if (options.classicChipType) {
    credentials.push({
      kind: 'mifare-classic',
      label: CHIP_NAMES[options.classicChipType],
      substrate: 'smartcard',
      confidence: 'high',
      evidence:
        options.sak !== undefined
          ? `SAK 0x${options.sak.toString(16).padStart(2, '0')} with GlobalPlatform ISD`
          : 'Classic SAK with GlobalPlatform ISD',
    });
  }

  if (options.isdSelected) {
    credentials.push({
      kind: 'javacard',
      label: options.icTypeName
        ? `JavaCard (${options.icTypeName})`
        : 'JavaCard / GlobalPlatform',
      detail: options.osName,
      substrate: 'smartcard',
      confidence: 'high',
      evidence: 'ISD SELECT 9000',
    });
  }

  return credentials;
}

// ============================================================================
// Applet AID → label interpretation (relocated from the adapter / javacard.ts)
// ============================================================================

/** True when two AID byte arrays are byte-for-byte equal. */
function aidEquals(a: number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/**
 * The applet AIDs whose presence we surface as a label, in the order the old
 * live `probeApplets` reported them.
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

/** Fidesmo AIDs — any present marks a Fidesmo device (Apex platform). */
const FIDESMO_AIDS: ReadonlyArray<readonly number[]> = [
  KNOWN_AIDS.fidesmoApp,
  KNOWN_AIDS.fidesmoBatch,
  KNOWN_AIDS.fidesmoPlatform,
];

/**
 * Resolve raw present-applet AIDs into the label set + Fidesmo flag that
 * {@link getJavacardImplantName} consumes. Pure. Relocated from the adapter.
 */
export function javacardAppletLabels(aids: number[][]): {
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

// ============================================================================
// Live ISO-DEP probes, re-homed onto the library command surface
// ============================================================================

/** True for the ISO-DEP NTAG DNA chips that carry a Spark 2 / NDEF identity. */
function isNtagDnaChip(type: ChipType): boolean {
  return (
    type === ChipType.NTAG424_DNA ||
    type === ChipType.NTAG424_DNA_TT ||
    type === ChipType.NTAG413_DNA
  );
}

/** SELECT an AID over the library transport, never throwing. */
async function selectAidSafe(
  lib: IsoDepTransponder,
  aid: number[],
): Promise<ApduResponse | undefined> {
  try {
    return await lib.sendApdu(selectAid(aid));
  } catch {
    return undefined;
  }
}

/**
 * #1 / #2 — version info + implementation substrate.
 *
 * `versionInfo` is taken from the DESFire transponder's stored `.version` (no
 * re-transceive). The implementation nibble (native vs SmartMX vs JavaCard
 * emulation) is NOT stored on the transponder, so it is obtained by re-issuing
 * GET_VERSION via `isoGetVersion()` — safe on DESFire / Plus / NTAG DNA because
 * no applet SELECT has happened by the time identify() returns one of those.
 *
 * FORK GAP: `DesfireTransponder.version` drops GetVersion byte 1 (the
 * implementation + product-family nibbles); only the hardware bytes survive.
 * The library should store the full `GetVersionDecoded` (or at least byte 1) on
 * the transponder so the substrate can be read without re-issuing GET_VERSION.
 * FORK GAP: on a `JavaCardTransponder` the identification path has already
 * SELECTed the ISD / applets, so re-issuing GET_VERSION would route to the
 * selected applet and return garbage — hence JavaCard is excluded here and its
 * substrate comes from the ISD/credential path instead.
 */
export async function enrichVersionAndImplementation(
  app: Transponder,
  lib: LibTransponder,
): Promise<void> {
  if (!(lib instanceof IsoDepTransponder) || lib instanceof JavaCardTransponder) {
    return;
  }

  if (lib instanceof DesfireTransponder) {
    const v = lib.version;
    app.versionInfo = {
      hardwareMajor: v.hardwareMajor,
      hardwareMinor: v.hardwareMinor,
      hardwareStorageSize: v.hardwareStorageSize,
      softwareMajor: v.softwareMajor,
      softwareMinor: v.softwareMinor,
    } as DesfireVersionInfo;
  }

  try {
    const decoded = await lib.isoGetVersion();
    app.implementationByte = decoded.productFamilyByte;
    const impl = implementationToTransponderField(decoded.implementation);
    if (impl) {
      app.implementation = impl;
    }
  } catch {
    // GET_VERSION unavailable (e.g. MIFARE Plus SL3) — leave fields unset.
  }
}

/**
 * #5 — DESFire application enumeration, via the library's `enumerateApps()`.
 * Returns display labels (the `formatDesfireApps` interpretation, re-homed off
 * `../../data/desfireAids`). Best-effort.
 */
export async function desfireAppLabels(
  lib: LibTransponder,
): Promise<string[]> {
  if (!(lib instanceof DesfireTransponder)) {
    return [];
  }
  let aids: number[][];
  try {
    aids = await lib.enumerateApps();
  } catch {
    return [];
  }
  const seen = new Set<string>();
  const labels: string[] = [];
  for (const aid of aids) {
    // enumerateApps() returns MSB-first AIDs; render as the 6-char uppercase
    // hex the AID database keys off.
    const hex = aid
      .map(b => b.toString(16).padStart(2, '0').toUpperCase())
      .join('');
    if (isHiddenAid(hex)) {
      continue;
    }
    const label = formatDesfireAidLabel(hex);
    if (label && !seen.has(label)) {
      seen.add(label);
      labels.push(label);
    }
  }
  return labels;
}

/**
 * #5 — Spark 2 / NDEF implant name (ISO-DEP), re-homed onto `lib.sendApdu`.
 *
 * Reads the Type 4 Tag NDEF file and looks for a vivokey.co URL. Interpretation
 * ported from `desfire.ts` `detectSpark2Implant`. Best-effort → `undefined`.
 *
 * Note: the old detector also had a *cached* NDEF path (`detectSpark2FromNdef`
 * over the raw scan's NDEF records); those records are not on the library
 * transponder, so only the live APDU read is re-homed here.
 */
export async function detectSpark2Name(
  lib: LibTransponder,
): Promise<string | undefined> {
  if (!(lib instanceof IsoDepTransponder)) {
    return undefined;
  }
  try {
    const appSel = await lib.sendApdu(selectAid(KNOWN_AIDS.ndefTag));
    if (!isSuccess(appSel)) {
      return undefined;
    }

    // SELECT NDEF file E104, falling back to 0002.
    let fileSel = await lib.sendApdu([0x00, 0xa4, 0x00, 0x0c, 0x02, 0xe1, 0x04]);
    if (!isSuccess(fileSel)) {
      fileSel = await lib.sendApdu([0x00, 0xa4, 0x00, 0x0c, 0x02, 0x00, 0x02]);
      if (!isSuccess(fileSel)) {
        return undefined;
      }
    }

    // READ BINARY: NDEF length (first 2 bytes).
    const lenResp = await lib.sendApdu([0x00, 0xb0, 0x00, 0x00, 0x02]);
    if (!isSuccess(lenResp) || lenResp.data.length < 2) {
      return undefined;
    }
    const ndefLength = (lenResp.data[0] << 8) | lenResp.data[1];
    if (ndefLength === 0 || ndefLength > 500) {
      return undefined;
    }

    const all: number[] = [];
    let offset = 2;
    let remaining = ndefLength;
    while (remaining > 0) {
      const chunk = Math.min(remaining, 128);
      const r = await lib.sendApdu([
        0x00,
        0xb0,
        (offset >> 8) & 0xff,
        offset & 0xff,
        chunk,
      ]);
      if (!isSuccess(r) || r.data.length === 0) {
        break;
      }
      all.push(...r.data);
      offset += r.data.length;
      remaining -= r.data.length;
    }
    if (all.length === 0) {
      return undefined;
    }

    const ascii = all
      .filter(b => b >= 0x20 && b <= 0x7e)
      .map(b => String.fromCharCode(b))
      .join('');
    return /vivokey\.co\/([A-Za-z0-9_-]+)/i.test(ascii) ? 'Spark 2' : undefined;
  } catch {
    return undefined;
  }
}

/**
 * #3 — JavaCard payment naming. Probes PPSE (`2PAY.SYS.DDF01`); if present,
 * resolves the payment network. Re-homed onto `lib.sendApdu`. Returns the
 * labels (e.g. `['Payment (PPSE)', 'Visa']`) the identity resolver consumes.
 */
export async function probeJavaCardPayment(
  lib: IsoDepTransponder,
): Promise<string[]> {
  const labels: string[] = [];
  const ppse = await selectAidSafe(lib, KNOWN_AIDS.ppse);
  if (!ppse || !isSuccess(ppse)) {
    return labels;
  }
  labels.push('Payment (PPSE)');

  const networks: Array<{aid: number[]; label: string}> = [
    {aid: KNOWN_AIDS.visaCredit, label: 'Visa'},
    {aid: KNOWN_AIDS.mastercard, label: 'Mastercard'},
    {aid: KNOWN_AIDS.amex, label: 'American Express'},
    {aid: KNOWN_AIDS.discover, label: 'Discover'},
    {aid: KNOWN_AIDS.maestro, label: 'Maestro'},
  ];
  for (const {aid, label} of networks) {
    const r = await selectAidSafe(lib, aid);
    if (r && isSuccess(r)) {
      labels.push(label);
      break;
    }
  }
  return labels;
}

/**
 * #3 — JavaCard Memory applet `persistentTotal` (storage). SELECTs the memory
 * applet; the SELECT response carries the 12-byte memory record. Interpretation
 * ported from `javacard.ts` `readJavacardMemory`. Best-effort → `undefined`.
 */
export async function readJavaCardStorage(
  lib: IsoDepTransponder,
): Promise<Transponder['storageInfo'] | undefined> {
  const r = await selectAidSafe(lib, KNOWN_AIDS.javacardMemory);
  if (!r || !isSuccess(r) || r.data.length < 12) {
    return undefined;
  }
  const d = r.data;
  return {
    persistentFree: ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0,
    persistentTotal: ((d[4] << 24) | (d[5] << 16) | (d[6] << 8) | d[7]) >>> 0,
    transientResetFree: (d[8] << 8) | d[9],
    transientDeselectFree: (d[10] << 8) | d[11],
  };
}

/**
 * Probe the DT-relevant applet AIDs over the live transport, returning those
 * that answered. Re-homed off `javacard.ts` `probeApplets` onto `lib.sendApdu`.
 * Used on the DESFire branch when an ISD answers (the library did not run its
 * JavaCard applet probe for a card it already typed as DESFire).
 */
async function probeAppletAids(lib: IsoDepTransponder): Promise<number[][]> {
  const probe: number[][] = [
    KNOWN_AIDS.javacardMemory,
    KNOWN_AIDS.fidesmoApp,
    KNOWN_AIDS.fidesmoBatch,
    KNOWN_AIDS.fidesmoPlatform,
    KNOWN_AIDS.openPgp,
    KNOWN_AIDS.fido,
    KNOWN_AIDS.fido2,
    KNOWN_AIDS.fido2Instance,
    KNOWN_AIDS.vivokeyOtp,
    KNOWN_AIDS.ndefTag,
    KNOWN_AIDS.oath,
    KNOWN_AIDS.piv,
  ];
  const found: number[][] = [];
  for (const aid of probe) {
    const r = await selectAidSafe(lib, aid);
    if (r && isSuccess(r)) {
      found.push(aid);
    }
  }
  return found;
}

/** Result of the GlobalPlatform ISD probe, re-homed onto `lib.sendApdu`. */
interface IsdProbeResult {
  isdSelected: boolean;
  cplc?: CplcInfo;
  icTypeName?: string;
  osName?: string;
}

/**
 * #4 — GlobalPlatform ISD SELECT + CPLC, re-homed onto `lib.sendApdu`.
 * Interpretation ported from `cplc.ts` `selectIsdAndReadCplc`. Never throws.
 * Runs LAST on the DESFire branch — it changes the selected application.
 */
async function probeIsd(lib: IsoDepTransponder): Promise<IsdProbeResult> {
  for (const aid of [KNOWN_AIDS.cardManager, KNOWN_AIDS.gpSecurityDomain]) {
    const sel = await selectAidSafe(lib, aid);
    if (!sel || !isSuccess(sel)) {
      continue;
    }
    const result: IsdProbeResult = {isdSelected: true};
    const cplcResp = await (async () => {
      try {
        return await lib.sendApdu(GET_CPLC);
      } catch {
        return undefined;
      }
    })();
    if (cplcResp && isSuccess(cplcResp)) {
      const cplc = parseCPLC(cplcResp.data);
      if (cplc) {
        result.cplc = toCplcInfo(cplc);
        result.icTypeName = identifyIcType(cplc.icType);
        result.osName =
          identifyJcopPlatform(cplc.icType) ?? identifyJcopVersion(cplc.osId);
      }
    }
    return result;
  }
  return {isdSelected: false};
}

// ============================================================================
// Chip re-typing helpers
// ============================================================================

/** Restamp the app transponder's chip identity (name / cloneability / size). */
function retype(app: Transponder, chip: ChipType, keepMemory = false): void {
  app.type = chip;
  app.chipName = CHIP_NAMES[chip] ?? String(chip);
  const cloneability = CHIP_CLONEABILITY[chip];
  app.isCloneable = cloneability?.cloneable ?? false;
  app.cloneabilityNote = cloneability?.note;
  if (!keepMemory) {
    app.memorySize = CHIP_MEMORY_SIZES[chip];
  }
}

// ============================================================================
// JavaCard identity — shared by the JavaCard branch and the DESFire+ISD path
// ============================================================================

/**
 * Apply the JavaCard product identity (CPLC, applets incl. PPSE + storage,
 * `getJavacardImplantName`) to `app`, driving the live reads off `lib`.
 *
 * `aids` are the applet AIDs already known (from the library's JavaCard probe,
 * or freshly probed on the DESFire branch). `extraLabels` fold in DESFire app
 * labels when a JavaCard is emulating a DESFire credential.
 */
async function applyJavaCardIdentity(
  app: Transponder,
  lib: LibTransponder,
  ev: {
    cplc?: CplcInfo;
    aids: number[][];
    extraLabels?: string[];
  },
): Promise<void> {
  if (ev.cplc && !app.cplc) {
    app.cplc = ev.cplc;
  }

  const {labels, isFidesmo} = javacardAppletLabels(ev.aids);
  const merged = new Set<string>([...(ev.extraLabels ?? []), ...labels]);

  let storageInfo: Transponder['storageInfo'];
  if (lib instanceof IsoDepTransponder) {
    // #3 live: PPSE / payment network + JavaCard Memory persistentTotal.
    const payment = await probeJavaCardPayment(lib);
    payment.forEach(p => merged.add(p));
    storageInfo = await readJavaCardStorage(lib);
    if (storageInfo) {
      app.storageInfo = storageInfo;
    }
  }

  const allLabels = Array.from(merged);
  if (allLabels.length > 0) {
    app.installedApplets = allLabels;
  }

  const identity = getJavacardImplantName(
    allLabels.length > 0 ? allLabels : undefined,
    isFidesmo,
    storageInfo,
    app.cplc?.icTypeName,
  );
  if (identity.name && !app.implantName) {
    app.implantName = identity.name;
    app.productKind = identity.kind;
  }
  if (identity.evidence.length > 0) {
    app.identityEvidence = identity.evidence;
  }
}

// ============================================================================
// Top-level ISO-DEP enrichment
// ============================================================================

/**
 * Enrich an ISO-DEP capable app transponder using the LIVE library transponder.
 * Dispatches:
 *
 *  - JavaCard headline (library `JavaCardTransponder`, or a card the app maps to
 *    the JavaCard family): CPLC + applets + PPSE/storage + identity + JavaCard
 *    credentials, from the already-probed `.cplc` / `.aids` plus live reads.
 *  - DESFire / Plus / NTAG DNA: version + implementation; DESFire app
 *    enumeration; Spark 2 / NDEF name; then the credential sweep (DESFire +
 *    SAK-Classic emulation + Plus historical-byte + GlobalPlatform ISD), with
 *    the EV3C promotion and — when an ISD answers — promotion to a JavaCard
 *    headline (a JavaCard emulating the DESFire the library saw).
 *
 * All reads are best-effort; a failure leaves the field undefined.
 */
export async function enrichIsoDep(
  app: Transponder,
  lib: LibTransponder,
): Promise<void> {
  const isJavaCardFamily = app.family === ChipFamily.JAVACARD;

  // ── JavaCard headline (family-keyed so both a real JavaCardTransponder and a
  //    hand-built fixture with `.cplc`/`.aids`/`.isdSelected` are enriched) ──
  if (isJavaCardFamily) {
    const jc = lib as Partial<JavaCardTransponder>;
    await applyJavaCardIdentity(app, lib, {
      cplc: jc.cplc ? toCplcInfo(jc.cplc) : undefined,
      aids: jc.aids ?? [],
    });
    const credentials = credentialsForJavaCard({
      sak: app.rawData.sak,
      classicChipType: classicChipTypeFromSak(app.rawData.sak),
      icTypeName: app.cplc?.icTypeName,
      osName: app.cplc?.osName,
      isdSelected: jc.isdSelected ?? false,
    });
    if (credentials.length > 0) {
      app.credentials = credentials;
    }
    return;
  }

  // ── DESFire / Plus / NTAG DNA ──
  // Order is load-bearing: version + native DESFire commands + NDEF (which
  // SELECTs the NDEF app) all run before the ISD SELECT, which changes the
  // selected application.
  await enrichVersionAndImplementation(app, lib);

  const desfireChip =
    lib instanceof DesfireTransponder && DESFIRE_CHIP_TYPES.includes(lib.chip)
      ? lib.chip
      : undefined;
  const dApps = await desfireAppLabels(lib);

  if (isNtagDnaChip(app.type) && !app.implantName) {
    const spark = await detectSpark2Name(lib);
    if (spark) {
      app.implantName = spark;
      app.productKind = 'implant';
    }
  }

  const isd =
    lib instanceof IsoDepTransponder
      ? await probeIsd(lib)
      : {isdSelected: false as boolean};

  if (isd.isdSelected) {
    // A GlobalPlatform ISD answered: this is a JavaCard hosting whatever it
    // emulated. Its silicon (CPLC IC type) is the real identity. Promote the
    // headline to JavaCard and demote the emulated chip to a credential.
    //
    // FORK GAP: the library's ISO-DEP waterfall returns at its DESFire step as
    // soon as GET_VERSION succeeds, and never runs its JavaCard ISD/applet
    // probe (step 3) for such a card — so a JavaCard emulating DESFire is typed
    // as a native `DesfireTransponder` and exposes no `.cplc` / `.aids`. We
    // recover the JavaCard identity by re-probing the ISD + applets over
    // `sendApdu`; the library should instead probe the ISD even after a
    // positive DESFire GET_VERSION (or expose a way to run the JavaCard probe
    // on any ISO-DEP transponder).
    if (
      app.type !== ChipType.JCOP4 &&
      app.type !== ChipType.JAVACARD_UNKNOWN
    ) {
      retype(app, ChipType.JCOP4);
    }
    // A native-looking DESFire that answers an ISD is emulation on a JavaCard.
    if (desfireChip && (app.implementation === 'native' || app.implementation === undefined)) {
      app.implementation = 'javacard_emulation';
    }

    const aids = lib instanceof IsoDepTransponder ? await probeAppletAids(lib) : [];
    await applyJavaCardIdentity(app, lib, {
      cplc: isd.cplc,
      aids,
      extraLabels: dApps,
    });

    app.credentials = buildIsoDepCredentials(app, {desfireChip, isd});
    return;
  }

  // No ISD — native DESFire / Plus / NTAG DNA.
  if (dApps.length > 0) {
    app.installedApplets = dApps;
  }
  const credentials = buildIsoDepCredentials(app, {desfireChip, isd});
  if (credentials.length > 0) {
    app.credentials = credentials;
  }

  // EV3C promotion: a Classic-SAK card that also answers DESFire GET_VERSION as
  // EV3 is a DESFire EV3C (the "C" is the emulated MIFARE Classic).
  if (
    classicChipTypeFromSak(app.rawData.sak) &&
    desfireChip === ChipType.DESFIRE_EV3
  ) {
    retype(app, ChipType.DESFIRE_EV3C, /* keepMemory */ true);
  }
}

/**
 * Build the ISO-DEP credential list (mirrors the old `runCredentialSweep`
 * output): DESFire (from the library chip) + SAK-Classic emulation + MIFARE
 * Plus historical-byte signature + GlobalPlatform ISD. Pure.
 */
function buildIsoDepCredentials(
  app: Transponder,
  opts: {desfireChip?: ChipType; isd: IsdProbeResult | {isdSelected: boolean}},
): DetectedCredential[] {
  const credentials: DetectedCredential[] = [];
  const sak = app.rawData.sak;
  const desfireSubstrate = substrateFromImpl(app.implementation);

  if (opts.desfireChip) {
    const byte1 =
      app.implementationByte !== undefined
        ? `0x${app.implementationByte.toString(16).padStart(2, '0')}`
        : 'n/a';
    credentials.push({
      kind: credentialKindForChipType(opts.desfireChip),
      label: CHIP_NAMES[opts.desfireChip],
      substrate: desfireSubstrate,
      confidence:
        opts.desfireChip === ChipType.DESFIRE_UNKNOWN ? 'medium' : 'high',
      evidence: `DESFire GetVersion (byte1=${byte1})`,
    });
  }

  const classicChip = classicChipTypeFromSak(sak);
  if (classicChip) {
    credentials.push({
      kind: 'mifare-classic',
      label: CHIP_NAMES[classicChip],
      substrate: desfireSubstrate,
      confidence: 'high',
      evidence:
        sak !== undefined
          ? `SAK 0x${sak.toString(16).padStart(2, '0')}`
          : 'MifareClassic tech type',
    });
  }

  const plus = matchPlusHistoricalSignature(app.rawData.historicalBytes);
  if (plus) {
    credentials.push({
      kind: 'mifare-plus',
      label: CHIP_NAMES[plus.chipType],
      detail: `SL${plus.securityLevel}`,
      substrate: 'native',
      confidence: 'high',
      evidence: 'AN10833 historical-byte signature',
    });
  }

  const isd = opts.isd as IsdProbeResult;
  if (isd.isdSelected) {
    credentials.push({
      kind: 'javacard',
      label: isd.icTypeName
        ? `JavaCard (${isd.icTypeName})`
        : 'JavaCard / GlobalPlatform',
      detail: isd.osName,
      substrate: 'smartcard',
      confidence: 'high',
      evidence: isd.cplc ? 'ISD SELECT + CPLC' : 'ISD SELECT 9000',
    });
    // A card whose ISD answers hosts its credentials on a smart card; upgrade
    // any credential we could not otherwise type.
    for (const c of credentials) {
      if (c.kind !== 'javacard' && c.substrate === 'unknown') {
        c.substrate = 'smartcard';
      }
    }
  }

  return credentials;
}

// ============================================================================
// NfcV (ISO 15693) DT probes, re-homed onto the library command surface
// ============================================================================

/**
 * VK Thermo AFI value — "T" for thermo. A tag whose GET_SYSTEM_INFO AFI is this
 * value is a VivoKey Thermo product. Relocated from `ntag5sensor.ts`.
 */
const VK_THERMO_AFI = 0x54;

/**
 * VK Thermo DSFID → product model. Relocated from `ntag5sensor.ts`
 * (`VK_THERMO_DSFID`, sensor-type field dropped — only the product name is
 * surfaced here). 0x09 → 112, 0x0A → 117, 0x0B → 119.
 */
const VK_THERMO_DSFID: Record<number, string> = {
  0x09: '112',
  0x0a: '117',
  0x0b: '119',
};

/**
 * Name a VK Thermo product from GET_SYSTEM_INFO AFI + DSFID. Pure interpretation
 * relocated from `ntag5sensor.ts` `detectThermoFromSystemInfo` (the fast path —
 * no I2C probing). Returns the implant name, or `undefined` when the AFI does
 * not mark a Thermo.
 *
 * The DSFID selects the sensor variant (112/117/119); an unknown DSFID on a
 * Thermo AFI still names it "VK Thermo".
 */
export function thermoNameFromSystemInfo(
  afi?: number,
  dsfid?: number,
): string | undefined {
  if (afi !== VK_THERMO_AFI) {
    return undefined;
  }
  const model = dsfid !== undefined ? VK_THERMO_DSFID[dsfid] : undefined;
  return model ? `VK Thermo ${model}` : 'VK Thermo';
}

/**
 * ISO 15693 Spark (Spark 1) implant name, re-homed onto `lib.readSingleBlock`.
 *
 * Reads NDEF blocks 0-7 (block 0 = Capability Container, 1+ = NDEF message),
 * decodes printable ASCII, and looks for a `vivokey.co/<code>` URL — the Spark
 * implant signature. Interpretation ported from `iso15693.ts`
 * `detectSparkImplant`; the block reads that used `transceiveNfcV(
 * iso15693ReadSingleBlock(block))` now use the library's `readSingleBlock`
 * (which already strips the response-flags byte). Best-effort → `undefined`.
 *
 * All ISO 15693 Spark chips (SLIX / SLIX2 / ICODE DNA) report as "Spark 1";
 * the NTAG 424 DNA "Spark 2" is an ISO-DEP tag named in `detectSpark2Name`.
 */
export async function detectSparkName(
  lib: Iso15693Transponder,
): Promise<string | undefined> {
  const ndefBytes: number[] = [];
  for (let block = 0; block < 8; block++) {
    try {
      const data = await lib.readSingleBlock(block);
      if (data.length === 0) {
        break;
      }
      ndefBytes.push(...data);
    } catch {
      // Ran off the end of memory / tag lost — stop with what we have.
      break;
    }
  }
  if (ndefBytes.length === 0) {
    return undefined;
  }
  const ascii = ndefBytes
    .filter(b => b >= 0x20 && b <= 0x7e)
    .map(b => String.fromCharCode(b))
    .join('');
  return /vivokey\.co\/[A-Za-z0-9]+/i.test(ascii) ? 'Spark 1' : undefined;
}

/**
 * The NTAG5 chip types that carry an I2C passthrough (VK Thermo / Temptress
 * temperature sensors). NTAG5 Switch has no I2C master, so it is excluded —
 * this mirrors the old detector's `isNtag5WithI2c` gate.
 */
function isNtag5SensorChip(type: ChipType): boolean {
  return type === ChipType.NTAG5_LINK || type === ChipType.NTAG5_BOOST;
}

/**
 * Enrich an ISO 15693 (NFC-V) app transponder using the LIVE library
 * transponder. Re-homes the DT NfcV probes:
 *
 *  1. **NTAG5 VK Thermo** — AFI/DSFID from `lib.getSystemInfo()` names the
 *     Thermo product (`implantName` / `productKind`).
 *  2. **ISO 15693 Spark** — the NDEF vivokey.co URL (via `lib.readSingleBlock`)
 *     names a Spark 1 implant.
 *  3. **NTAG5 temperature** — the live VK Thermo / Temptress temperature
 *     (`temperature` / `temperature2`), read APP-SIDE via the NXP custom
 *     commands in `nxpCommands.ts` over the generic raw NfcV primitive
 *     `nfcManager.sendRawNfcV`. These NXP proprietary commands (READ_CONFIG,
 *     WRITE_CONFIG, READ_I2C, WRITE_I2C, READ_SRAM) are DT custom hardware and
 *     deliberately do NOT live in the library — the library only provides the
 *     generic raw-transceive primitive; the app builds the frames.
 *
 * Sequencing: the temperature read runs LAST. `sendRawNfcV` connects to the
 * present tag on demand (via `transceiveToPresentTag`, whose connect → close →
 * connect handshake gives a clean activation), but it ends by cancelling the
 * reader tech request — after it, the library transport is spent. So it must
 * follow the library's `getSystemInfo` (naming) and `readSingleBlock` (Spark)
 * reads. For a VK Thermo the Spark path is skipped (already named), so the
 * temperature read is effectively last regardless.
 *
 * Best-effort: a probe failure leaves the field undefined and never throws.
 */
export async function enrichNfcV(
  app: Transponder,
  lib: LibTransponder,
): Promise<void> {
  if (!(lib instanceof Iso15693Transponder)) {
    return;
  }

  // 1. NTAG5 VK Thermo — fast-path product naming from GET_SYSTEM_INFO.
  let sysInfo: {afi?: number; dsfid?: number} | undefined;
  try {
    sysInfo = await lib.getSystemInfo();
  } catch {
    sysInfo = undefined;
  }
  if (sysInfo && !app.implantName) {
    const thermo = thermoNameFromSystemInfo(sysInfo.afi, sysInfo.dsfid);
    if (thermo) {
      app.implantName = thermo;
      app.productKind = 'implant';
    }
  }

  // 2. ISO 15693 Spark — NDEF vivokey.co URL names a Spark 1 implant.
  if (!app.implantName) {
    const spark = await detectSparkName(lib);
    if (spark) {
      app.implantName = spark;
      app.productKind = 'implant';
    }
  }

  // 3. NTAG5 temperature — live VK Thermo / Temptress reading, app-side over
  //    the generic raw NfcV primitive. Runs last (see the doc comment). Only
  //    the NTAG5 chips with an I2C passthrough support it. Best-effort.
  if (isNtag5SensorChip(app.type)) {
    try {
      const sensors = await readNtag5Temperatures(
        app.rawData.uid,
        sysInfo?.afi,
        sysInfo?.dsfid,
      );
      if (sensors.temperature) {
        app.temperature = sensors.temperature;
      }
      if (sensors.temperature2) {
        app.temperature2 = sensors.temperature2;
      }
      // A Temptress is named only by its dual-sensor I2C topology (no VivoKey
      // AFI), so pick up that name when the standard naming above found none.
      if (!app.implantName && sensors.implantName) {
        app.implantName = sensors.implantName;
        app.productKind = 'implant';
      }
    } catch {
      // Sensor read is best-effort — leave the fields undefined on failure.
    }
  }
}
