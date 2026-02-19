/**
 * Detection Orchestrator
 * Main entry point for chip detection using waterfall approach
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
} from './mifare';
import {detectDesfire, detectDesfireFromAts, detectSpark2Implant, detectSpark2FromNdef, enumerateDesfireApps, formatDesfireApps} from './desfire';
import {detectIso15693, isIso15693, detectSparkImplant} from './iso15693';
import {detectNtag5SensorImplant} from './ntag5sensor';
import {detectJavaCard, mightBeJavaCard, detectJavaCardFromAts, getJavacardStorageInfo} from './javacard';

/**
 * Create a Transponder object from detection results
 */
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
  };
}

/**
 * Determine implant name based on detected JavaCard applets and Fidesmo flag
 * - Fidesmo indicates Apex (only Apex has Fidesmo platform)
 * - JavaCard Memory without Fidesmo indicates flexSecure
 * - Payment applets indicate this is a payment card, not an implant
 */
function getJavacardImplantName(
  installedApplets?: string[],
  isFidesmo?: boolean,
): string | undefined {
  if (!installedApplets || installedApplets.length === 0) {
    return undefined;
  }

  // Payment card detection - not an implant
  if (installedApplets.includes('Payment (PPSE)')) {
    const network = installedApplets.find(a =>
      ['Visa', 'Mastercard', 'American Express', 'Discover', 'Maestro'].includes(a),
    );
    return network ? `${network} Payment Card` : 'Payment Card';
  }

  // Fidesmo detected (via AID probe or memory fingerprint) — definitely Apex
  if (isFidesmo || installedApplets.includes('Fidesmo')) {
    return 'Apex';
  }

  // JavaCard Memory present without Fidesmo — flexSecure
  if (installedApplets.includes('JavaCard Memory')) {
    return 'flexSecure';
  }

  return undefined;
}

/** Progress callback type for detection updates */
export type DetectionProgressCallback = (step: string) => void;

/**
 * Detect chip type using waterfall approach
 *
 * Detection order:
 * 1. Check for MIFARE Classic (SAK-based, quick)
 * 2. Check for NTAG (GET_VERSION command)
 * 3. Check for ISO-DEP capable chips (Phase 4: DESFire, Plus, JavaCard)
 * 4. Fall back to generic type based on technology
 */
export async function detectChip(
  rawData: RawTagData,
  onProgress?: DetectionProgressCallback,
): Promise<DetectionResult> {
  try {
    const {sak, techTypes} = rawData;

    console.log('[Detector] Starting detection with:', {
      uid: rawData.uid,
      sak: sak !== undefined ? `0x${sak.toString(16)}` : 'undefined',
      techTypes,
      hasIsoDep: techTypes.some(t => t.includes('IsoDep')),
      hasNfcA: techTypes.some(t => t.includes('NfcA')),
    });

    // ========================================================================
    // Step 1: Check for MIFARE Classic
    // Use tech type detection first (most reliable on Android), then SAK
    // ========================================================================
    onProgress?.('Checking MIFARE Classic...');

    const hasMifareClassicTech = techTypes.some(t =>
      t.includes('MifareClassic'),
    );
    const hasIsoDepTech = techTypes.some(t => t.includes('IsoDep'));

    // If we have MifareClassic tech type and NO IsoDep, it's definitely Classic
    if (hasMifareClassicTech && !hasIsoDepTech) {
      // Determine 1K vs 4K vs Mini
      // Priority: mifareClassic.size (most reliable on Android) > SAK > UID length
      let chipType = ChipType.MIFARE_CLASSIC_1K; // Default to 1K
      let memorySize = 1024;

      // First, check mifareClassic object from Android (most reliable)
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
      }
      // Fallback to SAK-based detection
      // SAK 0x18, 0x38, or 0x98 indicates 4K
      else if (sak === 0x18 || sak === 0x38 || sak === 0x98) {
        chipType = ChipType.MIFARE_CLASSIC_4K;
        memorySize = 4096;
      }
      // SAK 0x09 indicates Mini
      else if (sak === 0x09) {
        chipType = ChipType.MIFARE_CLASSIC_MINI;
        memorySize = 320;
      }
      // 7-byte UID often indicates 4K (but not always)
      else if (rawData.uid && rawData.uid.replace(/[:\s-]/g, '').length === 14) {
        // 14 hex chars = 7 bytes - could be 4K, but use SAK if available
        if (sak === undefined) {
          chipType = ChipType.MIFARE_CLASSIC_4K;
          memorySize = 4096;
        }
      }

      return {
        success: true,
        transponder: createTransponder(chipType, rawData, {
          memorySize,
          confidence: 'high',
        }),
      };
    }

    // SAK-based MIFARE Classic detection (fallback, includes iOS)
    if (sak !== undefined && isMifareClassicSak(sak) && !hasIsoDepTech) {
      const result = detectMifareClassic(sak);
      if (result.success && result.chipType) {
        return {
          success: true,
          transponder: createTransponder(result.chipType, rawData, {
            memorySize: result.memorySize,
            confidence: 'high',
          }),
        };
      }
    }

    // ========================================================================
    // Step 2: Check for NTAG (Type 2 tags with GET_VERSION)
    // ========================================================================
    const couldBeNtag = mightBeNtag(sak, techTypes);
    console.log('[Detector] mightBeNtag result:', couldBeNtag);

    if (couldBeNtag) {
      onProgress?.('Reading NTAG version...');
      console.log('[Detector] Attempting NTAG detection...');
      const ntagResult = await detectNtag();
      console.log('[Detector] NTAG detection result:', {
        success: ntagResult.success,
        chipType: ntagResult.chipType,
        error: ntagResult.error,
      });

      if (ntagResult.success && ntagResult.chipType) {
        // Try to detect implant name in last memory pages
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
          }),
        };
      }
      // If GET_VERSION failed, check for MIFARE Ultralight
      // Original Ultralight doesn't support GET_VERSION (only EV1+ does)
      // SAK can be 0x00 or undefined for Ultralight
      if ((sak === 0x00 || sak === undefined) && techTypes.some(t => t.includes('NfcA'))) {
        // Check for MifareUltralight tech type (Android provides this)
        const hasMifareUltralightTech = techTypes.some(t =>
          t.includes('MifareUltralight'),
        );

        if (hasMifareUltralightTech) {
          console.log('[Detector] MifareUltralight tech detected, identifying as original Ultralight');
          return {
            success: true,
            transponder: createTransponder(ChipType.ULTRALIGHT, rawData, {
              memorySize: 48, // Original Ultralight has 48 bytes user memory
              confidence: 'medium',
            }),
          };
        }

        // No MifareUltralight tech - fall back to unknown NTAG
        console.log('[Detector] NTAG detection failed, falling back to NTAG_UNKNOWN');
        return {
          success: true,
          transponder: createTransponder(ChipType.NTAG_UNKNOWN, rawData, {
            confidence: 'low',
          }),
        };
      }
    }

    // ========================================================================
    // Step 3: Check for ISO-DEP capable chips (DESFire, NTAG 424 DNA, JavaCard)
    // ========================================================================
    if (
      (sak !== undefined && hasIsoDepCapability(sak)) ||
      hasIsoDepTech
    ) {
      // 3a: Always try DESFire/NTAG 424 DNA detection first via GET_VERSION
      // This command works on DESFire EV1/2/3, DESFire Light, NTAG 424 DNA
      onProgress?.('Reading DESFire version...');
      const desfireResult = await detectDesfire();
      if (desfireResult.success && desfireResult.chipType) {
        // Enumerate DESFire applications (best-effort, must run before ISO 7816 SELECT)
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

        // Check for Spark 2 implant on NTAG 424 DNA / NTAG 413 DNA
        let implantName: string | undefined;
        const isNtagDna =
          desfireResult.chipType === ChipType.NTAG424_DNA ||
          desfireResult.chipType === ChipType.NTAG424_DNA_TT ||
          desfireResult.chipType === ChipType.NTAG413_DNA;

        if (isNtagDna) {
          // First, try to detect from cached NDEF records (doesn't require APDU)
          // This works even after DESFire GET_VERSION puts the tag in native mode
          const cachedNdefResult = detectSpark2FromNdef(rawData.ndefRecords);
          if (cachedNdefResult.found && cachedNdefResult.name) {
            implantName = cachedNdefResult.name;
            console.log('[Detector] Found Spark 2 implant from cached NDEF:', implantName);
          } else {
            // Fallback: Try APDU-based NDEF reading (may fail if tag is in native mode)
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
          }),
        };
      }

      // 3b: DESFire command failed - try ATS-based detection
      const desfireAtsResult = detectDesfireFromAts(
        rawData.historicalBytes,
        rawData.ats,
        sak,
        rawData.atqa,
      );
      if (desfireAtsResult.success && desfireAtsResult.chipType) {
        return {
          success: true,
          transponder: createTransponder(desfireAtsResult.chipType, rawData, {
            memorySize: desfireAtsResult.storageSize,
            confidence: 'medium', // Lower confidence since no version command
          }),
        };
      }

      // 3c: Try JavaCard detection (check historical bytes and CPLC)
      if (mightBeJavaCard(rawData.historicalBytes, rawData.ats)) {
        onProgress?.('Probing JavaCard applets...');
        const jcResult = await detectJavaCard();
        if (jcResult.success && jcResult.chipType) {
          const implantName = getJavacardImplantName(
            jcResult.installedApplets,
            jcResult.isFidesmo,
          );
          // Read storage info
          let storageInfo: Transponder['storageInfo'];
          try {
            const mem = await getJavacardStorageInfo();
            if (mem) {
              storageInfo = mem;
            }
          } catch {
            // Storage read is best-effort
          }
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

        // JavaCard CPLC failed - try ATS-based detection
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

      // 3d: If DESFire and likely JavaCard checks failed, try JavaCard as general fallback
      // (some JavaCards don't have obvious historical bytes)
      onProgress?.('Probing for smartcard applets...');
      const jcFallback = await detectJavaCard();
      if (jcFallback.success && jcFallback.chipType) {
        const implantName = getJavacardImplantName(
          jcFallback.installedApplets,
          jcFallback.isFidesmo,
        );
        // Read storage info
        let fallbackStorageInfo: Transponder['storageInfo'];
        try {
          const mem = await getJavacardStorageInfo();
          if (mem) {
            fallbackStorageInfo = mem;
          }
        } catch {
          // Storage read is best-effort
        }
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

      // 3e: Last resort - try ATS-based JavaCard detection without mightBeJavaCard check
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

      // ISO-DEP but couldn't identify - mark as unknown ISO 14443-A
      return {
        success: true,
        transponder: createTransponder(ChipType.ISO14443A_UNKNOWN, rawData, {
          confidence: 'low',
        }),
      };
    }

    // ========================================================================
    // Step 4: Check for ISO 15693 (NFC-V) - SLIX and NTAG 5 detection
    // ========================================================================
    if (isIso15693(techTypes)) {
      onProgress?.('Reading ISO 15693 system info...');
      const iso15693Result = await detectIso15693();
      if (iso15693Result.success && iso15693Result.chipType) {
        // Determine confidence based on whether we got a specific chip type
        const knownTypes = [
          ChipType.SLIX,
          ChipType.SLIX2,
          ChipType.SLIX_S,
          ChipType.SLIX_L,
          ChipType.NTAG5_LINK,
          ChipType.NTAG5_BOOST,
          ChipType.NTAG5_SWITCH,
        ];
        const confidence =
          iso15693Result.chipType === ChipType.ISO15693_UNKNOWN
            ? 'low'
            : knownTypes.includes(iso15693Result.chipType)
              ? 'high'
              : 'medium';

        let implantName: string | undefined;

        // For NTAG5 Boost/Link: check for sensor implants (Temptress, VK Thermo)
        const isNtag5WithI2c =
          iso15693Result.chipType === ChipType.NTAG5_BOOST ||
          iso15693Result.chipType === ChipType.NTAG5_LINK;

        let sensorTemperature: Transponder['temperature'];
        let sensorTemperature2: Transponder['temperature2'];

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
            // Sensor probing failure does NOT block basic chip identification
          }
        }

        // Check for Spark implant by reading NDEF for vivokey.co URL
        // (only if we haven't already identified the implant)
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

      // Fallback to unknown ISO 15693
      return {
        success: true,
        transponder: createTransponder(ChipType.ISO15693_UNKNOWN, rawData, {
          confidence: 'low',
        }),
      };
    }

    // ========================================================================
    // Step 5: Check for ISO 14443-B
    // ========================================================================
    if (techTypes.some(t => t.includes('NfcB'))) {
      return {
        success: true,
        transponder: createTransponder(ChipType.ISO14443B_UNKNOWN, rawData, {
          confidence: 'low',
        }),
      };
    }

    // ========================================================================
    // Fallback: Unknown chip
    // ========================================================================
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

/**
 * Get a brief description of what was detected
 */
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

/**
 * Check if we can do advanced detection on this platform
 */
export function canDoAdvancedDetection(
  chipType: ChipType,
): {canDetect: boolean; reason?: string} {
  // MIFARE Classic sector operations need Android
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
