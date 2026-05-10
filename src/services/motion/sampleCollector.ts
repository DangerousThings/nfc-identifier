/**
 * Sample Collector
 * Captures labeled motion samples from the monitor and uploads them
 */

import {Platform} from 'react-native';
import * as Device from 'expo-device';
import * as Crypto from 'expo-crypto';
import * as ScreenOrientation from 'expo-screen-orientation';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {motionMonitor} from './motionMonitor';
import {uploadService} from './uploadService';
import type {
  MotionSample,
  MotionLabel,
  ScreenOrientation as MotionScreenOrientation,
} from '../../types/motion';

const SAMPLES_KEY = 'motion_samples';
const MAX_LOCAL_SAMPLES = 500;
const SNAPSHOT_DURATION_MS = 3000;

function getDeviceModel(): string {
  return Device.modelName ?? Device.deviceName ?? 'unknown';
}

function getOsVersion(): string {
  return Device.osVersion ?? 'unknown';
}

async function getScreenOrientation(): Promise<MotionScreenOrientation> {
  try {
    const orientation = await ScreenOrientation.getOrientationAsync();
    switch (orientation) {
      case ScreenOrientation.Orientation.PORTRAIT_UP:
        return 'portrait';
      case ScreenOrientation.Orientation.PORTRAIT_DOWN:
        return 'portrait-upside-down';
      case ScreenOrientation.Orientation.LANDSCAPE_LEFT:
        return 'landscape-left';
      case ScreenOrientation.Orientation.LANDSCAPE_RIGHT:
        return 'landscape-right';
      default:
        return 'unknown';
    }
  } catch {
    return 'unknown';
  }
}

export class SampleCollector {
  async captureSample(label: MotionLabel): Promise<void> {
    if (!motionMonitor.isRunning) {
      console.log(`[Motion] Skipping ${label} capture — monitor not running`);
      return;
    }

    const readings = motionMonitor.snapshot(SNAPSHOT_DURATION_MS);
    if (readings.length === 0) {
      console.log(`[Motion] Skipping ${label} capture — no readings in buffer`);
      return;
    }

    console.log(`[Motion] Capturing ${label} — ${readings.length} readings`);

    const screenOrientation = await getScreenOrientation();

    const sample: MotionSample = {
      id: Crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      label,
      deviceModel: getDeviceModel(),
      platform: Platform.OS as 'ios' | 'android',
      osVersion: getOsVersion(),
      screenOrientation,
      sensorData: {
        samplingRateHz: motionMonitor.samplingRateHz,
        readings,
      },
    };

    // Store locally
    await this.storeSample(sample);
    console.log(`[Motion] Stored ${label} sample (${sample.id.slice(0, 8)})`);

    // Upload (queues on failure)
    uploadService.upload(sample).then(ok => {
      console.log(`[Motion] Upload ${ok ? 'succeeded' : 'queued'} (${sample.id.slice(0, 8)})`);
    });
  }

  private async storeSample(sample: MotionSample): Promise<void> {
    const raw = await AsyncStorage.getItem(SAMPLES_KEY);
    const samples: MotionSample[] = raw ? JSON.parse(raw) : [];
    samples.push(sample);

    // Prune oldest if over capacity
    const trimmed =
      samples.length > MAX_LOCAL_SAMPLES
        ? samples.slice(samples.length - MAX_LOCAL_SAMPLES)
        : samples;

    await AsyncStorage.setItem(SAMPLES_KEY, JSON.stringify(trimmed));
  }

  async getSampleCount(): Promise<number> {
    const raw = await AsyncStorage.getItem(SAMPLES_KEY);
    if (!raw) {
      return 0;
    }
    return JSON.parse(raw).length;
  }

  async exportSamples(): Promise<MotionSample[]> {
    const raw = await AsyncStorage.getItem(SAMPLES_KEY);
    return raw ? JSON.parse(raw) : [];
  }

  async clearSamples(): Promise<void> {
    await AsyncStorage.removeItem(SAMPLES_KEY);
    await uploadService.clearQueue();
  }
}

export const sampleCollector = new SampleCollector();
