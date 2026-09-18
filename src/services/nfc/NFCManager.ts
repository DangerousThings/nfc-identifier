/**
 * NFC Manager Service
 * Wrapper around react-native-nfc-manager for cross-platform NFC operations
 */

import {Platform} from 'react-native';
import NfcManager, {
  NfcAdapter,
  NfcTech,
  TagEvent,
} from '@dangerousthings/react-native-nfc-manager';
import {
  requestTechnology,
  cancelTechnologyRequest,
  sendType2Command,
} from './commands';
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
 * Reader mode covers every technology the app polls for: with reader mode on,
 * a technology whose flag is missing is simply never discovered.
 * SKIP_NDEF_CHECK keeps the platform from reading the tag before we do,
 * NO_PLATFORM_SOUNDS silences the system chirp.
 */
const READER_MODE_FLAGS =
  NfcAdapter.FLAG_READER_NFC_A |
  NfcAdapter.FLAG_READER_NFC_B |
  NfcAdapter.FLAG_READER_NFC_V |
  NfcAdapter.FLAG_READER_SKIP_NDEF_CHECK |
  NfcAdapter.FLAG_READER_NO_PLATFORM_SOUNDS;

/**
 * Reader-mode presence-check delay (EXTRA_READER_PRESENCE_CHECK_DELAY), ms.
 *
 * While a tag is connected, Android's reader mode pings it every this-many ms
 * to notice removal. On a Type 2 / NfcA tag that ping is an on-air READ, so at
 * the default 250 ms one lands between connect() and our own command and shows
 * up in a sniff as a stray READBLOCK. SKIP_NDEF_CHECK does not suppress it —
 * it is the presence check, not an NDEF check. Integer.MAX_VALUE (~24 days) is
 * the documented way to effectively disable it; we never rely on reader-mode
 * removal detection, we release the session explicitly.
 */
const PRESENCE_CHECK_OFF = 0x7fffffff;

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
  // Android: exposed top-level by the DT fork's tagToJSON enrichment
  // (NfcA.getSak()); stock builds omit it. Older/nested shape kept as a
  // fallback for safety.
  const topSak = (tag as any).sak;
  if (typeof topSak === 'number') {
    return topSak;
  }
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
  // Android: top-level `atqa` (number[]) from our patch (NfcA.getAtqa()).
  // getAtqa() returns the SENS_RES bytes little-endian ([0x04,0x00] for a
  // Classic 1K), but the detector's ATQA patterns are big-endian ("00:04"),
  // so reverse to match. Without this a normal Classic 1K reads as "04:00"
  // and trips the Gen1a-magic heuristic.
  const topAtqa = (tag as any).atqa;
  if (Array.isArray(topAtqa) && topAtqa.length > 0) {
    return bytesToHex([...topAtqa].reverse());
  }
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

  // Android: top-level `historicalBytes` (number[]) from our patch
  // (IsoDep.getHistoricalBytes(), Type A). `hiLayerResponse` is the Type B
  // counterpart. Stock react-native-nfc-manager omits both on Android.
  const topHistorical = (tag as any).historicalBytes;
  const topHiLayer = (tag as any).hiLayerResponse;
  if (topHistorical) {
    historicalBytes = bytesToHex(topHistorical);
  } else if (topHiLayer) {
    historicalBytes = bytesToHex(topHiLayer);
  }

  // Legacy/nested Android shape (older library builds).
  if (!historicalBytes && isoDep?.historicalBytes) {
    historicalBytes = bytesToHex(isoDep.historicalBytes);
  }

  // iOS: iso7816.historicalBytes
  if (!historicalBytes && iso7816?.historicalBytes) {
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
   * Begin a reader-mode session scoped to a "send raw to the present tag" flow
   * (the SEND RAW dialog). Presence check off — so no keep-alive READ lands
   * between connect() and our command — and no platform sound / NDEF read. The
   * tag gets discovered once on placement, which is what sendRawNfcA() then
   * connects to. Android only; iOS uses its modal per-send session instead.
   *
   * Pair with endPresentTagSession(). This is deliberately NOT app-wide: a
   * held presence-off session would stop the normal scan from ever
   * re-discovering a tag.
   */
  async beginPresentTagSession(): Promise<void> {
    if (Platform.OS === 'ios' || !(await this.init())) {
      return;
    }

    try {
      await NfcManager.registerTagEvent({
        isReaderModeEnabled: true,
        readerModeFlags: READER_MODE_FLAGS,
        readerModeDelay: PRESENCE_CHECK_OFF,
      });
    } catch (error) {
      console.debug('[NFCManager] Could not begin present-tag session:', error);
    }
  }

  /** End the reader-mode session begun by beginPresentTagSession(). */
  async endPresentTagSession(): Promise<void> {
    if (Platform.OS === 'ios') {
      return;
    }
    try {
      await NfcManager.cancelTechnologyRequest();
      await NfcManager.unregisterTagEvent();
    } catch (error) {
      console.debug('[NFCManager] Could not end present-tag session:', error);
    }
  }

  /**
   * Send one raw ISO 14443-3A (NfcA) command to the tag currently in the field
   * and return its response bytes. Fires on demand — it does NOT wait for a
   * fresh tap.
   *
   * Android: connects to the tag the raw-send reader session already
   * discovered (see beginPresentTagSession), transceives, then releases the
   * tech so the session stays up for the next call. Rejects if no tag is in
   * the field.
   *
   * iOS: opens the modal per-scan session — the system sheet is what puts the
   * phone against the tag — transceives, then closes it.
   */
  async sendRawNfcA(command: number[]): Promise<number[]> {
    if (Platform.OS === 'ios') {
      try {
        await requestTechnology(NfcTech.MifareIOS, {
          alertMessage: 'Hold your tag near the top of your iPhone',
        });
        return await sendType2Command(command);
      } finally {
        await cancelTechnologyRequest();
      }
    }

    return NfcManager.transceiveToPresentTag(command, NfcTech.NfcA);
  }

  /**
   * Send one raw ISO 15693 (NfcV) frame to the tag currently in the field and
   * return its response bytes (response-flags byte included, exactly as the tag
   * answers). Fires on demand — it does NOT wait for a fresh tap. The GENERIC
   * NfcV analogue of {@link sendRawNfcA}: it carries no protocol knowledge, it
   * just moves bytes, so a caller can drive vendor-proprietary frames (e.g. the
   * app's NTAG5 NXP custom commands) over it.
   *
   * Android: `transceiveToPresentTag` connects to the tag the active reader
   * session already discovered, transceives, then releases the tech — and its
   * connect → close → connect handshake gives the frame a clean activation
   * (the same fresh-connection state SEND RAW / the UG4 backdoor rely on), so
   * a preceding library read on the scan connection does not dirty it.
   *
   * iOS: CoreNFC exposes no raw ISO 15693 transceive — only the structured
   * `iso15693HandlerIOS.customCommand({flags, code, params})`. So there is no
   * raw-frame primitive to mirror here; callers that need an NXP custom command
   * on iOS go through that structured API directly (see `nxpCommands.ts`).
   */
  async sendRawNfcV(command: number[]): Promise<number[]> {
    if (Platform.OS === 'ios') {
      throw new Error(
        'sendRawNfcV: raw ISO 15693 frames are unsupported on iOS; use iso15693HandlerIOS.customCommand',
      );
    }

    return NfcManager.transceiveToPresentTag(command, NfcTech.NfcV);
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
        await NfcManager.requestTechnology(
          [
            NfcTech.IsoDep,
            NfcTech.NfcA,
            NfcTech.NfcV,
            NfcTech.NfcB,
            NfcTech.MifareClassic,
          ],
          {
            // Reader mode instead of foreground dispatch: no platform scan
            // sound, and no NDEF read behind our back before we get the tag.
            // Reader mode instead of foreground dispatch: no platform scan
            // sound, no NDEF read before we get the tag. Default presence-check
            // delay — normal tag discovery / removal, unlike the raw-send
            // session below.
            isReaderModeEnabled: true,
            readerModeFlags: READER_MODE_FLAGS,
          },
        );
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
