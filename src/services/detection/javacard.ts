/**
 * JavaCard/JCOP Detector
 * Identifies JavaCard chips using CPLC (Card Production Life Cycle) data
 * and AID probing
 */

import {ChipType} from '../../types/detection';
import {
  selectAid,
  KNOWN_AIDS,
  sendIsoDepCommand,
  parseApduResponse,
  bytesToHex,
} from '../nfc/commands';
import {
  identifyFabricator,
  selectIsdAndReadCplc,
  type CPLCData,
} from './cplc';

// CPLC parsing and ISD selection live in `./cplc` so branches other than this
// one can use them. Re-exported here for existing importers.
export type {CPLCData} from './cplc';
export {formatCPLC, identifyIcType, JCOP_IC_TYPES} from './cplc';

/**
 * Fidesmo persistent memory fingerprint (from GP Qt project)
 * Apex/VivoKey devices report exactly this value for persistent_total
 */
const FIDESMO_PERSISTENT_TOTAL = 84336;

/**
 * Result of JavaCard detection
 */
export interface JavaCardDetectionResult {
  success: boolean;
  chipType?: ChipType;
  cplc?: CPLCData;
  fabricatorName?: string;
  osName?: string;
  /** NXP part name from the CPLC IC Type, e.g. "J3R180". */
  icTypeName?: string;
  /**
   * Whether a GlobalPlatform ISD answered a SELECT. True even when CPLC
   * itself was unreadable — the ISD alone proves a smart card substrate.
   */
  isdSelected?: boolean;
  installedApplets?: string[];
  isFidesmo?: boolean;
  error?: string;
}

/**
 * Detect JavaCard/JCOP chip using CPLC, Fidesmo fingerprinting, and AID probing
 * Detection strategy derived from GP Qt project:
 *   1. Try Card Manager selection + CPLC
 *   2. Read JavaCard Memory applet (persistent_total == 84336 = Fidesmo)
 *   3. Probe Fidesmo-specific AIDs (App, Batch, Platform)
 *   4. Probe common applets for identification
 */
export async function detectJavaCard(): Promise<JavaCardDetectionResult> {
  try {
    // Select the GlobalPlatform ISD (trying both known AIDs) and read CPLC.
    const isd = await selectIsdAndReadCplc();
    const cplc: CPLCData | null = isd.cplc ?? null;
    let fabricatorName: string | undefined = isd.fabricatorName;
    let osName: string | undefined = isd.osName;
    const icTypeName = isd.icTypeName;

    // Check JavaCard Memory for Fidesmo fingerprint (from GP Qt project)
    // The memory applet reports persistent_total; Fidesmo devices report 84336
    const memoryResult = await readJavacardMemory();
    const isFidesmoByMemory =
      memoryResult !== null &&
      memoryResult.persistentTotal === FIDESMO_PERSISTENT_TOTAL;

    if (isFidesmoByMemory) {
      console.log(
        '[javacard] Fidesmo fingerprint detected via JavaCard Memory:',
        `persistent_total=${memoryResult!.persistentTotal}`,
      );
    }

    // Probe Fidesmo-specific AIDs (from GP Qt project)
    const fidesmoDetected = await probeFidesmo();

    // Probe for installed applets (also helps identify DT implants)
    const installedApplets = await probeApplets();

    // Add Fidesmo to applet list if detected by any method
    const isFidesmo = isFidesmoByMemory || fidesmoDetected;
    if (isFidesmo && !installedApplets.includes('Fidesmo')) {
      installedApplets.push('Fidesmo');
    }

    // Determine chip type
    let chipType: ChipType = ChipType.JAVACARD_UNKNOWN;

    // A recognised NXP JCOP part number is the strongest signal available —
    // it names the silicon outright, so it outranks the OS-ID pattern match.
    if (icTypeName) {
      chipType = ChipType.JCOP4;
      if (!osName) {
        osName = `JCOP4 (${icTypeName})`;
      }
      if (!fabricatorName) {
        fabricatorName = 'NXP Semiconductors';
      }
    }
    // If we have CPLC and it's NXP JCOP4
    else if (cplc && cplc.icFabricator === 0x4790 && osName?.includes('JCOP4')) {
      chipType = ChipType.JCOP4;
    }
    // Fidesmo fingerprint (memory or AID) — definitely JCOP4 Apex
    else if (isFidesmo) {
      chipType = ChipType.JCOP4;
      if (!osName) {
        osName = 'JCOP4 (Fidesmo)';
      }
      if (!fabricatorName) {
        fabricatorName = 'NXP Semiconductors';
      }
    }
    // If we found JavaCard Memory, it's a JCOP4 (Apex/flexSecure)
    else if (installedApplets.includes('JavaCard Memory')) {
      chipType = ChipType.JCOP4;
      if (!osName) {
        osName = 'JCOP4 (VivoKey)';
      }
      if (!fabricatorName) {
        fabricatorName = 'NXP Semiconductors';
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
      icTypeName,
      isdSelected: isd.isdSelected,
      installedApplets,
      isFidesmo,
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
 * JavaCard Memory applet response data
 */
export interface JavaCardMemoryInfo {
  persistentFree: number;
  persistentTotal: number;
  transientResetFree: number;
  transientDeselectFree: number;
}

/**
 * Read JavaCard Memory applet to get storage information
 * The response contains: [persistent_free:4][persistent_total:4][transient_reset:2][transient_deselect:2]
 * From GP Qt project: measure.py
 */
async function readJavacardMemory(): Promise<JavaCardMemoryInfo | null> {
  try {
    const response = await sendIsoDepCommand(
      selectAid(KNOWN_AIDS.javacardMemory),
    );
    const parsed = parseApduResponse(response);

    if (!parsed.isSuccess || parsed.data.length < 12) {
      return null;
    }

    const d = parsed.data;
    const persistentFree =
      ((d[0] << 24) | (d[1] << 16) | (d[2] << 8) | d[3]) >>> 0;
    const persistentTotal =
      ((d[4] << 24) | (d[5] << 16) | (d[6] << 8) | d[7]) >>> 0;
    const transientResetFree = (d[8] << 8) | d[9];
    const transientDeselectFree = (d[10] << 8) | d[11];

    console.log('[javacard] Memory info:', {
      persistentFree,
      persistentTotal,
      transientResetFree,
      transientDeselectFree,
    });

    return {
      persistentFree,
      persistentTotal,
      transientResetFree,
      transientDeselectFree,
    };
  } catch {
    return null;
  }
}

/**
 * Probe Fidesmo-specific AIDs (from GP Qt project)
 * Returns true if any Fidesmo AID is found
 */
async function probeFidesmo(): Promise<boolean> {
  const fidesmoAids = [
    {aid: KNOWN_AIDS.fidesmoApp, name: 'Fidesmo App'},
    {aid: KNOWN_AIDS.fidesmoBatch, name: 'Fidesmo Batch'},
    {aid: KNOWN_AIDS.fidesmoPlatform, name: 'Fidesmo Platform'},
  ];

  for (const {aid, name} of fidesmoAids) {
    try {
      const response = await sendIsoDepCommand(selectAid(aid));
      const parsed = parseApduResponse(response);
      if (parsed.isSuccess) {
        console.log(`[javacard] ${name} AID found: ${bytesToHex(aid)}`);
        return true;
      }
    } catch {
      // Not present, try next
    }
  }

  return false;
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

  // Try FIDO U2F applet
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.fido));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('FIDO U2F');
    }
  } catch {
    // Applet not present
  }

  // Try FIDO2 applet
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.fido2));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('FIDO2');
    }
  } catch {
    // Applet not present
  }

  // Try VivoKey OTP applet
  try {
    const response = await sendIsoDepCommand(
      selectAid(KNOWN_AIDS.vivokeyOtp),
    );
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('VivoKey OTP');
    }
  } catch {
    // Applet not present
  }

  // Try NDEF applet
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.ndefTag));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('NDEF');
    }
  } catch {
    // Applet not present
  }

  // Try OATH applet
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.oath));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('OATH (OTP)');
    }
  } catch {
    // Applet not present
  }

  // Try PIV applet
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.piv));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('PIV');
    }
  } catch {
    // Applet not present
  }

  // Try SatoChip applet
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.satoChip));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('SatoChip');
    }
  } catch {
    // Applet not present
  }

  // Try SeedKeeper applet
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.seedKeeper));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('SeedKeeper');
    }
  } catch {
    // Applet not present
  }

  // Try Keycard applet
  try {
    const response = await sendIsoDepCommand(selectAid(KNOWN_AIDS.keycard));
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('Keycard');
    }
  } catch {
    // Applet not present
  }

  // Try YubiKey HMAC applet
  try {
    const response = await sendIsoDepCommand(
      selectAid(KNOWN_AIDS.yubikeyHmac),
    );
    const parsed = parseApduResponse(response);
    if (parsed.isSuccess) {
      found.push('YubiKey HMAC');
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
 * Get JavaCard storage info (public wrapper)
 * Returns memory stats or null if not available
 */
export async function getJavacardStorageInfo(): Promise<JavaCardMemoryInfo | null> {
  return readJavacardMemory();
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
 * Resolve a CPLC record's IC fabricator code to a vendor name.
 * (`formatCPLC` for the full display string is re-exported from `./cplc`.)
 */
export function describeCplcFabricator(cplc: CPLCData): string {
  return identifyFabricator(cplc.icFabricator);
}
