/**
 * NFC APDU Commands
 * Command builders and utilities for NFC communication
 */

import {Platform} from 'react-native';
import NfcManager, {
  NfcTech,
  type RegisterTagEventOpts,
} from '@dangerousthings/react-native-nfc-manager';
import * as fixtureRecorder from '../detection/fixtureRecorder';

export {NfcTech};

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
 * Convert byte array to hex string
 */
export function bytesToHex(bytes: number[]): string {
  return bytes.map(b => b.toString(16).padStart(2, '0').toUpperCase()).join('');
}

// ============================================================================
// ISO 14443-4 / ISO-DEP Commands
// ============================================================================

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
// NXP Custom ISO 15693 Commands (NTAG5 Link/Boost I2C passthrough)
// ============================================================================
//
// RELOCATED: the NXP custom-command frame builder (NXP_CMD / NXP_MANUF_CODE /
// buildNxpCustomCommand / sendNxpCustomCommand) and the UID helpers
// (parseUidToBytes / uidBytesLsbFirst) moved to the STAYING
// `src/services/detection/nxpCommands.ts` module — DT custom hardware that is
// driven over the generic raw NfcV primitive `nfcManager.sendRawNfcV`.

// ============================================================================
// Known AIDs
// ============================================================================

export const KNOWN_AIDS = {
  /** Global Platform Card Manager */
  cardManager: [0xa0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00],
  /**
   * GlobalPlatform-registered Security Domain AID. Some issuers provision
   * the ISD here instead of under the canonical Card Manager AID, so the
   * ISD probe tries both.
   */
  gpSecurityDomain: [0xa0, 0x00, 0x00, 0x01, 0x51, 0x00, 0x00, 0x00],
  /** OpenPGP applet */
  openPgp: [0xd2, 0x76, 0x00, 0x01, 0x24, 0x01],
  /** FIDO U2F applet (CTAP1) */
  fido: [0xa0, 0x00, 0x00, 0x06, 0x47, 0x2f, 0x00, 0x02],
  /**
   * FIDO2/WebAuthn applet (CTAP2) — the AID every NFC authenticator must
   * answer (CTAP 2.1 §11.2.1, "Applet selection"), and the one declared in
   * the iOS `select-identifiers` entitlement. A Fidesmo-installed FIDO2 (Apex
   * / Apex 2) registers exactly this; SELECT matches by AID *prefix*, so it
   * also hits longer instance AIDs like DT's below.
   */
  fido2: [0xa0, 0x00, 0x00, 0x06, 0x47, 0x2f, 0x00, 0x01],
  /**
   * The instance AID of DT's own FIDO2.cap (verified against the CAP's Applet
   * component). Tried only when the spec AID above draws a blank, for cards
   * that don't do partial-AID selection.
   */
  fido2Instance: [0xa0, 0x00, 0x00, 0x06, 0x47, 0x2f, 0x00, 0x01, 0x01],
  /** NFC Forum Type 4 Tag NDEF applet */
  ndefTag: [0xd2, 0x76, 0x00, 0x00, 0x85, 0x01, 0x01],
  /** VivoKey OTP applet (full AID from GP Qt project) */
  vivokeyOtp: [
    0xa0, 0x00, 0x00, 0x05, 0x27, 0x21, 0x01, 0x01,
    0x41, 0x50, 0x45, 0x58, 0x01,
  ],
  /** PIV (Personal Identity Verification) */
  piv: [0xa0, 0x00, 0x00, 0x03, 0x08],
  /** OATH (OTP) applet */
  oath: [0xa0, 0x00, 0x00, 0x05, 0x27, 0x21, 0x01],
  /** JavaCard Memory Manager - present on Apex and flexSecure implants */
  javacardMemory: [
    0xa0, 0x00, 0x00, 0x08, 0x46, 0x6d, 0x65, 0x6d, 0x6f, 0x72, 0x79, 0x01,
  ],

  // Fidesmo AIDs (from GP Qt project - used for Apex detection)
  /** Fidesmo App AID */
  fidesmoApp: [
    0xa0, 0x00, 0x00, 0x06, 0x17, 0x02, 0x00, 0x02, 0x00, 0x00, 0x01,
  ],
  /** Fidesmo Batch AID */
  fidesmoBatch: [
    0xa0, 0x00, 0x00, 0x06, 0x17, 0x02, 0x00, 0x02, 0x00, 0x00, 0x02,
  ],
  /** Fidesmo Platform AID */
  fidesmoPlatform: [
    0xa0, 0x00, 0x00, 0x06, 0x17, 0x02, 0x00, 0x09, 0x00, 0x01, 0x01, 0x01,
  ],

  // Additional applet AIDs (from GP Qt project)
  /** SatoChip applet */
  satoChip: [0x53, 0x61, 0x74, 0x6f, 0x43, 0x68, 0x69, 0x70, 0x00],
  /** SeedKeeper applet */
  seedKeeper: [0x53, 0x65, 0x65, 0x64, 0x4b, 0x65, 0x65, 0x70, 0x65, 0x72, 0x00],
  /** Keycard applet */
  keycard: [0xa0, 0x00, 0x00, 0x08, 0x04, 0x00, 0x01],
  /** YubiKey HMAC applet */
  yubikeyHmac: [0xa0, 0x00, 0x00, 0x05, 0x27, 0x20, 0x01, 0x01],

  // Payment network AIDs (EMV)
  /** Visa Credit/Debit */
  visaCredit: [0xa0, 0x00, 0x00, 0x00, 0x03, 0x10, 0x10],
  /** Visa Electron */
  visaElectron: [0xa0, 0x00, 0x00, 0x00, 0x03, 0x20, 0x10],
  /** Mastercard Credit/Debit */
  mastercard: [0xa0, 0x00, 0x00, 0x00, 0x04, 0x10, 0x10],
  /** Mastercard Maestro */
  maestro: [0xa0, 0x00, 0x00, 0x00, 0x04, 0x30, 0x60],
  /** American Express */
  amex: [0xa0, 0x00, 0x00, 0x00, 0x25, 0x01, 0x08, 0x01],
  /** Discover */
  discover: [0xa0, 0x00, 0x00, 0x01, 0x52, 0x30, 0x10],
  /** JCB */
  jcb: [0xa0, 0x00, 0x00, 0x00, 0x65, 0x10, 0x10],
  /** UnionPay */
  unionpay: [0xa0, 0x00, 0x00, 0x03, 0x33, 0x01, 0x01, 0x01],
  /** PPSE (Proximity Payment System Environment) - present on all contactless payment cards */
  ppse: [0x32, 0x50, 0x41, 0x59, 0x2e, 0x53, 0x59, 0x53, 0x2e, 0x44, 0x44, 0x46, 0x30, 0x31], // "2PAY.SYS.DDF01"
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
    const arr = Array.from(response);
    fixtureRecorder.record('nfcA', command, arr);
    return arr;
  } catch (error) {
    // Use debug level - some failures are expected (e.g., GET_VERSION on original Ultralight)
    console.debug('[commands] NfcA transceive failed:', error);
    fixtureRecorder.record('nfcA', command, null);
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
    const arr = Array.from(response);
    fixtureRecorder.record('mifareIOS', command, arr);
    return arr;
  } catch (error) {
    console.error('[commands] MifareIOS transceive failed:', error);
    fixtureRecorder.record('mifareIOS', command, null);
    throw error;
  }
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
 * Request specific NFC technology
 */
export async function requestTechnology(
  tech: NfcTech | NfcTech[],
  options?: RegisterTagEventOpts,
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
