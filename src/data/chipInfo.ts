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
    'NXP NTAG and MIFARE Ultralight ICs are ISO/IEC 14443 Type A, NFC Forum Type 2 Tag compliant chips designed for consumer NFC applications like URL sharing, contact exchange, and smart product interactions.',
  [ChipFamily.MIFARE_CLASSIC]:
    'MIFARE Classic is an ISO/IEC 14443 Type A contactless smart card using proprietary CRYPTO1 encryption (now considered weak). Widely deployed in access control and transit systems.',
  [ChipFamily.MIFARE_DESFIRE]:
    'MIFARE DESFire is an ISO/IEC 14443 Type A contactless multi-application smart card IC with AES-128 and 3DES encryption. Common Criteria EAL5+ certified.',
  [ChipFamily.MIFARE_PLUS]:
    'MIFARE Plus is an ISO/IEC 14443 Type A smart card offering AES-128 security with backward compatibility to MIFARE Classic infrastructure.',
  [ChipFamily.ISO15693]:
    'ISO/IEC 15693 (NFC Forum Type 5) tags operate at 13.56 MHz with longer read distances than ISO 14443. This family includes NXP ICODE SLIX and NTAG 5 products.',
  [ChipFamily.JAVACARD]:
    'JavaCard secure elements run a Java Card OS supporting multiple cryptographic applets. NXP JCOP products use SmartMX hardware with Common Criteria EAL6+ certification.',
  [ChipFamily.UNKNOWN]:
    'This chip type could not be fully identified. It may be a less common or proprietary tag.',
};

export const CHIP_INFO: Partial<Record<ChipType, ChipInfo>> = {
  // ========================================================================
  // NTAG 21x family — ISO/IEC 14443 Type A, NFC Forum Type 2 Tag
  // Source: https://www.nxp.com/docs/en/data-sheet/NTAG213_215_216.pdf
  // ========================================================================
  [ChipType.NTAG213]: {
    description:
      'ISO/IEC 14443 Type A, NFC Forum Type 2 Tag IC with 144 bytes user memory and 106 kbit/s data rate.',
    commonUses: ['URL sharing', 'Smart posters', 'Product authentication'],
    capabilities: ['NFC Forum Type 2 Tag', '32-bit password protection', 'NFC counter', 'Originality signature'],
    securityLevel: 'low',
    memoryNote: '144 bytes user memory (180 bytes total)',
  },
  [ChipType.NTAG215]: {
    description:
      'ISO/IEC 14443 Type A, NFC Forum Type 2 Tag IC with 504 bytes user memory. Commonly used in gaming applications.',
    commonUses: ['Gaming (amiibo)', 'Access tokens', 'Loyalty cards'],
    capabilities: ['NFC Forum Type 2 Tag', '32-bit password protection', 'NFC counter', 'Originality signature'],
    securityLevel: 'low',
    memoryNote: '504 bytes user memory',
  },
  [ChipType.NTAG216]: {
    description:
      'ISO/IEC 14443 Type A, NFC Forum Type 2 Tag IC with 888 bytes user memory. Popular for NFC implants and data-rich applications.',
    commonUses: ['NFC implants', 'vCards', 'Complex data storage'],
    capabilities: ['NFC Forum Type 2 Tag', '32-bit password protection', 'NFC counter', 'Originality signature'],
    securityLevel: 'low',
    memoryNote: '888 bytes user memory',
  },

  // ========================================================================
  // NTAG I2C Plus — ISO/IEC 14443 Type A, NFC Forum Type 2 Tag + I2C
  // Source: https://www.nxp.com/docs/en/data-sheet/NT3H2111_2211.pdf
  // ========================================================================
  [ChipType.NTAG_I2C_1K]: {
    description:
      'NFC Forum Type 2 Tag IC with I2C interface, SRAM buffer, and energy harvesting for powering external sensors.',
    commonUses: ['IoT devices', 'Energy harvesting', 'Sensor-connected products'],
    capabilities: ['NFC + I2C dual interface', 'Energy harvesting', 'Field detection pin', 'SRAM pass-through'],
    securityLevel: 'low',
    memoryNote: '888 bytes user memory + 64 bytes SRAM',
  },
  [ChipType.NTAG_I2C_2K]: {
    description:
      'Extended memory NFC Forum Type 2 Tag with I2C interface and 32-bit password protection.',
    commonUses: ['IoT devices', 'Data logging', 'Connected products'],
    capabilities: ['NFC + I2C dual interface', 'Energy harvesting', '32-bit password', 'Originality signature (ECDSA)'],
    securityLevel: 'low',
    memoryNote: '1904 bytes user memory + 256 bytes SRAM',
  },

  // ========================================================================
  // NTAG 5 family — ISO/IEC 15693, NFC Forum Type 5 Tag + I2C
  // Source: https://www.nxp.com/docs/en/data-sheet/NTP53x2.pdf (link)
  //         https://www.nxp.com/docs/en/data-sheet/NTA5332.pdf (boost)
  // ========================================================================
  [ChipType.NTAG5_LINK]: {
    description:
      'ISO/IEC 15693, NFC Forum Type 5 Tag IC with I2C master/slave bridge, PWM, and GPIO interfaces for connecting NFC to sensors and microcontrollers.',
    commonUses: ['Sensor connectivity', 'IoT devices', 'Energy harvesting applications'],
    capabilities: ['NFC Forum Type 5 Tag', 'I2C master/slave', 'Energy harvesting', 'PWM/GPIO', 'Password and AES-128 authentication'],
    securityLevel: 'medium',
    memoryNote: '496 bytes user memory + 256 bytes SRAM',
  },
  [ChipType.NTAG5_BOOST]: {
    description:
      'ISO/IEC 15693, NFC Forum Type 5 Tag IC with active load modulation for robust phone communication and I2C bridge for tiny devices.',
    commonUses: ['Sensor implants', 'Compact IoT devices', 'Connected products'],
    capabilities: ['NFC Forum Type 5 Tag', 'Active load modulation', 'I2C master/slave', 'Energy harvesting', 'AES-128 mutual authentication'],
    securityLevel: 'medium',
    memoryNote: '2000 bytes user memory + 256 bytes SRAM',
  },

  // ========================================================================
  // MIFARE Ultralight family — ISO/IEC 14443 Type A, NFC Forum Type 2 Tag
  // Source: https://www.nxp.com/docs/en/data-sheet/MF0ULX1.pdf (EV1)
  //         https://www.nxp.com/docs/en/data-sheet/MF0AES(H)20.pdf (AES)
  // ========================================================================
  [ChipType.ULTRALIGHT]: {
    description:
      'ISO/IEC 14443 Type A, NFC Forum Type 2 Tag. A simple, low-cost contactless IC with minimal memory.',
    commonUses: ['Single-use tickets', 'Event passes', 'Disposable tags'],
    capabilities: ['NFC Forum Type 2 Tag', 'OTP area', 'Lock bits'],
    securityLevel: 'low',
    memoryNote: '48 bytes user memory',
  },
  [ChipType.ULTRALIGHT_C]: {
    description:
      'ISO/IEC 14443 Type A contactless IC with 3DES mutual authentication for limited-use applications.',
    commonUses: ['Limited-use tickets', 'Access tokens', 'Loyalty cards'],
    capabilities: ['NFC Forum Type 2 Tag', '3DES mutual authentication', 'Counter'],
    securityLevel: 'medium',
    memoryNote: '144 bytes user memory',
  },
  [ChipType.ULTRALIGHT_EV1]: {
    description:
      'ISO/IEC 14443 Type A contactless IC with 32-bit password protection, three 24-bit counters, and ECC-based originality signature.',
    commonUses: ['Event tickets', 'Brand protection', 'Gaming tokens'],
    capabilities: ['NFC Forum Type 2 Tag', '32-bit password', 'Originality signature (ECDSA)', '3 x 24-bit counters'],
    securityLevel: 'low',
    memoryNote: '48 or 128 bytes user memory',
  },
  [ChipType.ULTRALIGHT_AES]: {
    description:
      'ISO/IEC 14443 Type A contactless IC with AES-128 mutual authentication and CMAC message integrity protection.',
    commonUses: ['Secure tickets', 'Brand protection', 'Limited-use passes'],
    capabilities: ['NFC Forum Type 2 Tag', 'AES-128 mutual authentication', 'CMAC protection', 'Originality signature'],
    securityLevel: 'high',
    memoryNote: '540 bytes user memory',
  },

  // ========================================================================
  // MIFARE Classic EV1 — ISO/IEC 14443 Type A
  // Source: https://www.nxp.com/docs/en/data-sheet/MF1S50YYX_V1.pdf (1K)
  //         https://www.nxp.com/docs/en/data-sheet/MF1S70YYX_V1.pdf (4K)
  // ========================================================================
  [ChipType.MIFARE_CLASSIC_1K]: {
    description:
      'ISO/IEC 14443 Type A contactless smart card IC with CRYPTO1 stream cipher. Widely deployed but cryptographically broken.',
    commonUses: ['Building access', 'Hotel keys', 'Transit cards'],
    capabilities: ['16 sectors of 4 blocks', 'Mutual three-pass authentication', 'Dual key sets per sector', '106 kbit/s'],
    securityLevel: 'low',
    memoryNote: '1 KB (752 bytes usable)',
  },
  [ChipType.MIFARE_CLASSIC_4K]: {
    description:
      'ISO/IEC 14443 Type A contactless smart card IC with extended 4 KB memory. Same CRYPTO1 security as 1K.',
    commonUses: ['Building access', 'Parking systems', 'Legacy transit'],
    capabilities: ['40 sectors', 'Mutual three-pass authentication', 'Dual key sets per sector', '106 kbit/s'],
    securityLevel: 'low',
    memoryNote: '4 KB (3440 bytes usable)',
  },

  // ========================================================================
  // MIFARE DESFire — ISO/IEC 14443 Type A (ISO 14443-4)
  // Source: https://www.nxp.com/docs/en/data-sheet/MF3ICDX21_41_81_SDS.pdf (EV1)
  //         https://www.nxp.com/docs/en/data-sheet/MF3DX2_MF3DHX2_SDS.pdf (EV2)
  //         https://www.nxp.com/docs/en/data-sheet/MF3D_H_X3_SDS.pdf (EV3)
  // ========================================================================
  [ChipType.DESFIRE_EV1]: {
    description:
      'ISO/IEC 14443 Type A multi-application smart card IC with AES-128 and 3DES encryption. Up to 28 applications with 32 files each.',
    commonUses: ['Secure access control', 'Transit systems', 'Campus cards'],
    capabilities: ['AES-128 / 3DES', 'Up to 28 applications', 'Flexible file system', 'Up to 848 kbit/s'],
    securityLevel: 'high',
    memoryNote: '2 KB, 4 KB, or 8 KB',
  },
  [ChipType.DESFIRE_EV2]: {
    description:
      'ISO/IEC 14443 Type A multi-application smart card IC adding proximity check and Transaction MAC over EV1.',
    commonUses: ['High-security access', 'Payment cards', 'Government ID'],
    capabilities: [
      'AES-128 / 3DES',
      'Proximity check (relay attack protection)',
      'Transaction MAC',
      'Virtual Card Architecture',
    ],
    securityLevel: 'high',
    memoryNote: '2 KB, 4 KB, 8 KB, 16 KB, or 32 KB',
  },
  [ChipType.DESFIRE_EV3]: {
    description:
      'ISO/IEC 14443 Type A multi-application smart card IC. Adds Secure Dynamic Messaging (SDM), Transaction Timer, and SUN authentication over EV2. Common Criteria EAL5+.',
    commonUses: ['Transit', 'Access control', 'Micropayment', 'Loyalty'],
    capabilities: [
      'AES-128 / 3DES',
      'Secure Dynamic Messaging (SDM)',
      'Transaction Timer (anti-MITM)',
      'SUN authentication',
    ],
    securityLevel: 'high',
    memoryNote: '2 KB, 4 KB, 8 KB, 16 KB, or 32 KB',
  },

  // ========================================================================
  // ICODE SLIX/SLIX2/DNA — ISO/IEC 15693, NFC Forum Type 5
  // Source: https://www.nxp.com/docs/en/data-sheet/SL2S2002_SL2S2102.pdf (SLIX)
  //         https://www.nxp.com/docs/en/data-sheet/SL2S2602.pdf (SLIX2)
  //         https://www.nxp.com/docs/en/data-sheet/SL2S6002_SDS.pdf (DNA)
  // ========================================================================
  [ChipType.SLIX]: {
    description:
      'ISO/IEC 15693, NFC Forum Type 5 Tag with Electronic Article Surveillance (EAS) and longer read range than ISO 14443.',
    commonUses: ['Library systems', 'Inventory tracking', 'Industrial tags'],
    capabilities: ['NFC Forum Type 5 Tag', 'EAS', 'Anti-collision', 'AFI/DSFID', '32-bit password'],
    securityLevel: 'low',
    memoryNote: '112 bytes (896 bits) user memory',
  },
  [ChipType.SLIX2]: {
    description:
      'ISO/IEC 15693, NFC Forum Type 5 Tag with password-protected memory areas and ECC originality signature. Backward compatible with SLIX.',
    commonUses: ['Asset tracking', 'Brand protection', 'Library systems'],
    capabilities: ['NFC Forum Type 5 Tag', 'Multiple 32-bit passwords', 'Originality signature (ECDSA)', '16-bit counter', 'Privacy mode'],
    securityLevel: 'medium',
    memoryNote: '320 bytes (2560 bits) user memory',
  },
  [ChipType.ICODE_DNA]: {
    description:
      'ISO/IEC 15693 tag with AES-128 mutual authentication (ISO/IEC 29167-10) and three configurable user keys for brand protection.',
    commonUses: ['Brand protection', 'Anti-counterfeiting', 'Secure supply chain'],
    capabilities: [
      'AES-128 mutual authentication',
      '3 user keys with separate privileges',
      'Customizable originality signature',
    ],
    securityLevel: 'high',
    memoryNote: '256 bytes user memory',
  },

  // ========================================================================
  // JavaCard / JCOP — ISO/IEC 14443, ISO 7816
  // Source: https://www.nxp.com/products/security-and-authentication/jcop-for-payment-and-identity:END-TO-END-SERVICES
  //         https://www.nxp.com/docs/en/fact-sheet/P71D321.pdf (SmartMX3)
  // ========================================================================
  [ChipType.JCOP4]: {
    description:
      'NXP JCOP4 on SmartMX3 (P71) secure microcontroller. Java Card OS with Common Criteria EAL6+ certification for multi-application secure element use.',
    commonUses: ['Identity cards', 'Digital signatures', 'Secure authentication', 'Payment'],
    capabilities: [
      'Java Card OS with GlobalPlatform',
      'Contact + contactless (ISO 14443)',
      'Multiple applets (FIDO2, OpenPGP, OTP)',
      'Common Criteria EAL6+',
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
