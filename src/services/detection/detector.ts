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
} from '../../types/detection';
import {detectNtag, mightBeNtag, detectImplantNameInMemory} from './ntag';
import {
  detectMifareClassic,
  isMifareClassicSak,
  hasIsoDepCapability,
  detectSakSwap,
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
    sakSwapInfo?: Transponder['sakSwapInfo'];
    implantName?: string;
    temperature?: Transponder['temperature'];
    temperature2?: Transponder['temperature2'];
    installedApplets?: string[];
    storageInfo?: Transponder['storageInfo'];
    implementation?: Transponder['implementation'];
    implementationByte?: number;
  } = {},
): Transponder {
  const cloneInfo = CHIP_CLONEABILITY[type];

  // Run SAK swap detection if we have SAK
  let sakSwapInfo = options.sakSwapInfo;
  if (!sakSwapInfo && rawData.sak !== undefined) {
    sakSwapInfo = detectSakSwap(
      rawData.sak,
      rawData.atqa,
      rawData.historicalBytes,
    );
  }

  const capabilities = deriveCapabilities({
    type,
    implementation: options.implementation,
  });

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
    sakSwapInfo,
    implantName: options.implantName,
    temperature: options.temperature,
    temperature2: options.temperature2,
    installedApplets: options.installedApplets,
    storageInfo: options.storageInfo,
    confidence: options.confidence ?? 'medium',
    detectedOn: Platform.OS as 'ios' | 'android',
    implementation: options.implementation,
    implementationByte: options.implementationByte,
    capabilities,
  };
}

/**
 * Apex implants report ~84336 bytes total persistent memory via the
 * JavaCard Memory applet. Fidesmo wearables (rings, fobs, payment cards)
 * use the same Fidesmo platform but run on different secure-element
 * silicon with different storage capacity, so this is the discriminator.
 *
 * Allow ±5% tolerance for chip-to-chip variation and any small overhead
 * the applet itself reports.
 */
const APEX_PERSISTENT_TOTAL = 84336;
const APEX_STORAGE_TOLERANCE = 0.05;

function isApexStorageSize(persistentTotal?: number): boolean {
  if (persistentTotal === undefined) {
    return false;
  }
  const delta = Math.abs(persistentTotal - APEX_PERSISTENT_TOTAL);
  return delta / APEX_PERSISTENT_TOTAL <= APEX_STORAGE_TOLERANCE;
}

/**
 * Determine implant name based on detected JavaCard applets, Fidesmo flag,
 * and total persistent storage:
 *
 * - Payment applets → "Payment Card" (not an implant)
 * - Fidesmo + Apex storage signature → Apex
 * - Fidesmo without Apex storage signature → Fidesmo wearable (ring, fob,
 *   payment card, etc.) — distinguishable from Apex by silicon capacity
 * - JavaCard Memory without Fidesmo → flexSecure
 * - Otherwise → undefined (generic JavaCard)
 */
function getJavacardImplantName(
  installedApplets?: string[],
  isFidesmo?: boolean,
  storageInfo?: Transponder['storageInfo'],
): string | undefined {
  if (!installedApplets || installedApplets.length === 0) {
    return undefined;
  }

  if (installedApplets.includes('Payment (PPSE)')) {
    const network = installedApplets.find(a =>
      ['Visa', 'Mastercard', 'American Express', 'Discover', 'Maestro'].includes(
        a,
      ),
    );
    return network ? `${network} Payment Card` : 'Payment Card';
  }

  const fidesmoDetected = isFidesmo || installedApplets.includes('Fidesmo');
  if (fidesmoDetected) {
    if (isApexStorageSize(storageInfo?.persistentTotal)) {
      return 'Apex';
    }
    return 'Fidesmo Wearable';
  }

  if (installedApplets.includes('JavaCard Memory')) {
    return 'flexSecure';
  }

  return undefined;
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

    return {
      success: true,
      transponder: createTransponder(desfireResult.chipType, rawData, {
        memorySize: desfireResult.storageSize,
        versionInfo: desfireResult.versionInfo,
        confidence:
          desfireResult.chipType === ChipType.DESFIRE_UNKNOWN
            ? 'medium'
            : 'high',
        implantName,
        installedApplets: desfireAppLabels,
        implementation: desfireResult.implementation,
        implementationByte: desfireResult.implementationByte,
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
    return {
      success: true,
      transponder: createTransponder(plusMatch.chipType, rawData, {
        memorySize: plusMatch.memoryK * 1024,
        confidence: 'high',
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
      const implantName = getJavacardImplantName(
        jcResult.installedApplets,
        jcResult.isFidesmo,
        storageInfo,
      );
      return {
        success: true,
        transponder: createTransponder(jcResult.chipType, rawData, {
          confidence:
            jcResult.chipType === ChipType.JCOP4 ? 'high' : 'medium',
          implantName,
          installedApplets: jcResult.installedApplets,
          storageInfo,
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
    const implantName = getJavacardImplantName(
      jcFallback.installedApplets,
      jcFallback.isFidesmo,
      fallbackStorageInfo,
    );
    return {
      success: true,
      transponder: createTransponder(jcFallback.chipType, rawData, {
        confidence: 'medium',
        implantName,
        installedApplets: jcFallback.installedApplets,
        storageInfo: fallbackStorageInfo,
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
