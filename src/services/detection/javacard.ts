/**
 * JavaCard/JCOP Detector
 * Identifies JavaCard chips using CPLC (Card Production Life Cycle) data
 * and AID probing
 */

import {ChipType} from '../../types/detection';
import {
  GET_CPLC,
  selectAid,
  KNOWN_AIDS,
  sendIsoDepCommand,
  parseApduResponse,
} from '../nfc/commands';

/**
 * CPLC (Card Production Life Cycle) data structure
 */
export interface CPLCData {
  icFabricator: number;
  icType: number;
  osId: number;
  osBuildDate: number;
  icFabricationDate: number;
  icSerialNumber: number;
  icBatchIdentifier: number;
  icModulePackager: number;
  installerIdentifier: number;
}

/**
 * Known IC Fabricator codes
 */
const IC_FABRICATORS: Record<number, string> = {
  0x4790: 'NXP Semiconductors',
  0x4180: 'Atmel',
  0x4090: 'Infineon',
  0x3060: 'Renesas',
  0x4250: 'Samsung',
  0x3360: 'STMicroelectronics',
};

/**
 * Known JCOP versions based on OS ID patterns
 */
const JCOP_OS_PATTERNS: Array<{pattern: number; mask: number; name: string}> = [
  {pattern: 0x4791, mask: 0xffff, name: 'JCOP4 J3R180'},
  {pattern: 0x4700, mask: 0xff00, name: 'JCOP4'},
  {pattern: 0x4680, mask: 0xff80, name: 'JCOP3'},
  {pattern: 0x4600, mask: 0xff00, name: 'JCOP2.x'},
];

/**
 * Result of JavaCard detection
 */
export interface JavaCardDetectionResult {
  success: boolean;
  chipType?: ChipType;
  cplc?: CPLCData;
  fabricatorName?: string;
  osName?: string;
  installedApplets?: string[];
  error?: string;
}

/**
 * Parse CPLC response into structured data
 */
function parseCPLC(data: number[]): CPLCData | null {
  // CPLC is 42 bytes (sometimes with tag 9F7F prefix)
  let cplcData = data;

  // Remove tag if present
  if (data[0] === 0x9f && data[1] === 0x7f) {
    cplcData = data.slice(3); // Skip 9F 7F length
  }

  if (cplcData.length < 42) {
    return null;
  }

  return {
    icFabricator: (cplcData[0] << 8) | cplcData[1],
    icType: (cplcData[2] << 8) | cplcData[3],
    osId: (cplcData[4] << 8) | cplcData[5],
    osBuildDate: (cplcData[6] << 8) | cplcData[7],
    icFabricationDate: (cplcData[8] << 8) | cplcData[9],
    icSerialNumber:
      (cplcData[10] << 24) |
      (cplcData[11] << 16) |
      (cplcData[12] << 8) |
      cplcData[13],
    icBatchIdentifier: (cplcData[14] << 8) | cplcData[15],
    icModulePackager: (cplcData[16] << 8) | cplcData[17],
    installerIdentifier: (cplcData[18] << 8) | cplcData[19],
  };
}

/**
 * Identify JCOP version from OS ID
 */
function identifyJcopVersion(osId: number): string | null {
  for (const pattern of JCOP_OS_PATTERNS) {
    if ((osId & pattern.mask) === pattern.pattern) {
      return pattern.name;
    }
  }
  return null;
}

/**
 * Detect JavaCard/JCOP chip using CPLC
 */
export async function detectJavaCard(): Promise<JavaCardDetectionResult> {
  try {
    // First, try to select the Card Manager (ISD)
    // Card Manager selection might fail, but we can still try CPLC
    // Some cards allow CPLC without selecting an applet
    let cardManagerSelected = false;
    try {
      const cmResponse = await sendIsoDepCommand(
        selectAid(KNOWN_AIDS.cardManager),
      );
      const cmParsed = parseApduResponse(cmResponse);
      cardManagerSelected = cmParsed.isSuccess;
    } catch {
      // Ignore - some cards don't support Card Manager selection
    }

    // Get CPLC data
    let cplc: CPLCData | null = null;
    let fabricatorName: string | undefined;
    let osName: string | undefined;

    if (cardManagerSelected) {
      try {
        const cplcResponse = await sendIsoDepCommand(GET_CPLC);
        const cplcParsed = parseApduResponse(cplcResponse);

        if (cplcParsed.isSuccess && cplcParsed.data.length >= 20) {
          cplc = parseCPLC(cplcParsed.data);
          if (cplc) {
            fabricatorName =
              IC_FABRICATORS[cplc.icFabricator] ||
              `Unknown (0x${cplc.icFabricator.toString(16)})`;
            osName = identifyJcopVersion(cplc.osId) || undefined;
          }
        }
      } catch {
        // CPLC failed - will try AID probing
      }
    }

    // Probe for installed applets (this also helps identify DT implants)
    const installedApplets = await probeApplets();

    // Determine chip type
    let chipType: ChipType = ChipType.JAVACARD_UNKNOWN;

    // If we have CPLC and it's NXP JCOP4
    if (cplc && cplc.icFabricator === 0x4790 && osName?.includes('JCOP4')) {
      chipType = ChipType.JCOP4;
    }
    // If we found JavaCard Memory, it's definitely a JCOP4 (Apex/flexSecure)
    else if (installedApplets.includes('JavaCard Memory')) {
      chipType = ChipType.JCOP4;
      if (!osName) {
        osName = 'JCOP4 (VivoKey)';
      }
      if (!fabricatorName) {
        fabricatorName = 'NXP Semiconductors';
      }
    }
    // If Fidesmo is present, likely JCOP4
    else if (installedApplets.includes('Fidesmo') && !cplc) {
      chipType = ChipType.JCOP4;
      if (!osName) {
        osName = 'JCOP4 (Fidesmo)';
      }
    }

    // If no identification was successful at all
    if (
      chipType === ChipType.JAVACARD_UNKNOWN &&
      !cplc &&
      installedApplets.length === 0
    ) {
      return {
        success: false,
        error: 'Could not identify JavaCard - CPLC unavailable and no known applets found',
      };
    }

    return {
      success: true,
      chipType,
      cplc: cplc || undefined,
      fabricatorName,
      osName: osName || (cplc ? `Unknown OS (0x${cplc.osId.toString(16)})` : 'Unknown'),
      installedApplets,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);

    return {
      success: false,
      error: `JavaCard detection failed: ${errorMessage}`,
    };
  }
}

/**
 * Probe for common applets
 */
async function probeApplets(): Promise<string[]> {
  const found: string[] = [];

  // Try JavaCard Memory Manager (indicates Apex or flexSecure)
  try {
    const response = await sendIsoDepCommand(
      selectAid(KNOWN_AIDS.javacardMemory),
    );
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('JavaCard Memory');
    }
  } catch {
    // Applet not present
  }

  // Try OpenPGP applet
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.openPgp));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('OpenPGP');
    }
  } catch {
    // Applet not present
  }

  // Try FIDO/U2F applet
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.fido));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('FIDO/U2F');
    }
  } catch {
    // Applet not present
  }

  // Try Fidesmo service discovery
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.fidesmo));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('Fidesmo');
    }
  } catch {
    // Applet not present
  }

  // Try PPSE (Proximity Payment System Environment) - indicates contactless payment card
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.ppse));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('Payment (PPSE)');
      // If PPSE is present, try to identify specific payment network
      await probePaymentNetworks(found);
    }
  } catch {
    // Not a payment card
  }

  return found;
}

/**
 * Probe for specific payment network applets
 * Only called if PPSE is present (i.e., this is a payment card)
 */
async function probePaymentNetworks(found: string[]): Promise<void> {
  // Try Visa
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.visaCredit));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('Visa');
      return; // Found payment network, no need to check others
    }
  } catch {
    // Not present
  }

  // Try Mastercard
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.mastercard));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('Mastercard');
      return;
    }
  } catch {
    // Not present
  }

  // Try Amex
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.amex));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('American Express');
      return;
    }
  } catch {
    // Not present
  }

  // Try Discover
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.discover));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('Discover');
      return;
    }
  } catch {
    // Not present
  }

  // Try Maestro
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.maestro));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('Maestro');
      return;
    }
  } catch {
    // Not present
  }
}

/**
 * Check if the JavaCard Memory Manager applet is present
 * This indicates an Apex or flexSecure implant
 */
export async function hasJavacardMemory(): Promise<boolean> {
  try {
    const response = await sendIsoDepCommand(
      selectAid(KNOWN_AIDS.javacardMemory),
    );
    const parsed = parseApduResponse(response);
    return parsed.isSuccess;
  } catch {
    return false;
  }
}

/**
 * Check if tag might be a JavaCard based on ATS/historical bytes
 */
export function mightBeJavaCard(
  historicalBytes?: string,
  ats?: string,
): boolean {
  if (!historicalBytes && !ats) {
    return false;
  }

  const checkStr = (historicalBytes || ats || '').toUpperCase();

  // Look for JCOP signatures in historical bytes
  // "4A434F50" = "JCOP" in ASCII
  if (checkStr.includes('4A:43:4F:50') || checkStr.includes('4A434F50')) {
    return true;
  }

  // NXP SmartMX patterns
  if (checkStr.includes('80:31') || checkStr.includes('80:71')) {
    return true;
  }

  // Check for typical JavaCard ATS patterns
  // T0=78 indicates lots of historical bytes (common in JavaCards)
  if (ats && ats.startsWith('78')) {
    return true;
  }

  return false;
}

/**
 * Detect JavaCard from ATS/historical bytes when CPLC fails
 * This is useful for iOS where commands may not work reliably
 */
export function detectJavaCardFromAts(
  historicalBytes?: string,
  ats?: string,
): JavaCardDetectionResult {
  if (!historicalBytes && !ats) {
    return {
      success: false,
      error: 'No ATS/historical bytes available',
    };
  }

  const checkStr = (historicalBytes || ats || '').toUpperCase();
  const cleanStr = checkStr.replace(/[:\s-]/g, '');

  // Look for JCOP signatures in historical bytes
  // "4A434F50" = "JCOP" in ASCII
  if (cleanStr.includes('4A434F50')) {
    // Try to determine JCOP version from surrounding bytes
    const jcopIndex = cleanStr.indexOf('4A434F50');
    const afterJcop = cleanStr.substring(jcopIndex + 8);

    // JCOP4 typically has version info after "JCOP"
    if (afterJcop.startsWith('34') || afterJcop.includes('4A33')) {
      // '34' = '4' in ASCII, or J3 pattern
      return {
        success: true,
        chipType: ChipType.JCOP4,
        osName: 'JCOP4 (from ATS)',
      };
    }

    return {
      success: true,
      chipType: ChipType.JAVACARD_UNKNOWN,
      osName: 'JCOP (version unknown)',
    };
  }

  // NXP SmartMX patterns (common in JCOP cards)
  if (cleanStr.includes('8031') || cleanStr.includes('8071')) {
    return {
      success: true,
      chipType: ChipType.JAVACARD_UNKNOWN,
      osName: 'NXP SmartMX (likely JCOP)',
    };
  }

  // Check for JavaCard capability indicators in historical bytes
  // Category indicator 0x80 followed by card capabilities
  const histBytes = cleanStr.match(/.{1,2}/g)?.map(h => parseInt(h, 16)) || [];

  if (histBytes.length >= 3) {
    // Check for category indicator 0x80 (status indicator)
    if (histBytes[0] === 0x80) {
      // Check compact-TLV data objects
      // 0x31 = card capabilities, 0x71 = card service data
      if (histBytes[1] === 0x31 || histBytes[1] === 0x71) {
        return {
          success: true,
          chipType: ChipType.JAVACARD_UNKNOWN,
          osName: 'JavaCard (from ATS capabilities)',
        };
      }
    }

    // Check for initial selection indicator 0x00 (typically JavaCards)
    // followed by application identifier presence
    if (histBytes[0] === 0x00 && histBytes.length >= 5) {
      return {
        success: true,
        chipType: ChipType.JAVACARD_UNKNOWN,
        osName: 'Possible JavaCard (from ATS)',
      };
    }
  }

  return {
    success: false,
    error: 'Could not identify JavaCard from ATS',
  };
}

/**
 * Format CPLC data for display
 */
export function formatCPLC(cplc: CPLCData): string {
  const fabricator =
    IC_FABRICATORS[cplc.icFabricator] || `0x${cplc.icFabricator.toString(16)}`;
  return `Fabricator: ${fabricator}, OS: 0x${cplc.osId.toString(16)}`;
}
