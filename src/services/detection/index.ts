/**
 * Detection Module
 *
 * Chip identification now lives in the library
 * (`@dangerousthings/react-native-nfc-manager`); the app calls it through
 * `identifyTransponder` in `adapter.ts`. What remains here is the staying DT
 * layer that wraps and enriches the library's result.
 */

export {identifyTransponder} from './adapter';
export {emulatedCredentials} from './dtEnrich';
export {matchDtHistoricalSignature} from './dtproducts';
export type {DtProductMatch} from './dtproducts';
