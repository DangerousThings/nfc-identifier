/**
 * DESFire Detector
 * Identifies MIFARE DESFire EV1/EV2/EV3, DESFire DNA variants,
 * DESFire Light, and NTAG 424 DNA using GET_VERSION command
 */

import {ChipType, DesfireVersionInfo} from '../../types/detection';
import {
  DESFIRE_GET_VERSION,
  DESFIRE_GET_VERSION_CONTINUE,
  sendIsoDepCommand,
  parseApduResponse,
} from '../nfc/commands';

/**
 * Product type values from GET_VERSION byte 1
 */
const PRODUCT_TYPES = {
  DESFIRE: 0x01, // Standard DESFire
  NTAG_I2C: 0x05, // NTAG I2C family (can have ISO-DEP on Plus variants)
  DESFIRE_LIGHT: 0x08, // DESFire Light
  NTAG_424_DNA: 0x21, // NTAG 424 DNA family
} as const;

/**
 * DESFire hardware major version to chip type mapping
 * Per NXP MF3D(H)x1, MF3D(H)x2, MF3DHx3 datasheets
 *
 * Byte 3 (hwMajor) of GET_VERSION response indicates the version:
 * - EV1: 0x00, 0x01
 * - EV2: 0x12, 0x22 (standard), 0x32 (DNA capable)
 * - EV3: 0x30, 0x31, 0x32, 0x33, 0x34 (various configs)
 *
 * Note: The version byte encoding changed between generations
 */
const DESFIRE_VERSION_MAP: Record<number, ChipType> = {
  // DESFire EV1 (and legacy EV0)
  0x00: ChipType.DESFIRE_EV1, // EV0/Legacy
  0x01: ChipType.DESFIRE_EV1, // EV1 standard

  // DESFire EV2
  0x10: ChipType.DESFIRE_EV2, // Some EV2 variants
  0x11: ChipType.DESFIRE_EV2, // Some EV2 variants
  0x12: ChipType.DESFIRE_EV2, // EV2 standard
  0x20: ChipType.DESFIRE_EV2, // Some EV2 variants
  0x21: ChipType.DESFIRE_EV2, // Some EV2 variants
  0x22: ChipType.DESFIRE_EV2, // EV2 alternative

  // DESFire EV3 - per NXP MF3DHx3 datasheet
  0x30: ChipType.DESFIRE_EV3, // EV3 standard
  0x31: ChipType.DESFIRE_EV3, // EV3 variant
  0x32: ChipType.DESFIRE_EV3, // EV3 (may also be EV2 DNA in some docs)
  0x33: ChipType.DESFIRE_EV3, // EV3 variant
  0x34: ChipType.DESFIRE_EV3, // EV3 variant
  0x35: ChipType.DESFIRE_EV3, // EV3 variant
  0x36: ChipType.DESFIRE_EV3, // EV3 variant
};

/**
 * DESFire DNA detection notes:
 * DNA variants have originality signature capability, but this CANNOT be
 * reliably determined from GET_VERSION alone. The major version ranges
 * overlap between standard and DNA variants.
 *
 * To properly detect DNA, you would need to:
 * 1. Attempt to read the originality signature (command 0x3C)
 * 2. Check if it succeeds (DNA) or fails (non-DNA)
 *
 * For now, we report the base EV version without assuming DNA status.
 */

/**
 * DESFire storage size decoding
 * The storage size byte encodes capacity
 */
const DESFIRE_STORAGE_SIZES: Record<number, number> = {
  0x10: 256, // 256 bytes (DESFire Light)
  0x12: 512, // 512 bytes (DESFire Light)
  0x13: 888, // NTAG I2C 1K user memory
  0x14: 1024, // 1K
  0x15: 1912, // NTAG I2C 2K user memory
  0x16: 2048, // 2K
  0x18: 4096, // 4K
  0x1a: 8192, // 8K
  0x1c: 16384, // 16K
  0x1e: 32768, // 32K
};

/**
 * Result of DESFire detection
 */
export interface DesfireDetectionResult {
  success: boolean;
  chipType?: ChipType;
  versionInfo?: DesfireVersionInfo;
  storageSize?: number;
  error?: string;
}

/**
 * Detect DESFire chip version using GET_VERSION command
 *
 * DESFire GET_VERSION returns data in 3 frames:
 * Frame 1: Hardware version info (7 bytes)
 * Frame 2: Software version info (7 bytes)
 * Frame 3: Production info (14 bytes)
 */
export async function detectDesfire(): Promise<DesfireDetectionResult> {
  try {
    console.log('[DESFire] Sending GET_VERSION command:', DESFIRE_GET_VERSION);

    // Send GET_VERSION command (wrapped in ISO 7816-4 format)
    const response1 = await sendIsoDepCommand(DESFIRE_GET_VERSION);
    console.log('[DESFire] GET_VERSION response:', response1);

    const parsed1 = parseApduResponse(response1);
    console.log('[DESFire] Parsed response:', {
      data: parsed1.data,
      sw1: parsed1.sw1.toString(16),
      sw2: parsed1.sw2.toString(16),
      isSuccess: parsed1.isSuccess,
    });

    // Check for success or "more data" response
    if (!parsed1.isSuccess && parsed1.sw1 !== 0xaf) {
      return {
        success: false,
        error: `GET_VERSION failed: SW=${parsed1.sw1.toString(16)}${parsed1.sw2.toString(16)}`,
      };
    }

    if (parsed1.data.length < 7) {
      return {
        success: false,
        error: `Invalid GET_VERSION response length: ${parsed1.data.length}`,
      };
    }

    // Parse hardware version info
    // Byte 0: Vendor ID (0x04 = NXP)
    // Byte 1: Product type (0x01 = DESFire, 0x08 = DESFire Light, 0x21 = NTAG 424 DNA)
    // Byte 2: Subtype
    // Byte 3: Major version
    // Byte 4: Minor version
    // Byte 5: Storage size
    // Byte 6: Protocol
    const hwVendorId = parsed1.data[0];
    const hwProductType = parsed1.data[1];
    const hwSubtype = parsed1.data[2];
    const hwMajor = parsed1.data[3];
    const hwMinor = parsed1.data[4];
    const hwStorageSize = parsed1.data[5];

    // Verify this is NXP
    if (hwVendorId !== 0x04) {
      return {
        success: true,
        chipType: ChipType.DESFIRE_UNKNOWN,
        error: `Non-NXP vendor: 0x${hwVendorId.toString(16)}`,
      };
    }

    // Get software version (second frame)
    let swMajor = 0;
    let swMinor = 0;

    if (parsed1.sw1 === 0xaf || parsed1.sw2 === 0xaf) {
      try {
        const response2 = await sendIsoDepCommand(DESFIRE_GET_VERSION_CONTINUE);
        const parsed2 = parseApduResponse(response2);

        if (parsed2.data.length >= 7) {
          swMajor = parsed2.data[3];
          swMinor = parsed2.data[4];
        }
      } catch {
        // Continue without software version
      }
    }

    // Determine chip type based on product type and version
    let chipType: ChipType;

    if (hwProductType === PRODUCT_TYPES.NTAG_424_DNA) {
      // NTAG DNA family (413 DNA and 424 DNA share product type 0x21)
      // Subtype 0x02 = TagTamper variant (424 DNA TT only)
      // Storage size helps differentiate:
      // - NTAG 413 DNA: ~160 bytes user memory (storage code <= 0x0E)
      // - NTAG 424 DNA: ~416 bytes user memory (storage code >= 0x0F)
      if (hwSubtype === 0x02) {
        chipType = ChipType.NTAG424_DNA_TT;
      } else if (hwStorageSize <= 0x0e) {
        // Smaller storage indicates NTAG 413 DNA (~160 bytes)
        chipType = ChipType.NTAG413_DNA;
      } else {
        // Larger storage indicates NTAG 424 DNA (~416 bytes)
        chipType = ChipType.NTAG424_DNA;
      }
    } else if (hwProductType === PRODUCT_TYPES.NTAG_I2C) {
      // NTAG I2C family (can have ISO-DEP on Plus variants)
      // Per NXP NT3H2111/NT3H2211 datasheet:
      // - Storage size 0x13 = 1K variant (NT3H1101, NT3H2111)
      // - Storage size 0x15 = 2K variant (NT3H1201, NT3H2211)
      // - Subtype 0x01 = non-Plus, 0x02 = Plus
      const isPlus = hwSubtype === 0x02;

      if (hwStorageSize === 0x13) {
        chipType = isPlus ? ChipType.NTAG_I2C_PLUS_1K : ChipType.NTAG_I2C_1K;
      } else if (hwStorageSize === 0x15) {
        chipType = isPlus ? ChipType.NTAG_I2C_PLUS_2K : ChipType.NTAG_I2C_2K;
      } else {
        // Unknown storage size - report as unknown NTAG
        console.warn(
          `[DESFire] NTAG I2C with unknown storage size: 0x${hwStorageSize.toString(16)}`,
        );
        chipType = ChipType.NTAG_UNKNOWN;
      }
    } else if (hwProductType === PRODUCT_TYPES.DESFIRE_LIGHT) {
      // DESFire Light
      chipType = ChipType.DESFIRE_LIGHT;
    } else if (hwProductType === PRODUCT_TYPES.DESFIRE) {
      // Standard DESFire - determine version from hwMajor
      chipType = DESFIRE_VERSION_MAP[hwMajor];

      // If not in our map, try to infer from the version range
      if (!chipType) {
        console.warn(
          `[DESFire] Unknown hardware major version: 0x${hwMajor.toString(16)}`,
        );
        // Infer based on version ranges per NXP conventions
        if (hwMajor <= 0x01) {
          chipType = ChipType.DESFIRE_EV1;
        } else if (hwMajor >= 0x10 && hwMajor < 0x30) {
          chipType = ChipType.DESFIRE_EV2;
        } else if (hwMajor >= 0x30) {
          chipType = ChipType.DESFIRE_EV3;
        } else {
          chipType = ChipType.DESFIRE_UNKNOWN;
        }
      }

      // Note: DNA variants cannot be reliably detected from GET_VERSION.
      // To detect DNA, you would need to try reading the originality signature.
    } else {
      // Unknown product type
      chipType = ChipType.DESFIRE_UNKNOWN;
    }

    // Decode storage size
    const storageSize = DESFIRE_STORAGE_SIZES[hwStorageSize];

    const versionInfo: DesfireVersionInfo = {
      hardwareMajor: hwMajor,
      hardwareMinor: hwMinor,
      hardwareStorageSize: hwStorageSize,
      softwareMajor: swMajor,
      softwareMinor: swMinor,
    };

    return {
      success: true,
      chipType,
      versionInfo,
      storageSize,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: `DESFire detection failed: ${errorMessage}`,
    };
  }
}

/**
 * Check if tag might be DESFire based on SAK and tech types
 */
export function mightBeDesfire(sak?: number, techTypes?: string[]): boolean {
  // DESFire has SAK 0x20 (ISO 14443-4 compliant)
  // But SAK 0x20 can also be other ISO-DEP chips
  if (sak === 0x20) {
    return true;
  }

  // Check for IsoDep technology
  if (techTypes?.some(t => t.includes('IsoDep'))) {
    return true;
  }

  return false;
}

/**
 * Detect DESFire from ATS/historical bytes when GET_VERSION fails
 * This is useful for iOS where commands may not work reliably
 *
 * DESFire ATS patterns:
 * - Historical bytes starting with 0x75 (format byte) + 0x77 (card type)
 * - "DESFire" text in historical bytes (some older cards)
 * - SAK 0x20 with specific ATQA patterns
 */
export function detectDesfireFromAts(
  historicalBytes?: string,
  ats?: string,
  sak?: number,
  atqa?: string,
): DesfireDetectionResult {
  // Convert hex string to bytes for analysis
  const histBytes = historicalBytes
    ? historicalBytes
        .replace(/[:\s-]/g, '')
        .match(/.{1,2}/g)
        ?.map(h => parseInt(h, 16)) || []
    : [];

  // Check for DESFire historical bytes patterns
  // Pattern 1: 0x75 0x77 0x81 0x02 0x80 (DESFire EV1/2/3 typical pattern)
  if (histBytes.length >= 5) {
    if (histBytes[0] === 0x75 && histBytes[1] === 0x77) {
      // This is likely DESFire
      // Byte 4 often indicates storage size
      return {
        success: true,
        chipType: ChipType.DESFIRE_UNKNOWN,
        error: 'Identified as DESFire from ATS (version unknown)',
      };
    }
  }

  // Pattern 2: Check for specific DESFire identifiers
  // Some DESFire cards have 0x06 as format byte followed by capabilities
  if (histBytes.length >= 3 && histBytes[0] === 0x06) {
    return {
      success: true,
      chipType: ChipType.DESFIRE_UNKNOWN,
      error: 'Identified as DESFire from ATS format byte',
    };
  }

  // Pattern 3: Check for NTAG 424 DNA historical bytes
  // NTAG 424 DNA typically has historical bytes starting with specific patterns
  if (histBytes.length >= 4) {
    // NTAG 424 DNA pattern: 0x80 0x77 0xC1 or similar
    if (histBytes[0] === 0x80 && histBytes[1] === 0x77) {
      return {
        success: true,
        chipType: ChipType.NTAG424_DNA,
        error: 'Identified as NTAG 424 DNA from ATS',
      };
    }
  }

  // Pattern 4: Check for "DESFire" ASCII in historical bytes
  const histString = histBytes.map(b => String.fromCharCode(b)).join('');
  if (histString.includes('DESFire') || histString.includes('DESFIRE')) {
    return {
      success: true,
      chipType: ChipType.DESFIRE_UNKNOWN,
      error: 'Identified as DESFire from ATS string',
    };
  }

  // SAK-based inference
  if (sak === 0x20) {
    // SAK 0x20 with ISO-DEP capability but no other identification
    // Could be DESFire, NTAG 424 DNA, or other ISO 14443-4 card
    // Parse ATQA for more info
    if (atqa) {
      const atqaClean = atqa.replace(/[:\s-]/g, '');
      // DESFire typically has ATQA 0x0344 or 0x0304
      if (atqaClean === '0344' || atqaClean === '4403') {
        return {
          success: true,
          chipType: ChipType.DESFIRE_UNKNOWN,
          error: 'Likely DESFire based on SAK/ATQA',
        };
      }
      // NTAG 424 DNA typically has ATQA 0x0004
      if (atqaClean === '0004' || atqaClean === '0400') {
        return {
          success: true,
          chipType: ChipType.NTAG424_DNA,
          error: 'Likely NTAG 424 DNA based on SAK/ATQA',
        };
      }
    }
  }

  return {
    success: false,
    error: 'Could not identify DESFire from ATS',
  };
}

/**
 * Format DESFire version info for display
 */
export function formatDesfireVersionInfo(info: DesfireVersionInfo): string {
  const version = `HW: ${info.hardwareMajor}.${info.hardwareMinor}`;
  const software =
    info.softwareMajor > 0
      ? `, SW: ${info.softwareMajor}.${info.softwareMinor}`
      : '';
  return version + software;
}
