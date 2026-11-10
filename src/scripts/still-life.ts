/**
 * Game of Life still lifes and blinkers for the decorative dividers between home sections: pure patterns, blinker
 * phase and row layout (tested), and the canvas that draws them.
 */

export type Pattern = number[][];

/** 2×2 still life */
export const BLOCK: Pattern = [
  [1, 1],
  [1, 1],
];

/** 4×3 horizontal beehive */
export const BEEHIVE: Pattern = [
  [0, 1, 1, 0],
  [1, 0, 0, 1],
  [0, 1, 1, 0],
];

/** 4×4 still life */
export const LOAF: Pattern = [
  [0, 1, 1, 0],
  [1, 0, 0, 1],
  [0, 1, 0, 1],
  [0, 0, 1, 0],
];

/** 3×3 still life */
export const BOAT: Pattern = [
  [1, 1, 0],
  [1, 0, 1],
  [0, 1, 0],
];

/** 3×3 still life */
export const TUB: Pattern = [
  [0, 1, 0],
  [1, 0, 1],
  [0, 1, 0],
];

/** 3×3 period-2 oscillator: phase 0 (horizontal) and phase 1 (vertical) */
export const BLINKER_PHASES: [Pattern, Pattern] = [
  [
    [0, 0, 0],
    [1, 1, 1],
    [0, 0, 0],
  ],
  [
    [0, 1, 0],
    [0, 1, 0],
    [0, 1, 0],
  ],
];

export const STILL_LIFES = {
  block: BLOCK,
  beehive: BEEHIVE,
  loaf: LOAF,
  boat: BOAT,
  tub: TUB,
} as const;

export const ROW_HEIGHT_CELLS = 6;
/** One divider cell in CSS px: 2× the board's smallest cell. Fixed, so the row never changes height with the board. */
export const DIVIDER_CELL = 6;
/** Empty cells between two patterns: wide and irregular, so the row stays sparse. */
export const MIN_GAP_CELLS = 6;
export const MAX_GAP_CELLS = 20;
/** A row holds about one pattern per this many cells, at most MAX_PATTERNS: a phone gets fewer. */
const CELLS_PER_PATTERN = 16;
export const MAX_PATTERNS = 7;
export const BLINKER_PERIOD_MS = 600;

/** The blinker phase (0 or 1) at `timeMs`: it flips every `periodMs`. */
export function blinkerPhase(timeMs: number, periodMs = BLINKER_PERIOD_MS): 0 | 1 {
  const step = Math.floor(timeMs / periodMs);
  return (((step % 2) + 2) % 2) as 0 | 1;
}

/** 32-bit Mulberry32 PRNG for deterministic, reproducible layouts per seed. */
export function createRnd(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type PatternName = 'block' | 'beehive' | 'loaf' | 'boat' | 'tub' | 'blinker';

export interface PlacedPattern {
  name: PatternName;
  x: number;
  y: number;
  width: number;
  height: number;
  cells: Pattern;
  isBlinker: boolean;
}

interface PatternDescriptor {
  name: PatternName;
  width: number;
  height: number;
  cells: Pattern;
  isBlinker: boolean;
}

const DESCRIPTORS: readonly PatternDescriptor[] = [
  { name: 'block', width: 2, height: 2, cells: BLOCK, isBlinker: false },
  { name: 'beehive', width: 4, height: 3, cells: BEEHIVE, isBlinker: false },
  { name: 'loaf', width: 4, height: 4, cells: LOAF, isBlinker: false },
  { name: 'boat', width: 3, height: 3, cells: BOAT, isBlinker: false },
  { name: 'tub', width: 3, height: 3, cells: TUB, isBlinker: false },
  { name: 'blinker', width: 3, height: 3, cells: BLINKER_PHASES[0], isBlinker: true },
];

/**
 * Lays still lifes and blinkers out in one row across `width` px. Patterns never overlap or overflow, and
 * between two of them there are MIN_GAP_CELLS to MAX_GAP_CELLS empty cells. The row holds about one pattern per
 * CELLS_PER_PATTERN cells, capped at MAX_PATTERNS, so a phone gets fewer. Deterministic for a seeded `rnd`.
 */
export function layoutRow(width: number, cell: number, rnd: () => number = Math.random): PlacedPattern[] {
  if (width <= 0 || cell <= 0) return [];
  const cols = Math.floor(width / cell);
  if (cols < 2) return [];
  const maxPatterns = Math.min(MAX_PATTERNS, Math.max(2, Math.round(cols / CELLS_PER_PATTERN)));

  const placed: PlacedPattern[] = [];
  let x = Math.floor(rnd() * 3);

  while (placed.length < maxPatterns && x < cols) {
    const remaining = cols - x;
    const candidates = DESCRIPTORS.filter((d) => d.width <= remaining);
    if (candidates.length === 0) break;

    const chosen = candidates[Math.floor(rnd() * candidates.length)]!;
    placed.push({
      name: chosen.name,
      x,
      y: Math.floor((ROW_HEIGHT_CELLS - chosen.height) / 2),
      width: chosen.width,
      height: chosen.height,
      cells: chosen.cells,
      isBlinker: chosen.isBlinker,
    });

    const gap = MIN_GAP_CELLS + Math.floor(rnd() * (MAX_GAP_CELLS - MIN_GAP_CELLS + 1));
    x += chosen.width + gap;
  }

  return placed;
}

// Random seed per page load (constant during this visit)
const PAGE_SEED = Math.floor(Math.random() * 0x100000000);
/** Each drawn cell stops one px short of its slot, the same as the living paper. */
const CELL_GAP = 1;

/**
 * Draws the dividers. Each one lays its row out for its own width and draws it in the muted ink, with the
 * blinkers in the accent. Only the blinkers move: one timer flips them on the shared 600 ms boundary, and it runs
 * only while a divider is on screen, the tab is visible and motion is allowed. Redraws on resize and theme change.
 */
export function initLifeDividers(): void {
  const dividers = document.querySelectorAll<HTMLElement>('.life-divider');
  if (!dividers.length) return;

  const root = document.documentElement;
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const height = ROW_HEIGHT_CELLS * DIVIDER_CELL;

  dividers.forEach((divider, index) => {
    if (divider.dataset.lifeDividerInit === 'true') return;
    divider.dataset.lifeDividerInit = 'true';

    const canvas = divider.querySelector<HTMLCanvasElement>('canvas.life-divider-canvas');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    // a deterministic layout per divider, from the page seed
    const seed = (PAGE_SEED ^ (index * 0x9e3779b9)) >>> 0;

    let placed: PlacedPattern[] = [];
    let scale = 1;
    let phase: 0 | 1 = 0;
    let inView = false;
    let timer = 0;

    const draw = () => {
      const style = getComputedStyle(root);
      const mute = style.getPropertyValue('--mute').trim();
      const accent = style.getPropertyValue('--life-0').trim();
      // reduced motion: the blinkers rest in their first phase
      const shown = motion.matches ? 0 : phase;
      // each cell edge rounds to a whole device pixel, so the cells stay crisp at any density
      const edge = (v: number) => Math.round(v * scale);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of placed) {
        ctx.fillStyle = p.isBlinker ? accent : mute;
        const cells = p.isBlinker ? BLINKER_PHASES[shown] : p.cells;
        cells.forEach((row, r) =>
          row.forEach((alive, c) => {
            if (!alive) return;
            const left = edge((p.x + c) * DIVIDER_CELL);
            const top = edge((p.y + r) * DIVIDER_CELL);
            const right = edge((p.x + c + 1) * DIVIDER_CELL - CELL_GAP);
            const bottom = edge((p.y + r + 1) * DIVIDER_CELL - CELL_GAP);
            ctx.fillRect(left, top, right - left, bottom - top);
          }),
        );
      }
    };

    // the next boundary of the shared clock: every divider flips together. One clock read per tick, so the phase
    // and the delay agree (two reads could straddle a boundary and hold a phase for a whole period).
    const tick = () => {
      const now = performance.now();
      timer = 0;
      phase = blinkerPhase(now);
      draw();
      timer = window.setTimeout(tick, BLINKER_PERIOD_MS - (now % BLINKER_PERIOD_MS));
    };

    const sync = () => {
      const live = inView && !motion.matches && !document.hidden && placed.some((p) => p.isBlinker);
      if (live && !timer) tick();
      else if (!live && timer) {
        clearTimeout(timer);
        timer = 0;
      }
    };

    const build = () => {
      const width = Math.floor(divider.getBoundingClientRect().width);
      if (width <= 0) return;
      scale = window.devicePixelRatio || 1;
      canvas.width = Math.round(width * scale);
      canvas.height = Math.round(height * scale);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      placed = layoutRow(width, DIVIDER_CELL, createRnd(seed));
      draw();
      sync();
    };

    new ResizeObserver(build).observe(divider);
    new IntersectionObserver(([entry]) => {
      inView = !!entry?.isIntersecting;
      sync();
    }).observe(divider);
    new MutationObserver(draw).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    motion.addEventListener('change', () => {
      draw();
      sync();
    });
    document.addEventListener('visibilitychange', sync);
  });
}
