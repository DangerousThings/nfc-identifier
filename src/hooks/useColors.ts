/**
 * useColors
 *
 * The app's colour vocabulary, read from the active DT theme rather than the
 * static `DTColors` palette, so the brand and colour vision settings
 * recolour every screen. The keys mirror what the app used from `DTColors`;
 * `dark` and `light` are the background and foreground of the current theme,
 * not literal black and white.
 *
 * For `StyleSheet.create` blocks that mention a colour, build the sheet from
 * this object inside the component:
 *
 *   const colors = useColors();
 *   const styles = useMemo(() => makeStyles(colors), [colors]);
 */

import {useMemo} from 'react';
import {useDTTheme} from '@dangerousthings/react-native';

export interface AppColors {
  modeNormal: string;
  modeEmphasis: string;
  modeWarning: string;
  modeSuccess: string;
  modeOther: string;
  /** Page background of the current theme. */
  dark: string;
  /** Body text on that background. */
  light: string;
  background: string;
  surface: string;
  border: string;
  borderEmphasis: string;
}

export function useColors(): AppColors {
  const theme = useDTTheme();
  return useMemo(
    () => ({
      modeNormal: theme.custom.modeNormal,
      modeEmphasis: theme.custom.modeEmphasis,
      modeWarning: theme.custom.modeWarning,
      modeSuccess: theme.custom.modeSuccess,
      modeOther: theme.custom.modeOther,
      dark: theme.colors.background,
      light: theme.colors.onBackground,
      background: theme.colors.background,
      surface: theme.colors.surface,
      border: theme.custom.border,
      borderEmphasis: theme.custom.borderEmphasis,
    }),
    [theme],
  );
}
