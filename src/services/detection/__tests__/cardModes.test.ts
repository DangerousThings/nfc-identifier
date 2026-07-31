/**
 * Multi-mode / clone-suspect heuristics.
 *
 * The key regression here: smart cards carrying a MIFARE Classic credential
 * (SAK 0x28 and friends) must NOT be reported as multi-mode by this
 * heuristic, and must never be described as SAK swapping. They are described
 * by the credential sweep instead, and SAK swapping means specifically a
 * WUP-SAK / Vanity SAK mismatch read from Block 0.
 */

jest.mock('react-native', () => ({
  Platform: {OS: 'android', select: (obj: any) => obj.android ?? obj.default},
}));

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {},
  NfcTech: {},
}));

import {detectCardModes, isMirroredWupSak} from '../mifare';

describe('smart cards are not SAK swapping', () => {
  test('SAK 0x28 is not reported as multi-mode', () => {
    const result = detectCardModes(0x28, '00:04');

    expect(result.hasMultipleModes).toBe(false);
    expect(result.modeType).toBeUndefined();
  });

  test('SAK 0x38 (4K on a smart card) is not reported as multi-mode', () => {
    const result = detectCardModes(0x38, '00:02');
    expect(result.hasMultipleModes).toBe(false);
  });

  test('no description anywhere in the heuristic mentions SAK swapping', () => {
    // Guards against the old wording creeping back in. Every branch of the
    // heuristic must describe modes or clones, never "SAK swap".
    const inputs: Array<[number, string | undefined, string | undefined]> = [
      [0x28, '00:04', undefined],
      [0x08, '04:00', undefined],
      [0x08, '00:02', undefined],
      [0x18, '00:04', undefined],
      [0x10, undefined, undefined],
      [0x11, undefined, undefined],
      [0x20, undefined, 'C1052130 1F8FD1'],
      [0x08, '00:04', undefined],
      [0x08, undefined, 'C105212F 2F9035C7'],
    ];

    for (const [sak, atqa, historicalBytes] of inputs) {
      const result = detectCardModes(sak, atqa, historicalBytes);
      const text = [result.description, ...(result.notes ?? [])]
        .join(' ')
        .toLowerCase();
      expect(text).not.toContain('sak swap');
    }
  });
});

describe('genuine multi-mode cards', () => {
  test('MIFARE Plus in SL2 is multi-mode', () => {
    const result = detectCardModes(0x10);

    expect(result.hasMultipleModes).toBe(true);
    expect(result.modeType).toBe('mifare_plus_sl1');
    expect(result.description).toContain('Security Level 2');
  });

  test('Plus SL1 with a matching historical-byte signature is multi-mode', () => {
    // Plus EV1 2K SL1 prefix from the AN10833 signature table.
    const result = detectCardModes(0x08, '00:04', 'C1:05:21:30:0F:8F:D1');

    expect(result.hasMultipleModes).toBe(true);
    expect(result.modeType).toBe('mifare_plus_sl1');
  });

  test('a plain Classic 1K is single-mode', () => {
    const result = detectCardModes(0x08, '00:04');
    expect(result.hasMultipleModes).toBe(false);
  });
});

describe('mirrored WUP-SAK (keyless SAK-swap signal)', () => {
  test('0x88 as a WUP-SAK is flagged as a magic card at high confidence', () => {
    // 0x88 is a Vanity SAK value. No genuine chip wakes up announcing it —
    // MIFARE is NXP proprietary and cannot be emulated — so a card that does
    // is mirroring its WUP-SAK from Block 0. Caught without any key.
    const result = detectCardModes(0x88, '00:04');

    expect(result.hasMultipleModes).toBe(true);
    expect(result.modeType).toBe('magic_card');
    expect(result.confidence).toBe('high');
    expect(result.description).toContain('Vanity SAK');
  });

  test('0x98 as a WUP-SAK is likewise flagged', () => {
    const result = detectCardModes(0x98, '00:02');

    expect(result.hasMultipleModes).toBe(true);
    expect(result.modeType).toBe('magic_card');
    expect(result.confidence).toBe('high');
  });

  test('isMirroredWupSak identifies exactly the Vanity-only values', () => {
    expect(isMirroredWupSak(0x88)).toBe(true);
    expect(isMirroredWupSak(0x98)).toBe(true);
    expect(isMirroredWupSak(0x08)).toBe(false);
    expect(isMirroredWupSak(0x18)).toBe(false);
    expect(isMirroredWupSak(0x28)).toBe(false);
  });
});

describe('magic card indicators', () => {
  test('Gen1a ATQA pattern is flagged', () => {
    const result = detectCardModes(0x08, '04:00');

    expect(result.hasMultipleModes).toBe(true);
    expect(result.modeType).toBe('magic_card');
  });

  test('a SAK/ATQA mismatch is flagged at low confidence', () => {
    const result = detectCardModes(0x08, '00:02');

    expect(result.hasMultipleModes).toBe(true);
    expect(result.modeType).toBe('magic_card');
    expect(result.confidence).toBe('low');
  });
});
