/**
 * Release Notes
 *
 * Shown once per release ID via a dialog on first app launch after the
 * matching JS bundle arrives (typically right after an OTA update).
 *
 * To ship a new release-notes prompt:
 * 1. Bump CURRENT_RELEASE_ID below.
 * 2. Add a corresponding entry to RELEASE_NOTES with localised strings.
 * 3. Push the OTA. The next time each user launches the app, they see
 *    the dialog once; subsequent launches skip it until the ID changes
 *    again.
 *
 * Localisation strategy: we use the device language reported by the
 * Hermes built-in `Intl` API (no native module needed, OTA-safe). Each
 * string is a LocalizedString keyed by IETF language code (`en`, `es`,
 * `de`, ...). When the user's language is missing, we fall back to
 * English.
 */

/** Stable identifier for the release. Bump to trigger a new prompt. */
export const CURRENT_RELEASE_ID = 'an10833-rework-v1';

/**
 * A string with translations keyed by IETF language code.
 * `en` is required as the fallback for unsupported locales.
 */
export interface LocalizedString {
  en: string;
  [locale: string]: string;
}

export interface ReleaseNote {
  id: string;
  title: LocalizedString;
  body: LocalizedString;
}

export const RELEASE_NOTES: Record<string, ReleaseNote> = {
  'an10833-rework-v1': {
    id: 'an10833-rework-v1',
    title: {
      en: "What's new",
    },
    body: {
      en: [
        'Smarter chip detection (AN10833-aligned):',
        '',
        '• Distinguishes real MIFARE Classic from SmartMX, Plus EV1 SL1, and JavaCard substrates emulating Classic',
        '• Identifies new chip types: MIFARE DUOX, NTAG X DNA, MIFARE Plus EV2, MIFARE 2GO',
        '• Tells Apex implants apart from Fidesmo wearables by storage capacity',
        '• flexSecure detection now requires matching P71 silicon',
        '• Compatibility warnings flag cloning caveats (substrate uncertainty, capacity mismatch)',
        '',
        'Plus an opt-in fixture-capture mode in Settings for developers and QA.',
      ].join('\n'),
    },
  },
};

/** Pick the best translation for the user's language with English fallback. */
function pickLocale(localized: LocalizedString, language: string): string {
  return localized[language] ?? localized.en;
}

/**
 * Fetch the release note for the current release in the user's language,
 * or `null` if no note is registered for the current release ID.
 */
export function getCurrentReleaseNote(
  language: string,
): {title: string; body: string} | null {
  const note = RELEASE_NOTES[CURRENT_RELEASE_ID];
  if (!note) {
    return null;
  }
  return {
    title: pickLocale(note.title, language),
    body: pickLocale(note.body, language),
  };
}
