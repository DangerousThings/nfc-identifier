/**
 * useFixtureCapture
 *
 * Toggleable per-scan fixture recording. When enabled, the detector calls
 * fixtureRecorder.startCapture() at the start of each detectChip() and the
 * result screen shows a "Copy fixture JSON" button. Off by default — only
 * meaningful in dev/QA builds.
 *
 * Persisted in AsyncStorage so the user's last choice survives app
 * restarts. Shared via Context so the detector and UI see the same value
 * even when the toggle was flipped after mount.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'fixture_capture_enabled';

export interface UseFixtureCaptureResult {
  enabled: boolean;
  setEnabled: (value: boolean) => Promise<void>;
}

const FixtureCaptureContext =
  createContext<UseFixtureCaptureResult | null>(null);

export function FixtureCaptureProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [enabled, setEnabledState] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(value => {
      setEnabledState(value === 'true');
    });
  }, []);

  const setEnabled = useCallback(async (value: boolean) => {
    await AsyncStorage.setItem(STORAGE_KEY, value ? 'true' : 'false');
    setEnabledState(value);
  }, []);

  return React.createElement(
    FixtureCaptureContext.Provider,
    {value: {enabled, setEnabled}},
    children,
  );
}

export function useFixtureCapture(): UseFixtureCaptureResult {
  const ctx = useContext(FixtureCaptureContext);
  if (!ctx) {
    throw new Error(
      'useFixtureCapture must be used within FixtureCaptureProvider',
    );
  }
  return ctx;
}

/**
 * Imperative read of the current setting from AsyncStorage. Used by the
 * detector since it cannot subscribe to a hook. Returns false on error.
 */
export async function isFixtureCaptureEnabled(): Promise<boolean> {
  try {
    const value = await AsyncStorage.getItem(STORAGE_KEY);
    return value === 'true';
  } catch {
    return false;
  }
}
