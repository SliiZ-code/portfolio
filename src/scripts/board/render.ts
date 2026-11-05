import type { World } from './life';
import type { Structure } from './types';

export interface Colors {
  paper: string;
  ink: string;
  mute: string;
  /** Newborn → young, warm to cool; older cells fall back to `ink` at half opacity. */
  life: [string, string, string, string];
}

/** First age of each colour bucket after the first: 0–2 newborn, 3–6, 7–11, 12–17; from 18 on the cell is calm. */
export const AGE_STEPS = [3, 7, 12, 18] as const;
export const BUCKETS = AGE_STEPS.length + 1;
/** Bucket 0 is the brightest, the last one is the resting ink. */
export const BUCKET_ALPHA = [1, 1, 0.92, 0.78, 0.5] as const;

/** Colour bucket of a live cell: 0…BUCKETS-2 for the warm→cool ramp, BUCKETS-1 for the calm grey. */
export const ageBucket = (age: number): number => {
  for (let b = 0; b < AGE_STEPS.length; b++) if (age < AGE_STEPS[b]) return b;
  return AGE_STEPS.length;
};

/** Scratch space for the draw loop, allocated once per layout: no per-frame allocation. */
export interface RenderBuffers {
  /** BUCKETS lists of cell indices, `size` entries each. */
  lists: Uint32Array;
  counts: Int32Array;
  size: number;
}

export const createRenderBuffers = (size: number): RenderBuffers => ({
  lists: new Uint32Array(size * BUCKETS),
  counts: new Int32Array(BUCKETS),
  size,
});

/** The opening shockwave: everything inside the front is shown, a band of newborn colours rides on it. */
export interface Shockwave {
  /** Centre, in cells. */
  cx: number;
  cy: number;
  /** Radius of the front, in cells. */
  front: number;
  /** Width of one colour band, in cells. */
  band: number;
}

export interface RenderState {
  ctx: CanvasRenderingContext2D;
  /** Pixels per cell. */
  cell: number;
  dpr: number;
  width: number;
  height: number;
  world: World;
  structures: Structure[];
  colors: Colors;
  buffers: RenderBuffers;
  /** Null once the opening is over (or when there is none). */
  wave: Shockwave | null;
}

/** A cheap, stable 0…3 per cell (an integer hash, so no visible patches), so the ring reads as cells rather than as a solid stroke. */
const sparkle = (x: number, y: number): number => {
  let h = Math.imul(x, 0x45d9f3b) ^ Math.imul(y + 0x9e3779b9, 0x2c1b3c6d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  h ^= h >>> 13;
  return h & 3;
};

export function draw(state: RenderState): void {
  const { ctx, cell, dpr, width, height, world, structures, colors, buffers, wave } = state;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const gap = cell >= 4 ? 1 : 0;
  const size = cell - gap;
  const { w, cells, age } = world;
  const { lists, counts } = buffers;
  const reveal = wave ? wave.front * wave.front : Infinity;
  const cx = wave ? wave.cx : 0;
  const cy = wave ? wave.cy : 0;

  // one pass sorts the live cells into colour buckets, then one fillStyle per bucket
  counts.fill(0);
  for (let i = 0; i < cells.length; i++) {
    if (!cells[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    if (reveal !== Infinity && (x - cx) * (x - cx) + (y - cy) * (y - cy) > reveal) continue;
    const b = ageBucket(age[i]);
    lists[b * buffers.size + counts[b]++] = i;
  }
  for (let b = 0; b < BUCKETS; b++) {
    if (!counts[b]) continue;
    ctx.globalAlpha = BUCKET_ALPHA[b];
    ctx.fillStyle = b < BUCKETS - 1 ? colors.life[b] : colors.ink;
    const base = b * buffers.size;
    for (let n = 0; n < counts[b]; n++) {
      const i = lists[base + n];
      ctx.fillRect((i % w) * cell + gap, ((i / w) | 0) * cell + gap, size, size);
    }
  }

  ctx.globalAlpha = 1;
  for (const structure of structures) {
    ctx.fillStyle = colors.ink;
    for (let k = 0; k < structure.cur.length; k++) {
      if (!structure.cur[k] || structure.hidden[k]) continue;
      const x = structure.x + (k % structure.w);
      const y = structure.y + ((k / structure.w) | 0);
      if (reveal !== Infinity && (x - cx) * (x - cx) + (y - cy) * (y - cy) > reveal) continue;
      ctx.fillRect(x * cell + gap, y * cell + gap, size, size);
    }
  }

  if (wave) drawShockwave(ctx, wave, colors, cell, gap, size, world.w, world.h);
}

/** The ring: BUCKETS-1 concentric bands of newborn colours behind the front, brightest first. */
function drawShockwave(ctx: CanvasRenderingContext2D, wave: Shockwave, colors: Colors, cell: number, gap: number, size: number, cols: number, rows: number): void {
  const { cx, cy, front, band } = wave;
  ctx.globalAlpha = 1;
  for (let b = 0; b < colors.life.length; b++) {
    const outer = front - b * band;
    const inner = outer - band;
    if (outer <= 0) break;
    ctx.fillStyle = colors.life[b];
    const o2 = outer * outer;
    const i2 = inner > 0 ? inner * inner : -1;
    const y0 = Math.max(0, Math.ceil(cy - outer));
    const y1 = Math.min(rows - 1, Math.floor(cy + outer));
    for (let y = y0; y <= y1; y++) {
      const dy = y - cy;
      const dxo = Math.sqrt(Math.max(0, o2 - dy * dy));
      const dxi = i2 >= 0 && dy * dy < i2 ? Math.sqrt(i2 - dy * dy) : 0;
      // two spans per row: left and right of the centre, between the inner and the outer circle
      for (let side = -1; side <= 1; side += 2) {
        const from = Math.ceil(dxi);
        const to = Math.floor(dxo);
        for (let d = from; d <= to; d++) {
          const x = Math.round(cx + side * d);
          if (x < 0 || x >= cols || (side === 1 && d === 0) || sparkle(x, y) === 0) continue;
          ctx.fillRect(x * cell + gap, y * cell + gap, size, size);
        }
      }
    }
  }
}
