/**
 * DESFire Detector
 * Identifies MIFARE DESFire EV1/EV2/EV3, DESFire DNA variants,
 * DESFire Light, and NTAG 424 DNA using GET_VERSION command
 */

import {ChipType, DesfireVersionInfo} from '../../types/detection';
import type {NdefRecord} from '../../types/nfc';
import {
  DESFIRE_GET_VERSION,
  DESFIRE_GET_VERSION_CONTINUE,
  sendIsoDepCommand,
  parseApduResponse,
  selectAid,
  KNOWN_AIDS,
} from '../nfc/commands';

/**
 * URI record type name format prefixes
 * https://www.nfc-forum.org/specs/
 */
const URI_PREFIXES: Record<number, string> = {
  0x00: '',
  0x01: 'http://www.',
  0x02: 'https://www.',
  0x03: 'http://',
  0x04: 'https://',
  0x05: 'tel:',
  0x06: 'mailto:',
};

/**
 * Detect Spark 2 implant from cached NDEF records
 * This should be called BEFORE any APDU commands to avoid putting the tag
 * into native mode which breaks ISO 7816-4 NDEF reading
 */
export function detectSpark2FromNdef(
  ndefRecords?: NdefRecord[],
): Spark2DetectionResult {
  if (!ndefRecords || ndefRecords.length === 0) {
    return {found: false};
  }

  console.log('[DESFire] Checking cached NDEF records for Spark 2...');

  for (const record of ndefRecords) {
    // Check for URI record (TNF=1, type="U")
    if (record.tnf === 1 && record.type === 'U' && record.payload.length > 0) {
      // First byte is URI prefix code
      const prefixCode = record.payload[0];
      const prefix = URI_PREFIXES[prefixCode] || '';
      const uriBody = record.payload
        .slice(1)
        .map(b => String.fromCharCode(b))
        .join('');
      const fullUri = prefix + uriBody;

      console.log('[DESFire] Found URI record:', fullUri);

      // Check for vivokey.co pattern
      const vivokeyMatch = fullUri.match(/vivokey\.co\/([A-Za-z0-9_\-]+)/i);
      if (vivokeyMatch) {
        const code = vivokeyMatch[1];
        const url = `https://vivokey.co/${code}`;
        console.log('[DESFire] Found Spark 2 URL:', url);
        return {
          found: true,
          name: 'Spark 2',
          url,
        };
      }
    }
  }

  console.log('[DESFire] No vivokey.co URL in NDEF records');
  return {found: false};
}

/**
 * Product type values from GET_VERSION byte 1
 * Per NXP datasheets:
 * - NTAG 413 DNA (NT4H1321): Type 0x04, Subtype 0x02
 * - NTAG 424 DNA (NT4H2421): Type 0x04, Subtype 0x05
 * - NTAG 424 DNA TT: Type 0x04, Subtype 0x04
 * - DESFire EV1/EV2/EV3: Type 0x01
 */
const PRODUCT_TYPES = {
  DESFIRE: 0x01, // Standard DESFire
  NTAG_DNA: 0x04, // NTAG DNA family (413/424) - distinguished by subtype
  NTAG_I2C: 0x05, // NTAG I2C family (can have ISO-DEP on Plus variants)
  DESFIRE_LIGHT: 0x08, // DESFire Light
} as const;

/**
 * NTAG DNA subtype values from GET_VERSION byte 2
 * Per NXP NT4H1321 and NT4H2421 datasheets
 */
const NTAG_DNA_SUBTYPES = {
  NTAG413_DNA: 0x02, // NTAG 413 DNA
  NTAG424_DNA_TT: 0x04, // NTAG 424 DNA TagTamper
  NTAG424_DNA: 0x05, // NTAG 424 DNA
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

    if (hwProductType === PRODUCT_TYPES.NTAG_DNA) {
      // NTAG DNA family (413/424) - distinguish by subtype per NXP datasheets
      // NT4H1321 (NTAG 413 DNA): Subtype 0x02, Major 0x04
      // NT4H2421 (NTAG 424 DNA): Subtype 0x05, Major 0x04
      // NT4H2421 TT (NTAG 424 DNA TagTamper): Subtype 0x04, Major 0x04
      switch (hwSubtype) {
        case NTAG_DNA_SUBTYPES.NTAG413_DNA:
          console.log('[DESFire] Detected NTAG 413 DNA (product 0x04, subtype 0x02)');
          chipType = ChipType.NTAG413_DNA;
          break;
        case NTAG_DNA_SUBTYPES.NTAG424_DNA_TT:
          console.log('[DESFire] Detected NTAG 424 DNA TT (product 0x04, subtype 0x04)');
          chipType = ChipType.NTAG424_DNA_TT;
          break;
        case NTAG_DNA_SUBTYPES.NTAG424_DNA:
          console.log('[DESFire] Detected NTAG 424 DNA (product 0x04, subtype 0x05)');
          chipType = ChipType.NTAG424_DNA;
          break;
        default:
          // Unknown NTAG DNA subtype - log and fall back to 424 DNA as most common
          console.warn(
            `[DESFire] Unknown NTAG DNA subtype: 0x${hwSubtype.toString(16)}, major: 0x${hwMajor.toString(16)}`,
          );
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

/**
 * Result of Spark 2 detection
 */
export interface Spark2DetectionResult {
  found: boolean;
  name?: string;
  url?: string;
}

/**
 * Detect Spark 2 implant by reading NDEF from NTAG 424 DNA
 * Spark 2 implants have a URI record pointing to vivokey.co/$code
 *
 * Uses Type 4 Tag NDEF reading:
 * 1. SELECT NDEF application
 * 2. SELECT NDEF file (E104)
 * 3. READ BINARY to get NDEF message
 */
export async function detectSpark2Implant(): Promise<Spark2DetectionResult> {
  try {
    console.log('[DESFire] Checking for Spark 2 implant NDEF...');

    // Step 1: Select NDEF application (D2760000850101)
    console.log('[DESFire] Selecting NDEF application...');
    const selectNdefApp = await sendIsoDepCommand(selectAid(KNOWN_AIDS.ndefTag));
    const selectAppResponse = parseApduResponse(selectNdefApp);
    console.log('[DESFire] NDEF app select result:', {
      sw: `${selectAppResponse.sw1.toString(16)}${selectAppResponse.sw2.toString(16)}`,
      success: selectAppResponse.isSuccess,
    });

    if (!selectAppResponse.isSuccess) {
      console.log('[DESFire] NDEF app selection failed');
      return {found: false};
    }

    // Step 2: Select NDEF file (file ID E104 for standard Type 4 Tag)
    // SELECT by file ID: 00 A4 00 0C 02 E104
    console.log('[DESFire] Selecting NDEF file E104...');
    const selectFileCmd = [0x00, 0xa4, 0x00, 0x0c, 0x02, 0xe1, 0x04];
    const selectFileResponse = await sendIsoDepCommand(selectFileCmd);
    const selectFileParsed = parseApduResponse(selectFileResponse);
    console.log('[DESFire] NDEF file select result:', {
      sw: `${selectFileParsed.sw1.toString(16)}${selectFileParsed.sw2.toString(16)}`,
      success: selectFileParsed.isSuccess,
    });

    if (!selectFileParsed.isSuccess) {
      // Try alternate file ID (some Type 4 tags use E102 or just 02)
      console.log('[DESFire] Trying alternate NDEF file 0002...');
      const altSelectCmd = [0x00, 0xa4, 0x00, 0x0c, 0x02, 0x00, 0x02];
      const altSelectResponse = await sendIsoDepCommand(altSelectCmd);
      const altSelectParsed = parseApduResponse(altSelectResponse);
      console.log('[DESFire] Alternate file select result:', {
        sw: `${altSelectParsed.sw1.toString(16)}${altSelectParsed.sw2.toString(16)}`,
        success: altSelectParsed.isSuccess,
      });

      if (!altSelectParsed.isSuccess) {
        console.log('[DESFire] NDEF file selection failed');
        return {found: false};
      }
    }

    // Step 3: Read NDEF length (first 2 bytes)
    // READ BINARY: 00 B0 00 00 02
    console.log('[DESFire] Reading NDEF length...');
    const readLengthCmd = [0x00, 0xb0, 0x00, 0x00, 0x02];
    const readLengthResponse = await sendIsoDepCommand(readLengthCmd);
    const lengthParsed = parseApduResponse(readLengthResponse);
    console.log('[DESFire] NDEF length read result:', {
      sw: `${lengthParsed.sw1.toString(16)}${lengthParsed.sw2.toString(16)}`,
      data: lengthParsed.data,
    });

    if (!lengthParsed.isSuccess || lengthParsed.data.length < 2) {
      console.log('[DESFire] NDEF length read failed');
      return {found: false};
    }

    const ndefLength = (lengthParsed.data[0] << 8) | lengthParsed.data[1];
    console.log('[DESFire] NDEF message length:', ndefLength, 'bytes');

    if (ndefLength === 0 || ndefLength > 500) {
      console.log('[DESFire] Invalid or empty NDEF length');
      return {found: false};
    }

    // Step 4: Read NDEF message (starting after length bytes)
    // For longer NDEF messages, we may need to read in chunks
    const allNdefData: number[] = [];
    let offset = 2; // Start after the 2-byte length field
    let remaining = ndefLength;

    while (remaining > 0) {
      const chunkSize = Math.min(remaining, 128); // Read up to 128 bytes at a time
      // READ BINARY: 00 B0 <offset high> <offset low> <length>
      const readDataCmd = [0x00, 0xb0, (offset >> 8) & 0xff, offset & 0xff, chunkSize];
      const readDataResponse = await sendIsoDepCommand(readDataCmd);
      const dataParsed = parseApduResponse(readDataResponse);

      if (!dataParsed.isSuccess || dataParsed.data.length === 0) {
        console.log('[DESFire] NDEF data read failed at offset', offset);
        break;
      }

      allNdefData.push(...dataParsed.data);
      offset += dataParsed.data.length;
      remaining -= dataParsed.data.length;
    }

    if (allNdefData.length === 0) {
      console.log('[DESFire] No NDEF data read');
      return {found: false};
    }

    console.log(
      '[DESFire] NDEF data (' + allNdefData.length + ' bytes):',
      allNdefData.slice(0, 50).map(b => b.toString(16).padStart(2, '0')).join(' ') +
        (allNdefData.length > 50 ? '...' : ''),
    );

    // Convert to ASCII and look for vivokey.co pattern
    const asciiStr = allNdefData
      .filter(b => b >= 0x20 && b <= 0x7e)
      .map(b => String.fromCharCode(b))
      .join('');

    console.log('[DESFire] NDEF ASCII:', asciiStr);

    // Check for vivokey.co URL pattern - match any characters after the domain
    // Pattern allows alphanumeric, hyphens, underscores, and other URL-safe chars
    const vivokeyMatch = asciiStr.match(/vivokey\.co\/([A-Za-z0-9_\-]+)/i);
    if (vivokeyMatch) {
      const code = vivokeyMatch[1];
      const url = `https://vivokey.co/${code}`;
      console.log('[DESFire] Found Spark 2 URL:', url);

      return {
        found: true,
        name: 'Spark 2',
        url,
      };
    }

    console.log('[DESFire] No vivokey.co URL found');
    return {found: false};
  } catch (error) {
    console.warn('[DESFire] Spark 2 detection failed:', error);
    return {found: false};
  }
}
