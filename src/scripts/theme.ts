export type Theme = 'paper' | 'night';

export const initialTheme = (stored: string | null, hour: number): Theme => {
  if (stored === 'night' || stored === 'paper') {
    return stored;
  }
  return hour >= 19 || hour < 7 ? 'night' : 'paper';
};
