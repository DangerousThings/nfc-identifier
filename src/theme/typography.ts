import {Platform} from 'react-native';

export const DTFonts = {
  primary: Platform.select({
    ios: 'Tektur',
    android: 'Tektur',
    default: 'System',
  }),
} as const;

export const DTTypography = {
  displayLarge: {
    fontFamily: DTFonts.primary,
    fontSize: 57,
    fontWeight: '400' as const,
    letterSpacing: -0.25,
  },
  displayMedium: {
    fontFamily: DTFonts.primary,
    fontSize: 45,
    fontWeight: '400' as const,
  },
  displaySmall: {
    fontFamily: DTFonts.primary,
    fontSize: 36,
    fontWeight: '400' as const,
  },
  headlineLarge: {
    fontFamily: DTFonts.primary,
    fontSize: 32,
    fontWeight: '400' as const,
  },
  headlineMedium: {
    fontFamily: DTFonts.primary,
    fontSize: 28,
    fontWeight: '400' as const,
  },
  headlineSmall: {
    fontFamily: DTFonts.primary,
    fontSize: 24,
    fontWeight: '400' as const,
  },
  titleLarge: {
    fontFamily: DTFonts.primary,
    fontSize: 22,
    fontWeight: '500' as const,
  },
  titleMedium: {
    fontFamily: DTFonts.primary,
    fontSize: 16,
    fontWeight: '500' as const,
    letterSpacing: 0.15,
  },
  titleSmall: {
    fontFamily: DTFonts.primary,
    fontSize: 14,
    fontWeight: '500' as const,
    letterSpacing: 0.1,
  },
  bodyLarge: {
    fontFamily: DTFonts.primary,
    fontSize: 16,
    fontWeight: '400' as const,
    letterSpacing: 0.5,
  },
  bodyMedium: {
    fontFamily: DTFonts.primary,
    fontSize: 14,
    fontWeight: '400' as const,
    letterSpacing: 0.25,
  },
  bodySmall: {
    fontFamily: DTFonts.primary,
    fontSize: 12,
    fontWeight: '400' as const,
    letterSpacing: 0.4,
  },
  labelLarge: {
    fontFamily: DTFonts.primary,
    fontSize: 14,
    fontWeight: '500' as const,
    letterSpacing: 0.1,
  },
  labelMedium: {
    fontFamily: DTFonts.primary,
    fontSize: 12,
    fontWeight: '500' as const,
    letterSpacing: 0.5,
  },
  labelSmall: {
    fontFamily: DTFonts.primary,
    fontSize: 11,
    fontWeight: '500' as const,
    letterSpacing: 0.5,
  },
} as const;
