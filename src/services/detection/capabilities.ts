/**
 * Chip Capability Derivation
 *
 * Given a Transponder (chip type + implementation + raw data), produce the
 * set of `ChipCapability` tags that describe what the chip can do. This is
 * the single source of truth that the capability-driven product matcher
 * consumes, replacing the older chip-type-by-chip-type matrix.
 *
 * Reference: docs/plans/2026-05-03-an10833-detection-rework-design.md §6
 */

import {ChipType, Transponder} from '../../types/detection';
import type {ChipCapability} from '../../types/products';

/**
 * Static per-`ChipType` capability table. Covers the "interface shape" and
 * "hardware features" tags. Substrate tags (`native-silicon`,
 * `smartcard-substrate`, `mifare-2go-virtual`) are derived from
 * `transponder.implementation` rather than the chip type.
 */
const CHIP_INTERFACE_CAPABILITIES: Partial<Record<ChipType, ChipCapability[]>> =
  {
    // NTAG 21x — NFC Type 2
    [ChipType.NTAG213]: ['ntag-type2'],
    [ChipType.NTAG215]: ['ntag-type2'],
    [ChipType.NTAG216]: ['ntag-type2'],
    [ChipType.NTAG_I2C_1K]: ['ntag-type2', 'i2c-sensor-bus'],
    [ChipType.NTAG_I2C_2K]: ['ntag-type2', 'i2c-sensor-bus'],
    [ChipType.NTAG_I2C_PLUS_1K]: ['ntag-type2', 'i2c-sensor-bus'],
    [ChipType.NTAG_I2C_PLUS_2K]: ['ntag-type2', 'i2c-sensor-bus'],
    [ChipType.NTAG_UNKNOWN]: ['ntag-type2'],

    // NTAG 5 family — ISO 15693 with optional I²C
    [ChipType.NTAG5_LINK]: ['iso15693-shape', 'i2c-sensor-bus'],
    [ChipType.NTAG5_BOOST]: ['iso15693-shape', 'i2c-sensor-bus'],
    [ChipType.NTAG5_SWITCH]: ['iso15693-shape'],

    // NTAG DNA family — Layer 4 + AES
    [ChipType.NTAG413_DNA]: ['desfire-emulation', 'aes-protected'],
    [ChipType.NTAG424_DNA]: ['desfire-emulation', 'aes-protected'],
    [ChipType.NTAG424_DNA_TT]: ['desfire-emulation', 'aes-protected'],
    [ChipType.NTAG_X_DNA]: ['desfire-emulation', 'aes-protected'],

    // MIFARE Classic — interface only; substrate (real silicon vs SmartMX)
    // comes from implementation field
    [ChipType.MIFARE_CLASSIC_1K]: ['classic-emulation'],
    [ChipType.MIFARE_CLASSIC_4K]: ['classic-emulation'],
    [ChipType.MIFARE_CLASSIC_MINI]: ['classic-emulation'],

    // MIFARE DESFire family
    [ChipType.DESFIRE_EV1]: ['desfire-emulation', 'aes-protected'],
    [ChipType.DESFIRE_EV2]: ['desfire-emulation', 'aes-protected'],
    [ChipType.DESFIRE_EV3]: ['desfire-emulation', 'aes-protected'],
    // EV3C exposes both credentials. The Classic tag is also contributed by
    // the credential union in `deriveCapabilities`, but stating it here keeps
    // the static table honest for callers that read it directly.
    [ChipType.DESFIRE_EV3C]: [
      'desfire-emulation',
      'classic-emulation',
      'aes-protected',
    ],
    [ChipType.DESFIRE_LIGHT]: ['desfire-emulation', 'aes-protected'],
    [ChipType.DESFIRE_UNKNOWN]: ['desfire-emulation'],
    [ChipType.MIFARE_DUOX]: ['desfire-emulation', 'aes-protected'],

    // MIFARE Plus — exposes Classic command set in SL1, AES in SL2/SL3
    [ChipType.MIFARE_PLUS_S]: ['classic-emulation', 'aes-protected'],
    [ChipType.MIFARE_PLUS_X]: ['classic-emulation', 'aes-protected'],
    [ChipType.MIFARE_PLUS_SE]: ['classic-emulation', 'aes-protected'],
    [ChipType.MIFARE_PLUS_EV1]: ['classic-emulation', 'aes-protected'],
    [ChipType.MIFARE_PLUS_EV2]: ['classic-emulation', 'aes-protected'],
    [ChipType.MIFARE_PLUS]: ['classic-emulation', 'aes-protected'],

    // MIFARE Ultralight — NFC Type 2
    [ChipType.ULTRALIGHT]: ['ntag-type2'],
    [ChipType.ULTRALIGHT_C]: ['ntag-type2'],
    [ChipType.ULTRALIGHT_EV1]: ['ntag-type2'],
    [ChipType.ULTRALIGHT_NANO]: ['ntag-type2'],
    [ChipType.ULTRALIGHT_AES]: ['ntag-type2', 'aes-protected'],

    // ISO 15693 / NFC-V
    [ChipType.SLIX]: ['iso15693-shape'],
    [ChipType.SLIX2]: ['iso15693-shape'],
    [ChipType.SLIX_S]: ['iso15693-shape'],
    [ChipType.SLIX_L]: ['iso15693-shape'],
    [ChipType.ICODE_DNA]: ['iso15693-shape', 'aes-protected'],
    [ChipType.ISO15693_UNKNOWN]: ['iso15693-shape'],

    // JavaCard family
    [ChipType.JCOP4]: ['iso7816-substrate', 'aes-protected'],
    [ChipType.JAVACARD_UNKNOWN]: ['iso7816-substrate'],

    // MIFARE 2GO — virtual card; interface depends on emulated family
    [ChipType.MIFARE_2GO]: [],

    // Generic / unknown buckets — no capabilities asserted
    [ChipType.ISO14443A_UNKNOWN]: [],
    [ChipType.ISO14443B_UNKNOWN]: [],
    [ChipType.UNKNOWN]: [],
  };

/**
 * Map a Transponder.implementation value to the corresponding substrate
 * capability tag. Returns `undefined` when the implementation is unknown
 * or not yet stamped (e.g. iOS Classic where the GetVersion probe is
 * blocked by CoreNFC).
 */
function substrateCapability(
  implementation: Transponder['implementation'],
): ChipCapability | undefined {
  switch (implementation) {
    case 'native':
      return 'native-silicon';
    case 'smartmx_emulation':
      return 'smartcard-substrate';
    case 'javacard_emulation':
      // JavaCard substrate also exposes ISO 7816 — caller adds that tag
      // separately so callers can reason about both.
      return 'smartcard-substrate';
    case 'mifare_2go_virtual':
      return 'mifare-2go-virtual';
    case undefined:
    default:
      return undefined;
  }
}

/**
 * Derive the full capability set for a detected Transponder.
 *
 * Combines:
 * - Interface / hardware tags from the static chip-type table
 * - Interface tags from every entry in `transponder.credentials`, so a card
 *   exposing several credentials at once (e.g. DESFire EV3C, which carries
 *   both a DESFire and a MIFARE Classic credential) matches products for
 *   all of them
 * - Substrate tag from `transponder.implementation`
 * - `iso7816-substrate` for any JavaCard-emulated card (the substrate
 *   itself can run applets even when exposing a Classic interface)
 * - `crypto1-only` for native MIFARE Classic chips (cleared when running
 *   on a SmartMX / Plus / JavaCard substrate)
 *
 * Result is deduplicated and stable-ordered by the order capabilities are
 * added below.
 */
export function deriveCapabilities(
  transponder: Pick<Transponder, 'type' | 'implementation' | 'credentials'>,
): ChipCapability[] {
  const capabilities = new Set<ChipCapability>();

  // 1. Interface / hardware tags from the chip type
  const interfaceCaps = CHIP_INTERFACE_CAPABILITIES[transponder.type] ?? [];
  for (const cap of interfaceCaps) {
    capabilities.add(cap);
  }

  // 1b. Union in the interface tags implied by each detected credential.
  //     A card is only as narrow as its narrowest interface if it has one;
  //     multi-credential cards should match products for every credential
  //     they actually expose.
  for (const credential of transponder.credentials ?? []) {
    switch (credential.kind) {
      case 'mifare-classic':
        capabilities.add('classic-emulation');
        break;
      case 'mifare-plus':
        capabilities.add('classic-emulation');
        capabilities.add('aes-protected');
        break;
      case 'desfire':
        capabilities.add('desfire-emulation');
        capabilities.add('aes-protected');
        break;
      case 'javacard':
        capabilities.add('iso7816-substrate');
        capabilities.add('smartcard-substrate');
        break;
    }
  }

  // 2. Substrate tag from the implementation field
  const substrate = substrateCapability(transponder.implementation);
  if (substrate) {
    capabilities.add(substrate);
  }

  // 3. JavaCard substrates implicitly carry an iso7816-substrate capability —
  //    a card emulating Classic via JavaCard can host arbitrary applets.
  if (transponder.implementation === 'javacard_emulation') {
    capabilities.add('iso7816-substrate');
  }

  // 4. Native MIFARE Classic uses Crypto1; SmartMX / JavaCard substrates do
  //    not. Tag this only on the native path — and a card that answered the
  //    ISD probe is a smart card regardless of what its SAK advertised, so
  //    an ISD-backed credential vetoes the tag.
  const hasSmartcardCredential = (transponder.credentials ?? []).some(
    c => c.kind === 'javacard' || c.substrate === 'smartcard',
  );
  if (
    transponder.implementation === 'native' &&
    !hasSmartcardCredential &&
    (transponder.type === ChipType.MIFARE_CLASSIC_1K ||
      transponder.type === ChipType.MIFARE_CLASSIC_4K ||
      transponder.type === ChipType.MIFARE_CLASSIC_MINI)
  ) {
    capabilities.add('crypto1-only');
  }

  return Array.from(capabilities);
}
