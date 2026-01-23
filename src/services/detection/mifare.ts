/**
 * MIFARE Detector
 * Identifies MIFARE Classic 1K/4K/Mini based on SAK values
 * Also provides stubs for DESFire and Plus detection (Phase 4)
 */

import {Platform} from 'react-native';
import {ChipType, CHIP_MEMORY_SIZES} from '../../types/detection';

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
  // Plus in SL1 looks identical to Classic, but historical bytes may differ
  if (
    (sak === SAK_SWAP_INDICATORS.PLUS_SL1_2K ||
      sak === SAK_SWAP_INDICATORS.PLUS_SL1_4K) &&
    historicalBytes
  ) {
    // MIFARE Plus typically has specific historical bytes patterns
    if (
      historicalBytes.includes('C1') ||
      historicalBytes.includes('80:02')
    ) {
      notes.push('Historical bytes suggest MIFARE Plus in SL1 mode');
      return {
        hasSakSwap: true,
        swapType: 'mifare_plus_sl1',
        confidence: 'medium',
        description:
          'MIFARE Plus in Security Level 1 (emulating Classic). Can be switched to SL2/SL3 with cryptographic authentication.',
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
    // SL3 may look like generic ISO-DEP
    if (historicalBytes?.includes('C1')) {
      return {
        hasSakSwap: true,
        swapType: 'mifare_plus_sl1',
        confidence: 'medium',
        description:
          'MIFARE Plus in Security Level 3 (AES-only mode). May have originated from SL1 configuration.',
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
