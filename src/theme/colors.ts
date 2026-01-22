export const DTColors = {
  dark: '#000000',
  light: '#FFFFFF',
  modeNormal: '#00FFFF', // Cyan - primary actions
  modeNormalSelected: 'rgba(0, 255, 255, 0.7)',
  modeEmphasis: '#FFFF00', // Yellow - highlights
  modeEmphasisSelected: 'rgba(255, 255, 0, 0.7)',
  modeWarning: '#FF0000', // Red - errors/warnings
  modeSuccess: '#00FF00', // Green - success states
  modeOther: '#FF00FF', // Magenta - misc
} as const;

export type DTColorKey = keyof typeof DTColors;
