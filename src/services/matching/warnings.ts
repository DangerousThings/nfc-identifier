/**
 * Match Warning Pipeline
 *
 * Centralises per-(transponder, product) warning generation. Each warning
 * function inspects the pair and returns 0 or 1 MatchWarning entries. The
 * matcher composes them into the warnings array on each ProductMatch.
 *
 * Adding a new warning: write a function that takes `(transponder, product)`
 * and returns `MatchWarning | null`, then add it to `WARNING_GENERATORS`.
 */

import {ChipType, Transponder} from '../../types/detection';
import {MatchWarning, Product} from '../../types/products';

type WarningGenerator = (
  transponder: Transponder,
  product: Product,
) => MatchWarning | null;

/**
 * Warn when a 4K MIFARE Classic source is being matched to a 1K-only
 * implant — the destination cannot hold all the source's sectors.
 */
const MIFARE_1K_ONLY_PRODUCT_IDS = new Set(['xmagic', 'xm1', 'flexm1-v2']);

const mifareClassicCapacityWarning: WarningGenerator = (transponder, product) => {
  if (transponder.type !== ChipType.MIFARE_CLASSIC_4K) {
    return null;
  }
  if (!MIFARE_1K_ONLY_PRODUCT_IDS.has(product.id)) {
    return null;
  }
  return {
    severity: 'warning',
    code: 'mifare-classic-capacity-mismatch',
    message:
      'This implant has 1K memory only — might not have capacity to clone your 4K card.',
  };
};

/**
 * Warn when source DESFire EV level differs from the implant's EV level.
 * Direction matters: source-newer-than-implant is more concerning than
 * source-older-than-implant.
 */
function getDesfireEvLevel(chipType: ChipType): 1 | 2 | 3 | null {
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

const desfireEvMismatchWarning: WarningGenerator = (transponder, product) => {
  const sourceEv = getDesfireEvLevel(transponder.type);
  const productEv = product.desfireEvLevel;
  if (sourceEv === null || productEv === undefined || sourceEv === productEv) {
    return null;
  }
  if (sourceEv < productEv) {
    return {
      severity: 'caution',
      code: 'desfire-ev-mismatch-newer-implant',
      message: `Your card uses DESFire EV${sourceEv}, but this implant uses EV${productEv}. Some newer features may not be compatible with your existing system.`,
    };
  }
  return {
    severity: 'caution',
    code: 'desfire-ev-mismatch-older-implant',
    message: `Your card uses DESFire EV${sourceEv}, but this implant uses EV${productEv}. This should work, but you won't have access to EV${sourceEv} features.`,
  };
};

/**
 * Warn that a SmartMX / Plus EV1 SL1 / JavaCard substrate exposing the
 * Classic command set may not preserve issuer keys when cloned to a magic
 * Classic implant. Emitted only for sources whose probe revealed a
 * non-native substrate (M4 stamping).
 */
const smartcardSubstrateUncertaintyWarning: WarningGenerator = (
  transponder,
  product,
) => {
  if (
    transponder.implementation !== 'smartmx_emulation' &&
    transponder.implementation !== 'javacard_emulation'
  ) {
    return null;
  }
  // Only relevant when the destination relies on Classic-style cloning —
  // i.e. magic-Classic implants. Other targets (DESFire / JavaCard / NTAG)
  // either don't clone or use different mechanics.
  if (!MIFARE_1K_ONLY_PRODUCT_IDS.has(product.id)) {
    return null;
  }
  return {
    severity: 'caution',
    code: 'smartcard-substrate-uncertainty',
    message:
      'Your source card runs on a smartcard substrate (SmartMX / JavaCard / Plus EV1). Cloning to a magic implant will copy the visible Classic memory, but issuer keys and crypto state cannot be carried over — the clone may not authenticate to your existing reader.',
  };
};

/**
 * Warn that a MIFARE 2GO virtual card cannot be cloned at all (it is
 * cloud-backed, not a physical chip).
 */
const mifare2goVirtualWarning: WarningGenerator = (transponder, _product) => {
  if (transponder.type !== ChipType.MIFARE_2GO) {
    return null;
  }
  return {
    severity: 'warning',
    code: 'mifare-2go-virtual',
    message:
      'MIFARE 2GO is a virtual card backed by NXP\'s cloud — it cannot be cloned to any physical implant.',
  };
};

const WARNING_GENERATORS: WarningGenerator[] = [
  mifareClassicCapacityWarning,
  desfireEvMismatchWarning,
  smartcardSubstrateUncertaintyWarning,
  mifare2goVirtualWarning,
];

/**
 * Build the warning list for a (transponder, product) pair.
 *
 * Runs every registered generator and returns the non-null results in
 * registration order. The matcher attaches this array to each ProductMatch.
 */
export function buildMatchWarnings(
  transponder: Transponder,
  product: Product,
): MatchWarning[] {
  const warnings: MatchWarning[] = [];
  for (const generator of WARNING_GENERATORS) {
    const warning = generator(transponder, product);
    if (warning) {
      warnings.push(warning);
    }
  }
  return warnings;
}
