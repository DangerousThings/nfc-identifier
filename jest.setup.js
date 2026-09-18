/* eslint-env jest */
/**
 * Jest setup: replace native modules that have no JS fallback under jest.
 * AsyncStorage's own in-memory mock (see the async-storage jest docs).
 */
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);
