/**
 * Detection Module
 * Re-exports all detection functionality
 */

export {detectChip, getDetectionSummary, canDoAdvancedDetection} from './detector';
export type {DetectionProgressCallback} from './detector';
export {detectNtag, mightBeNtag, formatNtagVersionInfo, detectImplantNameInMemory} from './ntag';
export type {ImplantNameResult} from './ntag';
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
export {detectDesfire, mightBeDesfire, formatDesfireVersionInfo, detectSpark2Implant} from './desfire';
export type {DesfireDetectionResult, Spark2DetectionResult} from './desfire';
export {detectIso15693, isIso15693, getIcManufacturerName, detectSparkImplant, parseIso15693Uid} from './iso15693';
export type {Iso15693DetectionResult, SparkDetectionResult} from './iso15693';
export {detectNtag5SensorImplant, detectNtag5Sensors, detectThermoFromSystemInfo, readThermoSignature} from './ntag5sensor';
export type {Ntag5SensorResult, SensorType, DeviceType} from './ntag5sensor';
export {detectJavaCard, mightBeJavaCard, formatCPLC, hasJavacardMemory} from './javacard';
export type {JavaCardDetectionResult, CPLCData} from './javacard';
