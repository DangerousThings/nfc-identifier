/**
 * JavaCard implant naming.
 *
 * The interesting cases here are the ones the signals *can't* resolve. CPLC
 * IC Type 0xD321 (J3R180) is shared by the Apex and the flexSecure, and a
 * flexSecure reports the same 167736-byte persistentTotal as any other
 * J3R180 — or none at all. So flexSecure is deliberately never asserted;
 * these tests pin that down so it isn't reintroduced by accident.
 */

jest.mock('react-native', () => ({
  Platform: {OS: 'android', select: (obj: any) => obj.android ?? obj.default},
}));

jest.mock('react-native-nfc-manager', () => ({
  __esModule: true,
  default: {},
  NfcTech: {},
}));

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

import {getJavacardImplantName} from '../detector';

const APEX_TOTAL = 84336;
const J3R180_TOTAL = 167736;

function storage(persistentTotal: number) {
  return {
    persistentFree: 1000,
    persistentTotal,
    transientResetFree: 0,
    transientDeselectFree: 0,
  };
}

describe('payment cards', () => {
  test('names the payment network', () => {
    const {name} = getJavacardImplantName(['Payment (PPSE)', 'Visa']);
    expect(name).toBe('Visa Payment Card');
  });

  test('falls back to a generic label when the network is unknown', () => {
    const {name} = getJavacardImplantName(['Payment (PPSE)']);
    expect(name).toBe('Payment Card');
  });
});

describe('Apex', () => {
  test('Fidesmo + Apex storage size identifies an Apex', () => {
    const {name, evidence} = getJavacardImplantName(
      ['Fidesmo', 'JavaCard Memory'],
      true,
      storage(APEX_TOTAL),
    );

    expect(name).toBe('Apex');
    // Two independent signals agreed — that's what earns the product name.
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: 'applet-set', matched: true}),
        expect.objectContaining({source: 'persistent-total', matched: true}),
      ]),
    );
  });

  test('Apex is still named when CPLC also reports J3R180', () => {
    const {name} = getJavacardImplantName(
      ['Fidesmo'],
      true,
      storage(APEX_TOTAL),
      'J3R180',
    );
    expect(name).toBe('Apex');
  });

  test('Fidesmo without Apex storage is a generic Fidesmo wearable', () => {
    const {name} = getJavacardImplantName(
      ['Fidesmo'],
      true,
      storage(J3R180_TOTAL),
    );
    expect(name).toBe('Fidesmo Wearable');
  });

  test('Fidesmo with unreadable storage does not claim Apex', () => {
    const {name} = getJavacardImplantName(['Fidesmo'], true, undefined);
    expect(name).toBe('Fidesmo Wearable');
  });
});

describe('part identification from CPLC', () => {
  // Silicon named by CPLC (J3R180 / J3R452) is surfaced in the header, not
  // as an implant name — so these return no product name, but do record the
  // CPLC evidence.
  test('D321 yields no product name (silicon shown in header)', () => {
    const {name, evidence} = getJavacardImplantName(
      ['JavaCard Memory'],
      false,
      storage(J3R180_TOTAL),
      'J3R180',
    );
    expect(name).toBeUndefined();
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: 'cplc-ic-type', matched: true}),
      ]),
    );
  });

  test('D600 yields no product name (silicon shown in header)', () => {
    const {name} = getJavacardImplantName(
      ['JavaCard Memory'],
      false,
      storage(J3R180_TOTAL),
      'J3R452',
    );
    expect(name).toBeUndefined();
  });

  test('no applets + known IC type still yields no product name', () => {
    const {name} = getJavacardImplantName([], false, undefined, 'J3R452');
    expect(name).toBeUndefined();
  });
});

describe('flexSecure is never asserted', () => {
  test('J3R180 storage size alone reports the part, not flexSecure', () => {
    const {name, evidence} = getJavacardImplantName(
      ['JavaCard Memory'],
      false,
      storage(J3R180_TOTAL),
    );

    expect(name).toBe('J3R180');
    expect(name).not.toBe('flexSecure');
    // The tie-breaker that would resolve this is recorded as missing.
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: 'historical-bytes', matched: false}),
      ]),
    );
  });

  test('unreadable storage yields no product name at all', () => {
    // Previously this fell back to "flexSecure". Absent storage is a known
    // J3R180 signature, so that fallback was unsupported by the evidence.
    const {name, evidence} = getJavacardImplantName(
      ['JavaCard Memory'],
      false,
      undefined,
    );

    expect(name).toBeUndefined();
    expect(evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({source: 'persistent-total', matched: false}),
      ]),
    );
  });
});

describe('no identification possible', () => {
  test('no applets and no CPLC yields no name and no evidence', () => {
    const {name, evidence} = getJavacardImplantName([], false, undefined);
    expect(name).toBeUndefined();
    expect(evidence).toHaveLength(0);
  });

  test('unrecognised applet set yields no name', () => {
    const {name} = getJavacardImplantName(['OpenPGP'], false, undefined);
    expect(name).toBeUndefined();
  });
});
