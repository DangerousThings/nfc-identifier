/**
 * Unified GetVersion Decoder
 *
 * Single source of truth for parsing GetVersion responses, used by both:
 * - Layer 3 (Type 2 / NfcA) GetVersion via 0x60
 * - Layer 4 (ISO-DEP) DESFire-style GetVersion via 0x90 0x60 0x00 0x00 0x00
 *
 * The 7-byte GetVersion structure is the same on both layers; callers strip
 * any layer-specific header/wrapping before passing to `decodeGetVersion`.
 *
 * Reference: AN10833 rev 3.9 §2.1 — "MIFARE & NTAG GetVersion command"
 */

/**
 * Product family — lower nibble of GetVersion byte 1.
 *
 * Per AN10833 §2.1 Table 1. Note that some values differ between Layer 3
 * (NfcA Type 2) and Layer 4 (ISO-DEP) responses for the same physical chip.
 */
export enum ProductFamily {
  /** MIFARE DESFire family (and DESFire Light at 0x8) */
  DESFIRE = 0x1,
  /** MIFARE Plus EV2 family */
  PLUS = 0x2,
  /** MIFARE Ultralight family */
  ULTRALIGHT = 0x3,
  /** NTAG 21x and NTAG DNA family (distinguished by Layer + subtype) */
  NTAG = 0x4,
  /** NTAG I2C non-Plus */
  NTAG_I2C = 0x5,
  /** NTAG I2C Plus */
  NTAG_I2C_PLUS = 0x7,
  /** MIFARE DESFire Light */
  DESFIRE_LIGHT = 0x8,
  /** Unknown / not yet mapped */
  UNKNOWN = -1,
}

/**
 * Implementation kind — upper nibble of GetVersion byte 1.
 *
 * Per AN10833 §2.1: identifies whether the chip is real silicon of the named
 * family, a SmartMX / Plus EV1 emulating it, a JavaCard applet emulating it,
 * or a MIFARE 2GO virtual instance.
 */
export enum ImplementationKind {
  /** Real silicon of the named family */
  NATIVE = 0x0,
  /** SmartMX or MIFARE Plus EV1 SL1 emulating the family */
  SMARTMX = 0x8,
  /** JavaCard applet emulating the family */
  JAVACARD = 0x9,
  /** MIFARE 2GO cloud-backed virtual instance */
  MIFARE_2GO = 0xa,
  /** Unknown / not specified by the spec */
  UNKNOWN = -1,
}

/** Decoded GetVersion structure. All fields are derived from the 7 input bytes. */
export interface GetVersionDecoded {
  vendorId: number;
  /** Raw byte 1 — preserved for debugging when implementation is non-native */
  productFamilyByte: number;
  /** Lower nibble of byte 1 */
  productFamily: ProductFamily;
  /** Upper nibble of byte 1 */
  implementation: ImplementationKind;
  subtype: number;
  hwMajor: number;
  hwMinor: number;
  storageSize: number;
  protocol: number;
  /** The 7 input bytes, retained verbatim */
  raw: number[];
}

/** NXP vendor ID — every chip we care about reports this */
export const NXP_VENDOR_ID = 0x04;

/**
 * Decode a 7-byte GetVersion structure.
 *
 * Layout (same on Layer 3 and Layer 4):
 * - byte 0: vendor ID (0x04 for NXP)
 * - byte 1: product family (lower nibble) + implementation (upper nibble)
 * - byte 2: product subtype
 * - byte 3: hardware major version
 * - byte 4: hardware minor version
 * - byte 5: storage size
 * - byte 6: protocol type
 *
 * **Caller responsibilities:**
 * - For Layer 3 (NTAG / Ultralight): the raw response begins with a 0x00
 *   status header. Pass `response.slice(1, 8)` (or `response.slice(1)` if
 *   length is exactly 8).
 * - For Layer 4 (DESFire / Plus): pass the data field of the APDU response,
 *   i.e. the 7 bytes preceding the SW1/SW2 status word.
 *
 * @throws if `bytes.length < 7`
 */
export function decodeGetVersion(bytes: number[]): GetVersionDecoded {
  if (bytes.length < 7) {
    throw new Error(
      `GetVersion response too short: expected >=7 bytes, got ${bytes.length}`,
    );
  }

  const productFamilyByte = bytes[1];
  const lowerNibble = productFamilyByte & 0x0f;
  const upperNibble = (productFamilyByte >> 4) & 0x0f;

  return {
    vendorId: bytes[0],
    productFamilyByte,
    productFamily: nibbleToProductFamily(lowerNibble),
    implementation: nibbleToImplementationKind(upperNibble),
    subtype: bytes[2],
    hwMajor: bytes[3],
    hwMinor: bytes[4],
    storageSize: bytes[5],
    protocol: bytes[6],
    raw: bytes.slice(0, 7),
  };
}

function nibbleToProductFamily(nibble: number): ProductFamily {
  switch (nibble) {
    case 0x1:
      return ProductFamily.DESFIRE;
    case 0x2:
      return ProductFamily.PLUS;
    case 0x3:
      return ProductFamily.ULTRALIGHT;
    case 0x4:
      return ProductFamily.NTAG;
    case 0x5:
      return ProductFamily.NTAG_I2C;
    case 0x7:
      return ProductFamily.NTAG_I2C_PLUS;
    case 0x8:
      return ProductFamily.DESFIRE_LIGHT;
    default:
      return ProductFamily.UNKNOWN;
  }
}

function nibbleToImplementationKind(nibble: number): ImplementationKind {
  switch (nibble) {
    case 0x0:
      return ImplementationKind.NATIVE;
    case 0x8:
      return ImplementationKind.SMARTMX;
    case 0x9:
      return ImplementationKind.JAVACARD;
    case 0xa:
      return ImplementationKind.MIFARE_2GO;
    default:
      return ImplementationKind.UNKNOWN;
  }
}

/**
 * Map an `ImplementationKind` to the string literal used by
 * `Transponder.implementation`. Returns `undefined` for `UNKNOWN` so callers
 * can leave the field absent rather than misrepresent the chip.
 */
export function implementationToTransponderField(
  kind: ImplementationKind,
):
  | 'native'
  | 'smartmx_emulation'
  | 'javacard_emulation'
  | 'mifare_2go_virtual'
  | undefined {
  switch (kind) {
    case ImplementationKind.NATIVE:
      return 'native';
    case ImplementationKind.SMARTMX:
      return 'smartmx_emulation';
    case ImplementationKind.JAVACARD:
      return 'javacard_emulation';
    case ImplementationKind.MIFARE_2GO:
      return 'mifare_2go_virtual';
    case ImplementationKind.UNKNOWN:
    default:
      return undefined;
  }
}
