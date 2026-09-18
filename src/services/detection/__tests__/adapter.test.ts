/**
 * adapter.test.ts
 *
 * Unit tests for the identify() → app Transponder adapter. Builds fake LIBRARY
 * transponders (a few chip types + a gen4-magic one) and asserts the mapping
 * onto the app's Transponder shape, including the UG4 cardModeInfo mapping.
 * `NfcManager.identify` is mocked so no native NFC is touched.
 */

import {ChipType, ChipFamily} from '../../../types/detection';
import type {Transponder as LibTransponder} from '@dangerousthings/react-native-nfc-manager/src/transponders/base';
import type {Transport} from '@dangerousthings/react-native-nfc-manager/src/transponders/transport';
import type {TagInfo} from '@dangerousthings/react-native-nfc-manager/src/transponders/types';
import {decodeGetVersion} from '@dangerousthings/react-native-nfc-manager/src/transponders/probes/getversion';
import {DesfireTransponder} from '@dangerousthings/react-native-nfc-manager/src/transponders/isodep/desfire';
import {JavaCardTransponder} from '@dangerousthings/react-native-nfc-manager/src/transponders/isodep/javacard';
import {IcodeTag} from '@dangerousthings/react-native-nfc-manager/src/transponders/nfcv/iso15693';
import {Ntag5Transponder} from '@dangerousthings/react-native-nfc-manager/src/transponders/nfcv/ntag5';
import {KNOWN_AIDS} from '../../nfc/commands';
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
  } as unknown as LibTransponder;
}

/**
 * A scripted ISO-DEP transport: `transceive` matches the command against a list
 * of rules (first match wins) and returns the raw bytes for it, defaulting to a
 * 0x6A82 "file not found" so an unmatched SELECT reads as "applet absent".
 */
function scriptTransport(
  info: TagInfo,
  rules: Array<{when: (cmd: number[]) => boolean; resp: number[]}>,
): Transport {
  return {
    kind: 'isodep',
    uid: info.uid,
    sak: info.sak,
    atqa: info.atqa,
    ats: info.ats,
    historicalBytes: info.historicalBytes,
    transceive: async (cmd: number[]) => {
      const hit = rules.find(r => r.when(cmd));
      return hit ? hit.resp : [0x6a, 0x82];
    },
  } as unknown as Transport;
}

/** True when `cmd` is a SELECT-by-AID (00 A4 04 00 …) for exactly `aid`. */
function isSelect(cmd: number[], aid: readonly number[]): boolean {
  if (cmd[0] !== 0x00 || cmd[1] !== 0xa4 || cmd[2] !== 0x04) {
    return false;
  }
  const sent = cmd.slice(5, 5 + cmd[4]);
  return sent.length === aid.length && sent.every((v, i) => v === aid[i]);
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

/**
 * Encode a 7-byte GET_VERSION structure for the DESFire branch: NXP vendor,
 * byte1 = (impl<<4 | family), then subtype/hwMajor/hwMinor/storage/protocol.
 */
function getVersion7(byte1: number, hwMajor: number): number[] {
  return [0x04, byte1, 0x01, hwMajor, 0x00, 0x1a, 0x05];
}

/** DESFire GET_VERSION reply (7 data bytes + SW 0x91 0x00 "done"). */
function desfireVersionReply(byte1: number, hwMajor: number): number[] {
  return [...getVersion7(byte1, hwMajor), 0x91, 0x00];
}

describe('enrich — re-homed ISO-DEP DT probes (task 5b)', () => {
  beforeEach(() => mockIdentify.mockReset());

  it('#1/#2: surfaces implementation + version from a live DESFire', async () => {
    const info: TagInfo = {uid: [0x04, 0x1, 0x2, 0x3, 0x4, 0x5, 0x6], sak: 0x20};
    // byte1 0x01 = native (0x0) + DESFire family (0x1); hwMajor 0x12 → EV2.
    const t = scriptTransport(info, [
      {when: c => c[0] === 0x90 && c[1] === 0x60, resp: desfireVersionReply(0x01, 0x12)},
      {when: c => c[0] === 0x90 && c[1] === 0x6a, resp: [0x91, 0x00]},
    ]);
    const lib = new DesfireTransponder(info, t, decodeGetVersion(getVersion7(0x01, 0x12)));
    mockIdentify.mockResolvedValue(lib);

    const app = await identifyTransponder({platform: 'android'});
    expect(app.type).toBe(ChipType.DESFIRE_EV2);
    expect(app.implementation).toBe('native');
    expect(app.implementationByte).toBe(0x01);
    expect(app.versionInfo).toMatchObject({hardwareMajor: 0x12, hardwareStorageSize: 0x1a});
    // A DESFire credential is derived (no ISD → native substrate).
    expect(app.credentials?.some(c => c.kind === 'desfire')).toBe(true);
    expect(app.credentials?.some(c => c.kind === 'javacard')).toBe(false);
  });

  it('#5: enumerates DESFire application labels via enumerateApps()', async () => {
    const info: TagInfo = {uid: [0x04, 0x9], sak: 0x20};
    // GET_APPLICATION_IDS answers one AID, LSB-first (20 81 F4 → MSB F48120).
    const t = scriptTransport(info, [
      {when: c => c[0] === 0x90 && c[1] === 0x60, resp: desfireVersionReply(0x01, 0x12)},
      {when: c => c[0] === 0x90 && c[1] === 0x6a, resp: [0x20, 0x81, 0xf4, 0x91, 0x00]},
    ]);
    const lib = new DesfireTransponder(info, t, decodeGetVersion(getVersion7(0x01, 0x12)));
    mockIdentify.mockResolvedValue(lib);

    const app = await identifyTransponder({platform: 'android'});
    expect(app.installedApplets).toContain('App 0xF48120');
  });

  it('#4: promotes a Classic-SAK DESFire EV3 to EV3C with both credentials', async () => {
    // SAK 0x28 advertises MIFARE Classic 1K; hwMajor 0x30 → DESFire EV3.
    const info: TagInfo = {uid: [0x04, 0xa], sak: 0x28};
    const t = scriptTransport(info, [
      {when: c => c[0] === 0x90 && c[1] === 0x60, resp: desfireVersionReply(0x01, 0x30)},
      {when: c => c[0] === 0x90 && c[1] === 0x6a, resp: [0x91, 0x00]},
    ]);
    const lib = new DesfireTransponder(info, t, decodeGetVersion(getVersion7(0x01, 0x30)));
    mockIdentify.mockResolvedValue(lib);

    const app = await identifyTransponder({platform: 'android'});
    expect(app.type).toBe(ChipType.DESFIRE_EV3C);
    expect(app.credentials?.some(c => c.kind === 'desfire')).toBe(true);
    expect(app.credentials?.some(c => c.kind === 'mifare-classic')).toBe(true);
  });

  it('#3: names a payment card via a live PPSE probe on a JavaCard', async () => {
    const info: TagInfo = {uid: [0x04, 0xb, 0xc, 0xd, 0xe, 0xf, 0x1], sak: 0x20};
    const t = scriptTransport(info, [
      {when: c => isSelect(c, KNOWN_AIDS.ppse), resp: [0x90, 0x00]},
      {when: c => isSelect(c, KNOWN_AIDS.visaCredit), resp: [0x90, 0x00]},
    ]);
    // Constructed directly (bypassing the network-driven identify) with a
    // JavaCard probe that found an ISD but no Fidesmo / CPLC.
    const lib = new JavaCardTransponder(info, t, {isd: true, aids: [], cplc: undefined});
    mockIdentify.mockResolvedValue(lib);

    const app = await identifyTransponder({platform: 'android'});
    expect(app.installedApplets).toEqual(
      expect.arrayContaining(['Payment (PPSE)', 'Visa']),
    );
    expect(app.implantName).toBe('Visa Payment Card');
    expect(app.productKind).toBe('payment-card');
  });

  it('#3: reads JavaCard Memory persistentTotal into storageInfo', async () => {
    const info: TagInfo = {uid: [0x04, 0x2, 0x3], sak: 0x20};
    // persistent_total 0x00028F38 = 167736 (J3R180); 4B free, 4B total, 2B, 2B.
    const memoryResp = [
      0x00, 0x02, 0x8f, 0x00, // persistentFree
      0x00, 0x02, 0x8f, 0x38, // persistentTotal = 167736
      0x00, 0x10, // transientResetFree
      0x00, 0x20, // transientDeselectFree
      0x90, 0x00,
    ];
    const t = scriptTransport(info, [
      {when: c => isSelect(c, KNOWN_AIDS.javacardMemory), resp: memoryResp},
    ]);
    const lib = new JavaCardTransponder(info, t, {isd: false, aids: [KNOWN_AIDS.javacardMemory], cplc: undefined});
    mockIdentify.mockResolvedValue(lib);

    const app = await identifyTransponder({platform: 'android'});
    expect(app.storageInfo?.persistentTotal).toBe(167736);
    // JavaCard Memory + J3R180 storage size, no CPLC → "J3R180" fallback name.
    expect(app.implantName).toBe('J3R180');
  });
});

// ---------------------------------------------------------------------------
// NfcV (ISO 15693) DT probes — task 5c
// ---------------------------------------------------------------------------

/**
 * A scripted NfcV (ISO 15693) transport. `transceive` dispatches on the frame's
 * opcode byte (bytes[1]): GET_SYSTEM_INFO = 0x2B, READ_SINGLE_BLOCK = 0x20.
 * `sysInfo` is the raw GET_SYSTEM_INFO reply (or a function of it); `block(n)`
 * returns a block's 4 data bytes (the library strips the response-flags byte,
 * so we prepend 0x00). An undefined `sysInfo` answers the error flag.
 */
function nfcvTransport(
  uid: number[],
  opts: {sysInfo?: number[]; block?: (n: number) => number[]},
): Transport {
  return {
    kind: 'nfcv',
    uid,
    transceive: async (cmd: number[]) => {
      if (cmd[1] === 0x2b) {
        return opts.sysInfo ?? [0x01, 0x0f]; // error flag → getSystemInfo throws
      }
      if (cmd[1] === 0x20 && opts.block) {
        return [0x00, ...opts.block(cmd[2])];
      }
      return [0x01, 0x0f];
    },
  } as unknown as Transport;
}

describe('enrich — re-homed NfcV DT probes (task 5c)', () => {
  beforeEach(() => mockIdentify.mockReset());

  it('names a VK Thermo from GET_SYSTEM_INFO AFI/DSFID', async () => {
    const uid = [0x01, 0, 0, 0, 0, 0x01, 0x04, 0xe0];
    // infoFlags 0x03 = DSFID (0x01) + AFI (0x02); DSFID 0x0A → 117, AFI 0x54.
    const sysInfo = [0x00, 0x03, ...uid, 0x0a, 0x54];
    const t = nfcvTransport(uid, {sysInfo});
    const lib = new Ntag5Transponder(
      {uid},
      t,
      {chip: ChipType.NTAG5_LINK},
    );
    mockIdentify.mockResolvedValue(lib);

    const app = await identifyTransponder({platform: 'android'});
    expect(app.family).toBe(ChipFamily.ISO15693);
    expect(app.implantName).toBe('VK Thermo 117');
    expect(app.productKind).toBe('implant');
    // FORK GAP: temperature reads need NXP custom commands the lib lacks.
    expect(app.temperature).toBeUndefined();
  });

  it('names an ISO 15693 Spark 1 from the NDEF vivokey.co URL', async () => {
    const uid = [0x02, 0, 0, 0, 0, 0x01, 0x04, 0xe0];
    // 32-byte NDEF area whose ASCII carries a vivokey.co/<code> URL.
    const buf: number[] = [
      ...[...'  vivokey.co/sp4rk  '].map(c => c.charCodeAt(0)),
    ];
    while (buf.length < 32) {
      buf.push(0x00);
    }
    const t = nfcvTransport(uid, {
      // No system info (error) → Thermo path skipped, Spark path runs.
      block: n => buf.slice(n * 4, n * 4 + 4),
    });
    const lib = new IcodeTag({uid}, t, {chip: ChipType.SLIX});
    mockIdentify.mockResolvedValue(lib);

    const app = await identifyTransponder({platform: 'android'});
    expect(app.type).toBe(ChipType.SLIX);
    expect(app.implantName).toBe('Spark 1');
    expect(app.productKind).toBe('implant');
  });

  it('leaves a plain SLIX with no VK Thermo / Spark signature unnamed', async () => {
    const uid = [0x03, 0, 0, 0, 0, 0x01, 0x04, 0xe0];
    // Valid system info, AFI 0x00 (not Thermo); NDEF has no vivokey.co URL.
    const sysInfo = [0x00, 0x03, ...uid, 0x00, 0x00];
    const t = nfcvTransport(uid, {
      sysInfo,
      block: () => [0xde, 0xad, 0xbe, 0xef],
    });
    const lib = new IcodeTag({uid}, t, {chip: ChipType.SLIX2});
    mockIdentify.mockResolvedValue(lib);

    const app = await identifyTransponder({platform: 'android'});
    expect(app.implantName).toBeUndefined();
    expect(app.productKind).toBeUndefined();
  });
});
