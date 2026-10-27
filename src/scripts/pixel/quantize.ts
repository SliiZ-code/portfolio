export type RGB = [number, number, number];

export interface Palette {
  paper: RGB;
  ink: RGB;
  accent: RGB;
}

export const parseHex = (hex: string): RGB => {
  let value = hex.trim().replace('#', '');
  if (value.length === 3) value = [...value].map((c) => c + c).join('');
  const n = parseInt(value.slice(0, 6), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

const LEVELS = 4;

/**
 * Five ink levels between paper and ink, plus the accent for saturated colours. Light pixels read
 * as paper on the paper theme and as ink on the night theme. Works in place on RGBA data.
 */
export function quantize(data: Uint8ClampedArray, palette: Palette, night: boolean): void {
  const { paper, ink, accent } = palette;
  for (let i = 0; i < data.length; i += 4) {
    const r = data[i];
    const g = data[i + 1];
    const b = data[i + 2];
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const lum = (r * 0.3 + g * 0.59 + b * 0.11) / 255;
    const sat = max ? (max - min) / max : 0;
    if (sat > 0.5 && max > 90) {
      data[i] = accent[0];
      data[i + 1] = accent[1];
      data[i + 2] = accent[2];
    } else {
      const level = Math.round((night ? lum : 1 - lum) * LEVELS) / LEVELS;
      data[i] = Math.round(paper[0] + (ink[0] - paper[0]) * level);
      data[i + 1] = Math.round(paper[1] + (ink[1] - paper[1]) * level);
      data[i + 2] = Math.round(paper[2] + (ink[2] - paper[2]) * level);
    }
    data[i + 3] = 255;
  }
}

export const readPalette = (): { palette: Palette; night: boolean } => {
  const style = getComputedStyle(document.documentElement);
  return {
    palette: {
      paper: parseHex(style.getPropertyValue('--paper')),
      ink: parseHex(style.getPropertyValue('--ink')),
      accent: parseHex(style.getPropertyValue('--accent')),
    },
    night: document.documentElement.dataset.theme === 'night',
  };
};
