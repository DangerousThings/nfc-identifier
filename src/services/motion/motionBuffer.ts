/**
 * Motion Ring Buffer
 * Fixed-capacity circular buffer for storing recent sensor readings
 */

import type {MotionReading} from '../../types/motion';

export class MotionRingBuffer {
  private buffer: MotionReading[];
  private capacity: number;
  private writeIndex: number;
  private count: number;

  constructor(capacity: number = 150) {
    this.capacity = capacity;
    this.buffer = new Array(capacity);
    this.writeIndex = 0;
    this.count = 0;
  }

  push(reading: MotionReading): void {
    this.buffer[this.writeIndex] = reading;
    this.writeIndex = (this.writeIndex + 1) % this.capacity;
    if (this.count < this.capacity) {
      this.count++;
    }
  }

  /** Get the last N readings in chronological order */
  getLastN(n: number): MotionReading[] {
    const count = Math.min(n, this.count);
    if (count === 0) {
      return [];
    }

    const result: MotionReading[] = new Array(count);
    // Start from (writeIndex - count) and read forward
    let readIndex =
      (this.writeIndex - count + this.capacity) % this.capacity;
    for (let i = 0; i < count; i++) {
      result[i] = this.buffer[readIndex];
      readIndex = (readIndex + 1) % this.capacity;
    }
    return result;
  }

  /** Get readings from the last `durationMs` milliseconds */
  getLastMs(durationMs: number): MotionReading[] {
    if (this.count === 0) {
      return [];
    }

    // Most recent reading is at writeIndex - 1
    const latestIndex =
      (this.writeIndex - 1 + this.capacity) % this.capacity;
    const latestT = this.buffer[latestIndex].t;
    const cutoff = latestT - durationMs;

    // Walk backwards to find the start
    const all = this.getLastN(this.count);
    const startIdx = all.findIndex(r => r.t >= cutoff);
    return startIdx >= 0 ? all.slice(startIdx) : [];
  }

  clear(): void {
    this.writeIndex = 0;
    this.count = 0;
  }

  get size(): number {
    return this.count;
  }
}
