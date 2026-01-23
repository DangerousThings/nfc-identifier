/**
 * NFC APDU Commands
 * Command builders and utilities for NFC communication
 */

import {Platform} from 'react-native';
import NfcManager, {NfcTech} from 'react-native-nfc-manager';

/**
 * APDU response with status word
 */
export interface ApduResponse {
  data: number[];
  sw1: number;
  sw2: number;
  isSuccess: boolean;
}

/**
 * Parse APDU response extracting data and status words
 */
export function parseApduResponse(response: number[]): ApduResponse {
  if (response.length < 2) {
    return {data: [], sw1: 0, sw2: 0, isSuccess: false};
  }

  const sw1 = response[response.length - 2];
  const sw2 = response[response.length - 1];
  const data = response.slice(0, -2);

  // 0x9000 = Success, 0x91XX = DESFire success with more data
  const isSuccess = sw1 === 0x90 || sw1 === 0x91;

  return {data, sw1, sw2, isSuccess};
}

/**
 * Convert hex string to byte array
 */
export function hexToBytes(hex: string): number[] {
  const cleanHex = hex.replace(/[:\s-]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes.push(parseInt(cleanHex.substring(i, i + 2), 16));
  }
  return bytes;
}

/**
 * Convert byte array to hex string
 */
export function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

// ============================================================================
// NTAG Commands (NFC Type 2 Tags)
// ============================================================================

/**
 * NTAG GET_VERSION command
 * Returns 8 bytes: header, vendor ID, product type, product subtype,
 * major version, minor version, storage size, protocol type
 */
export const NTAG_GET_VERSION = [0x60];

/**
 * NTAG READ command - reads 4 pages (16 bytes) starting at given page
 */
export function ntagRead(pageAddress: number): number[] {
  return [0x30, pageAddress];
}

// ============================================================================
// ISO 14443-4 / ISO-DEP Commands
// ============================================================================

/**
 * DESFire GET_VERSION command (ISO-wrapped)
 * Response byte 3 indicates version: 0x00=EV0, 0x01=EV1, 0x10=EV2, 0x30=EV3
 */
export const DESFIRE_GET_VERSION = [0x90, 0x60, 0x00, 0x00, 0x00];

/**
 * DESFire GET_VERSION additional frames (for full version info)
 */
export const DESFIRE_GET_VERSION_CONTINUE = [0x90, 0xaf, 0x00, 0x00, 0x00];

/**
 * SELECT command for AID
 */
export function selectAid(aid: number[]): number[] {
  return [0x00, 0xa4, 0x04, 0x00, aid.length, ...aid, 0x00];
}

/**
 * GET DATA command for CPLC (Card Production Life Cycle)
 * Used for JavaCard/JCOP identification
 */
export const GET_CPLC = [0x80, 0xca, 0x9f, 0x7f, 0x00];

// ============================================================================
// ISO 15693 (NFC-V) Commands - Per NXP AN11042
// ============================================================================

/**
 * ISO 15693 GET_SYSTEM_INFO command (0x2B)
 * Returns: DSFID, UID, block size, block count, IC reference
 * This is the NXP-recommended way to identify SLIX/NTAG5 chips
 *
 * Request format: [Flags] [Command] [UID if addressed]
 * Flags 0x02 = unaddressed mode (use inventory to select)
 * Flags 0x22 = addressed mode (include UID)
 */
export const ISO15693_GET_SYSTEM_INFO = [0x02, 0x2b];

/**
 * ISO 15693 GET_SYSTEM_INFO with specific UID (addressed mode)
 */
export function iso15693GetSystemInfoAddressed(uid: number[]): number[] {
  // Flags 0x22: Addressed mode, high data rate
  return [0x22, 0x2b, ...uid];
}

/**
 * ISO 15693 READ_SINGLE_BLOCK command
 * Used to read configuration pages for additional identification
 */
export function iso15693ReadSingleBlock(blockNumber: number): number[] {
  return [0x02, 0x20, blockNumber];
}

// ============================================================================
// Known AIDs
// ============================================================================

export const KNOWN_AIDS = {
  /** Global Platform Card Manager */
  cardManager: [0xa0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00],
  /** OpenPGP applet */
  openPgp: [0xd2, 0x76, 0x00, 0x01, 0x24, 0x01],
  /** FIDO/U2F applet */
  fido: [0xa0, 0x00, 0x00, 0x06, 0x47, 0x2f, 0x00, 0x01],
};

// ============================================================================
// Command Execution
// ============================================================================

/**
 * Send a raw command to NFC-A tag (Type 2 tags like NTAG)
 */
export async function transceiveNfcA(command: number[]): Promise<number[]> {
  try {
    const response = await NfcManager.nfcAHandler.transceive(command);
    return Array.from(response);
  } catch (error) {
    console.error('[commands] NfcA transceive failed:', error);
    throw error;
  }
}

/**
 * Send ISO-DEP APDU command
 */
export async function transceiveIsoDep(command: number[]): Promise<number[]> {
  try {
    const response = await NfcManager.isoDepHandler.transceive(command);
    return Array.from(response);
  } catch (error) {
    console.error('[commands] IsoDep transceive failed:', error);
    throw error;
  }
}

/**
 * Send command via iOS MIFARE handler (covers NFC-A and ISO-DEP on iOS)
 */
export async function transceiveMifareIOS(
  command: number[],
): Promise<number[]> {
  try {
    const response = await NfcManager.sendMifareCommandIOS(command);
    return Array.from(response);
  } catch (error) {
    console.error('[commands] MifareIOS transceive failed:', error);
    throw error;
  }
}

/**
 * Send command via iOS using isoDepHandler (for ISO-DEP/ISO 14443-4 tags)
 * This works when the tag supports ISO-DEP
 */
export async function transceiveIsoDepIOS(command: number[]): Promise<number[]> {
  try {
    // Try isoDepHandler first - works for ISO 14443-4 tags
    const response = await NfcManager.isoDepHandler.transceive(command);
    return Array.from(response);
  } catch (error) {
    console.error('[commands] isoDepHandler transceive failed:', error);
    throw error;
  }
}

/**
 * Send ISO 15693 (NFC-V) command
 * Uses nfcVHandler on Android, iso15693HandlerIOS on iOS
 */
export async function transceiveNfcV(command: number[]): Promise<number[]> {
  try {
    // Android uses nfcVHandler.transceive for raw commands
    const response = await NfcManager.nfcVHandler.transceive(command);
    return Array.from(response);
  } catch (error) {
    console.error('[commands] NfcV transceive failed:', error);
    throw error;
  }
}

/**
 * Get ISO 15693 system info using platform-specific method
 * iOS has direct getSystemInfo method, Android uses raw command
 */
export interface Iso15693SystemInfo {
  dsfid?: number;
  afi?: number;
  blockSize?: number;
  blockCount?: number;
  icReference?: number;
}

export async function getIso15693SystemInfo(): Promise<Iso15693SystemInfo> {
  if (Platform.OS === 'ios') {
    // iOS has direct method with typed response
    try {
      const result = await NfcManager.iso15693HandlerIOS.getSystemInfo(0x02);
      return {
        dsfid: result.dsfid,
        afi: result.afi,
        blockSize: result.blockSize,
        blockCount: result.blockCount,
        icReference: result.icReference,
      };
    } catch (error) {
      console.error('[commands] iOS getSystemInfo failed:', error);
      throw error;
    }
  }

  // Android: use raw command and parse response
  const response = await transceiveNfcV(ISO15693_GET_SYSTEM_INFO);

  // Parse the response (simplified - may need adjustment based on actual response format)
  if (response.length < 2 || (response[0] & 0x01)) {
    throw new Error('GET_SYSTEM_INFO failed or returned error');
  }

  // Response parsing depends on info flags
  const infoFlags = response[1];
  let offset = 10; // Skip flags and UID

  const result: Iso15693SystemInfo = {};

  if ((infoFlags & 0x01) && response.length > offset) {
    result.dsfid = response[offset++];
  }
  if ((infoFlags & 0x02) && response.length > offset) {
    result.afi = response[offset++];
  }
  if ((infoFlags & 0x04) && response.length >= offset + 2) {
    result.blockCount = response[offset] + 1;
    result.blockSize = (response[offset + 1] & 0x1f) + 1;
    offset += 2;
  }
  if ((infoFlags & 0x08) && response.length > offset) {
    result.icReference = response[offset];
  }

  return result;
}

/**
 * Platform-aware command sending for Type 2 tags (NTAG)
 */
export async function sendType2Command(command: number[]): Promise<number[]> {
  if (Platform.OS === 'ios') {
    return transceiveMifareIOS(command);
  }
  return transceiveNfcA(command);
}

/**
 * Platform-aware command sending for ISO-DEP tags (DESFire, JavaCard)
 */
export async function sendIsoDepCommand(command: number[]): Promise<number[]> {
  console.log(`[commands] sendIsoDepCommand on ${Platform.OS}:`, command);

  if (Platform.OS === 'ios') {
    // Try isoDepHandler first (works for ISO 14443-4 tags)
    try {
      console.log('[commands] Trying isoDepHandler...');
      const response = await transceiveIsoDepIOS(command);
      console.log('[commands] isoDepHandler success:', response);
      return response;
    } catch (isoDepError) {
      console.log('[commands] isoDepHandler failed:', isoDepError);
      // Fall back to MifareIOS if isoDepHandler fails
      console.log('[commands] Trying MifareIOS fallback...');
      const response = await transceiveMifareIOS(command);
      console.log('[commands] MifareIOS success:', response);
      return response;
    }
  }

  console.log('[commands] Using Android isoDepHandler...');
  const response = await transceiveIsoDep(command);
  console.log('[commands] Android isoDepHandler success:', response);
  return response;
}

/**
 * Request specific NFC technology
 */
export async function requestTechnology(
  tech: NfcTech | NfcTech[],
  options?: {alertMessage?: string},
): Promise<void> {
  await NfcManager.requestTechnology(tech, options);
}

/**
 * Cancel technology request and cleanup
 */
export async function cancelTechnologyRequest(): Promise<void> {
  try {
    await NfcManager.cancelTechnologyRequest();
  } catch {
    // Ignore cleanup errors
  }
}
