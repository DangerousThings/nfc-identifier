/**
 * NTAG/Ultralight Detector
 * Identifies NTAG213/215/216, NTAG I2C, and MIFARE Ultralight variants
 * using GET_VERSION command
 */

import {ChipType, NtagVersionInfo} from '../../types/detection';
import {NTAG_GET_VERSION, sendType2Command} from '../nfc/commands';

/**
 * GET_VERSION response structure (same for NTAG and Ultralight):
 * Byte 0: Fixed header (0x00)
 * Byte 1: Vendor ID (0x04 = NXP)
 * Byte 2: Product type
 * Byte 3: Product subtype
 * Byte 4: Major product version
 * Byte 5: Minor product version
 * Byte 6: Storage size (encoded)
 * Byte 7: Protocol type (0x03 = ISO 14443-3)
 */

/** Product type values */
const PRODUCT_TYPES = {
  ULTRALIGHT: 0x03, // MIFARE Ultralight family
  NTAG: 0x04, // NTAG 21x family
  NTAG_I2C: 0x05, // NTAG I2C family
} as const;

/**
 * Storage size encoding for MIFARE Ultralight family (product type 0x03)
 */
const ULTRALIGHT_STORAGE_SIZES: Record<number, {type: ChipType; size: number}> =
  {
    // MIFARE Ultralight (MF0ICU1): 48 bytes
    0x06: {type: ChipType.ULTRALIGHT, size: 48},
    // MIFARE Ultralight Nano: 48 bytes
    0x0a: {type: ChipType.ULTRALIGHT_NANO, size: 48},
    // MIFARE Ultralight C (MF0ICU2): 144 bytes
    0x0b: {type: ChipType.ULTRALIGHT_C, size: 144},
    // MIFARE Ultralight EV1 (MF0UL11): 48 bytes (20 pages)
    0x0e: {type: ChipType.ULTRALIGHT_EV1, size: 48},
    // MIFARE Ultralight EV1 (MF0UL21): 128 bytes (41 pages)
    0x0f: {type: ChipType.ULTRALIGHT_EV1, size: 128},
    // MIFARE Ultralight AES: 540 bytes
    0x15: {type: ChipType.ULTRALIGHT_AES, size: 540},
  };

/**
 * Storage size encoding for standard NTAG chips (product type 0x04)
 */
const NTAG_STORAGE_SIZES: Record<number, {type: ChipType; size: number}> = {
  // NTAG210: 48 bytes user memory (rare)
  0x06: {type: ChipType.NTAG213, size: 48}, // Treat as NTAG213
  // NTAG212: 128 bytes user memory (rare)
  0x0a: {type: ChipType.NTAG213, size: 128}, // Treat as NTAG213
  // NTAG213: 144 bytes user memory
  0x0f: {type: ChipType.NTAG213, size: 144},
  // NTAG215: 504 bytes user memory
  0x11: {type: ChipType.NTAG215, size: 504},
  // NTAG216: 888 bytes user memory
  0x13: {type: ChipType.NTAG216, size: 888},
  // NTAG I2C 2K reporting as product type 0x04 (some chips do this)
  // Storage size 0x15 = ~1912 bytes, same as NTAG I2C 2K
  0x15: {type: ChipType.NTAG_I2C_2K, size: 1912},
};

/**
 * Storage size encoding for NTAG I2C chips (product type 0x05)
 * Per NXP NT3H1101/NT3H1201/NT3H2111/NT3H2211 datasheets
 *
 * IMPORTANT: Only use exact values from NXP datasheets.
 * Storage size byte encoding: 2^(storageSize/2) = total bytes
 * - 0x13: 2^(19/2) ≈ 1024 bytes total = NTAG I2C 1K
 * - 0x15: 2^(21/2) ≈ 2048 bytes total = NTAG I2C 2K
 *
 * The Plus vs non-Plus variant is determined by subtype byte, NOT storage size.
 */
const NTAG_I2C_STORAGE_SIZES: Record<number, {type: ChipType; size: number}> = {
  // NTAG I2C 1K (NT3H1101, NT3H2111): 888 bytes user memory
  0x13: {type: ChipType.NTAG_I2C_1K, size: 888},

  // NTAG I2C 2K (NT3H1201, NT3H2211): 1912 bytes user memory
  0x15: {type: ChipType.NTAG_I2C_2K, size: 1912},
};

/**
 * NTAG I2C Plus variants (detected by subtype)
 * Per NXP NT3H2111/NT3H2211 datasheet:
 * - Subtype 0x01: NTAG I2C (non-Plus)
 * - Subtype 0x02: NTAG I2C Plus
 */
const NTAG_I2C_PLUS_SUBTYPES = [0x02];

/**
 * Result of NTAG detection
 */
export interface NtagDetectionResult {
  success: boolean;
  chipType?: ChipType;
  versionInfo?: NtagVersionInfo;
  memorySize?: number;
  error?: string;
}

/**
 * Detect NTAG chip variant using GET_VERSION command
 */
export async function detectNtag(): Promise<NtagDetectionResult> {
  try {
    console.log('[NTAG] Sending GET_VERSION command:', NTAG_GET_VERSION);

    // Send GET_VERSION command (0x60)
    const response = await sendType2Command(NTAG_GET_VERSION);
    console.log('[NTAG] GET_VERSION response:', response);

    if (response.length < 8) {
      return {
        success: false,
        error: `Invalid GET_VERSION response length: ${response.length}`,
      };
    }

    // Parse version info
    const versionInfo: NtagVersionInfo = {
      vendorId: response[1],
      productType: response[2],
      productSubtype: response[3],
      majorVersion: response[4],
      minorVersion: response[5],
      storageSize: response[6],
      protocolType: response[7],
    };

    console.log('[NTAG] Parsed version info:', {
      vendorId: `0x${versionInfo.vendorId.toString(16)}`,
      productType: `0x${versionInfo.productType.toString(16)}`,
      productSubtype: `0x${versionInfo.productSubtype.toString(16)}`,
      storageSize: `0x${versionInfo.storageSize.toString(16)}`,
    });

    // Check if this is an NXP chip
    if (versionInfo.vendorId !== 0x04) {
      return {
        success: true,
        chipType: ChipType.NTAG_UNKNOWN,
        versionInfo,
        error: `Non-NXP vendor ID: 0x${versionInfo.vendorId.toString(16)}`,
      };
    }

    // Handle MIFARE Ultralight family (product type 0x03)
    if (versionInfo.productType === PRODUCT_TYPES.ULTRALIGHT) {
      const storageInfo = ULTRALIGHT_STORAGE_SIZES[versionInfo.storageSize];

      if (storageInfo) {
        return {
          success: true,
          chipType: storageInfo.type,
          versionInfo,
          memorySize: storageInfo.size,
        };
      }

      // Unknown Ultralight variant
      return {
        success: true,
        chipType: ChipType.ULTRALIGHT,
        versionInfo,
        error: `Unknown Ultralight storage size: 0x${versionInfo.storageSize.toString(16)}`,
      };
    }

    // Handle NTAG I2C (product type 0x05)
    // Per NXP NT3H2111/NT3H2211 datasheet:
    // - Storage size 0x13 = 1K variant (NT3H1101, NT3H2111)
    // - Storage size 0x15 = 2K variant (NT3H1201, NT3H2211)
    // - Subtype 0x01 = non-Plus, 0x02 = Plus
    if (versionInfo.productType === PRODUCT_TYPES.NTAG_I2C) {
      const storageInfo = NTAG_I2C_STORAGE_SIZES[versionInfo.storageSize];

      if (!storageInfo) {
        // Unknown storage size - report it for diagnosis rather than guessing
        console.warn(
          `[NTAG] Unknown NTAG I2C storage size: 0x${versionInfo.storageSize.toString(16)}`,
        );
        return {
          success: true,
          chipType: ChipType.NTAG_UNKNOWN,
          versionInfo,
          error: `NTAG I2C with unknown storage size: 0x${versionInfo.storageSize.toString(16)}. Expected 0x13 (1K) or 0x15 (2K).`,
        };
      }

      let chipType = storageInfo.type;
      const memorySize = storageInfo.size;

      // Check for Plus variant based on subtype (0x02 = Plus)
      if (NTAG_I2C_PLUS_SUBTYPES.includes(versionInfo.productSubtype)) {
        chipType =
          chipType === ChipType.NTAG_I2C_1K || chipType === ChipType.NTAG_I2C_PLUS_1K
            ? ChipType.NTAG_I2C_PLUS_1K
            : ChipType.NTAG_I2C_PLUS_2K;
      }

      return {
        success: true,
        chipType,
        versionInfo,
        memorySize,
      };
    }

    // Handle standard NTAG (product type 0x04)
    if (versionInfo.productType === PRODUCT_TYPES.NTAG) {
      const storageInfo = NTAG_STORAGE_SIZES[versionInfo.storageSize];

      if (storageInfo) {
        return {
          success: true,
          chipType: storageInfo.type,
          versionInfo,
          memorySize: storageInfo.size,
        };
      }

      // Unknown storage size - return as unknown NTAG
      return {
        success: true,
        chipType: ChipType.NTAG_UNKNOWN,
        versionInfo,
        error: `Unknown NTAG storage size: 0x${versionInfo.storageSize.toString(16)}`,
      };
    }

    // Unknown product type
    return {
      success: true,
      chipType: ChipType.NTAG_UNKNOWN,
      versionInfo,
      error: `Unknown product type: 0x${versionInfo.productType.toString(16)}`,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    // GET_VERSION command not supported - might not be an NTAG
    if (
      errorMessage.toLowerCase().includes('transceive') ||
      errorMessage.toLowerCase().includes('tag was lost')
    ) {
      return {
        success: false,
        error: 'GET_VERSION command failed - may not be an NTAG',
      };
    }

    return {
      success: false,
      error: `NTAG detection failed: ${errorMessage}`,
    };
  }
}

/**
 * Check if raw tag data suggests this might be an NTAG
 * (preliminary check before running GET_VERSION)
 */
export function mightBeNtag(sak?: number, techTypes?: string[]): boolean {
  // NTAG chips typically have SAK 0x00 (no ISO 14443-4 support)
  if (sak !== undefined && sak !== 0x00) {
    return false;
  }

  // Should have NfcA technology
  if (techTypes && !techTypes.some(t => t.includes('NfcA'))) {
    return false;
  }

  // Should NOT have IsoDep (NTAG is Type 2, not Type 4)
  if (techTypes && techTypes.some(t => t.includes('IsoDep'))) {
    return false;
  }

  return true;
}

/**
 * Format NTAG/Ultralight version info for display
 */
export function formatNtagVersionInfo(info: NtagVersionInfo): string {
  const productTypeNames: Record<number, string> = {
    0x03: 'Ultralight',
    0x04: 'NTAG',
    0x05: 'NTAG I2C',
  };
  const typeName =
    productTypeNames[info.productType] || `0x${info.productType.toString(16)}`;

  return [
    `Vendor: ${info.vendorId === 0x04 ? 'NXP' : `0x${info.vendorId.toString(16)}`}`,
    `Type: ${typeName}`,
    `Version: ${info.majorVersion}.${info.minorVersion}`,
    `Storage: 0x${info.storageSize.toString(16)}`,
  ].join(', ');
}
