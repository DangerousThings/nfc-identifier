/**
 * useReleaseNotesPrompt
 *
 * Shows a localised release-notes dialog with one "Close" button the first
 * time the app launches with a new CURRENT_RELEASE_ID. The user's
 * acknowledgement is persisted to AsyncStorage so subsequent launches
 * skip the prompt until the release ID changes again.
 *
 * Design notes:
 * - OTA-safe: uses Hermes' built-in `Intl` for language detection instead
 *   of `expo-localization` (which is a native module that would require
 *   a new binary build to ship).
 * - Shows on every device that hits a new release ID, including brand-new
 *   installs. The current release-notes content describes app capabilities,
 *   so this also doubles as a welcome on first launch — accepted tradeoff.
 * - If no release note is registered for the current ID, the marker is
 *   updated silently — no empty dialog.
 */

import {useEffect} from 'react';
import {Alert} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {CURRENT_RELEASE_ID, getCurrentReleaseNote} from '../data/releaseNotes';

const SEEN_RELEASE_KEY = 'last_seen_release_id';

/**
 * Get the device's primary language code (e.g. `en`, `es`, `de`).
 *
 * Hermes ships `Intl` support on Expo SDK 54 / RN 0.81; reading the
 * resolved locale never throws in practice, but we guard against it
 * anyway so this stays OTA-safe.
 */
function getDeviceLanguage(): string {
  try {
    const locale = Intl.DateTimeFormat().resolvedOptions().locale;
    return locale.split('-')[0].toLowerCase();
  } catch {
    return 'en';
  }
}

/**
 * Mount this hook once near the root of the navigation tree. It checks
 * AsyncStorage once on mount and may surface an `Alert.alert(...)` if a
 * new release should be shown.
 */
export function useReleaseNotesPrompt(): void {
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const seen = await AsyncStorage.getItem(SEEN_RELEASE_KEY);
        if (seen === CURRENT_RELEASE_ID) {
          return;
        }

        const note = getCurrentReleaseNote(getDeviceLanguage());
        if (!note) {
          // No release note registered for this ID — quietly update the
          // marker so we don't keep re-checking.
          await AsyncStorage.setItem(SEEN_RELEASE_KEY, CURRENT_RELEASE_ID);
          return;
        }

        if (cancelled) {
          return;
        }

        Alert.alert(note.title, note.body, [
          {
            text: 'Close',
            onPress: async () => {
              await AsyncStorage.setItem(
                SEEN_RELEASE_KEY,
                CURRENT_RELEASE_ID,
              );
            },
          },
        ]);
      } catch (err) {
        // Prompting failure is non-fatal — the app continues normally.
        console.warn('[ReleaseNotes] Failed to show prompt:', err);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);
}
