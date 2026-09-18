jest.mock('@dangerousthings/react-native-nfc-manager', () => ({
  __esModule: true,
  default: {},
  NfcTech: {},
  NfcAdapter: {
    FLAG_READER_NFC_A: 0x1,
    FLAG_READER_SKIP_NDEF_CHECK: 0x80,
    FLAG_READER_NO_PLATFORM_SOUNDS: 0x100,
  },
}));

import {parseHex, toSpacedHex} from '../SendRawModal';

describe('parseHex', () => {
  it('accepts hex with any separator', () => {
    expect(parseHex('3004')).toEqual([0x30, 0x04]);
    expect(parseHex('30 04')).toEqual([0x30, 0x04]);
    expect(parseHex('30:04')).toEqual([0x30, 0x04]);
    expect(parseHex('ffAB')).toEqual([0xff, 0xab]);
  });

  it('rejects empty, odd-length and non-hex input', () => {
    expect(parseHex('')).toBeNull();
    expect(parseHex('  ')).toBeNull();
    expect(parseHex('300')).toBeNull();
    expect(parseHex('30ZZ')).toBeNull();
  });
});

describe('toSpacedHex', () => {
  it('formats bytes as spaced uppercase pairs', () => {
    expect(toSpacedHex([0x04, 0x00, 0xab])).toBe('04 00 AB');
    expect(toSpacedHex([])).toBe('');
  });
});
