/**
 * Detection Types
 * Types for chip identification and transponder detection
 */

/**
 * Supported chip types
 */
export enum ChipType {
  // NTAG 21x family (ISO 14443-3A, Type 2)
  NTAG213 = 'NTAG213',
  NTAG215 = 'NTAG215',
  NTAG216 = 'NTAG216',
  NTAG_I2C_1K = 'NTAG_I2C_1K',
  NTAG_I2C_2K = 'NTAG_I2C_2K',
  NTAG_I2C_PLUS_1K = 'NTAG_I2C_PLUS_1K',
  NTAG_I2C_PLUS_2K = 'NTAG_I2C_PLUS_2K',

  // NTAG 5 family (ISO 15693, NFC-V)
  NTAG5_LINK = 'NTAG5_LINK',
  NTAG5_BOOST = 'NTAG5_BOOST',
  NTAG5_SWITCH = 'NTAG5_SWITCH',

  // NTAG DNA family (ISO 14443-4, Type 4)
  NTAG413_DNA = 'NTAG413_DNA',
  NTAG424_DNA = 'NTAG424_DNA',
  NTAG424_DNA_TT = 'NTAG424_DNA_TT', // TagTamper variant

  NTAG_UNKNOWN = 'NTAG_UNKNOWN',

  // MIFARE Classic family
  MIFARE_CLASSIC_1K = 'MIFARE_CLASSIC_1K',
  MIFARE_CLASSIC_4K = 'MIFARE_CLASSIC_4K',
  MIFARE_CLASSIC_MINI = 'MIFARE_CLASSIC_MINI',

  // MIFARE DESFire family
  DESFIRE_EV1 = 'DESFIRE_EV1',
  DESFIRE_EV2 = 'DESFIRE_EV2',
  DESFIRE_EV3 = 'DESFIRE_EV3',
  /**
   * DESFire EV3C — the "C" is for Classic. An EV3 that also exposes a
   * MIFARE Classic credential. Identified when a Classic SAK card answers
   * DESFire GetVersion with EV3; the Classic interface is retained in
   * `Transponder.credentials`.
   */
  DESFIRE_EV3C = 'DESFIRE_EV3C',
  DESFIRE_LIGHT = 'DESFIRE_LIGHT',
  DESFIRE_UNKNOWN = 'DESFIRE_UNKNOWN',

  // MIFARE DUOX (HW Major 0xA0 on DESFire family GetVersion)
  MIFARE_DUOX = 'MIFARE_DUOX',

  // MIFARE Plus
  MIFARE_PLUS_S = 'MIFARE_PLUS_S',
  MIFARE_PLUS_X = 'MIFARE_PLUS_X',
  MIFARE_PLUS_SE = 'MIFARE_PLUS_SE',
  MIFARE_PLUS_EV1 = 'MIFARE_PLUS_EV1',
  MIFARE_PLUS_EV2 = 'MIFARE_PLUS_EV2',
  MIFARE_PLUS = 'MIFARE_PLUS', // Generic

  // NTAG X DNA (HW Major 0xA0 on NTAG DNA family GetVersion)
  NTAG_X_DNA = 'NTAG_X_DNA',

  // MIFARE 2GO virtual cards (cloud-backed)
  MIFARE_2GO = 'MIFARE_2GO',

  // MIFARE Ultralight family
  ULTRALIGHT = 'ULTRALIGHT',
  ULTRALIGHT_C = 'ULTRALIGHT_C',
  ULTRALIGHT_EV1 = 'ULTRALIGHT_EV1',
  ULTRALIGHT_NANO = 'ULTRALIGHT_NANO',
  ULTRALIGHT_AES = 'ULTRALIGHT_AES',

  // ISO 15693 (NFC-V) - ICODE family
  SLIX = 'SLIX',
  SLIX2 = 'SLIX2',
  SLIX_S = 'SLIX_S',
  SLIX_L = 'SLIX_L',
  ICODE_DNA = 'ICODE_DNA',
  ISO15693_UNKNOWN = 'ISO15693_UNKNOWN',

  // JavaCard
  JCOP4 = 'JCOP4',
  JAVACARD_UNKNOWN = 'JAVACARD_UNKNOWN',

  // Generic/Unknown
  ISO14443A_UNKNOWN = 'ISO14443A_UNKNOWN',
  ISO14443B_UNKNOWN = 'ISO14443B_UNKNOWN',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Chip family categories
 */
export enum ChipFamily {
  NTAG = 'NTAG',
  MIFARE_CLASSIC = 'MIFARE_CLASSIC',
  MIFARE_DESFIRE = 'MIFARE_DESFIRE',
  MIFARE_PLUS = 'MIFARE_PLUS',
  ISO15693 = 'ISO15693',
  JAVACARD = 'JAVACARD',
  UNKNOWN = 'UNKNOWN',
}

/**
 * Get the chip family for a chip type
 */
export function getChipFamily(type: ChipType): ChipFamily {
  // NTAG5 is ISO 15693 / NFC Type 5 — must check before generic NTAG
  if (type.startsWith('NTAG5')) {
    return ChipFamily.ISO15693;
  }
  if (type.startsWith('NTAG')) {
    return ChipFamily.NTAG;
  }
  if (type.startsWith('ULTRALIGHT')) {
    return ChipFamily.NTAG; // Ultralight is in the NTAG/Type 2 family
  }
  if (type.startsWith('MIFARE_CLASSIC')) {
    return ChipFamily.MIFARE_CLASSIC;
  }
  if (type.startsWith('DESFIRE') || type === ChipType.MIFARE_DUOX) {
    // DUOX is the DESFire successor — same family for matcher purposes
    return ChipFamily.MIFARE_DESFIRE;
  }
  if (type.startsWith('MIFARE_PLUS')) {
    return ChipFamily.MIFARE_PLUS;
  }
  if (type.startsWith('SLIX') || type.startsWith('ICODE') || type.startsWith('ISO15693')) {
    return ChipFamily.ISO15693;
  }
  if (type.startsWith('JCOP') || type.startsWith('JAVACARD')) {
    return ChipFamily.JAVACARD;
  }
  return ChipFamily.UNKNOWN;
}

/**
 * NTAG version information from GET_VERSION response
 */
export interface NtagVersionInfo {
  vendorId: number;
  productType: number;
  productSubtype: number;
  majorVersion: number;
  minorVersion: number;
  storageSize: number;
  protocolType: number;
}

/**
 * DESFire version information
 */
export interface DesfireVersionInfo {
  hardwareMajor: number;
  hardwareMinor: number;
  hardwareStorageSize: number;
  softwareMajor: number;
  softwareMinor: number;
}

/**
 * Multi-mode / clone-suspect card detection (from the mifare detector).
 *
 * This is a heuristic over SAK and ATQA values describing cards that can
 * operate in more than one mode (MIFARE Plus security levels) or that look
 * like magic/clone cards.
 *
 * **Not to be confused with SAK swapping**, which specifically means the
 * WUP-SAK differs from the Vanity SAK stored in Block 0. A card mirroring a
 * Vanity SAK value (0x88 / 0x98) as its WUP-SAK is caught here keylessly via
 * `modeType: 'magic_card'`. A smart card exposing both a Classic and a
 * DESFire credential is multi-mode; it is not SAK swapping either.
 */
export interface CardModeInfo {
  hasMultipleModes: boolean;
  modeType?: 'mifare_plus_sl1' | 'magic_card' | 'unknown';
  confidence: 'high' | 'medium' | 'low';
  description: string;
  notes?: string[];
}

/**
 * A credential interface exposed by a transponder.
 *
 * A single smart card can present several of these at once — e.g. a JCOP
 * part hosting both a MIFARE Classic emulation and a DESFire applet. The
 * detector records every credential it can prove, and `deriveCapabilities`
 * unions across them so the product matcher sees the full picture.
 */
export type CredentialKind =
  | 'mifare-classic'
  | 'mifare-plus'
  | 'desfire'
  | 'javacard';

export interface DetectedCredential {
  kind: CredentialKind;

  /** Display label, e.g. "MIFARE Classic 1K" or "DESFire EV3". */
  label: string;

  /** Optional qualifier, e.g. "SL1" or "J3R180". */
  detail?: string;

  /**
   * What the credential runs on. `smartcard` means a SmartMX / JavaCard
   * substrate is emulating the named family; `native` means real silicon
   * of that family; `unknown` means we couldn't probe (e.g. iOS Classic).
   */
  substrate: 'native' | 'smartcard' | 'unknown';

  confidence: 'high' | 'medium' | 'low';

  /** What proved this credential exists, e.g. "ISD SELECT 9000". */
  evidence: string;
}

/**
 * CPLC (Card Production Life Cycle) data read from a GlobalPlatform ISD.
 *
 * `icTypeName` identifies the silicon (e.g. "J3R180"), not the product —
 * several Dangerous Things products share the same part.
 */
export interface CplcInfo {
  icFabricator: number;
  icType: number;
  icTypeName?: string;
  osId: number;
  osBuildDate: number;
  icFabricationDate: number;
  icSerialNumber: number;
  icBatchIdentifier: number;
  icModulePackager: number;
  installerIdentifier: number;
  fabricatorName?: string;
  osName?: string;
  /** Hex of the full CPLC record. */
  raw: string;
}

/**
 * How confident we are in a *product* identification, and why.
 *
 * Kept separate from `Transponder.confidence` (which is about chip
 * identification) because the two diverge: a J3R180 can be identified with
 * total certainty while the product built on it stays ambiguous.
 */
export interface IdentityEvidence {
  source:
    | 'persistent-total'
    | 'cplc-ic-type'
    | 'applet-set'
    | 'historical-bytes';
  matched: boolean;
  /** What this signal contributed, for display and debugging. */
  note: string;
}

/**
 * Detected transponder information
 */
export interface Transponder {
  /** Identified chip type */
  type: ChipType;

  /** Chip family category */
  family: ChipFamily;

  /** Human-readable chip name */
  chipName: string;

  /** Memory size in bytes (if known) */
  memorySize?: number;

  /** Whether the chip data can be cloned to an implant */
  isCloneable: boolean;

  /** Reason why chip is not cloneable (if applicable) */
  cloneabilityNote?: string;

  /** Raw detection data */
  rawData: {
    uid: string;
    sak?: number;
    atqa?: string;
    ats?: string;
    historicalBytes?: string;
    techTypes: string[];
  };

  /** Chip-specific version info */
  versionInfo?: NtagVersionInfo | DesfireVersionInfo;

  /** Multi-mode / clone-suspect heuristics, incl. mirrored WUP-SAK. */
  cardModeInfo?: CardModeInfo;

  /**
   * Official Dangerous Things product identified from its ATS historical-byte
   * signature. Present only for genuine DT products; drives the "DT" badge and
   * raises detection confidence. For implants, `name` is also surfaced as the
   * implant name (e.g. "flexSecure").
   */
  dtProduct?: {
    name: string;
    kind: 'implant' | 'card';
  };

  /** Implant name found in memory (for Type 2 tags) */
  implantName?: string;

  /** Temperature reading from sensor (VK Thermo / Temptress) */
  temperature?: { celsius: number; fahrenheit: number };

  /** Second temperature reading (Temptress dual-sensor only) */
  temperature2?: { celsius: number; fahrenheit: number };

  /** Installed applets (JavaCard only) */
  installedApplets?: string[];

  /** Storage info from JavaCard Memory applet */
  storageInfo?: {
    persistentFree: number;
    persistentTotal: number;
    transientResetFree: number;
    transientDeselectFree: number;
  };

  /**
   * Every credential interface the card exposes. Populated by the credential
   * sweep for ISO-DEP capable cards; absent for tags where the concept
   * doesn't apply (NTAG, ISO 15693).
   */
  credentials?: DetectedCredential[];

  /** CPLC read from the GlobalPlatform ISD, when one was selectable. */
  cplc?: CplcInfo;

  /**
   * Why we named (or declined to name) the implant. Empty or absent when no
   * product identification was attempted.
   */
  identityEvidence?: IdentityEvidence[];

  /** Detection confidence level */
  confidence: 'high' | 'medium' | 'low';

  /** Platform on which detection was performed */
  detectedOn: 'ios' | 'android';

  /**
   * Implementation flavor for the chip's interface family.
   * - `native` — real silicon of the named family (e.g. true MIFARE Classic 1K)
   * - `smartmx_emulation` — SmartMX or Plus EV1 SL1 emulating the family
   * - `javacard_emulation` — JavaCard applet emulating the family
   * - `mifare_2go_virtual` — MIFARE 2GO cloud-backed virtual instance
   *
   * Source of truth: GetVersion byte 1 upper nibble (see AN10833 §2.1).
   * Absent if not yet probed or if the chip family doesn't expose GetVersion.
   */
  implementation?:
    | 'native'
    | 'smartmx_emulation'
    | 'javacard_emulation'
    | 'mifare_2go_virtual';

  /**
   * Encoded GetVersion byte 1, retained for debugging/display when
   * `implementation` is non-native. Upper nibble = implementation kind,
   * lower nibble = product family.
   */
  implementationByte?: number;

  /**
   * Derived capability tags (interface shape, substrate, hardware features).
   * Computed from `type` + `implementation` + raw data via
   * `deriveCapabilities()` in the detector. Used by capability-driven
   * product matching.
   */
  capabilities?: import('./products').ChipCapability[];
}

/**
 * Detection result
 */
export interface DetectionResult {
  success: boolean;
  transponder?: Transponder;
  error?: string;
}

/**
 * Human-readable names for chip types
 */
export const CHIP_NAMES: Record<ChipType, string> = {
  // NTAG 21x family
  [ChipType.NTAG213]: 'NTAG213',
  [ChipType.NTAG215]: 'NTAG215',
  [ChipType.NTAG216]: 'NTAG216',
  [ChipType.NTAG_I2C_1K]: 'NTAG I2C 1K',
  [ChipType.NTAG_I2C_2K]: 'NTAG I2C 2K',
  [ChipType.NTAG_I2C_PLUS_1K]: 'NTAG I2C Plus 1K',
  [ChipType.NTAG_I2C_PLUS_2K]: 'NTAG I2C Plus 2K',

  // NTAG 5 family
  [ChipType.NTAG5_LINK]: 'NTAG 5 link',
  [ChipType.NTAG5_BOOST]: 'NTAG 5 boost',
  [ChipType.NTAG5_SWITCH]: 'NTAG 5 switch',

  // NTAG DNA family
  [ChipType.NTAG413_DNA]: 'NTAG 413 DNA',
  [ChipType.NTAG424_DNA]: 'NTAG 424 DNA',
  [ChipType.NTAG424_DNA_TT]: 'NTAG 424 DNA TagTamper',

  [ChipType.NTAG_UNKNOWN]: 'NTAG (Unknown variant)',

  // MIFARE Classic
  [ChipType.MIFARE_CLASSIC_1K]: 'MIFARE Classic 1K',
  [ChipType.MIFARE_CLASSIC_4K]: 'MIFARE Classic 4K',
  [ChipType.MIFARE_CLASSIC_MINI]: 'MIFARE Classic Mini',

  // MIFARE DESFire
  [ChipType.DESFIRE_EV1]: 'MIFARE DESFire EV1',
  [ChipType.DESFIRE_EV2]: 'MIFARE DESFire EV2',
  [ChipType.DESFIRE_EV3]: 'MIFARE DESFire EV3',
  [ChipType.DESFIRE_EV3C]: 'MIFARE DESFire EV3C',
  [ChipType.DESFIRE_LIGHT]: 'MIFARE DESFire Light',
  [ChipType.DESFIRE_UNKNOWN]: 'MIFARE DESFire (Unknown version)',

  // MIFARE DUOX
  [ChipType.MIFARE_DUOX]: 'MIFARE DUOX',

  // MIFARE Plus
  [ChipType.MIFARE_PLUS_S]: 'MIFARE Plus S',
  [ChipType.MIFARE_PLUS_X]: 'MIFARE Plus X',
  [ChipType.MIFARE_PLUS_SE]: 'MIFARE Plus SE',
  [ChipType.MIFARE_PLUS_EV1]: 'MIFARE Plus EV1',
  [ChipType.MIFARE_PLUS_EV2]: 'MIFARE Plus EV2',
  [ChipType.MIFARE_PLUS]: 'MIFARE Plus',

  // NTAG X DNA
  [ChipType.NTAG_X_DNA]: 'NTAG X DNA',

  // MIFARE 2GO
  [ChipType.MIFARE_2GO]: 'MIFARE 2GO (virtual)',

  // MIFARE Ultralight
  [ChipType.ULTRALIGHT]: 'MIFARE Ultralight',
  [ChipType.ULTRALIGHT_C]: 'MIFARE Ultralight C',
  [ChipType.ULTRALIGHT_EV1]: 'MIFARE Ultralight EV1',
  [ChipType.ULTRALIGHT_NANO]: 'MIFARE Ultralight Nano',
  [ChipType.ULTRALIGHT_AES]: 'MIFARE Ultralight AES',

  // ICODE family
  [ChipType.SLIX]: 'ICODE SLIX',
  [ChipType.SLIX2]: 'ICODE SLIX2',
  [ChipType.SLIX_S]: 'ICODE SLIX-S',
  [ChipType.SLIX_L]: 'ICODE SLIX-L',
  [ChipType.ICODE_DNA]: 'ICODE DNA',
  [ChipType.ISO15693_UNKNOWN]: 'ISO 15693 Tag',

  // JavaCard
  [ChipType.JCOP4]: 'JavaCard',
  [ChipType.JAVACARD_UNKNOWN]: 'JavaCard',

  // Generic/Unknown
  [ChipType.ISO14443A_UNKNOWN]: 'ISO 14443-A Tag',
  [ChipType.ISO14443B_UNKNOWN]: 'ISO 14443-B Tag',
  [ChipType.UNKNOWN]: 'Unknown NFC Tag',
};

/**
 * Memory sizes for known chip types (in bytes)
 */
export const CHIP_MEMORY_SIZES: Partial<Record<ChipType, number>> = {
  // NTAG 21x
  [ChipType.NTAG213]: 144,
  [ChipType.NTAG215]: 504,
  [ChipType.NTAG216]: 888,
  [ChipType.NTAG_I2C_1K]: 888,
  [ChipType.NTAG_I2C_2K]: 1912,
  [ChipType.NTAG_I2C_PLUS_1K]: 888,
  [ChipType.NTAG_I2C_PLUS_2K]: 1912,

  // NTAG 5 family
  [ChipType.NTAG5_LINK]: 496, // 496 bytes user memory
  [ChipType.NTAG5_BOOST]: 2000, // 2000 bytes user memory
  [ChipType.NTAG5_SWITCH]: 256, // 256 bytes user memory

  // NTAG DNA family
  [ChipType.NTAG413_DNA]: 160, // 160 bytes user memory
  [ChipType.NTAG424_DNA]: 416, // 416 bytes user memory (NDEF)
  [ChipType.NTAG424_DNA_TT]: 416,

  // MIFARE Classic
  [ChipType.MIFARE_CLASSIC_1K]: 1024,
  [ChipType.MIFARE_CLASSIC_4K]: 4096,
  [ChipType.MIFARE_CLASSIC_MINI]: 320,

  // MIFARE Ultralight
  [ChipType.ULTRALIGHT]: 48, // 48 bytes user memory
  [ChipType.ULTRALIGHT_C]: 144, // 144 bytes user memory
  [ChipType.ULTRALIGHT_EV1]: 128, // 128 bytes (EV1 80 page variant)
  [ChipType.ULTRALIGHT_NANO]: 48,
  [ChipType.ULTRALIGHT_AES]: 540, // 540 bytes user memory
};

/**
 * Cloneability information for chip types
 */
export const CHIP_CLONEABILITY: Record<
  ChipType,
  {cloneable: boolean; note?: string}
> = {
  // NTAG 21x - all cloneable
  [ChipType.NTAG213]: {cloneable: true},
  [ChipType.NTAG215]: {cloneable: true},
  [ChipType.NTAG216]: {cloneable: true},
  [ChipType.NTAG_I2C_1K]: {cloneable: true, note: 'I2C interface not cloneable'},
  [ChipType.NTAG_I2C_2K]: {cloneable: true, note: 'I2C interface not cloneable'},
  [ChipType.NTAG_I2C_PLUS_1K]: {cloneable: true, note: 'I2C interface not cloneable'},
  [ChipType.NTAG_I2C_PLUS_2K]: {cloneable: true, note: 'I2C interface not cloneable'},

  // NTAG 5 family - password and optional AES-128 mutual authentication
  [ChipType.NTAG5_LINK]: {
    cloneable: false,
    note: 'Password and AES mutual authentication protect data access',
  },
  [ChipType.NTAG5_BOOST]: {
    cloneable: false,
    note: 'Password and AES mutual authentication protect data access',
  },
  [ChipType.NTAG5_SWITCH]: {
    cloneable: false,
    note: 'Password and AES mutual authentication protect data access',
  },

  // NTAG DNA family - NOT cloneable (AES-128 crypto, originality signature)
  [ChipType.NTAG413_DNA]: {
    cloneable: false,
    note: 'AES-128 authentication and SUN messaging prevent cloning',
  },
  [ChipType.NTAG424_DNA]: {
    cloneable: false,
    note: 'AES-128 authentication and SUN messaging prevent cloning',
  },
  [ChipType.NTAG424_DNA_TT]: {
    cloneable: false,
    note: 'AES-128 authentication and tamper detection prevent cloning',
  },

  [ChipType.NTAG_UNKNOWN]: {cloneable: true, note: 'May require verification'},

  // MIFARE Classic - cloneable with keys
  [ChipType.MIFARE_CLASSIC_1K]: {
    cloneable: true,
    note: 'Requires key knowledge; Android only for sector operations',
  },
  [ChipType.MIFARE_CLASSIC_4K]: {
    cloneable: true,
    note: 'Requires key knowledge; Android only for sector operations',
  },
  [ChipType.MIFARE_CLASSIC_MINI]: {
    cloneable: true,
    note: 'Requires key knowledge; Android only for sector operations',
  },

  // MIFARE DESFire - NOT cloneable (strong crypto)
  [ChipType.DESFIRE_EV1]: {
    cloneable: false,
    note: 'Cryptographic protection prevents cloning',
  },
  [ChipType.DESFIRE_EV2]: {
    cloneable: false,
    note: 'Cryptographic protection prevents cloning',
  },
  [ChipType.DESFIRE_EV3]: {
    cloneable: false,
    note: 'Cryptographic protection prevents cloning',
  },
  [ChipType.DESFIRE_EV3C]: {
    cloneable: false,
    note: 'Cryptographic protection prevents cloning. The MIFARE Classic credential it emulates may be readable, but the card itself cannot be duplicated.',
  },
  [ChipType.DESFIRE_LIGHT]: {
    cloneable: false,
    note: 'Cryptographic protection prevents cloning',
  },
  [ChipType.DESFIRE_UNKNOWN]: {
    cloneable: false,
    note: 'Cryptographic protection prevents cloning',
  },

  // MIFARE DUOX - NOT cloneable (DESFire successor with stronger crypto)
  [ChipType.MIFARE_DUOX]: {
    cloneable: false,
    note: 'Cryptographic protection prevents cloning',
  },

  // NTAG X DNA - NOT cloneable (NTAG DNA successor with AES + ECC)
  [ChipType.NTAG_X_DNA]: {
    cloneable: false,
    note: 'AES and ECC authentication prevent cloning',
  },

  // MIFARE 2GO - NOT cloneable (cloud-backed virtual card)
  [ChipType.MIFARE_2GO]: {
    cloneable: false,
    note: 'Virtual card backed by NXP cloud — never cloneable',
  },

  // MIFARE Plus - NOT cloneable (AES crypto)
  [ChipType.MIFARE_PLUS_S]: {
    cloneable: false,
    note: 'AES cryptographic protection prevents cloning',
  },
  [ChipType.MIFARE_PLUS_X]: {
    cloneable: false,
    note: 'AES cryptographic protection prevents cloning',
  },
  [ChipType.MIFARE_PLUS_SE]: {
    cloneable: false,
    note: 'AES cryptographic protection prevents cloning',
  },
  [ChipType.MIFARE_PLUS_EV1]: {
    cloneable: false,
    note: 'AES cryptographic protection prevents cloning',
  },
  [ChipType.MIFARE_PLUS_EV2]: {
    cloneable: false,
    note: 'AES cryptographic protection prevents cloning',
  },
  [ChipType.MIFARE_PLUS]: {
    cloneable: false,
    note: 'AES cryptographic protection prevents cloning',
  },

  // MIFARE Ultralight - cloneable (basic variants)
  [ChipType.ULTRALIGHT]: {cloneable: true},
  [ChipType.ULTRALIGHT_C]: {
    cloneable: true,
    note: '3DES protection may require key knowledge',
  },
  [ChipType.ULTRALIGHT_EV1]: {cloneable: true},
  [ChipType.ULTRALIGHT_NANO]: {cloneable: true},
  [ChipType.ULTRALIGHT_AES]: {
    cloneable: false,
    note: 'AES authentication prevents cloning without keys',
  },

  // ICODE family - cloneable (basic variants), DNA has crypto
  [ChipType.SLIX]: {cloneable: true},
  [ChipType.SLIX2]: {cloneable: true},
  [ChipType.SLIX_S]: {cloneable: true},
  [ChipType.SLIX_L]: {cloneable: true},
  [ChipType.ICODE_DNA]: {
    cloneable: false,
    note: 'Cryptographic authentication prevents cloning',
  },
  [ChipType.ISO15693_UNKNOWN]: {
    cloneable: true,
    note: 'May require verification',
  },

  // JavaCard - NOT cloneable
  [ChipType.JCOP4]: {
    cloneable: false,
    note: 'Secure element prevents cloning',
  },
  [ChipType.JAVACARD_UNKNOWN]: {
    cloneable: false,
    note: 'Secure element prevents cloning',
  },

  // Unknown types
  [ChipType.ISO14443A_UNKNOWN]: {
    cloneable: false,
    note: 'Unknown chip - cannot determine cloneability',
  },
  [ChipType.ISO14443B_UNKNOWN]: {
    cloneable: false,
    note: 'Unknown chip - cannot determine cloneability',
  },
  [ChipType.UNKNOWN]: {
    cloneable: false,
    note: 'Unknown chip - cannot determine cloneability',
  },
};
