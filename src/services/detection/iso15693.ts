/**
 * ISO 15693 (NFC-V) Detector
 * Identifies ICODE SLIX, SLIX2, NTAG 5, and other ISO 15693 tags
 *
 * Per NXP AN11042, identification uses:
 * 1. GET_SYSTEM_INFO command (0x2B) - returns IC reference directly
 * 2. UID parsing - IC manufacturer code and reference in UID bytes
 */

import {Platform} from 'react-native';
import NfcManager from 'react-native-nfc-manager';
import {ChipType} from '../../types/detection';
import {getIso15693SystemInfo, transceiveNfcV, iso15693ReadSingleBlock} from '../nfc/commands';

/**
 * NXP ICODE IC manufacturer code
 */
const NXP_IC_MFG_CODE = 0x04;

/**
 * NXP ISO 15693 product family identification based on IC reference
 * The IC reference encoding varies by product family.
 *
 * Note: ISO 15693 UID is transmitted LSB first, but NFC libraries may
 * return bytes in different orders. We try multiple interpretations.
 *
 * Reference: NXP Product Short Form Specifications, AN11042
 */
const NXP_ISO15693_IC_REFERENCES: Record<number, ChipType> = {
  // ICODE SLIX (SL2S2002) - standard SLIX
  // IC reference values: 0x01, 0x02 (variants)
  0x01: ChipType.SLIX,
  0x02: ChipType.SLIX,
  0x03: ChipType.SLIX, // Additional variant

  // ICODE SLIX-S (SL2S2102) - SLIX with 32-bit password protection
  0x0a: ChipType.SLIX_S,
  0x0b: ChipType.SLIX_S, // Additional variant

  // ICODE SLIX-L (SL2S2702) - SLIX low-memory variant (512 bits)
  0x0c: ChipType.SLIX_L,
  0x0d: ChipType.SLIX_L,

  // ICODE SLIX2 (SL2S2602) - enhanced SLIX with multiple passwords
  // IC reference range: 0x14-0x1F
  0x14: ChipType.SLIX2,
  0x15: ChipType.SLIX2,
  0x16: ChipType.SLIX2,
  0x17: ChipType.SLIX2,
  0x18: ChipType.SLIX2,
  0x19: ChipType.SLIX2,
  0x1a: ChipType.SLIX2,
  0x1b: ChipType.SLIX2,
  0x1c: ChipType.SLIX2,
  0x1d: ChipType.SLIX2,
  0x1e: ChipType.SLIX2,
  0x1f: ChipType.SLIX2,

  // ICODE DNA (SL2S4001) - ICODE with crypto authentication
  // IC reference range per NXP: 0x24-0x27 (documented range)
  // GET_SYSTEM_INFO may return different values: observed 0x96 on real chips
  // Extended range based on real-world observations: 0x90-0xBF
  0x24: ChipType.ICODE_DNA,
  0x25: ChipType.ICODE_DNA,
  0x26: ChipType.ICODE_DNA,
  0x27: ChipType.ICODE_DNA,
  // Extended ICODE DNA range (observed in real chips via GET_SYSTEM_INFO)
  0x90: ChipType.ICODE_DNA,
  0x91: ChipType.ICODE_DNA,
  0x92: ChipType.ICODE_DNA,
  0x93: ChipType.ICODE_DNA,
  0x94: ChipType.ICODE_DNA,
  0x95: ChipType.ICODE_DNA,
  0x96: ChipType.ICODE_DNA, // Observed on ICODE DNA via GET_SYSTEM_INFO
  0x97: ChipType.ICODE_DNA,
  0x98: ChipType.ICODE_DNA,
  0x99: ChipType.ICODE_DNA,
  0x9a: ChipType.ICODE_DNA,
  0x9b: ChipType.ICODE_DNA,
  0x9c: ChipType.ICODE_DNA,
  0x9d: ChipType.ICODE_DNA,
  0x9e: ChipType.ICODE_DNA,
  0x9f: ChipType.ICODE_DNA,
  // UID-based IC reference range (0xA0-0xAF)
  0xa0: ChipType.ICODE_DNA,
  0xa1: ChipType.ICODE_DNA,
  0xa2: ChipType.ICODE_DNA, // Observed in UID of ICODE DNA
  0xa3: ChipType.ICODE_DNA,
  0xa4: ChipType.ICODE_DNA,
  0xa5: ChipType.ICODE_DNA,
  0xa6: ChipType.ICODE_DNA,
  0xa7: ChipType.ICODE_DNA,
  0xa8: ChipType.ICODE_DNA,
  0xa9: ChipType.ICODE_DNA,
  0xaa: ChipType.ICODE_DNA,
  0xab: ChipType.ICODE_DNA,
  0xac: ChipType.ICODE_DNA,
  0xad: ChipType.ICODE_DNA,
  0xae: ChipType.ICODE_DNA,
  0xaf: ChipType.ICODE_DNA,

  // NTAG 5 link (NT3H2111/NT3H2211) - NFC+I2C bridge
  // IC reference range: 0x20-0x23
  0x20: ChipType.NTAG5_LINK,
  0x21: ChipType.NTAG5_LINK,
  0x22: ChipType.NTAG5_LINK,
  0x23: ChipType.NTAG5_LINK,

  // NTAG 5 boost (NT3H3111/NT3H3211) - extended range, larger memory
  // IC reference range: 0x40-0x4F
  0x40: ChipType.NTAG5_BOOST,
  0x41: ChipType.NTAG5_BOOST,
  0x42: ChipType.NTAG5_BOOST,
  0x43: ChipType.NTAG5_BOOST,
  0x44: ChipType.NTAG5_BOOST,
  0x45: ChipType.NTAG5_BOOST,
  0x46: ChipType.NTAG5_BOOST,
  0x47: ChipType.NTAG5_BOOST,
  0x48: ChipType.NTAG5_BOOST,
  0x49: ChipType.NTAG5_BOOST,

  // NTAG 5 switch (NT3H1101/NT3H1201) - energy harvesting
  // IC reference range: 0x50-0x5F
  0x50: ChipType.NTAG5_SWITCH,
  0x51: ChipType.NTAG5_SWITCH,
  0x52: ChipType.NTAG5_SWITCH,
  0x53: ChipType.NTAG5_SWITCH,
};

/**
 * Determine ICODE variant from IC reference, with fallback for unknown values.
 * Some ICODE chips have non-standard IC references that don't match NXP docs.
 */
function getIcodeTypeFromIcReference(icRef: number): ChipType | null {
  // Check direct mapping first
  if (NXP_ISO15693_IC_REFERENCES[icRef]) {
    console.log(
      `[ISO15693] IC ref 0x${icRef.toString(16)} matched: ${NXP_ISO15693_IC_REFERENCES[icRef]}`,
    );
    return NXP_ISO15693_IC_REFERENCES[icRef];
  }

  // Handle unknown IC references by range inference
  // Standard SLIX range: 0x01-0x09
  if (icRef >= 0x01 && icRef <= 0x09) {
    console.log(
      `[ISO15693] Unknown IC ref 0x${icRef.toString(16)} in SLIX range, treating as SLIX`,
    );
    return ChipType.SLIX;
  }

  // SLIX-S/SLIX-L range: 0x0A-0x13
  if (icRef >= 0x0a && icRef <= 0x13) {
    console.log(
      `[ISO15693] Unknown IC ref 0x${icRef.toString(16)} in SLIX-S/L range, treating as SLIX_S`,
    );
    return ChipType.SLIX_S;
  }

  // SLIX2/NTAG5 link range: 0x14-0x2F
  if (icRef >= 0x14 && icRef <= 0x2f) {
    console.log(
      `[ISO15693] Unknown IC ref 0x${icRef.toString(16)} in SLIX2/NTAG5 range, treating as SLIX2`,
    );
    return ChipType.SLIX2;
  }

  // NTAG 5 boost range: 0x40-0x4F
  if (icRef >= 0x40 && icRef <= 0x4f) {
    console.log(
      `[ISO15693] Unknown IC ref 0x${icRef.toString(16)} in NTAG5 boost range`,
    );
    return ChipType.NTAG5_BOOST;
  }

  // NTAG 5 switch range: 0x50-0x5F
  if (icRef >= 0x50 && icRef <= 0x5f) {
    console.log(
      `[ISO15693] Unknown IC ref 0x${icRef.toString(16)} in NTAG5 switch range`,
    );
    return ChipType.NTAG5_SWITCH;
  }

  // ICODE DNA range: 0x90-0xBF (extended range based on real chips)
  // GET_SYSTEM_INFO returns IC ref in 0x90-0x9F range
  // UID parsing returns IC ref in 0xA0-0xAF range
  if (icRef >= 0x90 && icRef <= 0xbf) {
    console.log(
      `[ISO15693] IC ref 0x${icRef.toString(16)} in ICODE DNA range`,
    );
    return ChipType.ICODE_DNA;
  }

  // High IC references (0x80-0x8F) - unknown, don't guess
  if (icRef >= 0x80 && icRef < 0x90) {
    console.log(
      `[ISO15693] High IC ref 0x${icRef.toString(16)} - unknown variant`,
    );
    return null;
  }

  console.log(
    `[ISO15693] Unknown IC ref 0x${icRef.toString(16)}, no match`,
  );
  return null;
}

/**
 * Result of ISO 15693 detection
 */
export interface Iso15693DetectionResult {
  success: boolean;
  chipType?: ChipType;
  uid?: string;
  icManufacturer?: number;
  icReference?: number;
  blockSize?: number;
  blockCount?: number;
  error?: string;
}

/**
 * Identify SLIX variant from memory size when IC reference is not available
 * Per NXP datasheets, different SLIX variants have different memory sizes:
 * - SLIX (SL2S2002): 896 bits = 112 bytes = 28 blocks × 4 bytes
 * - SLIX-S (SL2S2102): 1280 bits = 160 bytes = 40 blocks × 4 bytes
 * - SLIX-L (SL2S2702): 512 bits = 64 bytes = 16 blocks × 4 bytes
 * - SLIX2 (SL2S2602): 2528 bits = 316 bytes = 79 blocks × 4 bytes
 */
function identifySlixFromMemory(
  blockCount?: number,
  blockSize?: number,
): ChipType | null {
  if (!blockCount || !blockSize) {
    return null;
  }

  const totalBytes = blockCount * blockSize;

  // SLIX-L: ~64 bytes (16 blocks)
  if (totalBytes <= 80 || blockCount <= 20) {
    return ChipType.SLIX_L;
  }

  // SLIX: ~112 bytes (28 blocks)
  if (totalBytes <= 128 || blockCount <= 32) {
    return ChipType.SLIX;
  }

  // SLIX-S: ~160 bytes (40 blocks)
  if (totalBytes <= 200 || blockCount <= 50) {
    return ChipType.SLIX_S;
  }

  // SLIX2: ~316 bytes (79 blocks)
  if (totalBytes <= 400 || blockCount <= 100) {
    return ChipType.SLIX2;
  }

  // Larger memory - could be NTAG5 or other
  if (totalBytes >= 400) {
    return ChipType.NTAG5_BOOST; // Larger NXP ISO 15693 chips
  }

  return null;
}

/**
 * Detect ISO 15693 tag type
 *
 * Per NXP AN11042, identification methods:
 * 1. GET_SYSTEM_INFO - returns IC reference (if bit 3 of info flags set)
 * 2. Memory size - different SLIX variants have different capacities
 * 3. UID manufacturer code - confirms NXP origin
 *
 * Note: IC reference is OPTIONAL in GET_SYSTEM_INFO - older SLIX chips
 * may not return it. In that case, use memory size to distinguish variants.
 */
export async function detectIso15693(): Promise<Iso15693DetectionResult> {
  try {
    console.log('[ISO15693] Starting detection...');

    // Get tag info for UID
    const tag = await NfcManager.getTag();
    let uid: string | undefined;
    let icManufacturer: number | undefined;
    let uidIcReference: number | undefined;

    if (tag?.id) {
      const uidBytes =
        typeof tag.id === 'string'
          ? tag.id
              .replace(/[:\s-]/g, '')
              .match(/.{1,2}/g)
              ?.map(h => parseInt(h, 16)) || []
          : Array.from(tag.id as unknown as number[]);

      uid = uidBytes
        .map(b => b.toString(16).padStart(2, '0').toUpperCase())
        .join(':');

      console.log('[ISO15693] UID:', uid);
      console.log('[ISO15693] UID bytes:', uidBytes.map(b => `0x${b.toString(16)}`).join(', '));

      // Parse manufacturer from UID
      const parsed = parseIso15693Uid(uidBytes);
      icManufacturer = parsed.icManufacturer;
      uidIcReference = parsed.icReference;

      console.log('[ISO15693] From UID - Manufacturer:', icManufacturer !== undefined ? `0x${icManufacturer.toString(16)}` : 'undefined');
      console.log('[ISO15693] From UID - IC Reference:', uidIcReference !== undefined ? `0x${uidIcReference.toString(16)}` : 'undefined');
    }

    // Try GET_SYSTEM_INFO command (NXP recommended method)
    try {
      console.log('[ISO15693] Trying GET_SYSTEM_INFO...');
      const sysInfo = await getIso15693SystemInfo();
      console.log('[ISO15693] GET_SYSTEM_INFO result:', sysInfo);

      // If we got IC reference from GET_SYSTEM_INFO, use it (most reliable)
      if (sysInfo.icReference !== undefined && sysInfo.icReference !== 0) {
        const icReference = sysInfo.icReference;
        console.log('[ISO15693] Got IC reference from sysInfo:', `0x${icReference.toString(16)}`);

        if (icManufacturer === NXP_IC_MFG_CODE || icManufacturer === undefined) {
          let chipType = getIcodeTypeFromIcReference(icReference) || ChipType.ISO15693_UNKNOWN;

          // Memory-based override for NXP chips when block count is available
          // IC references are NOT reliable for distinguishing SLIX vs ICODE DNA
          // because both chip families can report IC refs in overlapping ranges.
          //
          // Memory sizes per NXP datasheets are the reliable differentiator:
          // - SLIX (SL2S2002): 32 blocks (128 bytes)
          // - SLIX-S (SL2S2102): 40 blocks (160 bytes)
          // - SLIX-L (SL2S2702): 16 blocks (64 bytes)
          // - SLIX2 (SL2S2602): 79-80 blocks (316-320 bytes)
          // - ICODE DNA: 48-64 blocks (192-256 bytes)
          //
          // Use memory size as the authoritative source for NXP chips.
          if (
            icManufacturer === NXP_IC_MFG_CODE &&
            sysInfo.blockCount !== undefined
          ) {
            const blocks = sysInfo.blockCount;

            // SLIX-L: 16 blocks
            if (blocks <= 20) {
              console.log(
                `[ISO15693] NXP chip with ${blocks} blocks → SLIX-L`,
              );
              chipType = ChipType.SLIX_L;
            }
            // SLIX: 32 blocks
            else if (blocks <= 36) {
              console.log(
                `[ISO15693] NXP chip with ${blocks} blocks → SLIX`,
              );
              chipType = ChipType.SLIX;
            }
            // SLIX-S: 40 blocks
            else if (blocks <= 44) {
              console.log(
                `[ISO15693] NXP chip with ${blocks} blocks → SLIX-S`,
              );
              chipType = ChipType.SLIX_S;
            }
            // ICODE DNA: 48-64 blocks
            else if (blocks <= 68) {
              console.log(
                `[ISO15693] NXP chip with ${blocks} blocks → ICODE DNA`,
              );
              chipType = ChipType.ICODE_DNA;
            }
            // SLIX2: 79-80 blocks
            else if (blocks <= 85) {
              console.log(
                `[ISO15693] NXP chip with ${blocks} blocks → SLIX2`,
              );
              chipType = ChipType.SLIX2;
            }
            // Larger memory - NTAG5 variants
            else {
              console.log(
                `[ISO15693] NXP chip with ${blocks} blocks → NTAG5 (large memory)`,
              );
              chipType = ChipType.NTAG5_BOOST;
            }
          }

          return {
            success: true,
            chipType,
            uid,
            icManufacturer: icManufacturer ?? NXP_IC_MFG_CODE,
            icReference,
            blockSize: sysInfo.blockSize,
            blockCount: sysInfo.blockCount,
          };
        }

        return {
          success: true,
          chipType: ChipType.ISO15693_UNKNOWN,
          uid,
          icManufacturer,
          icReference,
          blockSize: sysInfo.blockSize,
          blockCount: sysInfo.blockCount,
        };
      }

      // IC reference not in GET_SYSTEM_INFO response (common for older SLIX)
      // Use memory size to identify the chip variant
      if (icManufacturer === NXP_IC_MFG_CODE || icManufacturer === undefined) {
        // For NXP chips, try to identify SLIX variant from memory size
        const chipFromMemory = identifySlixFromMemory(
          sysInfo.blockCount,
          sysInfo.blockSize,
        );

        if (chipFromMemory) {
          return {
            success: true,
            chipType: chipFromMemory,
            uid,
            icManufacturer: icManufacturer ?? NXP_IC_MFG_CODE,
            icReference: uidIcReference,
            blockSize: sysInfo.blockSize,
            blockCount: sysInfo.blockCount,
          };
        }

        // Got manufacturer NXP but couldn't determine exact variant
        // Don't assume SLIX - return unknown with NXP manufacturer info
        return {
          success: true,
          chipType: ChipType.ISO15693_UNKNOWN,
          uid,
          icManufacturer: icManufacturer ?? NXP_IC_MFG_CODE,
          blockSize: sysInfo.blockSize,
          blockCount: sysInfo.blockCount,
        };
      }

      // Non-NXP chip with system info
      return {
        success: true,
        chipType: ChipType.ISO15693_UNKNOWN,
        uid,
        icManufacturer,
        blockSize: sysInfo.blockSize,
        blockCount: sysInfo.blockCount,
      };
    } catch (sysInfoError) {
      // GET_SYSTEM_INFO failed
      console.warn('[ISO15693] GET_SYSTEM_INFO failed:', sysInfoError);
    }

    // Fall back: Use UID-based detection
    // If we know it's NXP, identify the ICODE variant
    console.log('[ISO15693] Falling back to UID-based detection');
    if (icManufacturer === NXP_IC_MFG_CODE) {
      console.log('[ISO15693] NXP manufacturer detected');
      // Check if we got IC reference from UID parsing
      if (uidIcReference !== undefined) {
        const chipType = getIcodeTypeFromIcReference(uidIcReference);
        if (chipType) {
          console.log('[ISO15693] UID-based detection result:', chipType);
          return {
            success: true,
            chipType,
            uid,
            icManufacturer,
            icReference: uidIcReference,
          };
        }
      }

      // NXP but couldn't determine exact variant - return unknown with NXP info
      console.log('[ISO15693] NXP but could not determine specific chip type');
      return {
        success: true,
        chipType: ChipType.ISO15693_UNKNOWN,
        uid,
        icManufacturer,
        icReference: uidIcReference,
      };
    }

    // Fall back to platform-specific detection using UID
    if (Platform.OS === 'android') {
      return await detectIso15693Android();
    }

    return await detectIso15693IOS();
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: `ISO 15693 detection failed: ${errorMessage}`,
    };
  }
}

/**
 * Parse ISO 15693 UID to extract manufacturer and IC reference
 * The UID is 8 bytes and may be in MSB or LSB first order.
 *
 * MSB first (standard): E0:MFG:ICRef:Serial[5]
 * LSB first (common in NFC reads): Serial[5]:ICRef:MFG:E0
 */
function parseIso15693Uid(uidBytes: number[]): {
  icManufacturer?: number;
  icReference?: number;
} {
  if (uidBytes.length < 8) {
    return {};
  }

  // Check for MSB first order (E0 at position 0)
  if (uidBytes[0] === 0xe0) {
    return {
      icManufacturer: uidBytes[1],
      icReference: uidBytes[2],
    };
  }

  // Check for LSB first order (E0 at position 7)
  if (uidBytes[7] === 0xe0) {
    return {
      icManufacturer: uidBytes[6],
      icReference: uidBytes[5],
    };
  }

  // Try to find E0 anywhere and infer order
  const e0Index = uidBytes.indexOf(0xe0);
  if (e0Index === -1) {
    // No E0 found - unusual, try positions anyway
    // Some readers strip E0 or return partial UIDs
    // Try treating first two bytes as mfg and icref
    return {
      icManufacturer: uidBytes[0],
      icReference: uidBytes[1],
    };
  }

  // E0 found at unexpected position - infer based on where it is
  if (e0Index < 4) {
    // E0 near start, likely MSB first
    return {
      icManufacturer: uidBytes[e0Index + 1],
      icReference: uidBytes[e0Index + 2],
    };
  } else {
    // E0 near end, likely LSB first
    return {
      icManufacturer: uidBytes[e0Index - 1],
      icReference: uidBytes[e0Index - 2],
    };
  }
}

/**
 * Android-specific ISO 15693 detection
 */
async function detectIso15693Android(): Promise<Iso15693DetectionResult> {
  try {
    // Try to get tag info - the NfcV handler provides some info
    const tag = await NfcManager.getTag();

    if (!tag) {
      return {
        success: false,
        error: 'No tag available',
      };
    }

    // Extract UID from tag
    const uid = tag.id
      ? Array.from(tag.id as unknown as number[])
          .map(b => b.toString(16).padStart(2, '0').toUpperCase())
          .join(':')
      : undefined;

    // Parse UID to extract manufacturer and IC reference
    if (uid && tag.id) {
      const uidBytes = Array.from(tag.id as unknown as number[]);
      const {icManufacturer, icReference} = parseIso15693Uid(uidBytes);

      if (icManufacturer !== undefined) {
        // For NXP chips, identify specific variant
        if (icManufacturer === NXP_IC_MFG_CODE && icReference !== undefined) {
          const chipType = getIcodeTypeFromIcReference(icReference) || ChipType.ISO15693_UNKNOWN;

          return {
            success: true,
            chipType,
            uid,
            icManufacturer,
            icReference,
          };
        }

        // Non-NXP ISO 15693 tag
        return {
          success: true,
          chipType: ChipType.ISO15693_UNKNOWN,
          uid,
          icManufacturer,
          icReference,
        };
      }
    }

    // Fallback - we know it's ISO 15693 but can't identify further
    return {
      success: true,
      chipType: ChipType.ISO15693_UNKNOWN,
      uid,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: `Android ISO 15693 detection failed: ${errorMessage}`,
    };
  }
}

/**
 * iOS-specific ISO 15693 detection
 */
async function detectIso15693IOS(): Promise<Iso15693DetectionResult> {
  try {
    // On iOS, we have limited access to ISO 15693 tags
    // CoreNFC provides basic tag info but detailed commands may be restricted
    const tag = await NfcManager.getTag();

    if (!tag) {
      return {
        success: false,
        error: 'No tag available',
      };
    }

    // Extract UID - iOS may return as string or array
    let uidBytes: number[] = [];
    let uid: string | undefined;

    if (tag.id) {
      if (typeof tag.id === 'string') {
        // Parse hex string to bytes
        const uidClean = tag.id.replace(/[:\s-]/g, '');
        uid = uidClean
          .match(/.{1,2}/g)
          ?.map(s => s.toUpperCase())
          .join(':');
        for (let i = 0; i < uidClean.length; i += 2) {
          uidBytes.push(parseInt(uidClean.substring(i, i + 2), 16));
        }
      } else {
        uidBytes = Array.from(tag.id as unknown as number[]);
        uid = uidBytes
          .map(b => b.toString(16).padStart(2, '0').toUpperCase())
          .join(':');
      }
    }

    // Parse UID to extract manufacturer and IC reference
    if (uidBytes.length >= 8) {
      const {icManufacturer, icReference} = parseIso15693Uid(uidBytes);

      if (icManufacturer !== undefined) {
        if (icManufacturer === NXP_IC_MFG_CODE && icReference !== undefined) {
          const chipType = getIcodeTypeFromIcReference(icReference) || ChipType.ISO15693_UNKNOWN;

          return {
            success: true,
            chipType,
            uid,
            icManufacturer,
            icReference,
          };
        }

        return {
          success: true,
          chipType: ChipType.ISO15693_UNKNOWN,
          uid,
          icManufacturer,
          icReference,
        };
      }
    }

    return {
      success: true,
      chipType: ChipType.ISO15693_UNKNOWN,
      uid,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: `iOS ISO 15693 detection failed: ${errorMessage}`,
    };
  }
}

/**
 * Check if tag is ISO 15693 based on tech types
 */
export function isIso15693(techTypes: string[]): boolean {
  return techTypes.some(
    t => t.includes('NfcV') || t.includes('ISO15693') || t.includes('Iso15693'),
  );
}

/**
 * Get human-readable name for IC manufacturer
 */
export function getIcManufacturerName(code: number): string {
  const manufacturers: Record<number, string> = {
    0x01: 'Motorola',
    0x02: 'STMicroelectronics',
    0x03: 'Hitachi',
    0x04: 'NXP Semiconductors',
    0x05: 'Infineon',
    0x06: 'Cylink',
    0x07: 'Texas Instruments',
    0x08: 'Fujitsu',
    0x09: 'Matsushita',
    0x0a: 'NEC',
    0x0b: 'Oki Electric',
    0x0c: 'Toshiba',
    0x0d: 'Mitsubishi',
    0x0e: 'Samsung',
    0x0f: 'Hyundai',
    0x10: 'LG Semiconductors',
  };

  return manufacturers[code] || `Unknown (0x${code.toString(16)})`;
}

/**
 * Result of Spark implant detection
 */
export interface SparkDetectionResult {
  found: boolean;
  name?: string;
  url?: string;
}

/**
 * Detect Spark implant by reading NDEF from ISO 15693 tag
 * Spark implants have a URI record pointing to vivokey.co/$code
 *
 * @param chipType - The detected chip type (used to determine Spark 1 vs 2)
 */
export async function detectSparkImplant(
  chipType: ChipType,
): Promise<SparkDetectionResult> {
  try {
    console.log('[ISO15693] Checking for Spark implant NDEF...');

    // Read first few blocks to find NDEF data
    // ISO 15693 NDEF layout: Block 0 = CC (Capability Container), Blocks 1+ = NDEF message
    const ndefBytes: number[] = [];

    // Read blocks 0-7 (typically enough for a short NDEF URI)
    for (let block = 0; block < 8; block++) {
      try {
        const response = await transceiveNfcV(iso15693ReadSingleBlock(block));
        // Response format: [flags] [data...]
        // Skip first byte (flags) if present
        if (response.length > 1 && (response[0] & 0x01) === 0) {
          // No error, data follows
          ndefBytes.push(...response.slice(1));
        } else if (response.length >= 4) {
          // Some readers don't include flags
          ndefBytes.push(...response);
        }
      } catch (e) {
        console.log(`[ISO15693] Block ${block} read failed:`, e);
        break;
      }
    }

    if (ndefBytes.length === 0) {
      console.log('[ISO15693] No NDEF data read');
      return {found: false};
    }

    console.log(
      '[ISO15693] Read NDEF bytes:',
      ndefBytes.map(b => b.toString(16).padStart(2, '0')).join(' '),
    );

    // Convert to ASCII and look for vivokey.co pattern
    const asciiStr = ndefBytes
      .filter(b => b >= 0x20 && b <= 0x7e)
      .map(b => String.fromCharCode(b))
      .join('');

    console.log('[ISO15693] ASCII content:', asciiStr);

    // Check for vivokey.co URL pattern
    const vivokeyMatch = asciiStr.match(/vivokey\.co\/([A-Za-z0-9]+)/i);
    if (vivokeyMatch) {
      const code = vivokeyMatch[1];
      const url = `https://vivokey.co/${code}`;
      console.log('[ISO15693] Found Spark URL:', url);

      // Determine Spark version based on chip type
      // SLIX/ICODE DNA = Spark 1 (ISO 15693)
      // NTAG 424 DNA = Spark 2 (ISO 14443-4, handled in desfire.ts)
      let sparkName: string;
      if (
        chipType === ChipType.SLIX ||
        chipType === ChipType.SLIX_S ||
        chipType === ChipType.SLIX_L ||
        chipType === ChipType.SLIX2 ||
        chipType === ChipType.ICODE_DNA
      ) {
        sparkName = 'Spark 1';
      } else {
        // Any other ISO 15693 chip with vivokey.co URL is likely a Spark variant
        sparkName = 'Spark 1';
      }

      return {
        found: true,
        name: sparkName,
        url,
      };
    }

    console.log('[ISO15693] No vivokey.co URL found');
    return {found: false};
  } catch (error) {
    console.warn('[ISO15693] Spark detection failed:', error);
    return {found: false};
  }
}
