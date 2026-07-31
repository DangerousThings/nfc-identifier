/**
 * CPLC parsing and IC-type identification.
 *
 * These are pure functions over byte arrays — no NFC mocking needed.
 */

// `cplc` imports the NFC command layer for `selectIsdAndReadCplc`. These
// tests only exercise the pure parsers, but the import chain still has to
// resolve — react-native-nfc-manager ships untransformed ESM.
jest.mock('react-native', () => ({
  Platform: {OS: 'android', select: (obj: any) => obj.android ?? obj.default},
}));

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {},
  NfcTech: {},
}));

import {
  parseCPLC,
  identifyIcType,
  identifyFabricator,
  formatCPLC,
  JCOP_IC_TYPES,
} from '../cplc';

/**
 * Build a 42-byte CPLC record with the given fabricator / IC type / OS ID
 * in their spec positions, zeroes elsewhere.
 */
function buildCplc(
  icFabricator: number,
  icType: number,
  osId: number,
): number[] {
  const bytes = new Array(42).fill(0);
  bytes[0] = (icFabricator >> 8) & 0xff;
  bytes[1] = icFabricator & 0xff;
  bytes[2] = (icType >> 8) & 0xff;
  bytes[3] = icType & 0xff;
  bytes[4] = (osId >> 8) & 0xff;
  bytes[5] = osId & 0xff;
  return bytes;
}

const NXP = 0x4790;

describe('parseCPLC', () => {
  test('parses a bare 42-byte record', () => {
    const cplc = parseCPLC(buildCplc(NXP, 0xd321, 0x4791));

    expect(cplc).not.toBeNull();
    expect(cplc!.icFabricator).toBe(NXP);
    expect(cplc!.icType).toBe(0xd321);
    expect(cplc!.osId).toBe(0x4791);
  });

  test('strips a leading 9F 7F tag', () => {
    const tagged = [0x9f, 0x7f, 0x2a, ...buildCplc(NXP, 0xd600, 0x4700)];
    const cplc = parseCPLC(tagged);

    expect(cplc).not.toBeNull();
    expect(cplc!.icType).toBe(0xd600);
  });

  test('returns null for a short record', () => {
    expect(parseCPLC(buildCplc(NXP, 0xd321, 0x4791).slice(0, 20))).toBeNull();
  });

  test('returns null for an empty response', () => {
    expect(parseCPLC([])).toBeNull();
  });

  test('decodes the IC serial number as unsigned', () => {
    // A serial with the high bit set would come out negative under signed
    // 32-bit shifts — the parser must produce an unsigned value.
    const bytes = buildCplc(NXP, 0xd321, 0x4791);
    bytes[10] = 0xff;
    bytes[11] = 0xff;
    bytes[12] = 0xff;
    bytes[13] = 0xfe;

    const cplc = parseCPLC(bytes);
    expect(cplc!.icSerialNumber).toBe(0xfffffffe);
    expect(cplc!.icSerialNumber).toBeGreaterThan(0);
  });

  test('retains the full record as hex', () => {
    const cplc = parseCPLC(buildCplc(NXP, 0xd321, 0x4791));
    expect(cplc!.raw).toHaveLength(84); // 42 bytes → 84 hex chars
    expect(cplc!.raw.startsWith('4790D321')).toBe(true);
  });
});

describe('identifyIcType', () => {
  test('maps D321 to J3R180', () => {
    expect(identifyIcType(0xd321)).toBe('J3R180');
  });

  test('maps D600 to J3R452', () => {
    expect(identifyIcType(0xd600)).toBe('J3R452');
  });

  test('returns undefined for an unknown IC type', () => {
    expect(identifyIcType(0x1234)).toBeUndefined();
  });

  test('every table entry round-trips', () => {
    for (const [code, name] of Object.entries(JCOP_IC_TYPES)) {
      expect(identifyIcType(Number(code))).toBe(name);
    }
  });
});

describe('identifyFabricator', () => {
  test('names NXP', () => {
    expect(identifyFabricator(0x4790)).toBe('NXP Semiconductors');
  });

  test('falls back to the raw code when unknown', () => {
    expect(identifyFabricator(0x0001)).toBe('Unknown (0x0001)');
  });
});

describe('formatCPLC', () => {
  test('uses the part name when the IC type is known', () => {
    const cplc = parseCPLC(buildCplc(NXP, 0xd321, 0x4791))!;
    expect(formatCPLC(cplc)).toContain('J3R180');
    expect(formatCPLC(cplc)).toContain('NXP Semiconductors');
  });

  test('falls back to the raw IC type when unknown', () => {
    const cplc = parseCPLC(buildCplc(NXP, 0xabcd, 0x4791))!;
    expect(formatCPLC(cplc)).toContain('0xabcd');
  });
});
