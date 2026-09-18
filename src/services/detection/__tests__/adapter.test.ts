/**
 * adapter.test.ts
 *
 * Unit tests for the identify() → app Transponder adapter. Builds fake LIBRARY
 * transponders (a few chip types + a gen4-magic one) and asserts the mapping
 * onto the app's Transponder shape, including the UG4 cardModeInfo mapping.
 * `NfcManager.identify` is mocked so no native NFC is touched.
 */

import {ChipType, ChipFamily} from '../../../types/detection';
import type {Transponder as LibTransponder} from '@dangerousthings/react-native-nfc-manager';
import {identifyTransponder, libToAppTransponder} from '../adapter';

// react-native's Platform, used for the detectedOn default.
jest.mock('react-native', () => ({Platform: {OS: 'android'}}));

// Mock the library root: only NfcManager.identify is used at runtime by the
// adapter (the type imports are erased). `mock`-prefixed so the hoisted factory
// may reference it.
const mockIdentify = jest.fn();
jest.mock('@dangerousthings/react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    identify: (...args: unknown[]) => mockIdentify(...args),
  },
}));

/**
 * Build a minimal fake LIBRARY transponder. Only the fields the adapter reads
 * need to be present; the rest of the interface is filled with inert stubs and
 * the whole thing is cast to the library type.
 */
function fakeLib(partial: Partial<LibTransponder>): LibTransponder {
  return {
    chip: ChipType.UNKNOWN,
    family: ChipFamily.UNKNOWN,
    uid: [],
    memory: [],
    stale: false,
    platformLimits: [],
    info: {uid: []},
    readUserMemory: async () => [],
    ...partial,
  } as LibTransponder;
}

describe('libToAppTransponder', () => {
  it('maps an NTAG216 with full raw data', () => {
    const lib = fakeLib({
      chip: ChipType.NTAG216,
      family: ChipFamily.NTAG,
      uid: [0x04, 0xab, 0xcd, 0xef, 0x12, 0x34, 0x56],
      sak: 0x00,
      // Library emits ATQA in raw little-endian (Android getAtqa) order; the
      // adapter reverses it to the app's big-endian convention → "00:44".
      atqa: [0x44, 0x00],
      ats: [0x0a, 0x0b],
      historicalBytes: [0x0a, 0x0b],
    });

    const t = libToAppTransponder(lib, {platform: 'android'});

    expect(t.type).toBe(ChipType.NTAG216);
    expect(t.family).toBe(ChipFamily.NTAG);
    expect(t.chipName).toBe('NTAG216');
    expect(t.isCloneable).toBe(true);
    expect(t.cloneabilityNote).toBeUndefined();
    expect(t.memorySize).toBe(888);
    expect(t.rawData).toEqual({
      uid: '04:AB:CD:EF:12:34:56',
      sak: 0x00,
      atqa: '00:44',
      ats: '0A:0B',
      historicalBytes: '0A:0B',
      techTypes: [],
    });
    expect(t.confidence).toBe('high');
    expect(t.detectedOn).toBe('android');
    expect(t.cardModeInfo).toBeUndefined();
  });

  it('maps a non-cloneable DESFire with its cloneability note', () => {
    const lib = fakeLib({
      chip: ChipType.DESFIRE_EV2,
      family: ChipFamily.MIFARE_DESFIRE,
      uid: [0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66],
    });

    const t = libToAppTransponder(lib, {platform: 'ios'});

    expect(t.type).toBe(ChipType.DESFIRE_EV2);
    expect(t.chipName).toBe('MIFARE DESFire EV2');
    expect(t.isCloneable).toBe(false);
    expect(t.cloneabilityNote).toBe(
      'Cryptographic protection prevents cloning',
    );
    expect(t.detectedOn).toBe('ios');
    // atqa/ats/historicalBytes absent → omitted (undefined), not empty strings.
    expect(t.rawData.atqa).toBeUndefined();
    expect(t.rawData.ats).toBeUndefined();
    expect(t.rawData.historicalBytes).toBeUndefined();
  });

  it('maps a Gen4 magic tag to cardModeInfo.modeType = ultimate_gen4', () => {
    const lib = fakeLib({
      chip: ChipType.MIFARE_CLASSIC_1K,
      family: ChipFamily.MIFARE_CLASSIC,
      uid: [0xde, 0xad, 0xbe, 0xef],
      sak: 0x08,
      magic: {
        gen: 'gen4',
        label: 'Ultimate Magic Card',
        verified: true,
        backdoor: async () => [],
      } as unknown as LibTransponder['magic'],
    });

    const t = libToAppTransponder(lib, {platform: 'android', probeMagic: true});

    // Still reports the emulated chip type…
    expect(t.type).toBe(ChipType.MIFARE_CLASSIC_1K);
    // …but the UG4 handle surfaces via cardModeInfo for the matcher.
    expect(t.cardModeInfo).toBeDefined();
    expect(t.cardModeInfo?.modeType).toBe('ultimate_gen4');
    expect(t.cardModeInfo?.hasMultipleModes).toBe(true);
    expect(t.cardModeInfo?.confidence).toBe('high');
    expect(t.cardModeInfo?.notes).toContain('Ultimate Magic Card');
  });

  it('does not map non-gen4 magic to cardModeInfo (left for Task 5)', () => {
    const lib = fakeLib({
      chip: ChipType.MIFARE_CLASSIC_1K,
      family: ChipFamily.MIFARE_CLASSIC,
      uid: [0x01, 0x02, 0x03, 0x04],
      magic: {
        gen: 'gen2',
        label: 'Gen2 CUID',
        verified: true,
        backdoor: async () => [],
      } as unknown as LibTransponder['magic'],
    });

    const t = libToAppTransponder(lib, {platform: 'android'});
    expect(t.cardModeInfo).toBeUndefined();
  });

  it('defaults detectedOn to Platform.OS when no platform option is given', () => {
    const lib = fakeLib({chip: ChipType.SLIX, family: ChipFamily.ISO15693, uid: [0xe0, 0x04]});
    const t = libToAppTransponder(lib);
    expect(t.detectedOn).toBe('android'); // mocked Platform.OS
  });
});

describe('identifyTransponder', () => {
  beforeEach(() => mockIdentify.mockReset());

  it('forwards options to NfcManager.identify and maps the result', async () => {
    const lib = fakeLib({
      chip: ChipType.NTAG215,
      family: ChipFamily.NTAG,
      uid: [0x04, 0x99, 0x88, 0x77, 0x66, 0x55, 0x44],
    });
    mockIdentify.mockResolvedValue(lib);

    const onProgress = jest.fn();
    const opts = {onProgress, probeMagic: true, platform: 'android' as const};
    const t = await identifyTransponder(opts);

    expect(mockIdentify).toHaveBeenCalledTimes(1);
    expect(mockIdentify).toHaveBeenCalledWith(opts);
    expect(t.type).toBe(ChipType.NTAG215);
    expect(t.chipName).toBe('NTAG215');
    expect(t.memorySize).toBe(504);
    expect(t.rawData.uid).toBe('04:99:88:77:66:55:44');
  });
});

/** Encode an ASCII string as a byte array. */
function ascii(s: string): number[] {
  return [...s].map(c => c.charCodeAt(0));
}

/** Build a MemorySector[] from a flat byte array (single sector, 4-byte blocks). */
function memory(bytes: number[]) {
  const blocks = [];
  for (let i = 0; i < bytes.length; i += 4) {
    blocks.push({address: i / 4, bytes: bytes.slice(i, i + 4)});
  }
  return [{sector: 0, blocks}];
}

describe('enrich (DT layer)', () => {
  beforeEach(() => mockIdentify.mockReset());

  it('reads a DT implant name from NTAG user memory (live)', async () => {
    const lib = fakeLib({
      chip: ChipType.NTAG216,
      family: ChipFamily.NTAG,
      uid: [0x04, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06],
      // readUserMemory() dumps the user area; the DT name lives in it.
      readUserMemory: async () => memory(ascii('....flexNT....')),
    });
    mockIdentify.mockResolvedValue(lib);

    const t = await identifyTransponder({platform: 'android'});
    expect(t.implantName).toBe('flexNT');
    expect(t.productKind).toBe('implant');
    // Capabilities are derived for every result now.
    expect(t.capabilities).toEqual(expect.arrayContaining(['ntag-type2']));
  });

  it('does not fail when NTAG user-memory read throws', async () => {
    const lib = fakeLib({
      chip: ChipType.NTAG213,
      family: ChipFamily.NTAG,
      uid: [0x04, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f],
      readUserMemory: async () => {
        throw new Error('tag lost');
      },
    });
    mockIdentify.mockResolvedValue(lib);

    const t = await identifyTransponder({platform: 'android'});
    expect(t.implantName).toBeUndefined();
    expect(t.type).toBe(ChipType.NTAG213);
  });

  it('stamps dtProduct + implant name from the DT historical-byte signature', async () => {
    // "JDNGRfS180" = flexSecure, an official DT implant.
    const lib = fakeLib({
      chip: ChipType.JCOP4,
      family: ChipFamily.JAVACARD,
      uid: [0x04, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66],
      historicalBytes: ascii('JDNGRfS180'),
    });
    mockIdentify.mockResolvedValue(lib);

    const t = await identifyTransponder({platform: 'android'});
    expect(t.dtProduct).toEqual({name: 'flexSecure', kind: 'implant'});
    expect(t.implantName).toBe('flexSecure');
    expect(t.productKind).toBe('implant');
    expect(t.confidence).toBe('high');
  });

  it('maps JavaCard CPLC + identity from the library probe data', async () => {
    // A Fidesmo device on J3R180 silicon → an Apex (IC-type path, no storage
    // needed). The library surfaces the parsed CPLC + present applet AIDs.
    const lib = fakeLib({
      chip: ChipType.JCOP4,
      family: ChipFamily.JAVACARD,
      uid: [0x04, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff],
      cplc: {
        icFabricator: 0x4790,
        icType: 0xd321, // → J3R180
        osId: 0x4791,
        osBuildDate: 0,
        icFabricationDate: 0,
        icSerialNumber: 0,
        icBatchIdentifier: 0,
        icModulePackager: 0,
        installerIdentifier: 0,
        raw: '',
      },
      // Fidesmo App AID present.
      aids: [[0xa0, 0x00, 0x00, 0x06, 0x17, 0x02, 0x00, 0x02, 0x00, 0x00, 0x01]],
      isdSelected: true,
    } as Partial<LibTransponder>);
    mockIdentify.mockResolvedValue(lib);

    const t = await identifyTransponder({platform: 'android'});
    expect(t.cplc?.icTypeName).toBe('J3R180');
    expect(t.installedApplets).toContain('Fidesmo');
    expect(t.implantName).toBe('Apex');
    expect(t.identityEvidence).toBeDefined();
    // ISD answered → a javacard credential is recorded.
    expect(t.credentials?.some(c => c.kind === 'javacard')).toBe(true);
    // …and the JavaCard substrate capability is derived from it.
    expect(t.capabilities).toEqual(
      expect.arrayContaining(['iso7816-substrate']),
    );
  });
});
