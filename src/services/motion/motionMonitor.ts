/**
 * Motion Monitor Service
 * Subscribes to device motion sensors and maintains a ring buffer of readings
 */

import {DeviceMotion, type DeviceMotionMeasurement} from 'expo-sensors';
import {MotionRingBuffer} from './motionBuffer';
import type {MotionReading} from '../../types/motion';

const SAMPLING_RATE_HZ = 30;
const BUFFER_DURATION_S = 5;
const BUFFER_CAPACITY = SAMPLING_RATE_HZ * BUFFER_DURATION_S; // 150

export class MotionMonitor {
  private buffer: MotionRingBuffer;
  private subscription: ReturnType<typeof DeviceMotion.addListener> | null =
    null;
  private startTime: number = 0;

  constructor() {
    this.buffer = new MotionRingBuffer(BUFFER_CAPACITY);
  }

  start(): void {
    if (this.subscription) {
      return;
    }

    this.buffer.clear();
    this.startTime = Date.now();

    DeviceMotion.setUpdateInterval(Math.round(1000 / SAMPLING_RATE_HZ));

    this.subscription = DeviceMotion.addListener(
      (data: DeviceMotionMeasurement) => {
        const reading: MotionReading = {
          t: Date.now() - this.startTime,
          ax: data.acceleration?.x ?? 0,
          ay: data.acceleration?.y ?? 0,
          az: data.acceleration?.z ?? 0,
          gx: data.rotation?.alpha ?? 0,
          gy: data.rotation?.beta ?? 0,
          gz: data.rotation?.gamma ?? 0,
        };
        this.buffer.push(reading);
      },
    );
  }

  stop(): void {
    if (this.subscription) {
      this.subscription.remove();
      this.subscription = null;
    }
  }

  /** Grab the last `durationMs` of sensor data */
  snapshot(durationMs: number = 3000): MotionReading[] {
    return this.buffer.getLastMs(durationMs);
  }

  get samplingRateHz(): number {
    return SAMPLING_RATE_HZ;
  }

  get isRunning(): boolean {
    return this.subscription !== null;
  }
}

/** Singleton instance */
export const motionMonitor = new MotionMonitor();
