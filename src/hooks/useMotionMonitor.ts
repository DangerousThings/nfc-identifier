/**
 * useMotionMonitor Hook
 * Manages motion sensor subscription based on consent and app state
 */

import {useEffect} from 'react';
import {AppState} from 'react-native';
import {motionMonitor} from '../services/motion/motionMonitor';
import {uploadService} from '../services/motion/uploadService';
import type {ConsentStatus} from '../types/motion';

export function useMotionMonitor(consentStatus: ConsentStatus): void {
  useEffect(() => {
    if (consentStatus !== 'opted_in') {
      motionMonitor.stop();
      return;
    }

    motionMonitor.start();
    // Retry any queued uploads on start
    uploadService.retryQueue();

    const subscription = AppState.addEventListener('change', nextState => {
      if (nextState === 'active') {
        motionMonitor.start();
        uploadService.retryQueue();
      } else {
        motionMonitor.stop();
      }
    });

    return () => {
      subscription.remove();
      motionMonitor.stop();
    };
  }, [consentStatus]);
}
