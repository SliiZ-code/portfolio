import { quantize, readPalette } from './quantize';

const WIDTH = 160;

/** Draws `source` into `canvas` at 160 px wide, quantised to the current theme's ink levels. */
export function pixelateInto(
  canvas: HTMLCanvasElement,
  ctx: CanvasRenderingContext2D,
  source: CanvasImageSource,
  sw: number,
  sh: number,
): void {
  const height = Math.max(1, Math.round((WIDTH * sh) / sw));
  if (canvas.width !== WIDTH || canvas.height !== height) {
    canvas.width = WIDTH;
    canvas.height = height;
  }
  ctx.drawImage(source, 0, 0, WIDTH, height);
  const image = ctx.getImageData(0, 0, WIDTH, height);
  const { palette, night } = readPalette();
  quantize(image.data, palette, night);
  ctx.putImageData(image, 0, 0);
}

/**
 * A project capture drawn as chunky pixels: a video is re-quantised every frame, a picture once
 * (and again when the theme changes). Without a capture the canvas is plain paper.
 */
export function initPixelPreview(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#pix');
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!canvas || !ctx) return;
  const src = canvas.dataset.src ?? '';
  const kind = canvas.dataset.kind ?? '';

  const blank = () => {
    canvas.width = 120;
    canvas.height = 75;
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim();
    ctx.fillRect(0, 0, 120, 75);
  };

  if (!src || (kind !== 'video' && kind !== 'image')) {
    blank();
    document.addEventListener('themechange', blank);
    return;
  }

  if (kind === 'image') {
    const image = new Image();
    const draw = () => pixelateInto(canvas, ctx, image, image.naturalWidth, image.naturalHeight);
    image.onload = draw;
    image.src = src;
    document.addEventListener('themechange', () => image.complete && image.naturalWidth && draw());
    return;
  }

  const video = Object.assign(document.createElement('video'), {
    muted: true,
    loop: true,
    playsInline: true,
    preload: 'auto',
    src,
  });
  const frameIt = () => {
    if (video.readyState >= 2) pixelateInto(canvas, ctx, video, video.videoWidth, video.videoHeight);
  };

  // reduced motion: a still capture, recoloured on theme change, instead of a looping video
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
    video.addEventListener('loadeddata', frameIt, { once: true });
    document.addEventListener('themechange', frameIt);
    return;
  }

  video.play().catch(() => undefined);
  const frame = () => {
    requestAnimationFrame(frame);
    frameIt();
  };
  requestAnimationFrame(frame);
}
