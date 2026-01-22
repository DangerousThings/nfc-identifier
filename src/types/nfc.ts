/**
 * NFC-related type definitions
 */

/**
 * Supported NFC technology types from react-native-nfc-manager
 */
export type NfcTechType =
  | 'NfcA'
  | 'NfcB'
  | 'NfcF'
  | 'NfcV'
  | 'IsoDep'
  | 'Ndef'
  | 'NdefFormatable'
  | 'MifareClassic'
  | 'MifareUltralight'
  | 'Iso7816'
  | 'Iso15693';

/**
 * Raw tag data from NFC scan
 */
export interface RawTagData {
  /** Tag UID as hex string (colon-separated) */
  uid: string;
  /** Available NFC technologies on this tag */
  techTypes: NfcTechType[];
  /** ATQA bytes (ISO 14443-3A) - Android only */
  atqa?: string;
  /** SAK byte (ISO 14443-3A) */
  sak?: number;
  /** ATS bytes (ISO 14443-4) */
  ats?: string;
  /** Historical bytes from ATS */
  historicalBytes?: string;
  /** Maximum transceive length */
  maxTransceiveLength?: number;
}

/**
 * Scan state machine states
 */
export type ScanState = 'idle' | 'scanning' | 'processing' | 'success' | 'error';

/**
 * Scan result with raw tag data
 */
export interface ScanResult {
  success: boolean;
  tag?: RawTagData;
  error?: ScanError;
}

/**
 * NFC scan error types
 */
export type ScanErrorType =
  | 'NFC_NOT_SUPPORTED'
  | 'NFC_NOT_ENABLED'
  | 'PERMISSION_DENIED'
  | 'TAG_LOST'
  | 'SCAN_CANCELLED'
  | 'TIMEOUT'
  | 'UNKNOWN';

/**
 * Structured scan error
 */
export interface ScanError {
  type: ScanErrorType;
  message: string;
  originalError?: unknown;
}

/**
 * NFC manager status
 */
export interface NFCStatus {
  isSupported: boolean;
  isEnabled: boolean;
}
