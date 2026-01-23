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
import {detectNtag, mightBeNtag} from './ntag';
import {
  detectMifareClassic,
  isMifareClassicSak,
  hasIsoDepCapability,
  detectSakSwap,
} from './mifare';
import {detectDesfire, detectDesfireFromAts} from './desfire';
import {detectIso15693, isIso15693} from './iso15693';
import {detectJavaCard, mightBeJavaCard, detectJavaCardFromAts} from './javacard';

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
    confidence: options.confidence ?? 'medium',
    detectedOn: Platform.OS as 'ios' | 'android',
  };
}

/**
 * Detect chip type using waterfall approach
 *
 * Detection order:
 * 1. Check for MIFARE Classic (SAK-based, quick)
 * 2. Check for NTAG (GET_VERSION command)
 * 3. Check for ISO-DEP capable chips (Phase 4: DESFire, Plus, JavaCard)
 * 4. Fall back to generic type based on technology
 */
export async function detectChip(rawData: RawTagData): Promise<DetectionResult> {
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
    const hasMifareClassicTech = techTypes.some(t =>
      t.includes('MifareClassic'),
    );
    const hasIsoDepTech = techTypes.some(t => t.includes('IsoDep'));

    // If we have MifareClassic tech type and NO IsoDep, it's definitely Classic
    if (hasMifareClassicTech && !hasIsoDepTech) {
      // Determine 1K vs 4K based on SAK or UID length
      let chipType = ChipType.MIFARE_CLASSIC_1K; // Default to 1K
      let memorySize = 1024;

      // SAK 0x18 or 0x38 indicates 4K
      if (sak === 0x18 || sak === 0x38 || sak === 0x98) {
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
      console.log('[Detector] Attempting NTAG detection...');
      const ntagResult = await detectNtag();
      console.log('[Detector] NTAG detection result:', {
        success: ntagResult.success,
        chipType: ntagResult.chipType,
        error: ntagResult.error,
      });

      if (ntagResult.success && ntagResult.chipType) {
        return {
          success: true,
          transponder: createTransponder(ntagResult.chipType, rawData, {
            memorySize: ntagResult.memorySize,
            versionInfo: ntagResult.versionInfo,
            confidence:
              ntagResult.chipType === ChipType.NTAG_UNKNOWN ? 'medium' : 'high',
          }),
        };
      }
      // If GET_VERSION failed but tag looks like Type 2, mark as unknown NTAG
      if (sak === 0x00 && techTypes.some(t => t.includes('NfcA'))) {
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
      const desfireResult = await detectDesfire();
      if (desfireResult.success && desfireResult.chipType) {
        return {
          success: true,
          transponder: createTransponder(desfireResult.chipType, rawData, {
            memorySize: desfireResult.storageSize,
            versionInfo: desfireResult.versionInfo,
            confidence:
              desfireResult.chipType === ChipType.DESFIRE_UNKNOWN
                ? 'medium'
                : 'high',
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
        const jcResult = await detectJavaCard();
        if (jcResult.success && jcResult.chipType) {
          return {
            success: true,
            transponder: createTransponder(jcResult.chipType, rawData, {
              confidence:
                jcResult.chipType === ChipType.JCOP4 ? 'high' : 'medium',
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
      const jcFallback = await detectJavaCard();
      if (jcFallback.success && jcFallback.chipType) {
        return {
          success: true,
          transponder: createTransponder(jcFallback.chipType, rawData, {
            confidence: 'medium',
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

        return {
          success: true,
          transponder: createTransponder(iso15693Result.chipType, rawData, {
            confidence,
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
