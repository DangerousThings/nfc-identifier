/**
 * Product Types for Dangerous Things Implants
 */

import {ChipType} from './detection';

/**
 * Product form factor
 */
export enum FormFactor {
  X_SERIES = 'X_SERIES', // 2x12mm injectable capsule (glass or bioresin)
  FLEX = 'FLEX', // Flexible PCB implant (incision install)
  BIORESIN = 'BIORESIN', // Larger bioresin capsule (incision install)
  CARD = 'CARD', // ISO card format
}

/**
 * Product category
 */
export enum ProductCategory {
  NFC = 'NFC', // NFC-only implants
  DUAL_FREQUENCY = 'DUAL_FREQUENCY', // NFC + 125kHz
  SECURE = 'SECURE', // Cryptographic/secure elements
  LED = 'LED', // Implants with LED indicators
  ACCESS = 'ACCESS', // Access control focused
  SENSOR = 'SENSOR', // Temperature/biometric sensor implants
}

/**
 * DESFire EV level for version matching
 */
export type DesfireEvLevel = 1 | 2 | 3;

/**
 * Capability tags describing what a chip exposes or what a product requires.
 *
 * Used for capability-driven matching: a product matches a scanned tag when
 * the tag's capability set is a superset of the product's `requiredSourceCapabilities`.
 *
 * Capability semantics (per the AN10833 rework design):
 *
 * **Interface shape** — what command set the chip speaks:
 * - `ntag-type2`         — NFC Type 2 (NTAG 21x, NTAG I2C, MIFARE Ultralight)
 * - `classic-emulation`  — exposes the MIFARE Classic command set (real or emulated)
 * - `desfire-emulation`  — exposes the DESFire / NTAG DNA command set (Layer 4)
 * - `iso15693-shape`     — ISO 15693 / NFC-V (SLIX, NTAG 5)
 * - `iso7816-substrate`  — ISO 7816 capable; can host JavaCard applets
 *
 * **Substrate** — what physical silicon the interface runs on:
 * - `native-silicon`        — real silicon of the named family
 * - `smartcard-substrate`   — SmartMX / Plus EV1 / JCOP emulating another family
 * - `mifare-2go-virtual`    — cloud-backed virtual card on a phone
 *
 * **Hardware features**:
 * - `i2c-sensor-bus`        — chip exposes an I²C bus for sensors (NTAG 5 Boost/Link)
 * - `aes-protected`         — chip uses AES authentication on its memory/applets
 * - `crypto1-only`          — chip uses only Crypto1 (real MIFARE Classic)
 * - `cloneable-via-magic`   — implant accepts magic-card UID/sector writes
 */
export type ChipCapability =
  // Interface shape
  | 'ntag-type2'
  | 'classic-emulation'
  | 'desfire-emulation'
  | 'iso15693-shape'
  | 'iso7816-substrate'
  // Substrate
  | 'native-silicon'
  | 'smartcard-substrate'
  | 'mifare-2go-virtual'
  // Hardware features
  | 'i2c-sensor-bus'
  | 'aes-protected'
  | 'crypto1-only'
  | 'cloneable-via-magic';

/**
 * A Dangerous Things product
 */
export interface Product {
  id: string;
  name: string;
  description: string;
  formFactor: FormFactor;
  categories: ProductCategory[];
  /**
   * Legacy chip-type compatibility list. Retained for the existing matcher
   * fallback path while products are being migrated to capability-based
   * matching (M7b). New products should declare `requiredSourceCapabilities`.
   */
  compatibleChips: ChipType[];
  /**
   * Capabilities this implant itself exposes — used for forward-compatibility
   * with future capability-driven UX (e.g. "this implant supports AES").
   */
  exposedCapabilities?: ChipCapability[];
  /**
   * Capabilities a *source* card must expose for this product to be a
   * meaningful match. The matcher selects products whose required set is
   * a subset of the source tag's derived `capabilities` field.
   *
   * If absent or empty, the matcher falls back to `compatibleChips`.
   */
  requiredSourceCapabilities?: ChipCapability[];
  features: string[];
  url: string;
  /** Whether this product can have data cloned TO it from the scanned chip */
  canReceiveClone: boolean;
  /** Whether this product uses the same chip type as scanned */
  exactMatch: boolean;
  /** Notes about compatibility or limitations */
  notes?: string;
  /** DESFire EV level (1, 2, or 3) for version mismatch warnings */
  desfireEvLevel?: DesfireEvLevel;
}

/**
 * Result of product matching
 */
export interface MatchResult {
  /** Products that use the exact same chip */
  exactMatches: Product[];
  /** Products that can receive cloned data from this chip */
  cloneTargets: Product[];
  /** Products in the same chip family */
  familyMatches: Product[];
  /** Is this chip cloneable at all? */
  isCloneable: boolean;
  /** Note about cloneability */
  cloneabilityNote?: string;
  /** Conversion service recommendation */
  conversionRecommended: boolean;
  /** Conversion URL */
  conversionUrl: string;
}

/**
 * Chip to product mapping for quick lookup
 */
export type ChipProductMap = Map<ChipType, Product[]>;
