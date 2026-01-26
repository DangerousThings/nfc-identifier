/**
 * Educational Chip Information
 *
 * Provides user-friendly explanations of NFC chip types
 */

import {ChipType, ChipFamily} from '../types/detection';

export interface ChipInfo {
  /** Brief description of the chip */
  description: string;
  /** What this chip is commonly used for */
  commonUses: string[];
  /** Key capabilities */
  capabilities: string[];
  /** Security level indicator */
  securityLevel: 'low' | 'medium' | 'high';
  /** Memory capacity description */
  memoryNote?: string;
}

export const CHIP_FAMILY_INFO: Record<ChipFamily, string> = {
  [ChipFamily.NTAG]:
    'NTAG chips are NXP-branded NFC Type 2 tags designed for consumer applications like sharing URLs, contact info, and app launches. This family includes MIFARE Ultralight variants.',
  [ChipFamily.MIFARE_CLASSIC]:
    'MIFARE Classic is a legacy contactless smart card technology commonly used in access control and transit systems.',
  [ChipFamily.MIFARE_DESFIRE]:
    'MIFARE DESFire is a high-security contactless smart card with advanced encryption, used in transit, access control, and payment applications.',
  [ChipFamily.MIFARE_PLUS]:
    'MIFARE Plus offers enhanced security over Classic, with optional AES encryption while maintaining backward compatibility.',
  [ChipFamily.ISO15693]:
    'ISO 15693 (NFC-V) tags operate at longer read distances than standard NFC, commonly used in library systems and industrial applications.',
  [ChipFamily.JAVACARD]:
    'JavaCard chips are programmable secure elements that can run multiple cryptographic applications, used in identity and payment systems.',
  [ChipFamily.UNKNOWN]:
    'This chip type could not be fully identified. It may be a less common or proprietary tag.',
};

export const CHIP_INFO: Partial<Record<ChipType, ChipInfo>> = {
  // NTAG family
  [ChipType.NTAG213]: {
    description:
      'Entry-level NTAG with 144 bytes of user memory, ideal for simple NFC applications.',
    commonUses: ['URL sharing', 'Smart posters', 'Product authentication'],
    capabilities: ['NFC Forum Type 2', 'Password protection', 'Counter function'],
    securityLevel: 'low',
    memoryNote: '144 bytes user memory',
  },
  [ChipType.NTAG215]: {
    description:
      'Mid-range NTAG commonly used for amiibo and similar applications.',
    commonUses: ['Gaming (amiibo)', 'Access tokens', 'Loyalty cards'],
    capabilities: ['NFC Forum Type 2', 'Password protection', 'Counter function'],
    securityLevel: 'low',
    memoryNote: '504 bytes user memory',
  },
  [ChipType.NTAG216]: {
    description:
      'Largest standard NTAG with 888 bytes, popular for implants and data storage.',
    commonUses: ['NFC implants', 'vCards', 'Complex data storage'],
    capabilities: ['NFC Forum Type 2', 'Password protection', 'Counter function'],
    securityLevel: 'low',
    memoryNote: '888 bytes user memory',
  },
  [ChipType.NTAG_I2C_1K]: {
    description:
      'NTAG with I2C interface allowing microcontroller communication alongside NFC.',
    commonUses: ['IoT devices', 'Energy harvesting', 'Field detection'],
    capabilities: ['NFC + I2C interface', 'Energy harvesting', 'Field detection'],
    securityLevel: 'low',
    memoryNote: '888 bytes user memory',
  },
  [ChipType.NTAG_I2C_2K]: {
    description:
      'Extended memory NTAG I2C with 1904 bytes and dual interface capability.',
    commonUses: ['IoT devices', 'Data logging', 'Connected products'],
    capabilities: ['NFC + I2C interface', 'Energy harvesting', 'SRAM buffer'],
    securityLevel: 'low',
    memoryNote: '1904 bytes user memory',
  },

  // MIFARE Ultralight family
  [ChipType.ULTRALIGHT]: {
    description:
      'Original MIFARE Ultralight - a simple, low-cost NFC tag with minimal memory.',
    commonUses: ['Single-use tickets', 'Event passes', 'Disposable tags'],
    capabilities: ['NFC Forum Type 2', 'OTP area', 'Lock bits'],
    securityLevel: 'low',
    memoryNote: '48 bytes user memory',
  },
  [ChipType.ULTRALIGHT_C]: {
    description:
      'Ultralight with 3DES authentication for basic security applications.',
    commonUses: ['Limited-use tickets', 'Access tokens', 'Loyalty cards'],
    capabilities: ['NFC Forum Type 2', '3DES authentication', 'Counter'],
    securityLevel: 'medium',
    memoryNote: '144 bytes user memory',
  },
  [ChipType.ULTRALIGHT_EV1]: {
    description:
      'Enhanced Ultralight with password protection and originality check.',
    commonUses: ['Event tickets', 'Brand protection', 'Gaming tokens'],
    capabilities: ['Password protection', 'Originality signature', 'Counter'],
    securityLevel: 'low',
    memoryNote: '48 or 128 bytes user memory',
  },
  [ChipType.ULTRALIGHT_AES]: {
    description:
      'Ultralight with AES-128 authentication for secure applications.',
    commonUses: ['Secure tickets', 'Brand protection', 'Limited-use passes'],
    capabilities: ['AES-128 authentication', 'Counter', 'Originality signature'],
    securityLevel: 'high',
    memoryNote: '540 bytes user memory',
  },

  // MIFARE Classic
  [ChipType.MIFARE_CLASSIC_1K]: {
    description:
      'Classic 1K is the most common access card, using Crypto-1 encryption (now considered weak).',
    commonUses: ['Building access', 'Hotel keys', 'Transit cards'],
    capabilities: ['16 sectors', 'Key-based authentication', 'Sector permissions'],
    securityLevel: 'low',
    memoryNote: '1KB (752 bytes usable)',
  },
  [ChipType.MIFARE_CLASSIC_4K]: {
    description:
      'Extended capacity Classic card with 4KB memory, same security as 1K.',
    commonUses: ['Building access', 'Parking systems', 'Legacy transit'],
    capabilities: ['40 sectors', 'Key-based authentication', 'Sector permissions'],
    securityLevel: 'low',
    memoryNote: '4KB (3440 bytes usable)',
  },

  // DESFire
  [ChipType.DESFIRE_EV1]: {
    description:
      'First generation DESFire with AES-128 encryption for secure applications.',
    commonUses: ['Secure access control', 'Transit systems', 'Campus cards'],
    capabilities: ['AES-128/3DES', 'Multiple applications', 'Flexible file system'],
    securityLevel: 'high',
    memoryNote: '2KB, 4KB, or 8KB options',
  },
  [ChipType.DESFIRE_EV2]: {
    description:
      'Enhanced DESFire with improved security features and proximity check.',
    commonUses: ['High-security access', 'Payment cards', 'Government ID'],
    capabilities: [
      'AES-128',
      'Proximity check',
      'Transaction MAC',
      'Virtual Card Architecture',
    ],
    securityLevel: 'high',
    memoryNote: '2KB, 4KB, 8KB, 16KB, or 32KB options',
  },
  [ChipType.DESFIRE_EV3]: {
    description:
      'Latest DESFire generation with enhanced cryptography and secure messaging.',
    commonUses: ['Transit', 'Access control', 'Micropayment', 'Loyalty'],
    capabilities: [
      'AES-128',
      'Secure Dynamic Messaging',
      'Transaction MAC',
      'Sun authentication',
    ],
    securityLevel: 'high',
    memoryNote: '2KB, 4KB, 8KB, 16KB, or 32KB options',
  },

  // ISO 15693
  [ChipType.SLIX]: {
    description:
      'Basic ISO 15693 (NFC-V) tag with longer read range than standard NFC.',
    commonUses: ['Library systems', 'Inventory tracking', 'Industrial tags'],
    capabilities: ['Long range', 'Anti-collision', 'AFI/DSFID support'],
    securityLevel: 'low',
    memoryNote: '128 bytes',
  },
  [ChipType.SLIX2]: {
    description:
      'Enhanced SLIX with more memory and improved security features.',
    commonUses: ['Asset tracking', 'Brand protection', 'Library systems'],
    capabilities: ['Long range', 'Password protection', 'Originality signature'],
    securityLevel: 'medium',
    memoryNote: '316 bytes',
  },
  [ChipType.ICODE_DNA]: {
    description:
      'Cryptographically secured NFC-V tag for brand protection and authentication.',
    commonUses: ['Brand protection', 'Anti-counterfeiting', 'Secure supply chain'],
    capabilities: [
      'Cryptographic authentication',
      'Rolling code',
      'Originality check',
    ],
    securityLevel: 'high',
    memoryNote: '256 bytes',
  },

  // JavaCard
  [ChipType.JCOP4]: {
    description:
      'Programmable secure element supporting Java Card applets for cryptographic applications.',
    commonUses: ['Identity cards', 'Digital signatures', 'Secure authentication'],
    capabilities: [
      'Java Card OS',
      'Multiple applets',
      'FIDO2/WebAuthn',
      'OpenPGP',
    ],
    securityLevel: 'high',
  },
};

/**
 * Get educational info for a chip type
 */
export function getChipInfo(chipType: ChipType): ChipInfo | undefined {
  return CHIP_INFO[chipType];
}

/**
 * Get family description for a chip family
 */
export function getChipFamilyInfo(family: ChipFamily): string {
  return CHIP_FAMILY_INFO[family];
}

/**
 * Get security level description
 */
export function getSecurityLevelDescription(
  level: 'low' | 'medium' | 'high',
): string {
  switch (level) {
    case 'low':
      return 'Basic security - data can be read/written with standard tools';
    case 'medium':
      return 'Moderate security - some protection against casual attacks';
    case 'high':
      return 'Strong security - cryptographic protection against cloning';
  }
}
