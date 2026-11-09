// The living paper: the content's whole page is a Game of Life board. The pointer leaves life where it moves,
// a click drops a glider, and now and then a glider sets off by itself. Text, pictures and titles are rocks: a cell
// that lands on them dies, so the life flows around what you read and never covers it.
// One fixed canvas the size of the viewport draws the rows in view; the grid itself is the size of the page.
import { GLIDER_HEADINGS } from './board/patterns';
import { ageBucket, AGE_STEPS } from './board/render';

/** A paper cell is this many board cells: big enough to read as cells at reading distance. */
export const PAPER_SCALE = 2;
/** Generations per second while anything lives. */
export const STEP_MS = 1000 / 12;
/** The pointer seeds a blob every this many cells of travel. */
export const SEED_EVERY = 3;
/** Chance that each cell of a 3×3 seed blob starts alive. */
export const SEED_DENSITY = 0.5;
/** A glider sets off by itself this often while the page is in view and quiet. */
export const AMBIENT_MS = 2600;
/** Text keeps this many cells of clear paper around it. */
export const PAD = 1;
/** Cells older than the colour ramp are drawn in ink at this opacity: settled life stays quiet. */
export const SETTLED_ALPHA = 0.22;

export interface Grid {
  cols: number;
  rows: number;
  /** 0 is dead; a live cell holds its age, 1–255. */
  cells: Uint8Array;
  /** 1 where the paper is blocked by text or a picture. */
  blocked: Uint8Array;
  /** Rows that may hold live cells, inclusive; lo > hi when empty. */
  lo: number;
  hi: number;
}

export const createGrid = (cols: number, rows: number): Grid => ({
  cols,
  rows,
  cells: new Uint8Array(cols * rows),
  blocked: new Uint8Array(cols * rows),
  lo: rows,
  hi: -1,
});

/** Brings a cell to life, unless it is off the grid or on a rock. Returns whether it did. */
export const plant = (grid: Grid, x: number, y: number): boolean => {
  if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) return false;
  const k = y * grid.cols + x;
  if (grid.blocked[k] || grid.cells[k]) return false;
  grid.cells[k] = 1;
  if (y < grid.lo) grid.lo = y;
  if (y > grid.hi) grid.hi = y;
  return true;
};

/** A 3×3 blob of random cells centred on (x, y): it mostly bursts and dies, sometimes leaves a still life or a glider. */
export const seedBlob = (grid: Grid, x: number, y: number, rnd: () => number = Math.random): number => {
  let planted = 0;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (rnd() < SEED_DENSITY && plant(grid, x + dx, y + dy)) planted++;
    }
  }
  return planted;
};

/** A glider with its top-left cell at (x, y), heading towards (hx, hy): each -1 or 1. */
export const plantGlider = (grid: Grid, x: number, y: number, hx: number, hy: number): void => {
  const entry = GLIDER_HEADINGS.find(({ heading }) => heading[0] === Math.sign(hx) && heading[1] === Math.sign(hy));
  const cells = (entry ?? GLIDER_HEADINGS[0]!).cells;
  cells.forEach((row, dy) => row.forEach((on, dx) => on && plant(grid, x + dx, y + dy)));
};

/**
 * One generation of B3/S23 into `next` (same size), with dead edges. A cell on a rock dies. Only the rows that can
 * change are visited: the live band and one row each side, cut to `from`..`to` when the caller wants a window (the
 * rows near the viewport). Life outside the window is frozen as it is and stays inside the live band, so it picks up
 * again when the window comes back. Returns the number of live cells in the rows it stepped.
 */
export function stepGrid(grid: Grid, next: Uint8Array, from = 0, to = grid.rows - 1): number {
  const { cols, rows, cells, blocked } = grid;
  if (grid.lo > grid.hi) return 0;
  const y0 = Math.max(0, grid.lo - 1, from);
  const y1 = Math.min(rows - 1, grid.hi + 1, to);
  if (y0 > y1) return 0;
  next.fill(0, y0 * cols, (y1 + 1) * cols);
  let lo = rows;
  let hi = -1;
  let alive = 0;
  for (let y = y0; y <= y1; y++) {
    const up = y > 0 ? (y - 1) * cols : -1;
    const row = y * cols;
    const down = y < rows - 1 ? (y + 1) * cols : -1;
    for (let x = 0; x < cols; x++) {
      let n = 0;
      const xl = x > 0;
      const xr = x < cols - 1;
      if (up >= 0) {
        if (xl && cells[up + x - 1]) n++;
        if (cells[up + x]) n++;
        if (xr && cells[up + x + 1]) n++;
      }
      if (xl && cells[row + x - 1]) n++;
      if (xr && cells[row + x + 1]) n++;
      if (down >= 0) {
        if (xl && cells[down + x - 1]) n++;
        if (cells[down + x]) n++;
        if (xr && cells[down + x + 1]) n++;
      }
      const k = row + x;
      const age = cells[k]!;
      let born = 0;
      if (age) born = n === 2 || n === 3 ? Math.min(255, age + 1) : 0;
      else if (n === 3) born = 1;
      if (born && blocked[k]) born = 0;
      if (!born) continue;
      next[k] = born;
      alive++;
      if (y < lo) lo = y;
      if (y > hi) hi = y;
    }
  }
  // the old band is cleared in the source, which becomes the scratch buffer of the next step
  cells.fill(0, y0 * cols, (y1 + 1) * cols);
  cells.set(next.subarray(y0 * cols, (y1 + 1) * cols), y0 * cols);
  // rows outside the window may still hold frozen life: the band keeps covering them
  grid.lo = grid.lo < y0 ? Math.min(lo, grid.lo) : lo;
  grid.hi = grid.hi > y1 ? Math.max(hi, grid.hi) : hi;
  return alive;
}

/**
 * The rows of a grid that sit under the viewport, widened by `margin` rows each side, as [first, last] inclusive.
 * `top` is the grid's top edge in viewport px. When nothing is in range, first > last.
 */
export function visibleRows(top: number, cell: number, viewHeight: number, rows: number, margin = 0): [number, number] {
  const first = Math.max(0, Math.floor(-top / cell) - margin);
  const last = Math.min(rows - 1, Math.ceil((viewHeight - top) / cell) + margin);
  return [first, last];
}

/** Marks the cells under a box (in px, relative to the grid's origin) as rock, with PAD cells around it. */
export function blockRect(grid: Grid, cell: number, left: number, top: number, right: number, bottom: number): void {
  const x0 = Math.max(0, Math.floor(left / cell) - PAD);
  const y0 = Math.max(0, Math.floor(top / cell) - PAD);
  const x1 = Math.min(grid.cols - 1, Math.ceil(right / cell) - 1 + PAD);
  const y1 = Math.min(grid.rows - 1, Math.ceil(bottom / cell) - 1 + PAD);
  for (let y = y0; y <= y1; y++) grid.blocked.fill(1, y * grid.cols + x0, y * grid.cols + x1 + 1);
}

/** The colour bucket of a live cell: the board's warm→cool ramp, then the settled ink. */
export const paperBucket = (age: number): number => ageBucket(age);
export const SETTLED_BUCKET = AGE_STEPS.length;

/**
 * Sorts the live cells of rows `first`..`last` into one list per colour bucket, as flat indices into the grid, so the
 * canvas takes one path per colour instead of one scan of the rows per colour. `lists` must be big enough for the rows.
 */
export function bucketCells(grid: Grid, first: number, last: number, lists: Int32Array[], counts: Int32Array): void {
  counts.fill(0);
  const { cols, cells } = grid;
  const from = Math.max(first, grid.lo);
  const to = Math.min(last, grid.hi);
  for (let k = from * cols, end = (to + 1) * cols; k < end; k++) {
    const age = cells[k]!;
    if (!age) continue;
    const bucket = paperBucket(age);
    lists[bucket]![counts[bucket]!++] = k;
  }
}

export interface PaperTuning {
  /** Milliseconds between generations. */
  stepMs: number;
  /** The canvas never renders at more than this many device pixels per CSS pixel. */
  maxDpr: number;
  /** Generations wait while the page is being scrolled; the drawing still follows the scroll. */
  pauseWhileScrolling: boolean;
}

/**
 * How hard the paper works on this device. A phone repaints a full-screen canvas on a slow CPU while it scrolls, so
 * it gets fewer generations, one canvas pixel per CSS pixel (cells are whole-pixel squares, so nothing blurs) and no
 * generations mid-scroll. A desktop keeps the full show unless it reports a weak CPU. `cores` 0 means unknown.
 */
export function paperTuning({ coarse, cores }: { coarse: boolean; cores: number }): PaperTuning {
  if (coarse) return { stepMs: 1000 / 8, maxDpr: 1, pauseWhileScrolling: true };
  if (cores > 0 && cores <= 4) return { stepMs: 1000 / 10, maxDpr: 2, pauseWhileScrolling: false };
  return { stepMs: STEP_MS, maxDpr: 2, pauseWhileScrolling: false };
}

/** Generations are skipped for this long after the last scroll event. */
export const SCROLL_QUIET_MS = 140;
/** The step window reaches this many viewport heights above and below the screen. */
export const STEP_REACH = 0.75;

/** Every cell on the line between two cells, so a fast pointer still leaves a continuous trail. */
export function lineCells(x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
  if (n === 0) return [[x0, y0]];
  const out: [number, number][] = [];
  for (let t = 0; t <= n; t++) out.push([Math.round(x0 + ((x1 - x0) * t) / n), Math.round(y0 + ((y1 - y0) * t) / n)]);
  return out;
}

const INTERACTIVE = 'a, button, input, textarea, select, summary, label, [role="button"]';

export function initLivingPaper(section: HTMLElement, canvas: HTMLCanvasElement): void {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  if (reduced.matches) return;
  const ctx = canvas.getContext('2d');
  const hc = section.querySelector<HTMLElement>('.hc');
  if (!ctx || !hc) return;
  const root = document.documentElement;
  const tuning = paperTuning({ coarse: matchMedia('(pointer: coarse)').matches, cores: navigator.hardwareConcurrency || 0 });

  let cell = 6;
  let grid = createGrid(1, 1);
  let scratch = new Uint8Array(1);
  let colors: string[] = [];
  let ink = '';

  const readColors = () => {
    const style = getComputedStyle(root);
    colors = ['--life-0', '--life-1', '--life-2', '--life-3'].map((name) => style.getPropertyValue(name).trim());
    ink = style.getPropertyValue('--ink').trim();
    dirty = true;
  };

  // ---- the grid: the size of the section, rocks where the text is ----
  const build = () => {
    const box = section.getBoundingClientRect();
    const boardCell = parseFloat(getComputedStyle(root).getPropertyValue('--c')) || 3;
    cell = Math.max(4, Math.round(boardCell * PAPER_SCALE));
    const cols = Math.ceil(box.width / cell);
    const rows = Math.ceil(box.height / cell);
    const old = grid;
    grid = createGrid(cols, rows);
    scratch = new Uint8Array(cols * rows);
    // the life already there keeps its place when only the height changed
    if (old.cols === cols) {
      const keep = Math.min(old.rows, rows);
      grid.cells.set(old.cells.subarray(0, keep * cols));
      grid.lo = Math.min(old.lo, keep - 1);
      grid.hi = Math.min(old.hi, keep - 1);
    }
    const range = document.createRange();
    const walker = document.createTreeWalker(hc, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent?.trim() || node.parentElement?.closest('script, style')) continue;
      range.selectNodeContents(node);
      for (const r of Array.from(range.getClientRects())) {
        if (r.width && r.height) blockRect(grid, cell, r.left - box.left, r.top - box.top, r.right - box.left, r.bottom - box.top);
      }
    }
    hc.querySelectorAll<HTMLElement>('figure, img, video, canvas, svg, .hc-media').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) blockRect(grid, cell, r.left - box.left, r.top - box.top, r.right - box.left, r.bottom - box.top);
    });
    // the rocks kill what stood on them right away
    for (let k = 0; k < grid.cells.length; k++) if (grid.blocked[k]) grid.cells[k] = 0;
    sizeCanvas();
    dirty = true;
  };

  const sizeCanvas = () => {
    const dpr = Math.min(tuning.maxDpr, devicePixelRatio || 1);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };

  // ---- drawing: only the rows in view, one path per colour ----
  let dirty = true;
  // what is already on the canvas: an empty paper is not cleared again on every scroll event
  let blank = false;
  let lists: Int32Array[] = [];
  const counts = new Int32Array(SETTLED_BUCKET + 1);
  const draw = (top: number, left: number) => {
    dirty = false;
    if (grid.lo > grid.hi) {
      if (!blank) ctx.clearRect(0, 0, innerWidth, innerHeight);
      blank = true;
      return;
    }
    blank = false;
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    const [first, last] = visibleRows(top, cell, innerHeight, grid.rows);
    const need = Math.max(0, last - first + 1) * grid.cols;
    if (!lists.length || lists[0]!.length < need) lists = Array.from({ length: SETTLED_BUCKET + 1 }, () => new Int32Array(need));
    bucketCells(grid, first, last, lists, counts);
    const size = cell - 1;
    const cols = grid.cols;
    for (let bucket = 0; bucket <= SETTLED_BUCKET; bucket++) {
      const n = counts[bucket]!;
      if (!n) continue;
      const settled = bucket === SETTLED_BUCKET;
      ctx.fillStyle = settled ? ink : colors[bucket] || ink;
      ctx.globalAlpha = settled ? SETTLED_ALPHA : 0.9;
      ctx.beginPath();
      const list = lists[bucket]!;
      for (let i = 0; i < n; i++) {
        const k = list[i]!;
        const y = (k / cols) | 0;
        ctx.rect(left + (k - y * cols) * cell, top + y * cell, size, size);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  };
  const drawNow = () => {
    const box = section.getBoundingClientRect();
    draw(box.top, box.left);
  };

  // ---- the loop: steps while anything lives and the section is in view ----
  let inView = false;
  let running = false;
  let lastStep = 0;
  let lastScroll = -Infinity;
  let lastAmbient = performance.now();
  const loop = (now: number) => {
    if (!inView || document.hidden) {
      running = false;
      return;
    }
    requestAnimationFrame(loop);
    // one layout read per frame, shared by the step window, the ambient glider and the drawing
    const box = section.getBoundingClientRect();
    const scrolling = tuning.pauseWhileScrolling && now - lastScroll < SCROLL_QUIET_MS;
    if (now - lastAmbient > AMBIENT_MS && !scrolling) {
      lastAmbient = now;
      ambient(box.top);
    }
    if (now - lastStep > tuning.stepMs && grid.lo <= grid.hi && !scrolling) {
      lastStep = now;
      // life far off screen waits where it is; the window reaches a good way past the edges so what scrolls in is alive
      const reach = Math.ceil((innerHeight * STEP_REACH) / cell);
      const [first, last] = visibleRows(box.top, cell, innerHeight, grid.rows, reach);
      if (first <= last) {
        stepGrid(grid, scratch, first, last);
        dirty = true;
      }
    }
    if (dirty) draw(box.top, box.left);
  };
  const wake = () => {
    if (running || !inView || document.hidden) return;
    running = true;
    requestAnimationFrame(loop);
  };

  // a glider sets off from the open paper in view, towards the bottom, on a side with room
  const ambient = (sectionTop: number) => {
    const top = Math.max(0, Math.floor(-sectionTop / cell));
    const bottom = Math.min(grid.rows - 4, Math.floor((innerHeight - sectionTop) / cell));
    for (let tries = 0; tries < 12; tries++) {
      const x = Math.floor(Math.random() * (grid.cols - 4));
      const y = top + Math.floor(Math.random() * Math.max(1, bottom - top));
      let open = true;
      for (let dy = -1; dy < 4 && open; dy++) for (let dx = -1; dx < 4 && open; dx++) {
        const yy = y + dy;
        const xx = x + dx;
        if (yy >= 0 && yy < grid.rows && xx >= 0 && xx < grid.cols && grid.blocked[yy * grid.cols + xx]) open = false;
      }
      if (!open) continue;
      plantGlider(grid, x, y, x < grid.cols / 2 ? 1 : -1, 1);
      return;
    }
  };

  // ---- the pointer: a trail of seeds, a click drops a glider ----
  let last: [number, number] | null = null;
  let travelled = 0;
  let heading: [number, number] = [1, 1];
  const cellAt = (event: PointerEvent): [number, number] => {
    const box = section.getBoundingClientRect();
    return [Math.floor((event.clientX - box.left) / cell), Math.floor((event.clientY - box.top) / cell)];
  };
  section.addEventListener('pointermove', (event) => {
    if (event.pointerType === 'touch') return;
    const at = cellAt(event);
    if (last) {
      const dx = at[0] - last[0];
      const dy = at[1] - last[1];
      if (dx || dy) heading = [dx >= 0 ? 1 : -1, dy >= 0 ? 1 : -1];
      for (const [x, y] of lineCells(last[0], last[1], at[0], at[1]).slice(1)) {
        if (++travelled % SEED_EVERY === 0 && seedBlob(grid, x, y)) dirty = true;
      }
    }
    last = at;
    wake();
  });
  section.addEventListener('pointerleave', () => {
    last = null;
  });
  let down: { x: number; y: number } | null = null;
  section.addEventListener('pointerdown', (event) => {
    down = { x: event.clientX, y: event.clientY };
  });
  section.addEventListener('pointerup', (event) => {
    if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 6) return;
    down = null;
    if ((event.target as Element).closest(INTERACTIVE)) return;
    const [x, y] = cellAt(event);
    plantGlider(grid, x - 1, y - 1, heading[0], heading[1]);
    dirty = true;
    wake();
  });

  // ---- lifecycle ----
  readColors();
  build();
  new MutationObserver(readColors).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  let resizeTimer = 0;
  const rebuildSoon = () => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(build, 150);
  };
  new ResizeObserver(rebuildSoon).observe(section);
  addEventListener('resize', () => {
    sizeCanvas();
    rebuildSoon();
  });
  document.fonts?.ready.then(rebuildSoon).catch(() => {});
  addEventListener('scroll', () => {
    lastScroll = performance.now();
    if (grid.lo <= grid.hi) {
      dirty = true;
      if (!running) drawNow();
    }
  }, { passive: true });
  document.addEventListener('visibilitychange', wake);
  new IntersectionObserver(([entry]) => {
    inView = !!entry?.isIntersecting;
    canvas.hidden = !inView;
    wake();
  }).observe(section);
  reduced.addEventListener('change', (event) => {
    if (!event.matches) return;
    grid.cells.fill(0);
    grid.lo = grid.rows;
    grid.hi = -1;
    drawNow();
  });
}
