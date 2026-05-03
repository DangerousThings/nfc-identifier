/**
 * useDataConsent Hook + Context
 * Shared consent state for motion data collection
 */

import React, {
  useState,
  useEffect,
  useCallback,
  useContext,
  createContext,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type {ConsentStatus} from '../types/motion';

const CONSENT_KEY = 'data_consent_status';
const SAMPLES_KEY = 'motion_samples';

export interface UseDataConsentResult {
  consentStatus: ConsentStatus;
  setConsent: (status: 'opted_in' | 'opted_out') => Promise<void>;
  clearLocalData: () => Promise<void>;
}

const DataConsentContext = createContext<UseDataConsentResult | null>(null);

export function DataConsentProvider({children}: {children: React.ReactNode}) {
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

  const value = {consentStatus, setConsent, clearLocalData};

  return React.createElement(
    DataConsentContext.Provider,
    {value},
    children,
  );
}

export function useDataConsent(): UseDataConsentResult {
  const context = useContext(DataConsentContext);
  if (!context) {
    throw new Error('useDataConsent must be used within DataConsentProvider');
  }
  return context;
}
