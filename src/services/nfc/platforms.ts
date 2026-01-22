/**
 * Platform-specific NFC utilities
 */

import {Platform} from 'react-native';
import type {NfcTechType, RawTagData} from '../../types/nfc';

/**
 * Check if the current platform is iOS
 */
export function isIOS(): boolean {
  return Platform.OS === 'ios';
}

/**
 * Check if the current platform is Android
 */
export function isAndroid(): boolean {
  return Platform.OS === 'android';
}

/**
 * Check if MIFARE Classic sector operations are available
 * Only supported on Android
 */
export function supportsMifareClassicSectors(): boolean {
  return isAndroid();
}

/**
 * Check if raw NFC-A commands are available
 * Full support on Android, limited on iOS
 */
export function supportsRawNfcACommands(): boolean {
  return isAndroid();
}

/**
 * Check if the tag supports ISO-DEP (ISO 14443-4)
 */
export function hasIsoDep(tag: RawTagData): boolean {
  return tag.techTypes.includes('IsoDep') || tag.techTypes.includes('Iso7816');
}

/**
 * Check if the tag is a MIFARE Classic (based on SAK)
 * SAK 0x08 = MIFARE Classic 1K
 * SAK 0x18 = MIFARE Classic 4K
 * SAK 0x09 = MIFARE Mini
 */
export function isMifareClassicByTag(tag: RawTagData): boolean {
  if (tag.sak === undefined) {
    return false;
  }
  return tag.sak === 0x08 || tag.sak === 0x18 || tag.sak === 0x09;
}

/**
 * Get the MIFARE Classic size from SAK
 */
export function getMifareClassicSize(sak: number): '320B' | '1K' | '4K' | null {
  switch (sak) {
    case 0x09:
      return '320B'; // Mini
    case 0x08:
      return '1K';
    case 0x18:
      return '4K';
    default:
      return null;
  }
}

/**
 * Check if tag has NFC-A technology (ISO 14443-3A)
 */
export function hasNfcA(tag: RawTagData): boolean {
  return tag.techTypes.includes('NfcA');
}

/**
 * Check if tag has NFC-V technology (ISO 15693)
 */
export function hasNfcV(tag: RawTagData): boolean {
  return tag.techTypes.includes('NfcV') || tag.techTypes.includes('Iso15693');
}

/**
 * Get platform-specific user instructions for scanning
 */
export function getScanInstructions(): string {
  if (isIOS()) {
    return 'Hold your NFC tag near the top of your iPhone';
  }
  return 'Hold your NFC tag near the back of your device';
}

/**
 * Get the primary NFC tech type to request based on detected technologies
 */
export function getPrimaryTech(techTypes: NfcTechType[]): NfcTechType | null {
  // Prefer IsoDep/Iso7816 for smart cards
  if (techTypes.includes('IsoDep')) {
    return 'IsoDep';
  }
  if (techTypes.includes('Iso7816')) {
    return 'Iso7816';
  }

  // Then NFC-A for most common tags
  if (techTypes.includes('NfcA')) {
    return 'NfcA';
  }

  // NFC-V for ISO 15693 tags
  if (techTypes.includes('NfcV')) {
    return 'NfcV';
  }

  // MIFARE specific
  if (techTypes.includes('MifareClassic')) {
    return 'MifareClassic';
  }
  if (techTypes.includes('MifareUltralight')) {
    return 'MifareUltralight';
  }

  return techTypes[0] || null;
}

/**
 * Platform limitations info
 */
export const PLATFORM_LIMITATIONS = {
  ios: {
    mifareClassicSectors: false,
    rawNfcA: false,
    backgroundReading: false,
    description: 'iOS has limited NFC capabilities due to CoreNFC restrictions',
  },
  android: {
    mifareClassicSectors: true,
    rawNfcA: true,
    backgroundReading: true,
    description: 'Android has full NFC capabilities',
  },
};
