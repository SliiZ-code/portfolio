const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((value) => (value + 0.5) / 16);

/** Ordered-dither a project capture into ink/paper, live. */
export function initDither(): void {
  const canvas = document.querySelector<HTMLCanvasElement>('#dither');
  if (!canvas) return;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return;

  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const src = canvas.dataset.src ?? '';
  const kind = canvas.dataset.kind ?? '';

  const video = Object.assign(document.createElement('video'), {
    muted: true,
    loop: true,
    playsInline: true,
  });
  const image = new Image();
  let source: HTMLVideoElement | HTMLImageElement | null = null;

  if (src && kind === 'video') {
    video.src = src;
    video.play().catch(() => undefined);
    source = video;
  } else if (src && kind === 'image') {
    image.src = src;
    source = image;
  }

  const frame = () => {
    requestAnimationFrame(frame);
    const paper = css('--paper');
    const inkCss = css('--ink');
    ctx.fillStyle = paper;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (!source) return;
    if (source === video && video.readyState < 2) return;
    if (source === image && !image.complete) return;

    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const pixels = data.data;
    const ink = parseInt(inkCss.slice(1), 16);
    const pap = parseInt(paper.slice(1), 16);

    let mean = 0;
    for (let i = 0; i < pixels.length; i += 16) {
      mean += pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11;
    }
    const flip = mean / (pixels.length / 16) / 255 < 0.45;

    for (let i = 0; i < pixels.length; i += 4) {
      const px = (i >> 2) % canvas.width;
      const py = (i >> 2) / canvas.width | 0;
      const on = ((pixels[i] * 0.3 + pixels[i + 1] * 0.59 + pixels[i + 2] * 0.11) / 255 < BAYER[(py & 3) * 4 + (px & 3)]) !== flip;
      const color = on ? ink : pap;
      pixels[i] = color >> 16;
      pixels[i + 1] = (color >> 8) & 255;
      pixels[i + 2] = color & 255;
      pixels[i + 3] = 255;
    }
    ctx.putImageData(data, 0, 0);
  };

  requestAnimationFrame(frame);
}
