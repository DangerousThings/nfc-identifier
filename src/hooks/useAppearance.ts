/**
 * useAppearance
 *
 * The design-system appearance settings, fed straight into DTThemeProvider:
 *
 *   brand        — 'dt' (cyberpunk) or 'classic' (clean)
 *   colorVision  — palette swap for protanopia / deuteranopia / tritanopia
 *   motionScale  — animation speed 0..1 (0 = off)
 *   stillImages  — show animated images as a single frame
 *
 * Persisted in AsyncStorage as one JSON record and shared via Context, so a
 * change in the settings modal re-themes every mounted screen. Stored values
 * are untrusted: each field is parsed on its own and junk falls back to the
 * default for that field, never to a crash.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  brands,
  parseColorVisionMode,
  parseMotionScale,
  type ColorVisionMode,
  type ThemeBrand,
} from '@dangerousthings/tokens';

const STORAGE_KEY = 'appearance';

export interface Appearance {
  brand: ThemeBrand;
  colorVision: ColorVisionMode;
  motionScale: number;
  stillImages: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  brand: 'dt',
  colorVision: 'none',
  motionScale: 1,
  stillImages: false,
};

/** Narrow an untrusted value to a brand the tokens package knows about. */
export function parseBrand(raw: unknown): ThemeBrand | null {
  return typeof raw === 'string' &&
    Object.prototype.hasOwnProperty.call(brands, raw)
    ? (raw as ThemeBrand)
    : null;
}

/** Parse the stored JSON record, field by field, falling back per field. */
export function parseAppearance(value: string | null): Appearance {
  if (!value) {
    return DEFAULT_APPEARANCE;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(value);
  } catch {
    return DEFAULT_APPEARANCE;
  }
  if (typeof raw !== 'object' || raw === null) {
    return DEFAULT_APPEARANCE;
  }
  const record = raw as Record<string, unknown>;
  return {
    brand: parseBrand(record.brand) ?? DEFAULT_APPEARANCE.brand,
    colorVision:
      parseColorVisionMode(record.colorVision) ??
      DEFAULT_APPEARANCE.colorVision,
    motionScale:
      parseMotionScale(record.motionScale) ?? DEFAULT_APPEARANCE.motionScale,
    stillImages:
      typeof record.stillImages === 'boolean'
        ? record.stillImages
        : DEFAULT_APPEARANCE.stillImages,
  };
}

export interface UseAppearanceResult extends Appearance {
  /** Merge a partial change, apply it immediately, then persist. */
  update: (patch: Partial<Appearance>) => Promise<void>;
  setBrand: (brand: ThemeBrand) => Promise<void>;
  setColorVision: (mode: ColorVisionMode) => Promise<void>;
  setMotionScale: (scale: number) => Promise<void>;
  setStillImages: (still: boolean) => Promise<void>;
}

const AppearanceContext = createContext<UseAppearanceResult | null>(null);

export function AppearanceProvider({children}: {children: React.ReactNode}) {
  const [appearance, setAppearance] =
    useState<Appearance>(DEFAULT_APPEARANCE);
  // Mirror of the state so back-to-back updates merge onto the latest value
  // rather than a stale render.
  const latest = useRef(appearance);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then(value => {
      const parsed = parseAppearance(value);
      latest.current = parsed;
      setAppearance(parsed);
    });
  }, []);

  const update = useCallback(async (patch: Partial<Appearance>) => {
    const next = {...latest.current, ...patch};
    latest.current = next;
    setAppearance(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }, []);

  const value = useMemo<UseAppearanceResult>(
    () => ({
      ...appearance,
      update,
      setBrand: brand => update({brand}),
      setColorVision: colorVision => update({colorVision}),
      setMotionScale: motionScale => update({motionScale}),
      setStillImages: stillImages => update({stillImages}),
    }),
    [appearance, update],
  );

  return React.createElement(AppearanceContext.Provider, {value}, children);
}

export function useAppearance(): UseAppearanceResult {
  const ctx = useContext(AppearanceContext);
  if (!ctx) {
    throw new Error('useAppearance must be used within AppearanceProvider');
  }
  return ctx;
}
