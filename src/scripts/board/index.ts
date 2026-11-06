import { GLIDERS, METHUSELAH_PATTERNS, type MethuselahName } from './patterns';
import { rasterize } from './rasterize';
import { addFeedGlider, clearBoxes, createWorld, idx, seedWorld, spawn, stepWorld, type World } from './life';
import { addStructure, stepStructures, structurePopulation } from './structures';
import {
  boxMinus,
  cellSizeFor,
  coreBox,
  gridFor,
  isProtected,
  namePlacement,
  orientationFor,
  rectToBox,
  type Box,
  type Grid,
} from './layout';
import { placeProjects, stampSpot, waveFront, waveTravel, type PxRect } from './projects';
import { createRenderBuffers, draw, BUCKETS, type Colors, type RenderState, type Shockwave } from './render';
import { createFromFlag, createReturnTracker, resolveFrom } from './return-flag';
import { bindInput } from './input';
import type { BoardConfig, Structure } from './types';

const RATE = 120;
const FEED_EVERY = 18;
const DIVE_SCALE = 16;
const DIVE_MS = 750;
/** The opening shockwave, from the centre of the name to past the farthest corner. */
const INTRO_MS = 1800;
/** Without an opening the first generation waits a moment, so the page settles first. */
const START_DELAY = 500;
const STAMP_COOLDOWN = 1500;
/** Width of one band of the shockwave's ring, in pixels. */
const BAND_PX = 11;

interface Row {
  slug: string;
  seed: MethuselahName;
  el: HTMLAnchorElement;
}

export async function initBoard(): Promise<void> {
  const source = document.getElementById('board-data');
  const canvas = document.querySelector<HTMLCanvasElement>('#board');
  const stage = document.getElementById('stage');
  const note = document.getElementById('name-note');
  const list = document.getElementById('projects');
  const ctx = canvas?.getContext('2d');
  if (!source?.textContent || !canvas || !stage || !list || !ctx) return;

  let data: BoardConfig;
  try {
    data = JSON.parse(source.textContent) as BoardConfig;
  } catch {
    return;
  }

  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = motion.matches;
  motion.addEventListener('change', (event) => {
    reduced = event.matches;
  });
  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let colors: Colors = { paper: '', ink: '', mute: '', life: ['', '', '', ''] };
  let dirty = true;
  const readColors = () => {
    colors = {
      paper: css('--paper'),
      ink: css('--ink'),
      mute: css('--mute'),
      life: [css('--life-0'), css('--life-1'), css('--life-2'), css('--life-3')],
    };
    renderState.colors = colors;
    dirty = true;
  };

  try {
    // a font that never loads must not leave the stage at opacity 0 forever
    await Promise.race([
      Promise.all([
        document.fonts.load('32px "Geist Pixel"'),
        document.fonts.load('12px "Geist Mono"'),
        document.fonts.load('20px "Shantell Sans"'),
      ]),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
  } catch {
    // the fallback fonts still give a usable board
  }

  const rows = new Map<string, Row>();
  list.querySelectorAll<HTMLAnchorElement>('.proj').forEach((el) => {
    const seed = el.dataset.seed as MethuselahName | undefined;
    if (seed && METHUSELAH_PATTERNS[seed]) rows.set(el.dataset.id ?? '', { slug: el.dataset.id ?? '', seed, el });
  });

  let cell = 10;
  let grid: Grid = { cols: 1, rows: 1 };
  let world: World = createWorld(1, 1);
  let structures: Structure[] = [];
  let keepClear: Box[] = [];
  // the name's keep-clear box without the name: the soup dies there, visitors may draw on the name
  let nameRing: Box[] = [];
  // the project list: the soup dies under it too, and seeds are fired beside it
  let listBox: Box | null = null;
  let lastSize = '';
  // the opening: where the shockwave starts and how far its front travels, in cells
  let waveCentre = { x: 0, y: 0 };
  let waveBand = 3;
  let waveTotal = 1;

  const renderState: RenderState = {
    ctx,
    cell,
    dpr: 1,
    width: 0,
    height: 0,
    world,
    structures,
    colors,
    buffers: createRenderBuffers(1),
    wave: null,
  };

  const protectedBoxes = () => [...keepClear, ...(listBox ? [listBox] : []), ...nameRing, ...structures.map((s) => coreBox(s))];
  // visitors may draw on the name, so only the note and the list stay off limits
  const isFree = (x: number, y: number) => !isProtected(x, y, 0, [...keepClear, ...(listBox ? [listBox] : [])]);

  const pxRect = (el: Element): PxRect | null => {
    const r = el.getBoundingClientRect();
    return r.width && r.height ? { left: r.left, top: r.top, right: r.right, bottom: r.bottom } : null;
  };

  /** Lays the board out for the current screen: the fine name sets the cell, then everything in screen fractions. */
  function layout(): void {
    const vw = innerWidth;
    const vh = innerHeight;
    lastSize = `${vw}x${vh}`;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const orientation = orientationFor(vw, vh);
    // the fine raster (half-pixel steps) is the only one that keeps the curves legible
    const nameCells = rasterize(data.name[orientation], true);
    if (!nameCells.length) return;
    const nameDims = { cols: nameCells[0].length, rows: nameCells.length };
    cell = cellSizeFor(nameDims, vw, vh, orientation);
    grid = gridFor(vw, vh, cell);
    stage!.style.setProperty('--c', `${cell}px`);
    canvas!.width = vw * dpr;
    canvas!.height = vh * dpr;
    world = createWorld(grid.cols, grid.rows);
    structures = [];
    keepClear = [];
    nameRing = [];
    listBox = null;
    list!.classList.remove('placed', 'compact', 'narrow', 'scroll');

    const at = namePlacement(grid, nameDims, orientation);
    addStructure(structures, {
      cells: nameCells,
      footprint: { x: at.x, y: at.y, w: at.w, h: at.h, core: { x: 0, y: 0, w: at.w, h: at.h } },
    });
    nameRing = boxMinus(
      { x: at.x - 1, y: at.y - 1, x2: at.x + at.w + 1, y2: at.y + at.h + 1 },
      { x: at.x, y: at.y, x2: at.x + at.w, y2: at.y + at.h },
    );

    // the list, as wide as its text wants: the room it needs decides whether the note runs on one line
    const measureList = () => {
      const style = list!.style;
      style.left = '0px';
      style.top = '0px';
      style.width = 'max-content';
      style.maxHeight = '';
      const r = list!.getBoundingClientRect();
      return { w: Math.ceil(r.width), h: Math.ceil(r.height) };
    };
    let natural = measureList();

    if (note) {
      note.style.left = `${at.x * cell}px`;
      note.style.top = `${(at.y + at.h) * cell + 10}px`;
      // one line under the name wherever it fits; inside the name's width on a phone,
      // and in landscape when the line would take the room the project list needs
      note.style.maxWidth = orientation === 'p' ? `${Math.min(at.w * cell, Math.round(vw * 0.7))}px` : 'none';
      if (orientation === 'l') {
        const oneLine = note.getBoundingClientRect().right;
        const right = Math.max(oneLine, (at.x + at.w) * cell);
        if (vw - 16 - right - 20 < Math.min(natural.w, 260)) note.style.maxWidth = `${at.w * cell}px`;
      }
      keepClear.push(rectToBox(note.getBoundingClientRect(), cell));
    }

    // the list goes where the board has room: right of the name in landscape, under it on a phone
    const obstacles: PxRect[] = [{ left: at.x * cell, top: at.y * cell, right: (at.x + at.w) * cell, bottom: (at.y + at.h) * cell }];
    if (note) {
      const r = pxRect(note);
      if (r) obstacles.push(r);
    }
    const hudTop = document.querySelector('.hud.tr');
    const hudBottom = document.querySelector('.hud.br');
    const topLimit = Math.max(12, (hudTop ? pxRect(hudTop)?.bottom ?? 0 : 0) + 12);
    const bottomRect = hudBottom ? pxRect(hudBottom) : null;
    const bottomLimit = (bottomRect ? bottomRect.top - 12 : vh - 16);
    const fit = () => {
      natural = measureList();
      return placeProjects({ vw, vh, orientation, natural, obstacles, topLimit, bottomLimit });
    };
    let spot = fit();
    // too tall: tighter rows first, then a scroll; too narrow: the meta column goes
    if (spot.overflow) {
      list!.classList.add('compact');
      spot = fit();
    }
    if (spot.narrow) {
      list!.classList.add('narrow');
      spot = fit();
    }
    list!.style.left = `${spot.left}px`;
    list!.style.top = `${spot.top}px`;
    list!.style.width = `${spot.width}px`;
    list!.style.maxHeight = `${spot.height}px`;
    list!.classList.toggle('scroll', spot.overflow);
    list!.classList.add('placed');
    const listRect = pxRect(list!);
    if (listRect) listBox = rectToBox(listRect, cell);

    // the board starts busy, but not noisy: about one free cell in twelve is seeded
    const boxes = protectedBoxes();
    seedWorld(world, (x, y) => isProtected(x, y, 5, boxes), 0.08);

    waveCentre = { x: at.x + at.w / 2, y: at.y + at.h / 2 };
    waveBand = Math.max(2, Math.round(BAND_PX / cell));
    waveTotal = waveTravel(waveCentre, grid, BUCKETS - 1, waveBand);
    renderState.cell = cell;
    renderState.width = vw;
    renderState.height = vh;
    renderState.dpr = dpr;
    renderState.world = world;
    renderState.structures = structures;
    renderState.buffers = createRenderBuffers(world.cells.length);
    dirty = true;
    updateCounters(0);
  }

  const genEl = document.getElementById('gen');
  const popEl = document.getElementById('pop');
  const updateCounters = (gen: number) => {
    if (genEl) genEl.textContent = String(gen).padStart(4, '0');
    if (popEl) popEl.textContent = String(world.cells.reduce((sum, v) => sum + v, 0) + structurePopulation(structures));
  };

  // ---- drawing ----
  const paint = (x: number, y: number) => {
    if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows || !isFree(x, y)) return;
    spawn(world, idx(world.w, world.h, x, y));
    dirty = true;
  };
  const dropGlider = (x: number, y: number) => {
    const glider = GLIDERS[(Math.random() * 4) | 0];
    glider.forEach((row, j) =>
      row.forEach((value, i) => {
        if (!value || !isFree(x + i - 1, y + j - 1)) return;
        spawn(world, idx(world.w, world.h, x + i - 1, y + j - 1));
      }),
    );
    dirty = true;
  };
  bindInput({
    canvas,
    cell: () => cell,
    paint,
    glider: dropGlider,
    // reduced motion: the board still answers the user, one generation at a time
    onChange: () => {
      if (reduced) tick();
    },
  });

  // ---- seeds: a project row fires its methuselah beside the list ----
  const lastFired = new Map<string, number>();
  const fire = (row: Row) => {
    const now = performance.now();
    if (!listBox || now - (lastFired.get(row.slug) ?? -Infinity) < STAMP_COOLDOWN) return;
    const pattern = METHUSELAH_PATTERNS[row.seed];
    const rect = row.el.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    const level = Math.min(Math.max(rect.top + rect.height / 2, bounds.top), bounds.bottom) / cell;
    const blocked = [...keepClear, ...nameRing, ...structures.map((s) => coreBox(s))];
    const spot = stampSpot({ w: pattern[0].length, h: pattern.length }, level, listBox, blocked, grid);
    if (!spot) return;
    lastFired.set(row.slug, now);
    pattern.forEach((line, j) => line.forEach((value, i) => value && spawn(world, idx(world.w, world.h, spot.x + i, spot.y + j))));
    dirty = true;
    if (reduced) tick();
  };
  const rowOf = (target: EventTarget | null): Row | undefined => {
    const el = (target as Element | null)?.closest?.<HTMLElement>('.proj');
    return el ? rows.get(el.dataset.id ?? '') : undefined;
  };
  list.addEventListener('pointerover', (event) => {
    const row = rowOf(event.target);
    if (row && !row.el.contains(event.relatedTarget as Node | null)) fire(row);
  });
  // a finger never hovers: touching the row fires it before the tap navigates
  list.addEventListener('pointerdown', (event) => {
    const row = event.pointerType !== 'mouse' && rowOf(event.target);
    if (row) fire(row);
  });
  // keyboard focus only: a mouse click focuses the row too, and a restored focus on Back must not fire
  list.addEventListener('focusin', (event) => {
    const row = rowOf(event.target);
    if (row && (event.target as Element).matches(':focus-visible')) fire(row);
  });

  // ---- dive and return ----
  const flag = createFromFlag(() => sessionStorage);
  const tracker = createReturnTracker(flag);
  let diving = false;

  const cleanUrl = () => {
    const url = new URL(location.href);
    if (!url.searchParams.has('from')) return;
    url.searchParams.delete('from');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };
  const originAt = (x: number, y: number) => {
    stage.style.transformOrigin = `${x}px ${y}px`;
  };
  /** The dive zooms toward the middle of the project's row. */
  const originOfRow = (row: Row) => {
    const rect = row.el.getBoundingClientRect();
    const bounds = list.getBoundingClientRect();
    originAt(rect.left + rect.width / 2, Math.min(Math.max(rect.top + rect.height / 2, bounds.top), bounds.bottom));
  };
  /** Puts the stage back at scale 1 without animating (a page restored from the back/forward cache). */
  const resetStage = () => {
    stage.style.transition = 'none';
    stage.style.transform = '';
    stage.getBoundingClientRect();
    stage.style.transition = '';
    diving = false;
  };

  const replayZoomOut = (slug: string): boolean => {
    const row = rows.get(slug);
    if (!row) return false;
    tracker.remember(slug);
    cleanUrl();
    if (reduced) return true;
    originOfRow(row);
    stage.style.transition = 'none';
    stage.style.transform = `scale(${DIVE_SCALE})`;
    stage.getBoundingClientRect();
    stage.classList.add('ready');
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        stage.style.transition = '';
        stage.style.transform = '';
      }),
    );
    return true;
  };

  /** A click on a project row: the stage scales toward the row, then the page changes. */
  const dive = (event: MouseEvent, row: Row) => {
    // leaving without a dive (reduced motion, new tab): no slug may survive to be replayed on a later Back
    if (reduced || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      tracker.forget();
      return;
    }
    event.preventDefault();
    if (diving) return;
    diving = true;
    tracker.remember(row.slug);
    originOfRow(row);
    stage.style.transform = `scale(${DIVE_SCALE})`;
    setTimeout(() => {
      location.href = row.el.href;
      // if the navigation never happens (offline, blocked), the board must come back;
      // a slow navigation that does happen unloads the page first, which cancels this
      const fallback = setTimeout(resetStage, 3000);
      addEventListener('pagehide', () => clearTimeout(fallback), { once: true });
    }, DIVE_MS);
  };

  list.addEventListener('click', (event) => {
    const row = rowOf(event.target);
    if (row) dive(event, row);
  });
  readColors();
  layout();

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const from = resolveFrom({
    query: new URLSearchParams(location.search).get('from'),
    navType: navigation?.type,
    stored: flag.get(),
  });
  flag.clear();
  const replayed = from ? replayZoomOut(from) : false;
  const entry = replayed && !reduced ? 'zoom-out' : reduced ? 'direct' : 'intro';
  canvas.dataset.entry = entry;

  // ---- the opening: a ring of newborn colours leaves the name, everything appears as it passes ----
  const wave: Shockwave = { cx: 0, cy: 0, front: 0, band: 3 };
  let intro: { el: HTMLElement; d: number; shown: boolean }[] | null = null;
  const startIntro = () => {
    intro = [];
    const targets: Element[] = [...list.querySelectorAll('.proj')];
    if (note) targets.push(note);
    for (const el of targets) {
      const r = el.getBoundingClientRect();
      const d = Math.hypot((r.left + r.width / 2) / cell - waveCentre.x, (r.top + r.height / 2) / cell - waveCentre.y);
      intro.push({ el: el as HTMLElement, d, shown: false });
    }
    stage.classList.add('intro');
  };
  const endIntro = () => {
    intro = null;
    renderState.wave = null;
    stage.classList.remove('intro');
    dirty = true;
  };
  if (entry === 'intro') {
    startIntro();
    renderState.wave = wave;
  }
  stage.classList.add('ready');

  addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    const slug = flag.get();
    flag.clear();
    resetStage();
    if (intro) endIntro();
    if (slug && replayZoomOut(slug)) canvas.dataset.entry = reduced ? 'direct' : 'zoom-out';
  });
  // Back → Forward → Back: the flag was consumed on arrival, put it back when the board is left
  addEventListener('pagehide', () => tracker.pagehide());
  // any other way out (CV, contact, language switch, list link) must not replay a zoom-out on the next Back
  document.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) tracker.forget();
    },
    true,
  );

  document.addEventListener('themechange', readColors);

  let resizeTimer: ReturnType<typeof setTimeout>;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (`${innerWidth}x${innerHeight}` === lastSize || diving) return;
      layout();
      // a new layout mid-opening: show the final state rather than re-timing the wave
      if (intro) {
        intro.forEach((item) => item.el.classList.remove('in'));
        endIntro();
      }
    }, 200);
  });

  // ---- loop ----
  const t0 = performance.now();
  let gen = 0;
  let last = 0;
  function tick(): void {
    gen++;
    stepWorld(world);
    // the name feels whatever reaches its ring before the ring is cleared
    stepStructures(world, structures, gen);
    clearBoxes(world, listBox ? [...keepClear, ...nameRing, listBox] : [...keepClear, ...nameRing]);
    if (gen % FEED_EVERY === 0) addFeedGlider(world);
    updateCounters(gen);
    dirty = true;
  }
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    if (intro) {
      const progress = (now - t0) / INTRO_MS;
      wave.cx = waveCentre.x;
      wave.cy = waveCentre.y;
      wave.band = waveBand;
      wave.front = waveFront(progress, waveTotal);
      for (const item of intro) {
        if (item.shown || wave.front < item.d) continue;
        item.shown = true;
        item.el.classList.add('in');
      }
      dirty = true;
      if (progress >= 1) {
        intro.forEach((item) => item.el.classList.remove('in'));
        endIntro();
      }
    }
    if (!reduced && !intro && now - last > RATE && now - t0 > (entry === 'intro' ? INTRO_MS : START_DELAY)) {
      last = now;
      tick();
    }
    if (!dirty) return;
    dirty = false;
    renderState.dpr = Math.min(2, devicePixelRatio || 1);
    draw(renderState);
  };
  requestAnimationFrame(loop);
}
