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
} from '../../types/nfc';

/**
 * Convert byte array to hex string
 */
function bytesToHex(bytes: number[] | undefined): string {
  if (!bytes || bytes.length === 0) {
    return '';
  }
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join(':');
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
 * Convert TagEvent to RawTagData
 */
function tagEventToRawData(tag: TagEvent): RawTagData {
  const techTypes = (tag.techTypes || []) as NfcTechType[];
  const uid = tag.id ? bytesToHex(tag.id as unknown as number[]) : '';
  const sak = parseSak(tag);
  const atqa = parseAtqa(tag);
  const {ats, historicalBytes} = parseAts(tag);

  const isoDep = (tag as any).isoDep;
  const maxTransceiveLength = isoDep?.maxTransceiveLength;

  return {
    uid,
    techTypes,
    sak,
    atqa,
    ats,
    historicalBytes,
    maxTransceiveLength,
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
   */
  async scanTag(): Promise<{tag?: RawTagData; error?: ScanError}> {
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
        // iOS: Use MifareIOS for broadest compatibility with ISO 14443 tags
        await NfcManager.requestTechnology(NfcTech.MifareIOS, {
          alertMessage: 'Hold your NFC tag near the top of your iPhone',
        });
      } else {
        // Android: Request multiple technologies for best detection
        await NfcManager.requestTechnology([
          NfcTech.NfcA,
          NfcTech.NfcB,
          NfcTech.NfcV,
          NfcTech.IsoDep,
          NfcTech.MifareClassic,
        ]);
      }

      // Get the tag
      const tag = await NfcManager.getTag();
      if (!tag) {
        return {
          error: createScanError('UNKNOWN', 'No tag data received'),
        };
      }

      return {tag: tagEventToRawData(tag)};
    } catch (error) {
      return {error: categorizeError(error)};
    } finally {
      // Always clean up
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
