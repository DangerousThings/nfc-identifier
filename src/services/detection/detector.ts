/**
 * Detection Orchestrator
 *
 * Restructured per AN10833 rev 3.9 Figure 1: dispatches incoming tags into
 * a small set of named branches, each of which mirrors a leaf of the spec's
 * decision tree. The orchestrator itself contains *no* chip-specific decode
 * logic — every chip-family identification lives in a branch handler or the
 * sub-detector module it calls into.
 *
 * Branch summary (in dispatch order — see `detectChip` below):
 *
 * 1. `runMifareClassicTechBranch`   — Android-only fast path: tag exposes the
 *                                     `MifareClassic` tech without `IsoDep`.
 *                                     Maps to AN10833 Fig 1 leaf "Classic 1K/4K/Mini".
 *
 * 2. `runMifareClassicSakBranch`    — SAK-based MIFARE Classic detection (iOS
 *                                     and Android fallback). Same Fig 1 leaf
 *                                     but reached via SAK bit 3 = 1 / bit 5 = 0.
 *
 * 3. `runType2Branch`               — Type 2 family (NTAG / Ultralight) via
 *                                     Layer 3 GetVersion (cmd 0x60). Reached
 *                                     when SAK bit 5 = 0 and bit 3 = 0.
 *
 * 4. `runIso14443_4Branch`          — ISO 14443-4 / T=CL family (DESFire,
 *                                     Plus, JavaCard, NTAG DNA). Reached when
 *                                     SAK bit 5 = 1 (ISO-DEP capability).
 *
 * 5. `runIso15693Branch`            — ISO 15693 / NFC-V (SLIX, NTAG 5).
 *
 * 6. `runIso14443BBranch`           — ISO 14443-B (rare in our domain).
 *
 * Each branch returns a fully-constructed `DetectionResult`. The dispatcher
 * picks exactly one branch based on tech types and SAK; falls back to
 * `UNKNOWN` only if no branch matches.
 */

import {Platform} from 'react-native';
import type {RawTagData} from '../../types/nfc';
import {
  ChipType,
  Transponder,
  DetectionResult,
  getChipFamily,
  CHIP_NAMES,
  CHIP_MEMORY_SIZES,
  CHIP_CLONEABILITY,
  type CplcInfo,
  type DetectedCredential,
  type IdentityEvidence,
} from '../../types/detection';
import {detectNtag, mightBeNtag, detectImplantNameInMemory} from './ntag';
import {
  detectMifareClassic,
  isMifareClassicSak,
  hasIsoDepCapability,
  detectCardModes,
  probeClassicGetVersion,
  matchPlusHistoricalSignature,
} from './mifare';
import {
  detectDesfire,
  detectDesfireFromAts,
  detectSpark2Implant,
  detectSpark2FromNdef,
  enumerateDesfireApps,
  formatDesfireApps,
} from './desfire';
import {detectIso15693, isIso15693, detectSparkImplant} from './iso15693';
import {detectNtag5SensorImplant} from './ntag5sensor';
import {
  detectJavaCard,
  mightBeJavaCard,
  detectJavaCardFromAts,
  getJavacardStorageInfo,
} from './javacard';
import {deriveCapabilities} from './capabilities';
import {runCredentialSweep, credentialsForJavaCard} from './credentials';
import {matchDtHistoricalSignature} from './dtproducts';
import type {IsdProbeResult} from './cplc';
import * as fixtureRecorder from './fixtureRecorder';
import {isFixtureCaptureEnabled} from '../../hooks/useFixtureCapture';

// ============================================================================
// Helpers
// ============================================================================

/** Build a Transponder from detection results, applying defaults. */
function createTransponder(
  type: ChipType,
  rawData: RawTagData,
  options: {
    memorySize?: number;
    versionInfo?: Transponder['versionInfo'];
    confidence?: Transponder['confidence'];
    cardModeInfo?: Transponder['cardModeInfo'];
    implantName?: string;
    temperature?: Transponder['temperature'];
    temperature2?: Transponder['temperature2'];
    installedApplets?: string[];
    storageInfo?: Transponder['storageInfo'];
    implementation?: Transponder['implementation'];
    implementationByte?: number;
    credentials?: DetectedCredential[];
    cplc?: CplcInfo;
    identityEvidence?: IdentityEvidence[];
  } = {},
): Transponder {
  const cloneInfo = CHIP_CLONEABILITY[type];

  // Multi-mode / clone-suspect heuristics — includes the keyless mirrored
  // WUP-SAK check (0x88/0x98 wake-up ⇒ likely magic card).
  let cardModeInfo = options.cardModeInfo;
  if (!cardModeInfo && rawData.sak !== undefined) {
    cardModeInfo = detectCardModes(
      rawData.sak,
      rawData.atqa,
      rawData.historicalBytes,
    );
  }

  const capabilities = deriveCapabilities({
    type,
    implementation: options.implementation,
    credentials: options.credentials,
  });

  // Official DT product signature (ATS historical bytes). Checked centrally so
  // every branch benefits — a DT card or implant can arrive via the DESFire,
  // JavaCard, or EV3C paths. A positive match:
  //  - raises confidence (we've positively identified the exact product),
  //  - flags the card as official (drives the "DT" badge),
  //  - names the implant (e.g. flexSecure) when the branch didn't already —
  //    this is the historical-byte tiebreaker that separates flexSecure from
  //    a bare J3R180.
  const dtMatch = matchDtHistoricalSignature(rawData.historicalBytes);
  const confidence: Transponder['confidence'] = dtMatch
    ? 'high'
    : (options.confidence ?? 'medium');
  const implantName =
    options.implantName ??
    (dtMatch?.kind === 'implant' ? dtMatch.name : undefined);

  return {
    type,
    family: getChipFamily(type),
    chipName: CHIP_NAMES[type],
    memorySize: options.memorySize ?? CHIP_MEMORY_SIZES[type],
    isCloneable: cloneInfo.cloneable,
    cloneabilityNote: cloneInfo.note,
    rawData: {
      uid: rawData.uid,
      sak: rawData.sak,
      atqa: rawData.atqa,
      ats: rawData.ats,
      historicalBytes: rawData.historicalBytes,
      techTypes: rawData.techTypes,
    },
    versionInfo: options.versionInfo,
    cardModeInfo,
    implantName,
    temperature: options.temperature,
    temperature2: options.temperature2,
    installedApplets: options.installedApplets,
    storageInfo: options.storageInfo,
    credentials: options.credentials,
    cplc: options.cplc,
    identityEvidence: options.identityEvidence,
    dtProduct: dtMatch ? {name: dtMatch.name, kind: dtMatch.kind} : undefined,
    confidence,
    detectedOn: Platform.OS as 'ios' | 'android',
    implementation: options.implementation,
    implementationByte: options.implementationByte,
    capabilities,
  };
}

/**
 * Persistent-memory baselines reported by the JavaCard Memory applet's
 * `persistentTotal` field.
 *
 * These are silicon-level capacities and don't change as applets are
 * installed (only `persistentFree` does). A small ±256-byte tolerance
 * catches reporting quirks.
 *
 * - Apex        → 84336 bytes (0x00014970)
 * - J3R180      → 167736 bytes (0x00028F38); note this is *also* what a
 *                 flexSecure reports, because a flexSecure **is** a J3R180.
 *                 Storage size therefore cannot separate the two.
 */
const APEX_PERSISTENT_TOTAL = 84336;
const J3R180_PERSISTENT_TOTAL = 167736;
const STORAGE_MATCH_TOLERANCE = 256;

function storageMatches(
  persistentTotal: number | undefined,
  baseline: number,
): boolean {
  if (persistentTotal === undefined) {
    return false;
  }
  return Math.abs(persistentTotal - baseline) <= STORAGE_MATCH_TOLERANCE;
}

function isApexStorageSize(persistentTotal?: number): boolean {
  return storageMatches(persistentTotal, APEX_PERSISTENT_TOTAL);
}

function isJ3R180StorageSize(persistentTotal?: number): boolean {
  return storageMatches(persistentTotal, J3R180_PERSISTENT_TOTAL);
}

/** What `getJavacardImplantName` concluded, and the evidence behind it. */
interface ImplantIdentity {
  name?: string;
  evidence: IdentityEvidence[];
}

/**
 * Determine what to call a JavaCard, and record why.
 *
 * The important constraint is what the available signals *can't* do. CPLC IC
 * Type `0xD321` (J3R180) is shared by both the Apex and the flexSecure, and
 * a flexSecure reports the same 167736-byte `persistentTotal` as any other
 * J3R180 — or none at all, when the memory applet isn't installed. So:
 *
 * - Apex is identifiable: 84336 bytes *plus* the Fidesmo fingerprint, two
 *   independent signals agreeing.
 * - flexSecure is **not** identifiable from these signals alone. We report
 *   the silicon ("J3R180") and let the product matcher offer flexSecure as
 *   one of several J3R180 products, rather than asserting it here.
 *
 * The `historical-bytes` evidence slot is reserved for the check that will
 * eventually break that tie.
 *
 * Silicon identity (J3R180 / J3R452, from CPLC) is surfaced in the header,
 * not here — this function names *products*, and returns undefined when only
 * the part is known.
 *
 * - Payment applets                → "<Network> Payment Card" (not an implant)
 * - Fidesmo + Apex storage         → "Apex"
 * - Fidesmo + other storage        → "Fidesmo Wearable"
 * - CPLC IC type known             → undefined (silicon shown in header)
 * - JavaCard Memory + J3R180 size  → "J3R180" only when CPLC couldn't be read
 *   (no header identity otherwise) — still not a product claim
 * - Otherwise                      → undefined (generic JavaCard)
 */
export function getJavacardImplantName(
  installedApplets?: string[],
  isFidesmo?: boolean,
  storageInfo?: Transponder['storageInfo'],
  icTypeName?: string,
): ImplantIdentity {
  const evidence: IdentityEvidence[] = [];
  const applets = installedApplets ?? [];

  if (applets.length === 0 && !icTypeName) {
    return {evidence};
  }

  if (applets.includes('Payment (PPSE)')) {
    const network = applets.find(a =>
      ['Visa', 'Mastercard', 'American Express', 'Discover', 'Maestro'].includes(
        a,
      ),
    );
    evidence.push({
      source: 'applet-set',
      matched: true,
      note: `Payment applet present${network ? ` (${network})` : ''}`,
    });
    return {
      name: network ? `${network} Payment Card` : 'Payment Card',
      evidence,
    };
  }

  const persistentTotal = storageInfo?.persistentTotal;
  const fidesmoDetected = isFidesmo || applets.includes('Fidesmo');

  if (icTypeName) {
    evidence.push({
      source: 'cplc-ic-type',
      matched: true,
      note: `CPLC IC Type identifies ${icTypeName} silicon`,
    });
  }

  if (fidesmoDetected) {
    evidence.push({
      source: 'applet-set',
      matched: true,
      note: 'Fidesmo fingerprint present',
    });

    if (isApexStorageSize(persistentTotal)) {
      evidence.push({
        source: 'persistent-total',
        matched: true,
        note: `${persistentTotal} bytes matches Apex`,
      });
      return {name: 'Apex', evidence};
    }

    evidence.push({
      source: 'persistent-total',
      matched: false,
      note:
        persistentTotal === undefined
          ? 'Storage size unavailable'
          : `${persistentTotal} bytes does not match Apex`,
    });
    return {name: 'Fidesmo Wearable', evidence};
  }

  // No Fidesmo. When CPLC named the silicon, that identity is surfaced in
  // the header (via `cplc.icTypeName`), not as an implant name — the implant
  // row is for actual DT/VK products (Apex, flexSecure, ...), not raw part
  // numbers. So decline to name a product here.
  if (icTypeName) {
    return {evidence};
  }

  if (applets.includes('JavaCard Memory')) {
    if (isJ3R180StorageSize(persistentTotal)) {
      evidence.push({
        source: 'persistent-total',
        matched: true,
        note: `${persistentTotal} bytes matches J3R180 (shared by flexSecure and other J3R180 cards)`,
      });
      evidence.push({
        source: 'historical-bytes',
        matched: false,
        note: 'Not yet implemented — would disambiguate flexSecure',
      });
      return {name: 'J3R180', evidence};
    }

    evidence.push({
      source: 'persistent-total',
      matched: false,
      note:
        persistentTotal === undefined
          ? 'Storage size unavailable — cannot identify product'
          : `${persistentTotal} bytes matches no known product`,
    });
    return {evidence};
  }

  return {evidence};
}

/**
 * The MIFARE Classic chip type a SAK advertises, or `undefined` if it
 * advertises none. Used to record a Classic credential on cards whose
 * headline identity comes from elsewhere (DESFire, JavaCard).
 */
function classicChipTypeFromSak(sak: number | undefined): ChipType | undefined {
  if (sak === undefined || !isMifareClassicSak(sak)) {
    return undefined;
  }
  return detectMifareClassic(sak).chipType;
}

/**
 * Convert a CPLC record from the detection layer into the shape carried on
 * the Transponder, folding in the resolved names.
 */
function toCplcInfo(probe: IsdProbeResult): CplcInfo | undefined {
  if (!probe.cplc) {
    return undefined;
  }
  return {
    ...probe.cplc,
    icTypeName: probe.icTypeName,
    fabricatorName: probe.fabricatorName,
    osName: probe.osName,
  };
}

/** Progress callback type for detection updates */
export type DetectionProgressCallback = (step: string) => void;

/**
 * Apply a Layer 3 GetVersion probe result to a Classic-family detection.
 *
 * - If the probe found nothing, leave the result alone (real MIFARE Classic).
 * - If the probe found a Plus EV1 in SL1 mode (byte 1 = 0x82), retype the
 *   chip as MIFARE_PLUS_EV1 — the Classic memory layout is real but the
 *   silicon is Plus.
 * - Otherwise, keep the Classic chip type and stamp the implementation
 *   field so the matcher / UI can warn about substrate uncertainty.
 */
function applyClassicProbe(
  baseChipType: ChipType,
  baseMemorySize: number | undefined,
  probe: Awaited<ReturnType<typeof probeClassicGetVersion>>,
): {
  chipType: ChipType;
  memorySize: number | undefined;
  implementation?: Transponder['implementation'];
  implementationByte?: number;
} {
  if (!probe.detected) {
    // Real MIFARE Classic — preserve existing behavior, mark implementation
    // as native so downstream code can render confident UI.
    return {
      chipType: baseChipType,
      memorySize: baseMemorySize,
      implementation: 'native',
    };
  }

  if (probe.isPlusEv1Sl1) {
    return {
      chipType: ChipType.MIFARE_PLUS_EV1,
      memorySize: baseMemorySize,
      implementation: probe.implementation,
      implementationByte: probe.implementationByte,
    };
  }

  return {
    chipType: baseChipType,
    memorySize: baseMemorySize,
    implementation: probe.implementation,
    implementationByte: probe.implementationByte,
  };
}

// ============================================================================
// Branch: MIFARE Classic — tech-type fast path (Android)
// ============================================================================

/**
 * MIFARE Classic family detection via the `MifareClassic` Android tech type.
 * Most reliable method on Android because the OS has already typed the tag.
 *
 * Reached from dispatcher when: `MifareClassic` tech present and `IsoDep` is
 * absent (i.e. not a multi-implementation card like SAK 0x28).
 */
async function runMifareClassicTechBranch(
  rawData: RawTagData,
): Promise<DetectionResult> {
  const {sak} = rawData;

  // Determine 1K vs 4K vs Mini.
  // Priority: mifareClassic.size (most reliable on Android) > SAK > UID length
  let chipType = ChipType.MIFARE_CLASSIC_1K;
  let memorySize = 1024;

  if (rawData.mifareClassic?.size) {
    const size = rawData.mifareClassic.size;
    console.log('[Detector] Using mifareClassic.size:', size);
    if (size >= 4096) {
      chipType = ChipType.MIFARE_CLASSIC_4K;
      memorySize = 4096;
    } else if (size >= 1024) {
      chipType = ChipType.MIFARE_CLASSIC_1K;
      memorySize = 1024;
    } else if (size >= 320) {
      chipType = ChipType.MIFARE_CLASSIC_MINI;
      memorySize = 320;
    }
  } else if (sak === 0x18 || sak === 0x38 || sak === 0x98) {
    chipType = ChipType.MIFARE_CLASSIC_4K;
    memorySize = 4096;
  } else if (sak === 0x09) {
    chipType = ChipType.MIFARE_CLASSIC_MINI;
    memorySize = 320;
  } else if (rawData.uid && rawData.uid.replace(/[:\s-]/g, '').length === 14) {
    // 14 hex chars = 7-byte UID — often 4K when SAK is missing
    if (sak === undefined) {
      chipType = ChipType.MIFARE_CLASSIC_4K;
      memorySize = 4096;
    }
  }

  // AN10833 §2.1: probe Layer 3 GetVersion to distinguish real silicon from
  // SmartMX / Plus EV1 SL1 / JavaCard substrates emulating Classic.
  const probe = await probeClassicGetVersion();
  const final = applyClassicProbe(chipType, memorySize, probe);

  return finishClassicBranch(rawData, final);
}

/**
 * Shared tail for both MIFARE Classic branches.
 *
 * Runs the credential sweep when the card can carry ISO-DEP traffic, then
 * builds the transponder. Split out so the tech-type and SAK branches can't
 * drift apart — they need identical post-probe handling.
 */
async function finishClassicBranch(
  rawData: RawTagData,
  final: ReturnType<typeof applyClassicProbe>,
): Promise<DetectionResult> {
  const canSendApdus =
    rawData.techTypes.some(t => t.includes('IsoDep')) ||
    (rawData.sak !== undefined && hasIsoDepCapability(rawData.sak));

  if (!canSendApdus) {
    // Plain Classic with no Layer 4 — nothing further to probe over ISO-DEP.
    // A mirrored WUP-SAK (0x88/0x98) is already flagged by `detectCardModes`
    // inside `createTransponder`, keylessly.
    return {
      success: true,
      transponder: createTransponder(final.chipType, rawData, {
        memorySize: final.memorySize,
        confidence: 'high',
        implementation: final.implementation,
        implementationByte: final.implementationByte,
      }),
    };
  }

  // Only claim a Classic credential when the card is actually still typed as
  // Classic. `applyClassicProbe` may have retyped it to MIFARE_PLUS_EV1, in
  // which case the Plus signature match inside the sweep records it properly
  // and labelling it "mifare-classic" here would both mislabel it and
  // duplicate that entry.
  const isStillClassic =
    final.chipType === ChipType.MIFARE_CLASSIC_1K ||
    final.chipType === ChipType.MIFARE_CLASSIC_4K ||
    final.chipType === ChipType.MIFARE_CLASSIC_MINI;

  const sweep = await runCredentialSweep({
    knownClassicChipType: isStillClassic ? final.chipType : undefined,
    classicImplementation: final.implementation,
    historicalBytes: rawData.historicalBytes,
    sak: rawData.sak,
  });

  // Classic + DESFire EV3 → DESFire EV3C ("C" for Classic). The Classic
  // credential survives in `credentials` and drives the Emulation Supported
  // display; the headline chip type becomes the EV3C.
  const chipType = sweep.promotedChipType ?? final.chipType;
  const isPromoted = sweep.promotedChipType !== undefined;

  // An ISD that answers proves a smart card substrate even when the Layer 3
  // GetVersion probe came back inconclusive (common on iOS).
  const implementation =
    final.implementation === 'native' && sweep.isd.isdSelected
      ? 'javacard_emulation'
      : final.implementation;

  return {
    success: true,
    transponder: createTransponder(chipType, rawData, {
      memorySize: isPromoted
        ? (sweep.desfireStorageSize ?? final.memorySize)
        : final.memorySize,
      versionInfo: isPromoted ? sweep.desfireVersionInfo : undefined,
      confidence: 'high',
      implementation,
      implementationByte: final.implementationByte,
      credentials: sweep.credentials,
      cplc: toCplcInfo(sweep.isd),
    }),
  };
}

// ============================================================================
// Branch: MIFARE Classic — SAK-based (iOS / Android fallback)
// ============================================================================

/**
 * MIFARE Classic family detection via SAK only. Used when the platform did
 * not surface a `MifareClassic` tech type (always the case on iOS) but the
 * SAK matches a known Classic value.
 *
 * Reached from dispatcher when: SAK indicates Classic and `IsoDep` is absent.
 * This corresponds to AN10833 Fig 1 path "SAK bit 5 = 0, bit 3 = 1".
 */
async function runMifareClassicSakBranch(
  rawData: RawTagData,
  sak: number,
): Promise<DetectionResult | null> {
  const result = detectMifareClassic(sak);
  if (result.success && result.chipType) {
    // AN10833 §2.1: probe Layer 3 GetVersion to detect SmartMX / Plus EV1
    // SL1 / JavaCard emulating Classic.
    const probe = await probeClassicGetVersion();
    const final = applyClassicProbe(result.chipType, result.memorySize, probe);

    return finishClassicBranch(rawData, final);
  }
  return null;
}

// ============================================================================
// Branch: Type 2 (NTAG / Ultralight) — Layer 3 GetVersion
// ============================================================================

/**
 * Type 2 / NTAG / Ultralight detection via Layer 3 GetVersion (cmd 0x60).
 * Falls back to `MifareUltralight` tech type or generic NTAG_UNKNOWN if
 * GetVersion fails or returns NAK.
 *
 * Reached from dispatcher when: `mightBeNtag(sak, techTypes)` is true
 * (SAK absent or 0x00 with NfcA, no IsoDep). AN10833 Fig 1 leaf "Type 2".
 */
async function runType2Branch(
  rawData: RawTagData,
  onProgress?: DetectionProgressCallback,
): Promise<DetectionResult> {
  const {sak, techTypes} = rawData;

  onProgress?.('Reading NTAG version...');
  console.log('[Detector] Attempting NTAG detection...');
  const ntagResult = await detectNtag();
  console.log('[Detector] NTAG detection result:', {
    success: ntagResult.success,
    chipType: ntagResult.chipType,
    error: ntagResult.error,
  });

  if (ntagResult.success && ntagResult.chipType) {
    let implantName: string | undefined;
    try {
      onProgress?.('Checking for implant signature...');
      const implantResult = await detectImplantNameInMemory(ntagResult.chipType);
      if (implantResult.found && implantResult.name) {
        implantName = implantResult.name;
        console.log('[Detector] Found implant name in memory:', implantName);
      }
    } catch (e) {
      console.warn('[Detector] Implant name detection failed:', e);
    }

    return {
      success: true,
      transponder: createTransponder(ntagResult.chipType, rawData, {
        memorySize: ntagResult.memorySize,
        versionInfo: ntagResult.versionInfo,
        confidence:
          ntagResult.chipType === ChipType.NTAG_UNKNOWN ? 'medium' : 'high',
        implantName,
        implementation: ntagResult.implementation,
        implementationByte: ntagResult.implementationByte,
      }),
    };
  }

  // GET_VERSION failed → check if it's an original Ultralight (no GET_VERSION
  // support; only EV1+ implements it).
  if ((sak === 0x00 || sak === undefined) && techTypes.some(t => t.includes('NfcA'))) {
    const hasMifareUltralightTech = techTypes.some(t =>
      t.includes('MifareUltralight'),
    );

    if (hasMifareUltralightTech) {
      console.log(
        '[Detector] MifareUltralight tech detected, identifying as original Ultralight',
      );
      return {
        success: true,
        transponder: createTransponder(ChipType.ULTRALIGHT, rawData, {
          memorySize: 48,
          confidence: 'medium',
        }),
      };
    }

    console.log('[Detector] NTAG detection failed, falling back to NTAG_UNKNOWN');
    return {
      success: true,
      transponder: createTransponder(ChipType.NTAG_UNKNOWN, rawData, {
        confidence: 'low',
      }),
    };
  }

  // Should be unreachable given the dispatcher's `mightBeNtag` gate, but bail
  // safely.
  return {
    success: true,
    transponder: createTransponder(ChipType.NTAG_UNKNOWN, rawData, {
      confidence: 'low',
    }),
  };
}

// ============================================================================
// Branch: ISO 14443-4 (DESFire, Plus, JavaCard, NTAG DNA)
// ============================================================================

/**
 * ISO 14443-4 / T=CL detection. Tries DESFire-style GetVersion first
 * (DESFire EV1/2/3, DESFire Light, NTAG 424 DNA), then ATS-based DESFire
 * detection, then JavaCard CPLC + AID probing, with multiple fallbacks.
 *
 * Reached from dispatcher when: SAK has bit 5 set (ISO-DEP capability) or
 * `IsoDep` tech is present. AN10833 Fig 1 leaf "ISO 14443-4".
 */
async function runIso14443_4Branch(
  rawData: RawTagData,
  onProgress?: DetectionProgressCallback,
): Promise<DetectionResult> {
  // 4a: DESFire-style GetVersion (covers DESFire and NTAG 424 DNA)
  onProgress?.('Reading DESFire version...');
  const desfireResult = await detectDesfire();
  if (desfireResult.success && desfireResult.chipType) {
    let desfireAppLabels: string[] | undefined;
    try {
      onProgress?.('Enumerating DESFire applications...');
      const apps = await enumerateDesfireApps();
      if (apps.length > 0) {
        desfireAppLabels = formatDesfireApps(apps);
      }
    } catch (e) {
      console.warn('[Detector] DESFire app enumeration failed:', e);
    }

    let implantName: string | undefined;
    const isNtagDna =
      desfireResult.chipType === ChipType.NTAG424_DNA ||
      desfireResult.chipType === ChipType.NTAG424_DNA_TT ||
      desfireResult.chipType === ChipType.NTAG413_DNA;

    if (isNtagDna) {
      // First, try cached NDEF (works even after GetVersion put the tag in
      // native mode).
      const cachedNdefResult = detectSpark2FromNdef(rawData.ndefRecords);
      if (cachedNdefResult.found && cachedNdefResult.name) {
        implantName = cachedNdefResult.name;
        console.log(
          '[Detector] Found Spark 2 implant from cached NDEF:',
          implantName,
        );
      } else {
        try {
          onProgress?.('Reading NDEF for Spark 2...');
          const spark2Result = await detectSpark2Implant();
          if (spark2Result.found && spark2Result.name) {
            implantName = spark2Result.name;
            console.log('[Detector] Found Spark 2 implant via APDU:', implantName);
          }
        } catch (e) {
          console.warn('[Detector] Spark 2 APDU detection failed:', e);
        }
      }
    }

    // A card whose SAK also advertises MIFARE Classic carries a Classic
    // credential alongside the DESFire one. This is the common Android path
    // for SAK 0x28 — the tag exposes IsoDep, so it lands here rather than in
    // the Classic branches, and it's where the EV3C promotion has to happen.
    const classicFromSak =
      rawData.sak !== undefined && isMifareClassicSak(rawData.sak)
        ? detectMifareClassic(rawData.sak)
        : undefined;

    // Sweep for the other credentials this card may carry. DESFire has
    // already been probed, so hand the result in rather than replaying it.
    onProgress?.('Checking for GlobalPlatform ISD...');
    const sweep = await runCredentialSweep({
      knownClassicChipType: classicFromSak?.chipType,
      // A native EV3C's Classic credential runs on the same genuine NXP
      // silicon as its DESFire one, so inherit the substrate GetVersion
      // reported rather than leaving it unknown.
      classicImplementation: desfireResult.implementation,
      knownDesfire: {
        chipType: desfireResult.chipType,
        implementation: desfireResult.implementation,
        implementationByte: desfireResult.implementationByte,
      },
      historicalBytes: rawData.historicalBytes,
      sak: rawData.sak,
    });

    const implementation =
      desfireResult.implementation === 'native' && sweep.isd.isdSelected
        ? 'javacard_emulation'
        : desfireResult.implementation;

    // Headline identity. Precedence:
    //   1. A card that answered a GlobalPlatform ISD is a JavaCard smart card
    //      hosting whatever it emulated. Its silicon (J3R452 / J3R180, via
    //      CPLC) is the real identity — even the EV3-shape (Classic + DESFire
    //      EV3) is emulation here, so every credential is demoted to
    //      `sweep.credentials` and the DESFire GetVersion result is not the
    //      headline.
    //   2. No ISD but Classic + DESFire EV3 → native DESFire EV3C, a real
    //      combined NXP part.
    //   3. Otherwise, keep what GetVersion reported (native DESFire, Plus,
    //      NTAG DNA, MIFARE 2GO).
    let chipType: ChipType;
    if (sweep.isd.isdSelected) {
      chipType = ChipType.JCOP4;
    } else if (sweep.promotedChipType) {
      chipType = sweep.promotedChipType;
    } else {
      chipType = desfireResult.chipType;
    }

    // The emulated credential is now surfaced via `credentials`, so drop the
    // storage/version of that credential from the headline when the card is
    // really a JavaCard — those describe the emulation, not the silicon.
    const isJavaCardHeadline = chipType === ChipType.JCOP4;

    // When the headline is a JavaCard, render it as fully as the pure-JavaCard
    // branch does: probe its installed applets and persistent storage, and
    // keep the known DESFire AIDs enumerated from the emulated DESFire
    // credential (e.g. HID SEOS, Gallagher). The GP applets (OpenPGP, FIDO,
    // ...) come from the JavaCard probe; the two lists are merged, deduped.
    let installedApplets = desfireAppLabels;
    let storageInfo: Transponder['storageInfo'];
    if (isJavaCardHeadline) {
      onProgress?.('Probing JavaCard applets...');
      const jc = await detectJavaCard();
      const merged = [
        ...(desfireAppLabels ?? []),
        ...(jc.installedApplets ?? []),
      ];
      installedApplets =
        merged.length > 0 ? Array.from(new Set(merged)) : undefined;
      try {
        const mem = await getJavacardStorageInfo();
        if (mem) {
          storageInfo = mem;
        }
      } catch {
        // Storage read is best-effort.
      }
    }

    return {
      success: true,
      transponder: createTransponder(chipType, rawData, {
        memorySize: isJavaCardHeadline ? undefined : desfireResult.storageSize,
        versionInfo: isJavaCardHeadline ? undefined : desfireResult.versionInfo,
        confidence:
          desfireResult.chipType === ChipType.DESFIRE_UNKNOWN
            ? 'medium'
            : 'high',
        implantName,
        installedApplets,
        storageInfo,
        implementation,
        implementationByte: desfireResult.implementationByte,
        credentials: sweep.credentials,
        cplc: toCplcInfo(sweep.isd),
      }),
    };
  }

  // 4a½: An official DT historical-byte signature is a definitive JavaCard
  // product ID. Check it before the weak ATS/SAK heuristics in 4b, which would
  // otherwise mislabel a bare (non-emulating) DT JavaCard — SAK 0x20, ATQA
  // 0x0004 — as NTAG 424 DNA and never run the reliable ISD/CPLC probe.
  // (DT cards that *emulate* a credential answer GetVersion and are handled by
  // 4a above; central `createTransponder` stamps `dtProduct` in both cases.)
  if (matchDtHistoricalSignature(rawData.historicalBytes)) {
    onProgress?.('Identifying DT smart card...');
    const jc = await detectJavaCard();
    let storageInfo: Transponder['storageInfo'];
    try {
      const mem = await getJavacardStorageInfo();
      if (mem) {
        storageInfo = mem;
      }
    } catch {
      // Storage read is best-effort.
    }
    return {
      success: true,
      transponder: createTransponder(ChipType.JCOP4, rawData, {
        confidence: 'high',
        installedApplets: jc.installedApplets,
        storageInfo,
        cplc: jc.cplc
          ? {
              ...jc.cplc,
              icTypeName: jc.icTypeName,
              fabricatorName: jc.fabricatorName,
              osName: jc.osName,
            }
          : undefined,
      }),
    };
  }

  // 4b: GetVersion failed → ATS-based DESFire detection
  const desfireAtsResult = detectDesfireFromAts(
    rawData.historicalBytes,
    rawData.ats,
    rawData.sak,
    rawData.atqa,
  );
  if (desfireAtsResult.success && desfireAtsResult.chipType) {
    return {
      success: true,
      transponder: createTransponder(desfireAtsResult.chipType, rawData, {
        memorySize: desfireAtsResult.storageSize,
        confidence: 'medium',
      }),
    };
  }

  // 4c: AN10833 Figure 1 — match against the MIFARE Plus historical-byte
  // signature table. Cards in SL3 (AES-only mode) don't answer DESFire
  // GetVersion and can be uniquely identified by these prefixes.
  const plusMatch = matchPlusHistoricalSignature(rawData.historicalBytes);
  if (plusMatch) {
    console.log('[Detector] Plus signature match:', plusMatch);

    // DESFire GetVersion already failed above, so skip re-probing it; the
    // sweep here is for the ISD/CPLC and to record the Plus credential.
    onProgress?.('Checking for GlobalPlatform ISD...');
    const sweep = await runCredentialSweep({
      historicalBytes: rawData.historicalBytes,
      sak: rawData.sak,
      skipDesfireProbe: true,
    });

    return {
      success: true,
      transponder: createTransponder(plusMatch.chipType, rawData, {
        memorySize: plusMatch.memoryK * 1024,
        confidence: 'high',
        implementation: sweep.isd.isdSelected ? 'javacard_emulation' : undefined,
        credentials: sweep.credentials,
        cplc: toCplcInfo(sweep.isd),
      }),
    };
  }

  // 4d: JavaCard via CPLC + AID probing (filtered by historical-byte hint)
  if (mightBeJavaCard(rawData.historicalBytes, rawData.ats)) {
    onProgress?.('Probing JavaCard applets...');
    const jcResult = await detectJavaCard();
    if (jcResult.success && jcResult.chipType) {
      // Storage info must be read before naming so we can distinguish Apex
      // (≈84336 bytes) from Fidesmo wearables on the same applet platform.
      let storageInfo: Transponder['storageInfo'];
      try {
        const mem = await getJavacardStorageInfo();
        if (mem) {
          storageInfo = mem;
        }
      } catch {
        // Storage read is best-effort
      }
      const identity = getJavacardImplantName(
        jcResult.installedApplets,
        jcResult.isFidesmo,
        storageInfo,
        jcResult.icTypeName,
      );
      return {
        success: true,
        transponder: createTransponder(jcResult.chipType, rawData, {
          confidence:
            jcResult.chipType === ChipType.JCOP4 ? 'high' : 'medium',
          implantName: identity.name,
          identityEvidence: identity.evidence,
          installedApplets: jcResult.installedApplets,
          storageInfo,
          credentials: credentialsForJavaCard({
            sak: rawData.sak,
            classicChipType: classicChipTypeFromSak(rawData.sak),
            icTypeName: jcResult.icTypeName,
            osName: jcResult.osName,
            isdSelected: jcResult.isdSelected ?? false,
          }),
          cplc: jcResult.cplc
            ? {
                ...jcResult.cplc,
                icTypeName: jcResult.icTypeName,
                fabricatorName: jcResult.fabricatorName,
                osName: jcResult.osName,
              }
            : undefined,
        }),
      };
    }

    // CPLC failed → ATS-based JavaCard detection
    const jcAtsResult = detectJavaCardFromAts(
      rawData.historicalBytes,
      rawData.ats,
    );
    if (jcAtsResult.success && jcAtsResult.chipType) {
      return {
        success: true,
        transponder: createTransponder(jcAtsResult.chipType, rawData, {
          confidence: 'medium',
        }),
      };
    }
  }

  // 4e: Fall back to JavaCard probing without the `mightBeJavaCard` hint —
  // some JavaCards lack distinguishing historical bytes.
  onProgress?.('Probing for smartcard applets...');
  const jcFallback = await detectJavaCard();
  if (jcFallback.success && jcFallback.chipType) {
    let fallbackStorageInfo: Transponder['storageInfo'];
    try {
      const mem = await getJavacardStorageInfo();
      if (mem) {
        fallbackStorageInfo = mem;
      }
    } catch {
      // Storage read is best-effort
    }
    const identity = getJavacardImplantName(
      jcFallback.installedApplets,
      jcFallback.isFidesmo,
      fallbackStorageInfo,
      jcFallback.icTypeName,
    );
    return {
      success: true,
      transponder: createTransponder(jcFallback.chipType, rawData, {
        confidence: 'medium',
        implantName: identity.name,
        identityEvidence: identity.evidence,
        installedApplets: jcFallback.installedApplets,
        storageInfo: fallbackStorageInfo,
        credentials: credentialsForJavaCard({
          sak: rawData.sak,
          classicChipType: classicChipTypeFromSak(rawData.sak),
          icTypeName: jcFallback.icTypeName,
          osName: jcFallback.osName,
          isdSelected: jcFallback.isdSelected ?? false,
        }),
        cplc: jcFallback.cplc
          ? {
              ...jcFallback.cplc,
              icTypeName: jcFallback.icTypeName,
              fabricatorName: jcFallback.fabricatorName,
              osName: jcFallback.osName,
            }
          : undefined,
      }),
    };
  }

  // 4f: Last resort — ATS-based JavaCard match without the gate
  const jcAtsFallback = detectJavaCardFromAts(
    rawData.historicalBytes,
    rawData.ats,
  );
  if (jcAtsFallback.success && jcAtsFallback.chipType) {
    return {
      success: true,
      transponder: createTransponder(jcAtsFallback.chipType, rawData, {
        confidence: 'low',
      }),
    };
  }

  // ISO-DEP but unidentifiable → generic ISO 14443-A
  return {
    success: true,
    transponder: createTransponder(ChipType.ISO14443A_UNKNOWN, rawData, {
      confidence: 'low',
    }),
  };
}

// ============================================================================
// Branch: ISO 15693 / NFC-V
// ============================================================================

/**
 * ISO 15693 / NFC-V detection. Identifies SLIX family, NTAG 5, and runs
 * sensor-implant probes for NTAG 5 Boost/Link variants.
 */
async function runIso15693Branch(
  rawData: RawTagData,
  onProgress?: DetectionProgressCallback,
): Promise<DetectionResult> {
  onProgress?.('Reading ISO 15693 system info...');
  const iso15693Result = await detectIso15693();
  if (iso15693Result.success && iso15693Result.chipType) {
    const knownTypes = [
      ChipType.SLIX,
      ChipType.SLIX2,
      ChipType.SLIX_S,
      ChipType.SLIX_L,
      ChipType.NTAG5_LINK,
      ChipType.NTAG5_BOOST,
      ChipType.NTAG5_SWITCH,
    ];
    const confidence: Transponder['confidence'] =
      iso15693Result.chipType === ChipType.ISO15693_UNKNOWN
        ? 'low'
        : knownTypes.includes(iso15693Result.chipType)
          ? 'high'
          : 'medium';

    let implantName: string | undefined;
    let sensorTemperature: Transponder['temperature'];
    let sensorTemperature2: Transponder['temperature2'];

    const isNtag5WithI2c =
      iso15693Result.chipType === ChipType.NTAG5_BOOST ||
      iso15693Result.chipType === ChipType.NTAG5_LINK;

    if (isNtag5WithI2c && iso15693Result.uid) {
      try {
        onProgress?.('Probing I2C sensors...');
        const sensorResult = await detectNtag5SensorImplant(
          iso15693Result.uid,
          iso15693Result.afi,
          iso15693Result.dsfid,
        );
        if (sensorResult.detected && sensorResult.implantName) {
          implantName = sensorResult.implantName;
          sensorTemperature = sensorResult.temperature;
          sensorTemperature2 = sensorResult.temperature2;
          console.log(
            '[Detector] Found sensor implant:',
            implantName,
            `(${sensorResult.deviceType}, ${sensorResult.sensorType})`,
          );
        }
      } catch (e) {
        console.warn('[Detector] NTAG5 sensor detection failed:', e);
      }
    }

    if (!implantName) {
      try {
        onProgress?.('Reading NDEF for Spark 1...');
        const sparkResult = await detectSparkImplant(iso15693Result.chipType);
        if (sparkResult.found && sparkResult.name) {
          implantName = sparkResult.name;
          console.log('[Detector] Found Spark implant:', implantName);
        }
      } catch (e) {
        console.warn('[Detector] Spark detection failed:', e);
      }
    }

    return {
      success: true,
      transponder: createTransponder(iso15693Result.chipType, rawData, {
        confidence,
        implantName,
        temperature: sensorTemperature,
        temperature2: sensorTemperature2,
      }),
    };
  }

  return {
    success: true,
    transponder: createTransponder(ChipType.ISO15693_UNKNOWN, rawData, {
      confidence: 'low',
    }),
  };
}

// ============================================================================
// Branch: ISO 14443-B
// ============================================================================

function runIso14443BBranch(rawData: RawTagData): DetectionResult {
  return {
    success: true,
    transponder: createTransponder(ChipType.ISO14443B_UNKNOWN, rawData, {
      confidence: 'low',
    }),
  };
}

// ============================================================================
// Dispatcher
// ============================================================================

/**
 * Detect chip type by dispatching into one of six branches based on tag
 * tech types and SAK structure (AN10833 Fig 1).
 *
 * Branch precedence is preserved from the pre-rework waterfall to keep
 * behavior bit-identical until later milestones add new probes.
 */
export async function detectChip(
  rawData: RawTagData,
  onProgress?: DetectionProgressCallback,
): Promise<DetectionResult> {
  // Start fixture capture if the user has it enabled — runs in parallel with
  // the rest of detection. Read is fire-and-forget (await still resolves
  // before the first transceive call because both are awaited from the same
  // event loop tick).
  if (await isFixtureCaptureEnabled()) {
    fixtureRecorder.startCapture();
  } else {
    fixtureRecorder.stopCapture();
  }

  try {
    const {sak, techTypes} = rawData;
    const hasMifareClassicTech = techTypes.some(t => t.includes('MifareClassic'));
    const hasIsoDepTech = techTypes.some(t => t.includes('IsoDep'));

    console.log('[Detector] Starting detection with:', {
      uid: rawData.uid,
      sak: sak !== undefined ? `0x${sak.toString(16)}` : 'undefined',
      techTypes,
      hasIsoDep: hasIsoDepTech,
      hasNfcA: techTypes.some(t => t.includes('NfcA')),
    });

    // 1. MIFARE Classic (Android tech type, fastest path)
    onProgress?.('Checking MIFARE Classic...');
    if (hasMifareClassicTech && !hasIsoDepTech) {
      return await runMifareClassicTechBranch(rawData);
    }

    // 2. MIFARE Classic (SAK-based fallback — covers iOS)
    //    AN10833 Fig 1: SAK bit 5 = 0, bit 3 = 1
    if (sak !== undefined && isMifareClassicSak(sak) && !hasIsoDepTech) {
      const classicResult = await runMifareClassicSakBranch(rawData, sak);
      if (classicResult) {
        return classicResult;
      }
    }

    // 3. Type 2 family (NTAG / Ultralight via Layer 3 GetVersion)
    //    AN10833 Fig 1: SAK bit 5 = 0, bit 3 = 0 (or SAK absent with NfcA)
    if (mightBeNtag(sak, techTypes)) {
      return await runType2Branch(rawData, onProgress);
    }

    // 4. ISO 14443-4 / T=CL (DESFire, Plus, JavaCard, NTAG DNA)
    //    AN10833 Fig 1: SAK bit 5 = 1
    if ((sak !== undefined && hasIsoDepCapability(sak)) || hasIsoDepTech) {
      return await runIso14443_4Branch(rawData, onProgress);
    }

    // 5. ISO 15693 / NFC-V
    if (isIso15693(techTypes)) {
      return await runIso15693Branch(rawData, onProgress);
    }

    // 6. ISO 14443-B
    if (techTypes.some(t => t.includes('NfcB'))) {
      return runIso14443BBranch(rawData);
    }

    // No branch matched
    return {
      success: true,
      transponder: createTransponder(ChipType.UNKNOWN, rawData, {
        confidence: 'low',
      }),
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Detection failed: ${errorMessage}`,
    };
  }
}

// ============================================================================
// Public utilities (unchanged)
// ============================================================================

export function getDetectionSummary(transponder: Transponder): string {
  const parts: string[] = [transponder.chipName];

  if (transponder.memorySize) {
    parts.push(`(${transponder.memorySize} bytes)`);
  }

  if (transponder.isCloneable) {
    parts.push('- Cloneable');
  } else {
    parts.push('- Not cloneable');
  }

  return parts.join(' ');
}

export function canDoAdvancedDetection(
  chipType: ChipType,
): {canDetect: boolean; reason?: string} {
  if (
    chipType === ChipType.MIFARE_CLASSIC_1K ||
    chipType === ChipType.MIFARE_CLASSIC_4K ||
    chipType === ChipType.MIFARE_CLASSIC_MINI
  ) {
    if (Platform.OS === 'ios') {
      return {
        canDetect: false,
        reason: 'MIFARE Classic sector operations require Android',
      };
    }
  }

  return {canDetect: true};
}
