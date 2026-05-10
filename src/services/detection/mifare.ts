/**
 * MIFARE Detector
 * Identifies MIFARE Classic 1K/4K/Mini based on SAK values
 * Also provides stubs for DESFire and Plus detection (Phase 4)
 */

import {Platform} from 'react-native';
import {ChipType, CHIP_MEMORY_SIZES} from '../../types/detection';
import {NTAG_GET_VERSION, sendType2Command} from '../nfc/commands';
import {
  decodeGetVersion,
  GetVersionDecoded,
  ImplementationKind,
  implementationToTransponderField,
  NXP_VENDOR_ID,
  ProductFamily,
} from './getversion';
import type {Transponder} from '../../types/detection';

/**
 * SAK (Select Acknowledge) values for MIFARE chips
 *
 * SAK is returned during ISO 14443-3A anticollision and indicates card capabilities
 */
const MIFARE_SAK_VALUES = {
  // MIFARE Classic 1K variants
  CLASSIC_1K: 0x08,
  CLASSIC_1K_SMARTMX: 0x28, // Classic 1K emulation on SmartMX
  CLASSIC_1K_INFINEON: 0x88, // Infineon variant

  // MIFARE Classic 4K variants
  CLASSIC_4K: 0x18,
  CLASSIC_4K_SMARTMX: 0x38, // Classic 4K emulation on SmartMX
  CLASSIC_4K_INFINEON: 0x98, // Infineon variant

  // MIFARE Classic 2K (rare)
  CLASSIC_2K: 0x19,

  // MIFARE Classic Mini
  CLASSIC_MINI: 0x09,

  // MIFARE Classic 1K with UID changeable (magic cards often)
  CLASSIC_1K_UID_CHANGEABLE: 0x01,

  // Cards with ISO 14443-4 support (bit 5 set)
  // These might be DESFire, Plus, or SmartMX
  ISO_DEP_CAPABLE: 0x20,
} as const;

// All SAK values that indicate MIFARE Classic
const ALL_CLASSIC_1K_SAKS: number[] = [
  MIFARE_SAK_VALUES.CLASSIC_1K,
  MIFARE_SAK_VALUES.CLASSIC_1K_SMARTMX,
  MIFARE_SAK_VALUES.CLASSIC_1K_INFINEON,
  MIFARE_SAK_VALUES.CLASSIC_1K_UID_CHANGEABLE,
];

const ALL_CLASSIC_4K_SAKS: number[] = [
  MIFARE_SAK_VALUES.CLASSIC_4K,
  MIFARE_SAK_VALUES.CLASSIC_4K_SMARTMX,
  MIFARE_SAK_VALUES.CLASSIC_4K_INFINEON,
  MIFARE_SAK_VALUES.CLASSIC_2K, // 2K treated as 4K variant
];

/**
 * Result of MIFARE Classic detection
 */
export interface MifareClassicDetectionResult {
  success: boolean;
  chipType?: ChipType;
  memorySize?: number;
  sectorCount?: number;
  blockCount?: number;
  note?: string;
}

/**
 * Detect MIFARE Classic variant from SAK value
 */
export function detectMifareClassic(sak: number): MifareClassicDetectionResult {
  // Check for MIFARE Classic 1K variants
  if (ALL_CLASSIC_1K_SAKS.includes(sak)) {
    return {
      success: true,
      chipType: ChipType.MIFARE_CLASSIC_1K,
      memorySize: CHIP_MEMORY_SIZES[ChipType.MIFARE_CLASSIC_1K],
      sectorCount: 16,
      blockCount: 64,
      note:
        Platform.OS === 'ios'
          ? 'Sector operations require Android'
          : undefined,
    };
  }

  // Check for MIFARE Classic 4K variants
  if (ALL_CLASSIC_4K_SAKS.includes(sak)) {
    return {
      success: true,
      chipType: ChipType.MIFARE_CLASSIC_4K,
      memorySize: CHIP_MEMORY_SIZES[ChipType.MIFARE_CLASSIC_4K],
      sectorCount: 40, // 32 small sectors + 8 large sectors
      blockCount: 256,
      note:
        Platform.OS === 'ios'
          ? 'Sector operations require Android'
          : undefined,
    };
  }

  // Check for MIFARE Classic Mini (SAK 0x09)
  if (sak === MIFARE_SAK_VALUES.CLASSIC_MINI) {
    return {
      success: true,
      chipType: ChipType.MIFARE_CLASSIC_MINI,
      memorySize: CHIP_MEMORY_SIZES[ChipType.MIFARE_CLASSIC_MINI],
      sectorCount: 5,
      blockCount: 20,
      note:
        Platform.OS === 'ios'
          ? 'Sector operations require Android'
          : undefined,
    };
  }

  return {
    success: false,
  };
}

/**
 * Check if SAK indicates a MIFARE Classic chip
 */
export function isMifareClassicSak(sak: number): boolean {
  return (
    ALL_CLASSIC_1K_SAKS.includes(sak) ||
    ALL_CLASSIC_4K_SAKS.includes(sak) ||
    sak === MIFARE_SAK_VALUES.CLASSIC_MINI
  );
}

/**
 * Check if SAK indicates ISO 14443-4 (ISO-DEP) capability
 * This means the chip might be DESFire, Plus, or SmartMX
 */
export function hasIsoDepCapability(sak: number): boolean {
  // Bit 5 (0x20) indicates ISO 14443-4 compliance
  return (sak & 0x20) !== 0;
}

/**
 * Get human-readable description of SAK value
 */
export function describeSak(sak: number): string {
  if (sak === MIFARE_SAK_VALUES.CLASSIC_1K) {
    return 'MIFARE Classic 1K';
  }
  if (sak === MIFARE_SAK_VALUES.CLASSIC_4K) {
    return 'MIFARE Classic 4K';
  }
  if (sak === MIFARE_SAK_VALUES.CLASSIC_2K) {
    return 'MIFARE Classic 2K';
  }
  if (sak === MIFARE_SAK_VALUES.CLASSIC_MINI) {
    return 'MIFARE Classic Mini';
  }
  if (sak === 0x00) {
    return 'Type 2 Tag (NTAG/Ultralight)';
  }
  if (hasIsoDepCapability(sak)) {
    return 'ISO 14443-4 capable (DESFire/Plus/SmartMX)';
  }
  return `Unknown (SAK: 0x${sak.toString(16).padStart(2, '0')})`;
}

/**
 * iOS MIFARE Classic limitation info
 */
export const IOS_MIFARE_CLASSIC_NOTE =
  'iOS can detect MIFARE Classic but cannot perform sector-level operations. ' +
  'For cloning or data extraction, an Android device is required.';

// ============================================================================
// SAK Swap Detection
// ============================================================================

/**
 * SAK values that indicate potential SAK swap capability
 *
 * SAK swap refers to chips that can operate in multiple modes:
 * - MIFARE Plus in SL1 emulates Classic but can switch to SL3
 * - Some magic/clone cards have mutable SAK values
 * - DESFire cards with MIFARE Classic emulation
 */
const SAK_SWAP_INDICATORS = {
  // MIFARE Plus SL1 (emulating Classic 1K but can upgrade)
  PLUS_SL1_2K: 0x08, // Same as Classic 1K but actually Plus
  PLUS_SL1_4K: 0x18, // Same as Classic 4K but actually Plus

  // MIFARE Plus SL2/SL3 (ISO-DEP mode)
  PLUS_SL2_2K: 0x10,
  PLUS_SL2_4K: 0x11,
  PLUS_SL3_2K: 0x20,
  PLUS_SL3_4K: 0x20,

  // DESFire with MIFARE Application
  DESFIRE_WITH_CLASSIC: 0x28, // DESFire + Classic emulation

  // Known magic card indicators (Gen2/CUID often have unusual ATQA)
  MAGIC_INDICATOR: 0x00,
} as const;

/**
 * ATQA patterns that might indicate special cards
 */
const SUSPICIOUS_ATQA_PATTERNS = {
  // Gen1a magic cards often have ATQA 0x0400
  GEN1A_MAGIC: '04:00',
  // Gen2/CUID cards
  GEN2_MAGIC: '08:04',
  // Standard Classic 1K
  CLASSIC_1K: '00:04',
  // Standard Classic 4K
  CLASSIC_4K: '00:02',
};

/**
 * SAK swap detection result
 */
export interface SakSwapDetection {
  /** Whether SAK swap capability was detected */
  hasSakSwap: boolean;

  /** Type of SAK swap if detected */
  swapType?:
    | 'mifare_plus_sl1'
    | 'desfire_with_classic'
    | 'magic_card'
    | 'unknown';

  /** Confidence in the detection */
  confidence: 'high' | 'medium' | 'low';

  /** Human-readable description */
  description: string;

  /** Additional notes */
  notes?: string[];
}

/**
 * Detect if a tag might have SAK swap capability
 *
 * This checks for indicators that suggest the tag can operate in
 * multiple modes or has been modified from factory defaults.
 */
export function detectSakSwap(
  sak: number,
  atqa?: string,
  historicalBytes?: string,
): SakSwapDetection {
  const notes: string[] = [];

  // Check for MIFARE Plus in SL1 mode
  // Plus in SL1 looks identical to Classic at the SAK level; its historical
  // bytes carry an AN10833-defined signature (Figure 1, ISO 14443-4 leaves).
  if (
    (sak === SAK_SWAP_INDICATORS.PLUS_SL1_2K ||
      sak === SAK_SWAP_INDICATORS.PLUS_SL1_4K) &&
    historicalBytes
  ) {
    const plusMatch = matchPlusHistoricalSignature(historicalBytes);
    if (plusMatch) {
      notes.push(
        `Plus ${plusMatch.variant} ${plusMatch.memoryK}K in SL${plusMatch.securityLevel} (signature match)`,
      );
      return {
        hasSakSwap: true,
        swapType: 'mifare_plus_sl1',
        confidence: 'high',
        description: `MIFARE Plus ${plusMatch.variant} ${plusMatch.memoryK}K in Security Level ${plusMatch.securityLevel} (emulating Classic). Can be switched to SL2/SL3 with cryptographic authentication.`,
        notes,
      };
    }
  }

  // Check for DESFire with MIFARE Classic application
  if (sak === SAK_SWAP_INDICATORS.DESFIRE_WITH_CLASSIC) {
    return {
      hasSakSwap: true,
      swapType: 'desfire_with_classic',
      confidence: 'high',
      description:
        'DESFire with MIFARE Classic emulation. Tag operates as both DESFire and Classic.',
      notes: ['Full DESFire functionality available via ISO-DEP'],
    };
  }

  // Check for Magic card indicators via ATQA
  if (atqa) {
    const cleanAtqa = atqa.toUpperCase();

    // Gen1a magic cards have unusual ATQA patterns
    if (
      cleanAtqa === SUSPICIOUS_ATQA_PATTERNS.GEN1A_MAGIC &&
      (sak === 0x08 || sak === 0x18)
    ) {
      notes.push('ATQA pattern suggests Gen1a magic card');
      return {
        hasSakSwap: true,
        swapType: 'magic_card',
        confidence: 'medium',
        description:
          'Possible Gen1a magic card (UID-writable). SAK and UID can be modified with special commands.',
        notes,
      };
    }

    // Check for mismatched ATQA/SAK (common in clones)
    const isClassic1kSak = sak === 0x08;
    const isClassic4kSak = sak === 0x18;
    const isClassic1kAtqa = cleanAtqa === SUSPICIOUS_ATQA_PATTERNS.CLASSIC_1K;
    const isClassic4kAtqa = cleanAtqa === SUSPICIOUS_ATQA_PATTERNS.CLASSIC_4K;

    if (
      (isClassic1kSak && isClassic4kAtqa) ||
      (isClassic4kSak && isClassic1kAtqa)
    ) {
      notes.push('SAK/ATQA mismatch suggests modified or clone card');
      return {
        hasSakSwap: true,
        swapType: 'magic_card',
        confidence: 'low',
        description:
          'SAK and ATQA values are inconsistent. May be a magic/clone card with modified parameters.',
        notes,
      };
    }
  }

  // Check for Plus SL2/SL3 modes
  if (
    sak === SAK_SWAP_INDICATORS.PLUS_SL2_2K ||
    sak === SAK_SWAP_INDICATORS.PLUS_SL2_4K
  ) {
    return {
      hasSakSwap: true,
      swapType: 'mifare_plus_sl1',
      confidence: 'high',
      description:
        'MIFARE Plus in Security Level 2. Supports both Classic commands and AES authentication.',
      notes: ['Can fall back to SL1 (Classic) mode in some configurations'],
    };
  }

  if (
    sak === SAK_SWAP_INDICATORS.PLUS_SL3_2K ||
    sak === SAK_SWAP_INDICATORS.PLUS_SL3_4K
  ) {
    // SL3 may look like generic ISO-DEP. An AN10833 signature match
    // confirms Plus identity; without one, we don't infer Plus from SAK
    // alone.
    const plusMatch = matchPlusHistoricalSignature(historicalBytes);
    if (plusMatch) {
      return {
        hasSakSwap: true,
        swapType: 'mifare_plus_sl1',
        confidence: 'high',
        description: `MIFARE Plus ${plusMatch.variant} ${plusMatch.memoryK}K in Security Level 3 (AES-only mode).`,
        notes: ['Cannot fall back to Classic mode once in SL3'],
      };
    }
  }

  // No SAK swap detected
  return {
    hasSakSwap: false,
    confidence: 'high',
    description: 'Standard tag with no SAK swap capability detected.',
  };
}

/**
 * Check if tag might be a magic/clone card based on behavior
 */
export function mightBeMagicCard(sak: number, atqa?: string): boolean {
  // Gen1a magic cards often have ATQA 0x0400
  if (atqa === SUSPICIOUS_ATQA_PATTERNS.GEN1A_MAGIC) {
    return true;
  }

  // SAK 0x00 with NfcA tech might be magic NTAG
  if (sak === 0x00 && atqa === '00:44') {
    return true;
  }

  return false;
}

// ============================================================================
// MIFARE Plus historical-byte signatures (AN10833 Figure 1, ISO 14443-4 leaves)
// ============================================================================

/**
 * Parse a colon-separated hex string into a byte array.
 *
 * Accepts the formats produced by `bytesToHex` (e.g. `"C1:05:2F:2F"`) plus
 * tolerates other separators and casing. Returns `undefined` on malformed
 * input — callers should treat that as "no signature match available".
 */
function parseHexBytes(hex: string | undefined): number[] | undefined {
  if (!hex) {
    return undefined;
  }
  const cleaned = hex.replace(/[:\s-]/g, '');
  if (cleaned.length === 0 || cleaned.length % 2 !== 0) {
    return undefined;
  }
  const bytes: number[] = [];
  for (let i = 0; i < cleaned.length; i += 2) {
    const byte = parseInt(cleaned.slice(i, i + 2), 16);
    if (Number.isNaN(byte)) {
      return undefined;
    }
    bytes.push(byte);
  }
  return bytes;
}

/** Variant identifier for MIFARE Plus chips (memory layout / silicon family) */
export type PlusVariant = 'S' | 'X' | 'SE' | 'EV1';

/**
 * Result of matching a tag's historical bytes against the AN10833 Plus
 * signature table.
 */
export interface PlusSignatureMatch {
  chipType: ChipType;
  variant: PlusVariant;
  /** Plus security level the card is currently presenting (1, 2, or 3). */
  securityLevel: 1 | 2 | 3;
  /** User memory in kilobytes (2 or 4). */
  memoryK: 2 | 4;
  /** The matched prefix bytes (for debugging / display). */
  matchedPrefix: number[];
}

interface PlusSignatureEntry {
  prefix: number[];
  chipType: ChipType;
  variant: PlusVariant;
  securityLevel: 1 | 2 | 3;
  memoryK: 2 | 4;
}

/**
 * AN10833 Figure 1 historical-byte prefixes for MIFARE Plus variants.
 *
 * Order matters: the matcher returns the first entry whose prefix matches,
 * so longer / more-specific prefixes should appear before shorter ones.
 */
const PLUS_HISTORICAL_SIGNATURES: PlusSignatureEntry[] = [
  // Plus X — historical bytes "C1 05 2F 2F ..." with variable byte 4
  {
    prefix: [0xc1, 0x05, 0x2f, 0x2f, 0x90, 0x35, 0xc7],
    chipType: ChipType.MIFARE_PLUS_X,
    variant: 'X',
    securityLevel: 1,
    memoryK: 4,
  },
  {
    prefix: [0xc1, 0x05, 0x2f, 0x2f, 0x91, 0x35, 0xc8],
    chipType: ChipType.MIFARE_PLUS_X,
    variant: 'X',
    securityLevel: 1,
    memoryK: 2,
  },

  // Plus SE
  {
    prefix: [0xc1, 0x05, 0x2f, 0x2f, 0x00, 0x35, 0xc7],
    chipType: ChipType.MIFARE_PLUS_SE,
    variant: 'SE',
    securityLevel: 1,
    memoryK: 4,
  },
  {
    prefix: [0xc1, 0x05, 0x2f, 0x2f, 0x01, 0x35, 0xc8],
    chipType: ChipType.MIFARE_PLUS_SE,
    variant: 'SE',
    securityLevel: 1,
    memoryK: 2,
  },
  {
    prefix: [0xc1, 0x05, 0x2f, 0x2f, 0x0b, 0xc8, 0xc8],
    chipType: ChipType.MIFARE_PLUS_SE,
    variant: 'SE',
    securityLevel: 1,
    memoryK: 2,
  },

  // Plus EV1 — historical bytes start "C1 05 21 30 ..."
  {
    prefix: [0xc1, 0x05, 0x21, 0x30, 0x0f, 0x8f, 0xd1],
    chipType: ChipType.MIFARE_PLUS_EV1,
    variant: 'EV1',
    securityLevel: 1,
    memoryK: 2,
  },
  {
    prefix: [0xc1, 0x05, 0x21, 0x30, 0x1f, 0x8f, 0xd1],
    chipType: ChipType.MIFARE_PLUS_EV1,
    variant: 'EV1',
    securityLevel: 1,
    memoryK: 4,
  },
];

/**
 * Match a tag's historical bytes against the Plus signature table.
 *
 * Returns the first matching entry, or `undefined` if no signature matches.
 * This replaces the older loose substring match (`historicalBytes.includes('C1')`)
 * which produced false positives — `0xC1` appears inside many byte values.
 */
export function matchPlusHistoricalSignature(
  historicalBytes: string | undefined,
): PlusSignatureMatch | undefined {
  const bytes = parseHexBytes(historicalBytes);
  if (!bytes) {
    return undefined;
  }

  for (const entry of PLUS_HISTORICAL_SIGNATURES) {
    if (bytes.length < entry.prefix.length) {
      continue;
    }
    const matches = entry.prefix.every((b, i) => bytes[i] === b);
    if (matches) {
      return {
        chipType: entry.chipType,
        variant: entry.variant,
        securityLevel: entry.securityLevel,
        memoryK: entry.memoryK,
        matchedPrefix: entry.prefix.slice(),
      };
    }
  }
  return undefined;
}

// ============================================================================
// Layer 3 GetVersion probe for MIFARE Classic-typed cards (AN10833 §2.1)
// ============================================================================

/**
 * Outcome of probing a Classic-typed card with Layer 3 GetVersion (cmd 0x60).
 *
 * - Real MIFARE Classic NAKs the command (caught as a transceive error).
 * - SmartMX / Plus EV1 in SL1 emulating Classic answer with a 7-byte
 *   GetVersion structure whose byte 1 upper nibble = 0x8.
 * - JavaCard applets emulating Classic answer with byte 1 upper nibble = 0x9.
 *
 * The probe is a no-op for callers when `detected` is false — they continue
 * with their existing SAK-based Classic identification.
 */
export interface ClassicGetVersionProbeResult {
  /** True when the card answered with a parseable GetVersion response. */
  detected: boolean;
  /** Decoded GetVersion fields, if `detected`. */
  decoded?: GetVersionDecoded;
  /** Mapped Transponder.implementation field, if `detected`. */
  implementation?: Transponder['implementation'];
  /** Raw GetVersion byte 1, retained for debugging. */
  implementationByte?: number;
  /**
   * True when byte 1 specifically equals 0x82 — MIFARE Plus EV1 operating
   * in Security Level 1 mode (Plus family + SmartMX-style emulation upper
   * nibble). The card's chip type should be reported as MIFARE_PLUS_EV1
   * rather than MIFARE_CLASSIC_*.
   */
  isPlusEv1Sl1?: boolean;
}

/**
 * Probe a card whose SAK identifies it as MIFARE Classic with the Layer 3
 * GetVersion command (cmd 0x60).
 *
 * Real MIFARE Classic chips do not implement GetVersion and respond with a
 * NAK (which surfaces as a transceive exception in our nfc layer). Cards
 * whose Classic memory layout is provided by a SmartMX, Plus EV1 SL1, or
 * JavaCard substrate answer with the standard 7-byte GetVersion structure
 * carrying their substrate identity in byte 1.
 *
 * **Platform notes:**
 * - On Android, this works for any tag that exposes the `MifareClassic` or
 *   `NfcA` tech.
 * - On iOS, `sendMifareCommandIOS` may refuse to send arbitrary commands to
 *   a tag CoreNFC has typed as MIFARE Classic. In that case the probe
 *   throws and we treat the card as real Classic — same outcome as a NAK.
 */
export async function probeClassicGetVersion(): Promise<ClassicGetVersionProbeResult> {
  try {
    console.log('[MIFARE] Probing Layer 3 GetVersion on Classic-typed card');
    const response = await sendType2Command(NTAG_GET_VERSION);

    if (response.length < 8) {
      console.log(
        '[MIFARE] GetVersion probe: response too short',
        response.length,
      );
      return {detected: false};
    }

    // Layer 3 GetVersion responses lead with a 0x00 status byte; the 7-byte
    // version structure starts at offset 1.
    const decoded = decodeGetVersion(response.slice(1, 8));

    if (decoded.vendorId !== NXP_VENDOR_ID) {
      console.log(
        '[MIFARE] GetVersion probe: non-NXP vendor',
        `0x${decoded.vendorId.toString(16)}`,
      );
      return {detected: false};
    }

    const implementation = implementationToTransponderField(
      decoded.implementation,
    );

    // Native (upper nibble 0) on a Classic-SAK card would be unusual — real
    // MIFARE Classic NAKs the command. If we somehow get here, treat it as
    // an inconclusive probe rather than misreporting.
    if (decoded.implementation === ImplementationKind.NATIVE) {
      console.log(
        '[MIFARE] GetVersion probe: unexpected native response on Classic SAK',
      );
      return {detected: false};
    }

    const isPlusEv1Sl1 = decoded.productFamilyByte === 0x82;

    console.log('[MIFARE] GetVersion probe: detected', {
      byte1: `0x${decoded.productFamilyByte.toString(16)}`,
      family: ProductFamily[decoded.productFamily],
      implementation: ImplementationKind[decoded.implementation],
      isPlusEv1Sl1,
    });

    return {
      detected: true,
      decoded,
      implementation,
      implementationByte: decoded.productFamilyByte,
      isPlusEv1Sl1,
    };
  } catch (error) {
    console.log(
      '[MIFARE] GetVersion probe: NAK or transceive error (expected for real Classic):',
      error instanceof Error ? error.message : error,
    );
    return {detected: false};
  }
}
