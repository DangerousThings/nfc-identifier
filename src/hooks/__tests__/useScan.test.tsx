/**
 * useScan — scan state machine over the fork's identify() adapter.
 *
 * Phase 5 / Task 4 migrated useScan off `detectChip` onto
 * `identifyTransponder()` (the identify() adapter). These tests pin the
 * behaviour that must survive the swap:
 *   - the idle → scanning → success/error/idle state machine,
 *   - the onProgress → scanProgress plumbing,
 *   - error mapping (pre-scan status, scan-session errors, and library
 *     errors thrown *inside* identify() — tag loss vs unknown),
 *   - the identify() options useScan passes (probeMagic / platform /
 *     rawAvailable / onExchange), and the fixture-capture gate.
 *
 * All native NFC + the adapter are mocked; nothing touches a real tag.
 */

import React from 'react';
import renderer, {act} from 'react-test-renderer';

import type {RawTagData} from '../../types/nfc';
import type {Transponder} from '../../types/detection';

// useScan only reaches into react-native for Platform.OS (the detectedOn /
// probeMagic gate). Pin it to android so probeMagic defaults on.
jest.mock('react-native', () => ({Platform: {OS: 'android'}}));

// The NFC singleton: session arming + teardown live here. scanWithDetection is
// modelled on the real one — it runs the detect callback and *swallows* a throw
// from it, returning just {tag} (see NFCManager.scanWithDetection).
const mockGetStatus = jest.fn();
const mockScanWithDetection = jest.fn();
const mockCancelScan = jest.fn().mockResolvedValue(undefined);
const mockInit = jest.fn().mockResolvedValue(undefined);
const mockOpenSettings = jest.fn().mockResolvedValue(undefined);
jest.mock('../../services/nfc', () => ({
  nfcManager: {
    init: (...a: unknown[]) => mockInit(...a),
    getStatus: (...a: unknown[]) => mockGetStatus(...a),
    scanWithDetection: (...a: unknown[]) => mockScanWithDetection(...a),
    cancelScan: (...a: unknown[]) => mockCancelScan(...a),
    openNFCSettings: (...a: unknown[]) => mockOpenSettings(...a),
  },
}));

const mockIdentify = jest.fn();
jest.mock('../../services/detection/adapter', () => ({
  identifyTransponder: (...a: unknown[]) => mockIdentify(...a),
}));

const mockIsTagLoss = jest.fn();
jest.mock('@dangerousthings/react-native-nfc-manager', () => ({
  __esModule: true,
  default: {},
  isTagLoss: (e: unknown) => mockIsTagLoss(e),
}));

const mockCaptureSample = jest.fn();
jest.mock('../../services/motion', () => ({
  sampleCollector: {captureSample: (...a: unknown[]) => mockCaptureSample(...a)},
}));

const mockStartCapture = jest.fn();
const mockStopCapture = jest.fn();
const mockRecord = jest.fn();
jest.mock('../../services/detection/fixtureRecorder', () => ({
  startCapture: (...a: unknown[]) => mockStartCapture(...a),
  stopCapture: (...a: unknown[]) => mockStopCapture(...a),
  record: (...a: unknown[]) => mockRecord(...a),
}));

const mockIsFixtureCaptureEnabled = jest.fn();
jest.mock('../useFixtureCapture', () => ({
  isFixtureCaptureEnabled: (...a: unknown[]) => mockIsFixtureCaptureEnabled(...a),
}));

// eslint-disable-next-line import/first
import {useScan, type UseScanResult} from '../useScan';

// Test harness: surface the latest hook result to the test.
let latest: UseScanResult;
function Harness() {
  latest = useScan();
  return null;
}

const FAKE_TAG: RawTagData = {
  uid: '04:AB:CD:EF:12:34:56',
  techTypes: ['android.nfc.tech.NfcA'],
  sak: 0x00,
} as unknown as RawTagData;

const FAKE_TRANSPONDER = {
  type: 'NTAG216',
  chipName: 'NTAG216',
  isCloneable: true,
  rawData: {uid: FAKE_TAG.uid, techTypes: []},
  confidence: 'high',
  detectedOn: 'android',
} as unknown as Transponder;

/** Model the real scanWithDetection: run detectFn, swallow its throws. */
function armScan(
  tag: RawTagData | undefined,
  error?: unknown,
) {
  mockScanWithDetection.mockImplementation(
    async (detectFn: (t: RawTagData) => Promise<unknown>) => {
      if (error) {
        return {error};
      }
      if (!tag) {
        return {};
      }
      try {
        const detection = await detectFn(tag);
        return {tag, detection};
      } catch {
        return {tag};
      }
    },
  );
}

async function mountAndScan() {
  let tree!: renderer.ReactTestRenderer;
  await act(async () => {
    tree = renderer.create(<Harness />);
  });
  await act(async () => {
    await latest.startScan();
  });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetStatus.mockResolvedValue({isSupported: true, isEnabled: true});
  mockIsFixtureCaptureEnabled.mockResolvedValue(false);
  mockIsTagLoss.mockReturnValue(false);
  mockIdentify.mockResolvedValue(FAKE_TRANSPONDER);
  armScan(FAKE_TAG);
});

describe('useScan — success path', () => {
  it('runs identify() and lands in success with the mapped transponder', async () => {
    await mountAndScan();
    expect(latest.state).toBe('success');
    expect(latest.tag).toEqual(FAKE_TAG);
    expect(latest.transponder).toBe(FAKE_TRANSPONDER);
    expect(mockIdentify).toHaveBeenCalledTimes(1);
  });

  it('passes probeMagic (android), platform, rawAvailable to identify()', async () => {
    await mountAndScan();
    const opts = mockIdentify.mock.calls[0][0];
    expect(opts.probeMagic).toBe(true);
    expect(opts.platform).toBe('android');
    expect(opts.rawAvailable).toBe(false);
    expect(typeof opts.onProgress).toBe('function');
  });

  it('threads identify() onProgress into scanProgress', async () => {
    mockIdentify.mockImplementation(async (opts: {onProgress?: (s: string) => void}) => {
      opts.onProgress?.('Reading NTAG version...');
      return FAKE_TRANSPONDER;
    });
    let tree!: renderer.ReactTestRenderer;
    await act(async () => {
      tree = renderer.create(<Harness />);
    });
    await act(async () => {
      await latest.startScan();
    });
    // Terminal progress step after identify resolves.
    expect(latest.scanProgress).toEqual({step: 'Detection complete', current: 4});
    await act(async () => {
      tree.unmount();
    });
  });
});

describe('useScan — fixture capture gate', () => {
  it('does not start capture or pass onExchange when the toggle is off', async () => {
    mockIsFixtureCaptureEnabled.mockResolvedValue(false);
    await mountAndScan();
    expect(mockStartCapture).not.toHaveBeenCalled();
    expect(mockIdentify.mock.calls[0][0].onExchange).toBeUndefined();
  });

  it('starts capture and wires onExchange to the recorder when the toggle is on', async () => {
    mockIsFixtureCaptureEnabled.mockResolvedValue(true);
    await mountAndScan();
    expect(mockStartCapture).toHaveBeenCalledTimes(1);
    const {onExchange} = mockIdentify.mock.calls[0][0];
    expect(typeof onExchange).toBe('function');
    onExchange([0x30, 0x00], [0x01, 0x02]);
    expect(mockRecord).toHaveBeenCalledWith('nfcA', [0x30, 0x00], [0x01, 0x02]);
  });
});

describe('useScan — error mapping', () => {
  it('maps a NOT SUPPORTED status to an error before scanning', async () => {
    mockGetStatus.mockResolvedValue({isSupported: false, isEnabled: false});
    await mountAndScan();
    expect(latest.state).toBe('error');
    expect(latest.error?.type).toBe('NFC_NOT_SUPPORTED');
    expect(mockScanWithDetection).not.toHaveBeenCalled();
  });

  it('maps a NOT ENABLED status to an error before scanning', async () => {
    mockGetStatus.mockResolvedValue({isSupported: true, isEnabled: false});
    await mountAndScan();
    expect(latest.state).toBe('error');
    expect(latest.error?.type).toBe('NFC_NOT_ENABLED');
  });

  it('surfaces a scan-session error from scanWithDetection', async () => {
    armScan(undefined, undefined);
    mockScanWithDetection.mockResolvedValue({
      error: {type: 'TAG_LOST', message: 'Tag was removed during scan'},
    });
    await mountAndScan();
    expect(latest.state).toBe('error');
    expect(latest.error?.type).toBe('TAG_LOST');
  });

  it('returns to idle (no error) on a cancelled scan', async () => {
    mockScanWithDetection.mockResolvedValue({
      error: {type: 'SCAN_CANCELLED', message: 'Scan was cancelled'},
    });
    await mountAndScan();
    expect(latest.state).toBe('idle');
    expect(latest.error).toBeNull();
  });

  it('maps a tag-loss thrown inside identify() to TAG_LOST', async () => {
    mockIdentify.mockRejectedValue(new Error('the tag was lost'));
    mockIsTagLoss.mockReturnValue(true);
    await mountAndScan();
    expect(latest.state).toBe('error');
    expect(latest.error?.type).toBe('TAG_LOST');
  });

  it('maps a non-tag-loss throw inside identify() to UNKNOWN', async () => {
    mockIdentify.mockRejectedValue(new Error('boom'));
    mockIsTagLoss.mockReturnValue(false);
    await mountAndScan();
    expect(latest.state).toBe('error');
    expect(latest.error?.type).toBe('UNKNOWN');
  });
});
