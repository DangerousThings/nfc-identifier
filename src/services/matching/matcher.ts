/**
 * Product Matching Service
 *
 * Matches detected NFC chips to compatible Dangerous Things products
 */

import { ChipType, getChipFamily, CHIP_CLONEABILITY, ChipFamily, Transponder } from '../../types/detection';
import { MatchResult, Product, DesfireEvLevel } from '../../types/products';
import {
  PRODUCTS,
  getChipProductMap,
  CONVERSION_SERVICE_URL,
} from '../../data/products';

/**
 * Match a detected chip to compatible products
 */
export function matchChipToProducts(chip: Transponder): MatchResult {
  const chipType = chip.type as ChipType
  const chipProductMap = getChipProductMap();
  const cloneability = CHIP_CLONEABILITY[chipType];
  const chipFamily = getChipFamily(chipType);

  // Get products that directly support this chip
  const directMatches = chipProductMap.get(chipType) || [];

  // Separate exact matches from clone targets
  const exactMatches: Product[] = [];
  const cloneTargets: Product[] = [];

  for (const product of directMatches) {
    if (product.exactMatch) {
      exactMatches.push(product);
    }
    if (product.canReceiveClone && cloneability?.cloneable) {
      if ((product.name.startsWith("xMagic") || product.name.startsWith("xM1") || product.name.startsWith("flexM1")) && chip.rawData.uid.replaceAll(":", "").length / 2 !== 4) {
        // This skips things without a 4-byte UID

      } else {
        cloneTargets.push(product);
      }
    }
  }

  // Find products in the same chip family
  const familyMatches = findFamilyMatches(chipType, chipFamily, directMatches);

  // Determine if conversion is recommended
  // Conversion is recommended when:
  // 1. No exact matches AND no clone targets
  // 2. Chip is not cloneable (crypto protection)
  const hasMatches = exactMatches.length > 0 || cloneTargets.length > 0;
  const conversionRecommended = !hasMatches || !cloneability?.cloneable;

  return {
    exactMatches,
    cloneTargets,
    familyMatches,
    isCloneable: cloneability?.cloneable ?? false,
    cloneabilityNote: cloneability?.note,
    conversionRecommended,
    conversionUrl: CONVERSION_SERVICE_URL,
  };
}

/**
 * Find products in the same chip family that might be of interest
 */
function findFamilyMatches(
  chipType: ChipType,
  chipFamily: ChipFamily,
  excludeProducts: Product[],
): Product[] {
  const excludeIds = new Set(excludeProducts.map(p => p.id));
  const familyMatches: Product[] = [];

  for (const product of PRODUCTS) {
    // Skip already matched products
    if (excludeIds.has(product.id)) {
      continue;
    }

    // Check if any of the product's compatible chips are in the same family
    const productChipFamilies = product.compatibleChips.map(getChipFamily);
    if (productChipFamilies.includes(chipFamily)) {
      familyMatches.push(product);
    }
  }

  return familyMatches;
}

/**
 * Get a summary message for the match result
 */
export function getMatchSummary(result: MatchResult, chipName: string): string {
  if (result.exactMatches.length > 0) {
    const names = result.exactMatches.map(p => p.name).join(', ');
    return `Your ${chipName} is compatible with: ${names}`;
  }

  if (result.cloneTargets.length > 0) {
    const names = result.cloneTargets.map(p => p.name).join(', ');
    return `Your ${chipName} data can be cloned to: ${names}`;
  }

  if (!result.isCloneable) {
    return `${chipName} uses cryptographic protection and cannot be cloned. Consider our conversion service for compatible options.`;
  }

  return `No direct product match found for ${chipName}. Check our conversion service for options.`;
}

/**
 * Get recommended action based on match result
 */
export function getRecommendedAction(
  result: MatchResult,
): 'purchase' | 'clone' | 'conversion' | 'contact' {
  if (result.exactMatches.length > 0) {
    return 'purchase';
  }

  if (result.cloneTargets.length > 0 && result.isCloneable) {
    return 'clone';
  }

  if (result.conversionRecommended) {
    return 'conversion';
  }

  return 'contact';
}

/**
 * Format product features for display
 */
export function formatProductFeatures(product: Product): string[] {
  return product.features;
}

/**
 * Get products that can receive cloned data from a chip type
 */
export function getCloneTargetsForChip(chipType: ChipType): Product[] {
  const cloneability = CHIP_CLONEABILITY[chipType];
  if (!cloneability?.cloneable) {
    return [];
  }

  const chipProductMap = getChipProductMap();
  const directMatches = chipProductMap.get(chipType) || [];

  return directMatches.filter(p => p.canReceiveClone);
}

/**
 * Check if a chip can be cloned to any product
 */
export function canCloneToProduct(chipType: ChipType): boolean {
  return getCloneTargetsForChip(chipType).length > 0;
}

/**
 * Get DESFire EV level from chip type
 */
export function getDesfireEvLevel(chipType: ChipType): DesfireEvLevel | null {
  switch (chipType) {
    case ChipType.DESFIRE_EV1:
      return 1;
    case ChipType.DESFIRE_EV2:
      return 2;
    case ChipType.DESFIRE_EV3:
      return 3;
    default:
      return null;
  }
}

/**
 * Check if there's a DESFire EV mismatch between chip and product
 * Returns warning message if mismatch, null if no issue
 */
export function getDesfireEvMismatchWarning(
  chipType: ChipType,
  product: Product,
): string | null {
  const chipEvLevel = getDesfireEvLevel(chipType);
  const productEvLevel = product.desfireEvLevel;

  // Not a DESFire chip or product doesn't have EV level
  if (chipEvLevel === null || productEvLevel === undefined) {
    return null;
  }

  // Perfect match
  if (chipEvLevel === productEvLevel) {
    return null;
  }

  // Mismatch - warn user
  if (chipEvLevel < productEvLevel) {
    return `Your card uses DESFire EV${chipEvLevel}, but this implant uses EV${productEvLevel}. Some newer features may not be compatible with your existing system.`;
  } else {
    return `Your card uses DESFire EV${chipEvLevel}, but this implant uses EV${productEvLevel}. This should work, but you won't have access to EV${chipEvLevel} features.`;
  }
}
