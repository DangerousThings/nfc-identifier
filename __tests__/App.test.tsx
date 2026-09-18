/**
 * @format
 */

import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// Native-only modules with no JS fallback under jest. Expo modules need the
// `jest-expo` preset to load at all, so each one the app tree reaches is
// replaced with the slice of its API the app calls.
jest.mock('@dangerousthings/react-native-nfc-manager', () => ({
  __esModule: true,
  default: {
    isSupported: jest.fn().mockResolvedValue(false),
    isEnabled: jest.fn().mockResolvedValue(false),
    start: jest.fn().mockResolvedValue(undefined),
    setEventListener: jest.fn(),
    registerTagEvent: jest.fn().mockResolvedValue(undefined),
    unregisterTagEvent: jest.fn().mockResolvedValue(undefined),
    requestTechnology: jest.fn().mockResolvedValue(undefined),
    cancelTechnologyRequest: jest.fn().mockResolvedValue(undefined),
    getTag: jest.fn().mockResolvedValue(null),
    goToNfcSetting: jest.fn().mockResolvedValue(undefined),
  },
  NfcTech: {},
  NfcEvents: {},
  NfcAdapter: {
    FLAG_READER_NFC_A: 0x1,
    FLAG_READER_SKIP_NDEF_CHECK: 0x80,
    FLAG_READER_NO_PLATFORM_SOUNDS: 0x100,
  },
}));
jest.mock('expo-clipboard', () => ({setStringAsync: jest.fn()}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => '00000000-0000-4000-8000-000000000000',
  digestStringAsync: jest.fn().mockResolvedValue(''),
  CryptoDigestAlgorithm: {SHA256: 'SHA-256'},
}));
jest.mock('expo-device', () => ({
  deviceName: 'jest',
  modelName: 'jest',
  osVersion: '0',
}));
jest.mock('expo-screen-orientation', () => ({
  getOrientationAsync: jest.fn().mockResolvedValue(1),
  Orientation: {
    UNKNOWN: 0,
    PORTRAIT_UP: 1,
    PORTRAIT_DOWN: 2,
    LANDSCAPE_LEFT: 3,
    LANDSCAPE_RIGHT: 4,
  },
}));
jest.mock('expo-updates', () => ({channel: 'jest', updateId: null}));
jest.mock('expo-sensors', () => ({
  DeviceMotion: {
    addListener: jest.fn(() => ({remove: jest.fn()})),
    setUpdateInterval: jest.fn(),
  },
}));

import App from '../App';

test('renders correctly', async () => {
  await ReactTestRenderer.act(() => {
    ReactTestRenderer.create(<App />);
  });
});
