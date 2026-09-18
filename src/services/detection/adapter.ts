/**
 * identify() adapter
 *
 * Bridges the DT fork's library identification result
 * (`NfcManager.identify()` → a library `Transponder`) to the app's own
 * `Transponder` shape (see `src/types/detection.ts`).
 *
 * Chip IDENTIFICATION now lives in the library; this adapter does the pure,
 * side-effect-free field mapping from the library's base transponder onto the
 * app's interface. It deliberately does NOT run the DT product layer (implant
 * naming, capabilities, credential sweep, CPLC-based product identity) — those
 * are layered on top in a later task. It produces a faithful base
 * `Transponder` plus the UG4/magic hook the matcher keys off.
 *
 * NOTE (Task 4): this is not yet wired into `useScan`; it is built and
 * unit-tested standalone here.
 */

import {Platform} from 'react-native';
import NfcManager, {
  type IdentifyOptions,
  type Transponder as LibTransponder,
} from '@dangerousthings/react-native-nfc-manager';

import {
  CHIP_CLONEABILITY,
  CHIP_MEMORY_SIZES,
  CHIP_NAMES,
  type Transponder,
} from '../../types/detection';

/**
 * Format a byte array as colon-separated, upper-case hex — the string form the
 * rest of the app (raw-data display, matcher, DT signature matching) expects
 * for `rawData` fields (matches `NFCManager.bytesToHex`). Returns `undefined`
 * for a missing or empty array so optional fields stay absent rather than `''`.
 */
function bytesToHex(bytes?: number[]): string | undefined {
  if (!bytes || bytes.length === 0) {
    return undefined;
  }
  return bytes
    .map(b => b.toString(16).padStart(2, '0').toUpperCase())
    .join(':');
}

/**
 * Map a library `Transponder` onto the app's `Transponder` shape.
 *
 * Split out from {@link identifyTransponder} so it can be unit-tested against
 * hand-built library transponders without touching native NFC.
 */
export function libToAppTransponder(
  lib: LibTransponder,
  opts?: IdentifyOptions,
): Transponder {
  const chip = lib.chip;
  const cloneability = CHIP_CLONEABILITY[chip];

  const transponder: Transponder = {
    type: chip,
    family: lib.family,
    chipName: CHIP_NAMES[chip] ?? String(chip),
    isCloneable: cloneability?.cloneable ?? false,
    cloneabilityNote: cloneability?.note,
    memorySize: CHIP_MEMORY_SIZES[chip],
    rawData: {
      uid: bytesToHex(lib.uid) ?? '',
      sak: lib.sak,
      atqa: bytesToHex(lib.atqa),
      ats: bytesToHex(lib.ats),
      historicalBytes: bytesToHex(lib.historicalBytes),
      // The library transponder does not surface the platform tech-type list;
      // useScan still carries the raw scan's techTypes separately. Left empty
      // here and flagged for Task 5.
      techTypes: [],
    },
    // The library does not (yet) express a chip-identification confidence.
    // Default to 'high' — the library's waterfall is authoritative when it
    // names a chip. Flagged for Task 5 to thread a real confidence through.
    confidence: 'high',
    detectedOn: (opts?.platform ?? (Platform.OS as 'ios' | 'android')),
  };

  // UG4 / magic surfacing. Per CLAUDE.md, a Gen4 ("Ultimate") magic hit sets
  // cardModeInfo.modeType='ultimate_gen4'; the matcher short-circuits on this
  // to list only UG4 implants. Only mapped when the library ran its magic
  // sweep (probeMagic) and bound a gen4 handle. Other magic gens are left for
  // Task 5 (not mapped here to avoid inventing product behaviour).
  if (lib.magic?.gen === 'gen4') {
    transponder.cardModeInfo = {
      hasMultipleModes: true,
      modeType: 'ultimate_gen4',
      confidence: 'high',
      description:
        'Ultimate Magic (Gen4) tag — answered the vendor backdoor command.',
      notes: [lib.magic.label].filter(Boolean),
    };
  }

  return transponder;
}

/**
 * Run the library identification against the tag in the field and return an
 * app `Transponder`.
 *
 * Options (`onProgress`, `onExchange`, `probeMagic`, `platform`,
 * `rawAvailable`, `magicPassword`) are forwarded verbatim to
 * `NfcManager.identify`. `onExchange` is accepted here so the later useScan
 * task can wire it to fixture capture; this adapter just forwards it.
 */
export async function identifyTransponder(
  opts?: IdentifyOptions,
): Promise<Transponder> {
  const lib = await NfcManager.identify(opts);
  return libToAppTransponder(lib, opts);
}
