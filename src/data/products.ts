/**
 * Dangerous Things Product Catalog
 *
 * This contains the implant products available from Dangerous Things
 * and their chip compatibility information.
 *
 * Updated based on https://dangerousthings.com/category/implants/
 * Discontinued products removed per https://forum.dangerousthings.com/t/shes-dead-jim/26308
 */

import { ChipType } from '../types/detection';
import {
  Product,
  FormFactor,
  ProductCategory,
  ChipProductMap,
} from '../types/products';

/**
 * Chip types that can be cloned to NTAG216-based implants
 * Any NTAG21x data can be written to an NTAG216 (same NFC Type 2 protocol)
 */
const NTAG21X_COMPATIBLE: ChipType[] = [
  ChipType.NTAG213,
  ChipType.NTAG215,
  ChipType.NTAG216,
];

/**
 * NTAG I2C compatible chips
 */
const NTAG_I2C_COMPATIBLE: ChipType[] = [
  ChipType.NTAG_I2C_1K,
  ChipType.NTAG_I2C_2K,
  ChipType.NTAG_I2C_PLUS_1K,
  ChipType.NTAG_I2C_PLUS_2K,
];

/**
 * MIFARE Classic compatible chips (for magic card cloning)
 */
const MIFARE_CLASSIC_COMPATIBLE: ChipType[] = [
  ChipType.MIFARE_CLASSIC_1K,
  ChipType.MIFARE_CLASSIC_4K,
  ChipType.MIFARE_CLASSIC_MINI,
];

/**
 * All DESFire chips - any DESFire product works with any DESFire chip
 */
const DESFIRE_ALL: ChipType[] = [
  ChipType.DESFIRE_EV1,
  ChipType.DESFIRE_EV2,
  ChipType.DESFIRE_EV3,
];

/**
 * ICODE SLIX compatible
 */
const SLIX_COMPATIBLE: ChipType[] = [
  ChipType.SLIX,
  ChipType.SLIX2,
  ChipType.SLIX_S,
  ChipType.SLIX_L,
];

/**
 * MIFARE Ultralight compatible chips (for Gen4 magic implants)
 * Note: Ultralight AES cannot be cloned if AES protection is active
 */
const ULTRALIGHT_COMPATIBLE: ChipType[] = [
  ChipType.ULTRALIGHT,
  ChipType.ULTRALIGHT_C,
  ChipType.ULTRALIGHT_EV1,
  ChipType.ULTRALIGHT_NANO,
  ChipType.ULTRALIGHT_AES,
];

export const PRODUCTS: Product[] = [
  // ==========================================================================
  // X-Series (Glass Capsule) Implants - NFC
  // ==========================================================================
  {
    id: 'xnt',
    name: 'xNT',
    description:
      'NFC Type 2 implant with 888 bytes of user memory.',
    formFactor: FormFactor.X_SERIES,
    categories: [ProductCategory.NFC],
    compatibleChips: [...NTAG21X_COMPATIBLE, ...NTAG_I2C_COMPATIBLE],
    features: [
      'NTAG216 chip',
      '888 bytes user memory',
      'NFC Type 2 tag',
      'URL/contact sharing',
    ],
    url: 'https://dangerousthings.com/product/xnt/',
    canReceiveClone: true,
    exactMatch: true,
    notes: "UID cannot be changed"
  },
  {
    id: 'xsiid',
    name: 'xSIID',
    description:
      'NFC implant with built-in LED that blinks when scanned. Multiple color options available.',
    formFactor: FormFactor.X_SERIES,
    categories: [ProductCategory.NFC, ProductCategory.LED],
    compatibleChips: [...NTAG21X_COMPATIBLE, ...NTAG_I2C_COMPATIBLE],
    features: [
      'NTAG I2C chip',
      '1kB user memory',
      'URL/contact sharing',
      'Red, Green, Blue, and White LEDs available',
    ],
    url: 'https://dangerousthings.com/product/xsiid/',
    canReceiveClone: true,
    exactMatch: true,
    notes: "UID cannot be changed"
  },
  {
    id: 'xslx',
    name: 'xSLX',
    description: 'NFC Type 5 implant using ICODE SLIX chip.',
    formFactor: FormFactor.X_SERIES,
    categories: [ProductCategory.NFC],
    compatibleChips: [...SLIX_COMPATIBLE],
    features: [
      'ICODE SLIX chip',
      '320 bbytes user memory',
      'URL/contact sharing',
    ],
    url: 'https://dangerousthings.com/product/xslx/',
    canReceiveClone: true,
    exactMatch: true,
    notes: "UID cannot be changed"
  },

  // ==========================================================================
  // X-Series - Dual Frequency (NFC + 125kHz)
  // ==========================================================================
  {
    id: 'next',
    name: 'NExT',
    description:
      'Original dual-frequency implant combining NTAG216 (NFC) with T5577 (125kHz).',
    formFactor: FormFactor.X_SERIES,
    categories: [ProductCategory.DUAL_FREQUENCY, ProductCategory.ACCESS],
    compatibleChips: [...NTAG21X_COMPATIBLE, ...NTAG_I2C_COMPATIBLE],
    features: [
      'Dual-frequency',
      'NTAG216 NFC chip',
      '888 bytes user memory',
      'URL/contact sharing',
      'T5577 125kHz chip',
      'Access control (LF)',
    ],
    url: 'https://dangerousthings.com/product/next/',
    canReceiveClone: true,
    exactMatch: true,
    notes: 'HF UID cannot be changed. Also includes T5577 for 125kHz access systems',
  },
  {
    id: 'next-v2',
    name: 'NExT v2',
    description:
      'Updated dual-frequency implant with NTAG I2C, T5577, and built-in LED.',
    formFactor: FormFactor.X_SERIES,
    categories: [ProductCategory.DUAL_FREQUENCY, ProductCategory.ACCESS, ProductCategory.LED],
    compatibleChips: [...NTAG21X_COMPATIBLE, ...NTAG_I2C_COMPATIBLE],
    features: [
      'NTAG I2C NFC chip',
      '1kB user memory',
      'URL/contact sharing',
      'Green, Blue, and White LEDs available (HF)',
      'T5577 125kHz chip',
      'Access control (LF)',
    ],
    url: 'https://dangerousthings.com/product/next-v2/',
    canReceiveClone: true,
    exactMatch: true,
    notes: 'HF UID cannot be changed. Also includes T5577 for 125kHz access systems',
  },
  {
    id: 'xmagic',
    name: 'xMagic',
    description:
      'Dual-frequency implant with magic MIFARE Classic (changeable UID) and T5577.',
    formFactor: FormFactor.X_SERIES,
    categories: [ProductCategory.DUAL_FREQUENCY, ProductCategory.ACCESS],
    compatibleChips: [...MIFARE_CLASSIC_COMPATIBLE],
    features: [
      'Magic MIFARE Classic chip',
      'Changeable UID (4-byte)',
      'Gen1a and gen2 magic options',
      'T5577 125kHz chip',
      'Access control (LF)',
    ],
    url: 'https://dangerousthings.com/product/xmagic/',
    canReceiveClone: true,
    exactMatch: false,
  },

  // ==========================================================================
  // X-Series - DESFire (Secure NFC)
  // Note: xDF (EV1) and xDF2 (EV2) discontinued - see flexDF/flexDF2 for those
  // ==========================================================================
  {
    id: 'xdf3',
    name: 'xDF3',
    description: 'Latest generation secure NFC implant using MIFARE DESFire EV3.',
    formFactor: FormFactor.X_SERIES,
    categories: [ProductCategory.SECURE, ProductCategory.ACCESS],
    compatibleChips: [...DESFIRE_ALL],
    features: [
      'DESFire EV3 chip',
      '8KB memory',
      'Latest security features',
      'Access control (HF)',
      'URL/contact sharing',
    ],
    url: 'https://dangerousthings.com/product/xdf3/',
    canReceiveClone: false,
    exactMatch: true,
    notes: 'UID cannot be changed. Cannot clone data due to cryptographic protection',
    desfireEvLevel: 3,
  },

  // ==========================================================================
  // X-Series - Magic/Cloning
  // ==========================================================================
  {
    id: 'xm1',
    name: 'xM1',
    description: 'Magic MIFARE Classic 1K implant with changeable UID for cloning access cards.',
    formFactor: FormFactor.X_SERIES,
    categories: [ProductCategory.ACCESS],
    compatibleChips: [...MIFARE_CLASSIC_COMPATIBLE],
    features: [
      'Magic MIFARE Classic 1K',
      'Gen1a and gen2 magic options',
      'Changeable UID (4-byte)',
    ],
    url: 'https://dangerousthings.com/product/xm1/',
    canReceiveClone: true,
    exactMatch: false,
  },

  // ==========================================================================
  // X-Series - Cryptographic/Identity
  // ==========================================================================
  {
    id: 'spark2',
    name: 'VivoKey Spark 2',
    description:
      'Cryptobionic identity implant for secure authentication and digital identity.',
    formFactor: FormFactor.X_SERIES,
    categories: [ProductCategory.SECURE],
    compatibleChips: [ChipType.NTAG424_DNA, ChipType.NTAG424_DNA_TT, ChipType.ICODE_DNA],
    features: [
      'VivoKey Ecosystem',
      'Spark Actions',
      'Verify API',
    ],
    url: 'https://dangerousthings.com/product/vivokey-spark/',
    canReceiveClone: false,
    exactMatch: true,
    notes: 'UID cannot be changed. Uses cryptographic authentication - cannot clone',
  },

  // ==========================================================================
  // Bioresin Implants - Larger capsules (incision install)
  // ==========================================================================
  {
    id: 'dnext',
    name: 'dNExT',
    description:
      'Jumbo-sized bioresin dual-frequency implant with NTAG216 (NFC) and T5577 (125kHz). Enhanced read range.',
    formFactor: FormFactor.BIORESIN,
    categories: [ProductCategory.DUAL_FREQUENCY, ProductCategory.ACCESS],
    compatibleChips: [...NTAG21X_COMPATIBLE, ...NTAG_I2C_COMPATIBLE],
    features: [
      'NTAG216 NFC chip',
      '888 bytes user memory',
      'URL/contact sharing',
      'T5577 125kHz chip',
      'Bioresin encapsulation',
      'Enhanced read range',
    ],
    url: 'https://dangerousthings.com/product/dnext/',
    canReceiveClone: true,
    exactMatch: true,
    notes: 'HF UID cannot be changed. Larger size provides improved performance over x-series',
  },
  {
    id: 'dug4t',
    name: 'dUG4T',
    description:
      'Bioresin dual-frequency implant with Ultimate Gen4 magic MIFARE and T5577 for maximum compatibility.',
    formFactor: FormFactor.BIORESIN,
    categories: [ProductCategory.DUAL_FREQUENCY, ProductCategory.ACCESS],
    compatibleChips: [...MIFARE_CLASSIC_COMPATIBLE, ...ULTRALIGHT_COMPATIBLE],
    features: [
      'Ultimate Gen4 magic chip',
      'Changeable UID',
      'Access control (HF)',
      'T5577 125kHz chip',
      'Changeable UID',
      'Enhanced cloning capability',
      'Access control (LF)',
    ],
    url: 'https://dangerousthings.com/product/dug4t/',
    canReceiveClone: true,
    exactMatch: false,
    notes: 'Supports 1K and 4K cloning. Also includes T5577 for LF.',
  },

  // ==========================================================================
  // Flex Implants - NFC
  // ==========================================================================
  {
    id: 'flexnt',
    name: 'flexNT',
    description:
      'Flexible NTAG216 implant with larger antenna for improved read range.',
    formFactor: FormFactor.FLEX,
    categories: [ProductCategory.NFC],
    compatibleChips: [...NTAG21X_COMPATIBLE, ...NTAG_I2C_COMPATIBLE],
    features: [
      'NTAG216 chip',
      '888 bytes user memory',
      'URL/contact sharing',
      'Extended read range',
    ],
    url: 'https://dangerousthings.com/product/flexnt/',
    canReceiveClone: true,
    exactMatch: true,
    notes: "UID cannot be changed"
  },

  // ==========================================================================
  // Flex Implants - DESFire (Secure)
  // Note: flexDF (EV1) discontinued - flexDF2 is current
  // ==========================================================================
  {
    id: 'flexdf2',
    name: 'flexDF2',
    description: 'Flexible DESFire EV2 implant with enhanced security.',
    formFactor: FormFactor.FLEX,
    categories: [ProductCategory.SECURE, ProductCategory.ACCESS],
    compatibleChips: [...DESFIRE_ALL],
    features: [
      'DESFire EV2 chip',
      '8KB memory',
      'AES-128 encryption',
      'URL/contact sharing',
    ],
    url: 'https://dangerousthings.com/product/flexdf2/',
    canReceiveClone: false,
    exactMatch: true,
    notes: 'UID cannot be changed. Cannot clone data due to cryptographic protection',
    desfireEvLevel: 2,
  },

  // ==========================================================================
  // Flex Implants - Magic/Cloning
  // ==========================================================================
  {
    id: 'flexm1-v2',
    name: 'flexM1 v2',
    description: 'Updated flexible magic MIFARE Classic 1K implant.',
    formFactor: FormFactor.FLEX,
    categories: [ProductCategory.ACCESS],
    compatibleChips: [...MIFARE_CLASSIC_COMPATIBLE],
    features: [
      'Magic MIFARE Classic 1K',
      'Improved antenna design',
      'Changeable UID',
      'Better compatibility',
    ],
    url: 'https://dangerousthings.com/product/flexm1-v2/',
    canReceiveClone: true,
    exactMatch: false,
  },

  // ==========================================================================
  // Flex Implants - Secure Element / JavaCard
  // ==========================================================================
  {
    id: 'apex-flex',
    name: 'Apex Flex',
    description:
      'The ultimate subdermal security key for digital identity, cryptography, and blockchain applications.',
    formFactor: FormFactor.FLEX,
    categories: [ProductCategory.SECURE],
    compatibleChips: [ChipType.JCOP4, ChipType.JAVACARD_UNKNOWN],
    features: [
      'JCOP4 secure element',
      'Fidesmo platform',
      'FIDO2/WebAuthn',
      'OTP support',
      'URL/contact sharing',
    ],
    url: 'https://dangerousthings.com/product/apex-flex/',
    canReceiveClone: false,
    exactMatch: true,
    notes: 'UID cannot be changed. Cannot clone - programmable via Fidesmo app',
  },
  {
    id: 'flexsecure',
    name: 'flexSecure',
    description:
      'Developer-friendly JavaCard implant for custom secure applications.',
    formFactor: FormFactor.FLEX,
    categories: [ProductCategory.SECURE],
    compatibleChips: [ChipType.JCOP4, ChipType.JAVACARD_UNKNOWN],
    features: [
      'SmartMX3 P71 chip',
      'Full JavaCard access',
      'GlobalPlatformPro compatible',
      'Custom applet support',
      'FIDO2/WebAuthn',
      'OTP support',
      'URL/contact sharing',
    ],
    url: 'https://dangerousthings.com/product/flexsecure/',
    canReceiveClone: false,
    exactMatch: true,
    notes: 'UID cannot be changed. Developer-focused - requires technical knowledge',
  },

  // ==========================================================================
  // Flex Implants - Access Control
  // ==========================================================================
  {
    id: 'flexclass',
    name: 'flexClass',
    description: 'Flexible HID iCLASS compatible implant for enterprise access control.',
    formFactor: FormFactor.FLEX,
    categories: [ProductCategory.SECURE, ProductCategory.ACCESS],
    compatibleChips: [], // iCLASS uses proprietary protocol
    features: [
      'HID iCLASS SE compatible',
      'Enterprise access control',
    ],
    url: 'https://dangerousthings.com/product/flexclass/',
    canReceiveClone: false,
    exactMatch: false,
    notes: 'For HID iCLASS systems only',
  },
  {
    id: 'flexug4',
    name: 'flexUG4',
    description: 'Flexible Ultimate Gen4 magic MIFARE implant for cloning access cards.',
    formFactor: FormFactor.FLEX,
    categories: [ProductCategory.ACCESS],
    compatibleChips: [...MIFARE_CLASSIC_COMPATIBLE, ...ULTRALIGHT_COMPATIBLE],
    features: [
      'Ultimate Gen4 magic chip',
      'Changeable UID',
      'Enhanced cloning capability',
    ],
    url: 'https://dangerousthings.com/product/flexug4/',
    canReceiveClone: true,
    exactMatch: false,
    notes: 'Supports 1K and 4K cloning.',
  },

  // ==========================================================================
  // Sensor Implants — Temperature monitoring via NTAG5 + I2C sensors
  // ==========================================================================
  {
    id: 'temptress',
    name: 'Temptress',
    description:
      'Dual-sensor temperature monitoring implant with two TMP117 sensors for differential temperature measurement.',
    formFactor: FormFactor.FLEX,
    categories: [ProductCategory.NFC, ProductCategory.SENSOR],
    compatibleChips: [ChipType.NTAG5_BOOST, ChipType.NTAG5_LINK],
    features: [
      'Dual TMP117 sensors',
      'Temperature monitoring',
      'Energy harvesting powered',
      'NTAG5 NFC interface',
    ],
    url: 'https://dangerousthings.com/product/temptress/',
    canReceiveClone: false,
    exactMatch: true,
    notes: 'Identified by dual TMP117 sensors at I2C addresses 0x49/0x4A. Not a VivoKey product.',
  },
  {
    id: 'vk-thermo-112',
    name: 'VivoKey Thermo 112',
    description:
      'Temperature monitoring implant using TMP112 sensor with VivoKey Verify authentication.',
    formFactor: FormFactor.X_SERIES,
    categories: [ProductCategory.NFC, ProductCategory.SENSOR, ProductCategory.SECURE],
    compatibleChips: [ChipType.NTAG5_BOOST, ChipType.NTAG5_LINK],
    features: [
      'TMP112 temperature sensor',
      'Temperature monitoring',
      'VivoKey Verify authentication',
      'Energy harvesting powered',
    ],
    url: 'https://vivokey.com/thermo',
    canReceiveClone: false,
    exactMatch: true,
    notes: 'Identified by AFI=0x54, DSFID=0x09. Signature: "VK Thermo 112 vivokey.com/thermo"',
  },
  // VK Thermo 117 (TMP117) — end of life, detection still works but not listed as product
  // VK Thermo 119 (TMP119) — not yet released, detection still works but not listed as product
];

/**
 * Build a map of chip types to compatible products
 */
export function buildChipProductMap(): ChipProductMap {
  const map: ChipProductMap = new Map();

  for (const product of PRODUCTS) {
    for (const chipType of product.compatibleChips) {
      const existing = map.get(chipType) || [];
      existing.push(product);
      map.set(chipType, existing);
    }
  }

  return map;
}

/**
 * Cached chip-to-product map
 */
let chipProductMapCache: ChipProductMap | null = null;

/**
 * Get the chip-to-product map (cached)
 */
export function getChipProductMap(): ChipProductMap {
  if (!chipProductMapCache) {
    chipProductMapCache = buildChipProductMap();
  }
  return chipProductMapCache;
}

/**
 * Conversion service URL for chips that don't have direct matches
 */
export const CONVERSION_SERVICE_URL = 'https://dngr.us/conversion';

/**
 * Get all products
 */
export function getAllProducts(): Product[] {
  return PRODUCTS;
}

/**
 * Get product by ID
 */
export function getProductById(id: string): Product | undefined {
  return PRODUCTS.find(p => p.id === id);
}
