/**
 * useSwipeBack
 *
 * What the iOS swipe-back gesture does on the result screen. Three choices:
 *
 *   restart-scan     — start a fresh scan (default)
 *   previous-result  — pop to the result before this one, the plain stack pop
 *   home             — back to the home screen
 *
 * Only the *gesture* follows this setting: the header back arrow and the
 * Android system back keep popping the stack normally. Android's native stack
 * has no swipe gesture at all (`gestureEnabled` is iOS-only), so the setting
 * has no effect there.
 *
 * Persisted in AsyncStorage and shared via Context, so a change on the home
 * screen reaches an already-mounted result screen.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = 'swipe_back_action';

export type SwipeBackAction = 'restart-scan' | 'previous-result' | 'home';

const DEFAULT_ACTION: SwipeBackAction = 'restart-scan';

const ACTIONS: SwipeBackAction[] = ['restart-scan', 'previous-result', 'home'];

/** Labels for the settings UI, in display order. */
export const SWIPE_BACK_OPTIONS: Array<{
  value: SwipeBackAction;
  label: string;
}> = [
  {value: 'restart-scan', label: 'Restart scan'},
  {value: 'previous-result', label: 'Previous result'},
  {value: 'home', label: 'Home'},
];

/** Narrow a stored string to a known action, falling back to the default. */
export function parseSwipeBackAction(value: string | null): SwipeBackAction {
  return ACTIONS.includes(value as SwipeBackAction)
    ? (value as SwipeBackAction)
    : DEFAULT_ACTION;
}

export interface UseSwipeBackResult {
  action: SwipeBackAction;
  setAction: (value: SwipeBackAction) => Promise<void>;
}

const SwipeBackContext = createContext<UseSwipeBackResult | null>(null);

export function SwipeBackProvider({children}: {children: React.ReactNode}) {
  const [action, setActionState] = useState<SwipeBackAction>(DEFAULT_ACTION);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(value => {
      setActionState(parseSwipeBackAction(value));
    });
  }, []);

  const setAction = useCallback(async (value: SwipeBackAction) => {
    await AsyncStorage.setItem(STORAGE_KEY, value);
    setActionState(value);
  }, []);

  return React.createElement(
    SwipeBackContext.Provider,
    {value: {action, setAction}},
    children,
  );
}

export function useSwipeBack(): UseSwipeBackResult {
  const ctx = useContext(SwipeBackContext);
  if (!ctx) {
    throw new Error('useSwipeBack must be used within SwipeBackProvider');
  }
  return ctx;
}
