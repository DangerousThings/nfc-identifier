/**
 * Gen4 "Ultimate" probe (Android path): close the dirty scan connection,
 * reconnect fresh NfcA, send CF 00 00 00 00 C6; any non-empty answer is a hit.
 */

jest.mock('react-native', () => ({Platform: {OS: 'android'}}));

jest.mock('@dangerousthings/react-native-nfc-manager', () => ({
  __esModule: true,
  default: {close: jest.fn(), connect: jest.fn(), transceive: jest.fn()},
  NfcTech: {NfcA: 'NfcA'},
}));

jest.mock('../../nfc/commands', () => ({sendType2Command: jest.fn()}));

import NfcManager from '@dangerousthings/react-native-nfc-manager';
import {GEN4_GET_CONFIG, probeGen4Ultimate} from '../gen4';

const mockClose = NfcManager.close as jest.Mock;
const mockConnect = NfcManager.connect as jest.Mock;
const mockTransceive = NfcManager.transceive as jest.Mock;

beforeEach(() => {
  mockClose.mockReset().mockResolvedValue(undefined);
  mockConnect.mockReset().mockResolvedValue(undefined);
  mockTransceive.mockReset();
});

describe('probeGen4Ultimate (android)', () => {
  it('closes, reconnects NfcA, then sends CF …C6', async () => {
    mockTransceive.mockResolvedValue([0x00]);
    await probeGen4Ultimate();
    expect(mockConnect).toHaveBeenCalledWith(['NfcA']);
    expect(mockTransceive).toHaveBeenCalledWith(GEN4_GET_CONFIG);
    expect(GEN4_GET_CONFIG).toEqual([0xcf, 0x00, 0x00, 0x00, 0x00, 0xc6]);
  });

  it('is a hit on any non-empty response, and releases the tech', async () => {
    mockTransceive.mockResolvedValue([0x11, 0x22]);
    await expect(probeGen4Ultimate()).resolves.toBe(true);
    expect(mockClose).toHaveBeenCalledTimes(2); // pre-connect close + release
  });

  it('is not a hit on an empty response', async () => {
    mockTransceive.mockResolvedValue([]);
    await expect(probeGen4Ultimate()).resolves.toBe(false);
  });

  it('is not a hit when transceive throws, and still releases', async () => {
    mockTransceive.mockRejectedValue(new Error('Tag was lost'));
    await expect(probeGen4Ultimate()).resolves.toBe(false);
    expect(mockClose).toHaveBeenCalledTimes(2);
  });
});
