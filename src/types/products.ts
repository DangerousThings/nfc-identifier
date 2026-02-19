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
 * A Dangerous Things product
 */
export interface Product {
  id: string;
  name: string;
  description: string;
  formFactor: FormFactor;
  categories: ProductCategory[];
  compatibleChips: ChipType[];
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
