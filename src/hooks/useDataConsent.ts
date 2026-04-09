/**
 * useDataConsent Hook
 * Manages user consent for motion data collection
 */

import {useState, useEffect, useCallback} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {ConsentStatus} from '../types/motion';

const CONSENT_KEY = 'data_consent_status';
const SAMPLES_KEY = 'motion_samples';

export interface UseDataConsentResult {
  consentStatus: ConsentStatus;
  setConsent: (status: 'opted_in' | 'opted_out') => Promise<void>;
  clearLocalData: () => Promise<void>;
}

export function useDataConsent(): UseDataConsentResult {
  const [consentStatus, setConsentStatus] = useState<ConsentStatus>('loading');

  useEffect(() => {
    AsyncStorage.getItem(CONSENT_KEY).then(value => {
      if (value === 'opted_in' || value === 'opted_out') {
        setConsentStatus(value);
      } else {
        setConsentStatus('not_asked');
      }
    });
  }, []);

  const setConsent = useCallback(
    async (status: 'opted_in' | 'opted_out') => {
      await AsyncStorage.setItem(CONSENT_KEY, status);
      setConsentStatus(status);
    },
    [],
  );

  const clearLocalData = useCallback(async () => {
    await AsyncStorage.removeItem(SAMPLES_KEY);
  }, []);

  return {consentStatus, setConsent, clearLocalData};
}
