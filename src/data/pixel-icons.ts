/** 7×7 pixel sun and moon; the theme toggle shows the one you switch to. */
const ICONS = {
  sun: ['...O...', '.O...O.', '..OOO..', 'O.OOO.O', '..OOO..', '.O...O.', '...O...'],
  moon: ['..OOO..', '.OO....', 'OO.....', 'OO.....', 'OO.....', '.OO....', '..OOO..'],
} as const;

export const iconPixels = (name: keyof typeof ICONS): { x: number; y: number }[] =>
  ICONS[name].flatMap((row, y) => [...row].flatMap((cell, x) => (cell === 'O' ? [{ x, y }] : [])));
