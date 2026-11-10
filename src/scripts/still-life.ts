/**
 * Pure Game of Life still lifes, oscillators, and row layout helpers for decorative dividers.
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

export const PATTERNS = {
  ...STILL_LIFES,
  blinker: BLINKER_PHASES[0],
} as const;

export const ROW_HEIGHT_CELLS = 6;
export const BLINKER_PERIOD_MS = 600;

/** Computes the blinker phase (0 or 1) based on timestamp or step count. */
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
 * Lays out still lifes and blinkers in a row across the available pixel width.
 * Guarantees no overlaps, at least 1 empty cell between patterns, no width overflow,
 * and deterministic output when given the same seeded rnd function.
 */
export function layoutRow(width: number, cell: number, rnd: () => number = Math.random): PlacedPattern[] {
  if (width <= 0 || cell <= 0) return [];
  const cols = Math.floor(width / cell);
  if (cols < 2) return [];

  const placed: PlacedPattern[] = [];
  // Small initial margin (0..1 cells) if room permits
  let x = cols >= 4 ? Math.floor(rnd() * 2) : 0;

  while (x < cols) {
    const remaining = cols - x;
    const candidates = DESCRIPTORS.filter((d) => d.width <= remaining);
    if (candidates.length === 0) break;

    const chosen = candidates[Math.floor(rnd() * candidates.length)]!;
    const y = Math.floor((ROW_HEIGHT_CELLS - chosen.height) / 2);

    placed.push({
      name: chosen.name,
      x,
      y,
      width: chosen.width,
      height: chosen.height,
      cells: chosen.cells,
      isBlinker: chosen.isBlinker,
    });

    // Irregular gap of 1..4 cells between patterns
    const gap = 1 + Math.floor(rnd() * 4);
    x += chosen.width + gap;
  }

  return placed;
}

// Random seed per page load (constant during this visit)
const PAGE_SEED = Math.floor(Math.random() * 0x100000000);

/**
 * Initializes canvas still-life dividers on the page.
 * Manages crisp DPR rendering, theme changes, responsive resizing,
 * and blinker animation loop gated by IntersectionObserver and prefers-reduced-motion.
 */
export function initLifeDividers(): void {
  const dividers = document.querySelectorAll<HTMLElement>('.life-divider');
  if (!dividers.length) return;

  const root = document.documentElement;
  const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

  dividers.forEach((divider, index) => {
    if (divider.dataset.lifeDividerInit === 'true') return;
    divider.dataset.lifeDividerInit = 'true';

    const canvas = divider.querySelector<HTMLCanvasElement>('canvas.life-divider-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Per-divider deterministic seed derived from page seed and divider index
    const seed = (PAGE_SEED ^ (index * 0x9e3779b9)) >>> 0;

    let placedPatterns: PlacedPattern[] = [];
    let cell = 6;
    let width = 0;
    let height = 0;
    let currentPhase: 0 | 1 = 0;
    let inView = false;
    let rafId = 0;

    const readCell = (): number => {
      const rawC = parseFloat(getComputedStyle(root).getPropertyValue('--c'));
      const c = isNaN(rawC) || rawC <= 0 ? 3 : rawC;
      return Math.max(5, Math.round(2 * c));
    };

    const draw = () => {
      if (width <= 0 || height <= 0) return;
      const ink = getComputedStyle(root).getPropertyValue('--ink').trim() || '#000';
      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = ink;

      const gap = cell >= 4 ? 1 : 0;
      const size = cell - gap;

      for (const p of placedPatterns) {
        const patternCells = p.isBlinker ? BLINKER_PHASES[currentPhase] : p.cells;
        for (let r = 0; r < patternCells.length; r++) {
          const row = patternCells[r]!;
          for (let c = 0; c < row.length; c++) {
            if (row[c]) {
              ctx.fillRect((p.x + c) * cell + gap, (p.y + r) * cell + gap, size, size);
            }
          }
        }
      }
    };

    const build = () => {
      const rect = divider.getBoundingClientRect();
      const newWidth = Math.floor(rect.width || divider.clientWidth);
      cell = readCell();
      height = cell * ROW_HEIGHT_CELLS;
      width = newWidth;

      if (width <= 0) return;

      const dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Re-layout using the divider's deterministic seed
      const rnd = createRnd(seed);
      placedPatterns = layoutRow(width, cell, rnd);
      draw();
    };

    const tick = (now: number) => {
      if (!inView || motionQuery.matches) {
        rafId = 0;
        return;
      }
      const nextPhase = blinkerPhase(now);
      if (nextPhase !== currentPhase) {
        currentPhase = nextPhase;
        draw();
      }
      rafId = requestAnimationFrame(tick);
    };

    const startLoop = () => {
      if (rafId || !inView || motionQuery.matches) return;
      const hasBlinkers = placedPatterns.some((p) => p.isBlinker);
      if (!hasBlinkers) return;
      rafId = requestAnimationFrame(tick);
    };

    const stopLoop = () => {
      if (rafId) {
        cancelAnimationFrame(rafId);
        rafId = 0;
      }
    };

    // IntersectionObserver: only animate while in view
    const intersectionObserver = new IntersectionObserver(([entry]) => {
      inView = !!entry?.isIntersecting;
      if (inView) {
        startLoop();
      } else {
        stopLoop();
      }
    });
    intersectionObserver.observe(divider);

    // Responsive rebuild on resize
    let resizeTimer = 0;
    const onResize = () => {
      clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(build, 100);
    };
    const resizeObserver = new ResizeObserver(onResize);
    resizeObserver.observe(divider);
    window.addEventListener('resize', onResize);

    // Re-draw on theme change
    const themeObserver = new MutationObserver(() => {
      draw();
    });
    themeObserver.observe(root, { attributes: true, attributeFilter: ['data-theme'] });

    // Handle reduced motion changes
    motionQuery.addEventListener('change', (e) => {
      if (e.matches) {
        stopLoop();
        currentPhase = 0;
        draw();
      } else if (inView) {
        startLoop();
      }
    });

    document.fonts?.ready.then(build).catch(() => {});

    // Initial build
    build();
  });
}
