/**
 * Detection Module
 * Re-exports all detection functionality
 */

export {detectChip, getDetectionSummary, canDoAdvancedDetection} from './detector';
export {detectNtag, mightBeNtag, formatNtagVersionInfo} from './ntag';
export {
  detectMifareClassic,
  isMifareClassicSak,
  hasIsoDepCapability,
  describeSak,
  detectSakSwap,
  mightBeMagicCard,
  IOS_MIFARE_CLASSIC_NOTE,
} from './mifare';
export type {SakSwapDetection} from './mifare';
export {detectDesfire, mightBeDesfire, formatDesfireVersionInfo} from './desfire';
export type {DesfireDetectionResult} from './desfire';
export {detectIso15693, isIso15693, getIcManufacturerName} from './iso15693';
export type {Iso15693DetectionResult} from './iso15693';
export {detectJavaCard, mightBeJavaCard, formatCPLC} from './javacard';
export type {JavaCardDetectionResult, CPLCData} from './javacard';
