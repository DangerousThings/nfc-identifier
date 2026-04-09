/**
 * Motion Data Collection Types
 * Types for accelerometer/gyroscope data collection and labeling
 */

/** Single sensor reading from DeviceMotion */
export interface MotionReading {
  /** Milliseconds offset from window start */
  t: number;
  /** Acceleration X (m/s^2) */
  ax: number;
  /** Acceleration Y (m/s^2) */
  ay: number;
  /** Acceleration Z (m/s^2) */
  az: number;
  /** Gyroscope X (rad/s) */
  gx: number;
  /** Gyroscope Y (rad/s) */
  gy: number;
  /** Gyroscope Z (rad/s) */
  gz: number;
}

/** Labels for captured motion samples */
export type MotionLabel =
  | 'scan_initiated'
  | 'scan_success'
  | 'scan_timeout'
  | 'app_idle';

/** A labeled motion data sample ready for storage/upload */
export interface MotionSample {
  id: string;
  timestamp: string;
  label: MotionLabel;
  deviceModel: string;
  platform: 'ios' | 'android';
  osVersion: string;
  sensorData: {
    samplingRateHz: number;
    readings: MotionReading[];
  };
}

/** Consent status for motion data collection */
export type ConsentStatus = 'opted_in' | 'opted_out' | 'not_asked' | 'loading';
