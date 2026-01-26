/**
 * NFC Manager Service
 * Wrapper around react-native-nfc-manager for cross-platform NFC operations
 */

import {Platform} from 'react-native';
import NfcManager, {NfcTech, TagEvent} from 'react-native-nfc-manager';
import type {
  RawTagData,
  NFCStatus,
  ScanError,
  ScanErrorType,
  NfcTechType,
  NdefRecord,
  MifareClassicInfo,
} from '../../types/nfc';

/**
 * Convert byte array to hex string
 * Handles number[], Uint8Array, string, or undefined
 */
function bytesToHex(bytes: number[] | Uint8Array | string | undefined): string {
  if (!bytes) {
    return '';
  }

  // If already a string, assume it's hex and format it
  if (typeof bytes === 'string') {
    // Remove any existing separators and format consistently
    const hex = bytes.replace(/[:\s-]/g, '').toUpperCase();
    if (hex.length === 0) {
      return '';
    }
    // Add colons between byte pairs
    return hex.match(/.{1,2}/g)?.join(':') || hex;
  }

  // Convert array-like to actual array if needed (handles Uint8Array)
  const byteArray = Array.from(bytes);

  if (byteArray.length === 0) {
    return '';
  }

  return byteArray.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
}

/**
 * Parse SAK from tag event
 */
function parseSak(tag: TagEvent): number | undefined {
  // Android provides nfcA.sak
  const nfcA = (tag as any).nfcA;
  if (nfcA?.sak !== undefined) {
    return nfcA.sak;
  }

  // iOS: CoreNFC doesn't directly expose SAK
  // But we can infer ISO-DEP capability (SAK bit 5) from iso7816 presence
  if (Platform.OS === 'ios') {
    const iso7816 = (tag as any).iso7816;
    const mifare = (tag as any).mifare;

    // If iso7816 interface is available, the tag has ISO-DEP capability
    // This corresponds to SAK bit 5 being set (value 0x20)
    if (iso7816) {
      // Check if also has MIFARE capability (could be DESFire or Plus)
      if (mifare) {
        return 0x20; // ISO-DEP capable (like DESFire)
      }
      return 0x20; // Pure ISO-DEP (like NTAG 424 DNA)
    }

    // If only MIFARE/NFC-A without iso7816, likely NTAG or Ultralight (SAK 0x00)
    if (mifare) {
      return 0x00;
    }
  }

  return undefined;
}

/**
 * Parse ATQA from tag event
 */
function parseAtqa(tag: TagEvent): string | undefined {
  // Android provides nfcA.atqa as byte array
  const nfcA = (tag as any).nfcA;
  if (nfcA?.atqa) {
    return bytesToHex(nfcA.atqa);
  }
  return undefined;
}

/**
 * Parse ATS and historical bytes from tag event
 */
function parseAts(tag: TagEvent): {ats?: string; historicalBytes?: string} {
  const isoDep = (tag as any).isoDep;
  const iso7816 = (tag as any).iso7816;

  let historicalBytes: string | undefined;

  // Android: isoDep.historicalBytes
  if (isoDep?.historicalBytes) {
    historicalBytes = bytesToHex(isoDep.historicalBytes);
  }

  // iOS: iso7816.historicalBytes
  if (iso7816?.historicalBytes) {
    historicalBytes = bytesToHex(iso7816.historicalBytes);
  }

  // Construct ATS if we have historical bytes (simplified)
  const ats = historicalBytes ? historicalBytes : undefined;

  return {ats, historicalBytes};
}

/**
 * Parse MIFARE Classic info from TagEvent (Android only)
 *
 * Uses NDEF maxSize to determine card capacity:
 * - 4K: maxSize ~3356 bytes (NDEF capacity)
 * - 1K: maxSize ~716 bytes (NDEF capacity)
 * - Mini: maxSize ~80 bytes (NDEF capacity)
 */
function parseMifareClassic(tag: TagEvent): MifareClassicInfo | undefined {
  const techTypes = tag.techTypes || [];
  const isMifareClassic = techTypes.some(t => t.includes('MifareClassic'));

  if (!isMifareClassic) {
    return undefined;
  }

  // Use NDEF maxSize to determine card type
  // MIFARE Classic 4K has ~3356 bytes NDEF capacity
  // MIFARE Classic 1K has ~716 bytes NDEF capacity
  const maxSize = (tag as any).maxSize;

  if (typeof maxSize === 'number' && maxSize > 0) {
    let size: number;
    let sectorCount: number;
    let blockCount: number;

    if (maxSize >= 2000) {
      // 4K card (NDEF maxSize ~3356)
      size = 4096;
      sectorCount = 40;
      blockCount = 256;
    } else if (maxSize >= 500) {
      // 1K card (NDEF maxSize ~716)
      size = 1024;
      sectorCount = 16;
      blockCount = 64;
    } else {
      // Mini card (NDEF maxSize ~80)
      size = 320;
      sectorCount = 5;
      blockCount = 20;
    }

    console.log('[NFCManager] MIFARE Classic from maxSize:', {maxSize, size, sectorCount, blockCount});
    return {size, sectorCount, blockCount};
  }

  return undefined;
}

/**
 * Parse NDEF records from TagEvent
 */
function parseNdefRecords(tag: TagEvent): NdefRecord[] | undefined {
  const ndefMessage = (tag as any).ndefMessage;
  if (!ndefMessage || !Array.isArray(ndefMessage) || ndefMessage.length === 0) {
    return undefined;
  }

  const records: NdefRecord[] = [];
  for (const record of ndefMessage) {
    if (!record) continue;

    // react-native-nfc-manager returns NDEF records with these properties
    const tnf = record.tnf ?? 0;
    const type = record.type
      ? typeof record.type === 'string'
        ? record.type
        : String.fromCharCode(...(Array.isArray(record.type) ? record.type : []))
      : '';
    const id = record.id
      ? typeof record.id === 'string'
        ? record.id
        : String.fromCharCode(...(Array.isArray(record.id) ? record.id : []))
      : undefined;
    const payload = Array.isArray(record.payload)
      ? record.payload
      : typeof record.payload === 'string'
        ? record.payload.split('').map((c: string) => c.charCodeAt(0))
        : [];

    records.push({tnf, type, id, payload});
  }

  if (records.length > 0) {
    console.log('[NFCManager] Parsed NDEF records:', records.length);
  }

  return records.length > 0 ? records : undefined;
}

/**
 * Convert TagEvent to RawTagData
 */
function tagEventToRawData(tag: TagEvent): RawTagData {
  let techTypes = (tag.techTypes || []) as NfcTechType[];
  const uid = tag.id ? bytesToHex(tag.id as string | number[] | Uint8Array) : '';
  const sak = parseSak(tag);
  const atqa = parseAtqa(tag);
  const {ats, historicalBytes} = parseAts(tag);
  const ndefRecords = parseNdefRecords(tag);
  const mifareClassic = parseMifareClassic(tag);

  const isoDep = (tag as any).isoDep;
  const iso7816 = (tag as any).iso7816;
  const maxTransceiveLength = isoDep?.maxTransceiveLength;

  // On iOS, detect ISO-DEP capability from iso7816 property or tag type
  // This ensures NTAG 424 DNA and DESFire are properly identified
  if (Platform.OS === 'ios') {
    // If iso7816 property exists, this is an ISO-DEP capable tag
    if (iso7816 && !techTypes.some(t => t.includes('IsoDep'))) {
      techTypes = [...techTypes, 'android.nfc.tech.IsoDep' as NfcTechType];
    }
    // Also check tag type for iOS
    const tagType = (tag as any).type;
    if (tagType && typeof tagType === 'string') {
      if (tagType.includes('iso7816') || tagType.includes('IsoDep')) {
        if (!techTypes.some(t => t.includes('IsoDep'))) {
          techTypes = [...techTypes, 'android.nfc.tech.IsoDep' as NfcTechType];
        }
      }
      if (tagType.includes('iso15693') || tagType.includes('NfcV')) {
        if (!techTypes.some(t => t.includes('NfcV'))) {
          techTypes = [...techTypes, 'android.nfc.tech.NfcV' as NfcTechType];
        }
      }
    }
  }

  return {
    uid,
    techTypes,
    sak,
    atqa,
    ats,
    historicalBytes,
    maxTransceiveLength,
    ndefRecords,
    mifareClassic,
  };
}

/**
 * Create a structured scan error
 */
function createScanError(
  type: ScanErrorType,
  message: string,
  originalError?: unknown,
): ScanError {
  return {type, message, originalError};
}

/**
 * Determine error type from error message/object
 */
function categorizeError(error: unknown): ScanError {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();

  if (lowerMessage.includes('cancelled') || lowerMessage.includes('canceled')) {
    return createScanError('SCAN_CANCELLED', 'Scan was cancelled', error);
  }

  if (lowerMessage.includes('tag was lost') || lowerMessage.includes('taglost')) {
    return createScanError('TAG_LOST', 'Tag was removed during scan', error);
  }

  if (lowerMessage.includes('timeout')) {
    return createScanError('TIMEOUT', 'Scan timed out', error);
  }

  if (lowerMessage.includes('permission')) {
    return createScanError('PERMISSION_DENIED', 'NFC permission denied', error);
  }

  if (lowerMessage.includes('not enabled') || lowerMessage.includes('disabled')) {
    return createScanError('NFC_NOT_ENABLED', 'NFC is disabled on this device', error);
  }

  if (lowerMessage.includes('not supported')) {
    return createScanError('NFC_NOT_SUPPORTED', 'NFC is not supported on this device', error);
  }

  return createScanError('UNKNOWN', errorMessage || 'An unknown NFC error occurred', error);
}

/**
 * NFC Manager singleton class
 */
class NFCManagerService {
  private initialized = false;

  /**
   * Initialize NFC manager
   * Must be called before any other NFC operations
   */
  async init(): Promise<boolean> {
    if (this.initialized) {
      return true;
    }

    try {
      const supported = await NfcManager.isSupported();
      if (!supported) {
        return false;
      }

      await NfcManager.start();
      this.initialized = true;
      return true;
    } catch (error) {
      console.error('[NFCManager] Init failed:', error);
      return false;
    }
  }

  /**
   * Check NFC status (supported and enabled)
   */
  async getStatus(): Promise<NFCStatus> {
    try {
      const isSupported = await NfcManager.isSupported();
      if (!isSupported) {
        return {isSupported: false, isEnabled: false};
      }

      const isEnabled = await NfcManager.isEnabled();
      return {isSupported, isEnabled};
    } catch {
      return {isSupported: false, isEnabled: false};
    }
  }

  /**
   * Request NFC technology and scan for a tag
   * Returns raw tag data on success
   *
   * @param keepAlive - If true, don't release the NFC technology after scanning.
   *                    Caller must call cancelScan() when done.
   */
  async scanTag(
    keepAlive = false,
  ): Promise<{tag?: RawTagData; error?: ScanError}> {
    try {
      // Ensure initialized
      if (!this.initialized) {
        const initSuccess = await this.init();
        if (!initSuccess) {
          return {
            error: createScanError(
              'NFC_NOT_SUPPORTED',
              'NFC is not supported on this device',
            ),
          };
        }
      }

      // Check if NFC is enabled
      const status = await this.getStatus();
      if (!status.isEnabled) {
        return {
          error: createScanError(
            'NFC_NOT_ENABLED',
            'Please enable NFC in your device settings',
          ),
        };
      }

      // Request technology based on platform
      if (Platform.OS === 'ios') {
        // iOS: Use MifareIOS which works for NFC-A tags including ISO-DEP
        // The iso7816HandlerIOS is used separately for ISO-DEP commands
        await NfcManager.requestTechnology(NfcTech.MifareIOS, {
          alertMessage: 'Hold your NFC tag near the top of your iPhone',
        });
      } else {
        // Android: Request multiple technologies for best detection
        // IMPORTANT: IsoDep MUST be first so ISO-DEP capable tags (DESFire, NTAG 424 DNA)
        // connect via ISO-DEP rather than NfcA. When NfcA connects first, isoDepHandler
        // won't work because the wrong technology is active.
        await NfcManager.requestTechnology([
          NfcTech.IsoDep,
          NfcTech.NfcA,
          NfcTech.NfcV,
          NfcTech.NfcB,
          NfcTech.MifareClassic,
        ]);
      }

      // Get the tag
      const tag = await NfcManager.getTag();
      if (!tag) {
        if (!keepAlive) {
          await this.cancelScan();
        }
        return {
          error: createScanError('UNKNOWN', 'No tag data received'),
        };
      }

      // Convert to RawTagData
      const rawData = tagEventToRawData(tag);

      return {tag: rawData};
    } catch (error) {
      return {error: categorizeError(error)};
    } finally {
      // Only clean up if not keeping alive
      if (!keepAlive) {
        await this.cancelScan();
      }
    }
  }

  /**
   * Scan tag and run detection callback while NFC session is active
   * This ensures commands can be sent during detection
   */
  async scanWithDetection<T>(
    detectFn: (tag: RawTagData) => Promise<T>,
  ): Promise<{tag?: RawTagData; detection?: T; error?: ScanError}> {
    try {
      // Scan but keep the session alive
      const {tag, error} = await this.scanTag(true);

      if (error || !tag) {
        return {error};
      }

      // Run detection while session is still active
      try {
        const detection = await detectFn(tag);
        return {tag, detection};
      } catch (detectError) {
        // Detection failed but we still have the tag data
        console.warn('[NFCManager] Detection failed:', detectError);
        return {tag};
      }
    } finally {
      // Always clean up after detection
      await this.cancelScan();
    }
  }

  /**
   * Cancel ongoing scan and release NFC technology
   */
  async cancelScan(): Promise<void> {
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch {
      // Ignore errors during cleanup
    }
  }

  /**
   * Clean up NFC manager
   * Call when app is unmounting or NFC no longer needed
   */
  async cleanup(): Promise<void> {
    try {
      await this.cancelScan();
      // Note: We don't call NfcManager.stop() as it can cause issues
      // if we need to restart scanning
    } catch {
      // Ignore cleanup errors
    }
  }

  /**
   * Open device NFC settings (Android only)
   */
  async openNFCSettings(): Promise<void> {
    if (Platform.OS === 'android') {
      try {
        await NfcManager.goToNfcSetting();
      } catch {
        // Settings may not be available
      }
    }
  }
}

// Export singleton instance
export const nfcManager = new NFCManagerService();
