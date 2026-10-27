import { PATTERNS, GLIDERS } from './patterns';
import { rasterize } from './rasterize';
import { addFeedGlider, clearBoxes, createWorld, idx, seedWorld, stepWorld, type World } from './life';
import { addStructure, stepStructures, structurePopulation } from './structures';
import {
  anchorFor,
  cellSizeFor,
  coreBox,
  footprint,
  gridFor,
  isProtected,
  namePlacement,
  orientationFor,
  rectToBox,
  type Box,
  type Footprint,
  type Grid,
} from './layout';
import { findFreeSlot } from './slots';
import { draw, type Colors } from './render';
import { createFromFlag, createReturnTracker, resolveFrom } from './return-flag';
import { bindInput } from './input';
import type { BoardConfig, EntityConfig, Structure } from './types';

const RATE = 120;
const FEED_EVERY = 18;
const DIVE_SCALE = 16;
const DIVE_MS = 750;
const INTRO_MS = 1400;

interface Placed {
  config: EntityConfig;
  el: HTMLElement;
  fp: Footprint;
}

export async function initBoard(): Promise<void> {
  const source = document.getElementById('board-data');
  const canvas = document.querySelector<HTMLCanvasElement>('#board');
  const stage = document.getElementById('stage');
  const labels = document.getElementById('labels');
  const note = document.getElementById('name-note');
  const ctx = canvas?.getContext('2d');
  if (!source?.textContent || !canvas || !stage || !labels || !ctx) return;

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
  let colors: Colors = { paper: '', ink: '', mute: '', accent: '' };
  const readColors = () => {
    colors = { paper: css('--paper'), ink: css('--ink'), mute: css('--mute'), accent: css('--accent') };
  };
  readColors();

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

  const anchors = new Map<string, HTMLElement>();
  labels.querySelectorAll<HTMLElement>('.ent').forEach((el) => anchors.set(el.dataset.id ?? '', el));

  let cell = 10;
  let grid: Grid = { cols: 1, rows: 1 };
  let world: World = createWorld(1, 1);
  let structures: Structure[] = [];
  let keepClear: Box[] = [];
  let placed = new Map<string, Placed>();
  let lastSize = '';

  const protectedBoxes = () => [...keepClear, ...structures.map((s) => coreBox(s))];
  const isFree = (x: number, y: number) => !isProtected(x, y, 0, protectedBoxes());

  /** Lays the board out for the current screen: cell size from the name, then everything in screen fractions. */
  function layout(): void {
    const vw = innerWidth;
    const vh = innerHeight;
    lastSize = `${vw}x${vh}`;
    const dpr = Math.min(2, devicePixelRatio || 1);
    const orientation = orientationFor(vw, vh);
    const nameCells = rasterize(data.name[orientation]);
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
    placed = new Map();
    anchors.forEach((el) => el.classList.remove('placed'));

    const at = namePlacement(grid, nameDims, orientation);
    addStructure(structures, {
      cells: nameCells,
      footprint: { x: at.x, y: at.y, w: at.w, h: at.h, core: { x: 0, y: 0, w: at.w, h: at.h } },
      pad: 0,
      kind: 'name',
      id: null,
    });
    keepClear.push({ x: at.x - 1, y: at.y - 1, x2: at.x + at.w + 1, y2: at.y + at.h + 1 });

    if (note) {
      note.textContent = data.nameNote[orientation];
      note.style.left = `${at.x * cell}px`;
      note.style.top = `${(at.y + at.h + 1.2) * cell}px`;
      note.style.maxWidth = orientation === 'p' ? `${at.w * cell}px` : '';
    }

    const place = (config: EntityConfig, anchor: { cx: number; ty: number }): Placed | null => {
      const el = anchors.get(config.id);
      if (!el) return null;
      const gun = config.pattern === 'gun';
      const cells = PATTERNS[config.pattern];
      const fp = footprint({ w: cells[0].length, h: cells.length }, config.pad, anchor, gun);
      addStructure(structures, { cells, footprint: fp, pad: gun ? 0 : config.pad, kind: gun ? 'gun' : 'osc', id: config.id });
      // the link sits under the pattern and its hit area covers the pattern too
      const hit = el.querySelector<HTMLElement>('.hit');
      if (hit) {
        hit.style.width = `${fp.core.w * cell}px`;
        hit.style.height = `${fp.core.h * cell}px`;
      }
      el.style.left = `${(fp.x + fp.core.x) * cell + (fp.core.w * cell) / 2}px`;
      el.style.top = `${fp.y * cell}px`;
      el.classList.add('placed');
      const result = { config, el, fp };
      placed.set(config.id, result);
      return result;
    };
    const addLabelBoxes = (el: HTMLElement) => {
      for (const part of el.querySelectorAll<HTMLElement>('.name, .meta')) {
        const r = part.getBoundingClientRect();
        if (r.width && r.height) keepClear.push(rectToBox(r, cell));
      }
    };

    const nameRect = at;
    const fixed = data.entities.filter((entity) => entity.at?.[orientation]);
    const loose = data.entities.filter((entity) => !entity.at?.[orientation]);
    for (const config of fixed) place(config, anchorFor(config.at![orientation], grid, nameRect));
    if (note) {
      const r = note.getBoundingClientRect();
      keepClear.push(rectToBox(r, cell));
    }
    placed.forEach(({ el }) => addLabelBoxes(el));

    // a project the layout doesn't know: the first free rectangle, nearest the middle
    const hud: Box[] = [];
    document.querySelectorAll<HTMLElement>('.hud').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width && r.height) hud.push(rectToBox(r, cell));
    });
    for (const config of loose) {
      const el = anchors.get(config.id);
      if (!el) continue;
      const cells = PATTERNS[config.pattern];
      const fp = footprint({ w: cells[0].length, h: cells.length }, config.pad, { cx: 0, ty: 0 });
      const hit = el.querySelector<HTMLElement>('.hit');
      if (hit) {
        hit.style.width = `${fp.w * cell}px`;
        hit.style.height = `${fp.h * cell}px`;
      }
      el.style.left = '0px';
      el.style.top = '0px';
      const r = el.getBoundingClientRect();
      const need = { w: Math.ceil(r.width / cell) + 2, h: Math.ceil(r.height / cell) + 1 };
      const occupied = [...keepClear, ...hud, ...structures.map((s) => coreBox(s))];
      const slot = findFreeSlot(need, occupied, grid, { margin: 2 });
      if (!slot) {
        console.warn(`[board] no free slot for "${config.id}": left off the board (still in the list)`);
        continue;
      }
      const result = place(config, { cx: Math.round(slot.x + need.w / 2), ty: slot.y + config.pad });
      if (result) addLabelBoxes(result.el);
    }

    // the board starts busy: a third of the free space is seeded
    const boxes = protectedBoxes();
    seedWorld(world, (x, y) => isProtected(x, y, 5, boxes), 0.3);
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
    const k = idx(world.w, world.h, x, y);
    world.cells[k] = 1;
    world.heat[k] = 200;
  };
  const dropGlider = (x: number, y: number) => {
    const glider = GLIDERS[(Math.random() * 4) | 0];
    glider.forEach((row, j) =>
      row.forEach((value, i) => {
        if (!value || !isFree(x + i - 1, y + j - 1)) return;
        const k = idx(world.w, world.h, x + i - 1, y + j - 1);
        world.cells[k] = 1;
        world.heat[k] = 255;
      }),
    );
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

  // ---- dive and return ----
  const flag = createFromFlag(() => sessionStorage);
  const tracker = createReturnTracker(flag);
  const diveKinds = new Set(['project', 'page']);
  let diving = false;
  let hoverId: string | null = null;

  const cleanUrl = () => {
    const url = new URL(location.href);
    if (!url.searchParams.has('from')) return;
    url.searchParams.delete('from');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };
  const originOf = (target: Placed) => {
    const { fp } = target;
    stage.style.transformOrigin = `${(fp.x + fp.core.x + fp.core.w / 2) * cell}px ${(fp.y + fp.core.y + fp.core.h / 2) * cell}px`;
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
    const target = placed.get(slug);
    if (!target || !diveKinds.has(target.config.kind)) return false;
    tracker.remember(slug);
    cleanUrl();
    if (reduced) return true;
    originOf(target);
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

  labels.addEventListener('click', (event) => {
    const el = (event.target as Element).closest<HTMLElement>('.ent');
    const target = el && placed.get(el.dataset.id ?? '');
    if (!el || !target || !(el instanceof HTMLAnchorElement)) return;
    if (!diveKinds.has(target.config.kind) && target.config.kind !== 'cv') return;
    // leaving without a dive (reduced motion, new tab): no slug may survive to be replayed on a later Back
    if (reduced || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
      tracker.forget();
      return;
    }
    event.preventDefault();
    if (diving) return;
    diving = true;
    if (diveKinds.has(target.config.kind)) tracker.remember(target.config.id);
    else tracker.forget();
    originOf(target);
    stage.style.transform = `scale(${DIVE_SCALE})`;
    setTimeout(() => {
      location.href = el.href;
      // if the navigation never happens (offline, blocked), the board must come back;
      // a slow navigation that does happen unloads the page first, which cancels this
      const fallback = setTimeout(resetStage, 3000);
      addEventListener('pagehide', () => clearTimeout(fallback), { once: true });
    }, DIVE_MS);
  });
  labels.addEventListener('pointerover', (event) => {
    hoverId = (event.target as Element).closest<HTMLElement>('.ent')?.dataset.id ?? null;
  });
  labels.addEventListener('pointerout', (event) => {
    if (!(event.relatedTarget as Element | null)?.closest?.('.ent')) hoverId = null;
  });
  labels.addEventListener('focusin', (event) => {
    hoverId = (event.target as Element).closest<HTMLElement>('.ent')?.dataset.id ?? null;
  });
  labels.addEventListener('focusout', () => {
    hoverId = null;
  });

  layout();

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const from = resolveFrom({
    query: new URLSearchParams(location.search).get('from'),
    navType: navigation?.type,
    stored: flag.get(),
  });
  flag.clear();
  const replayed = from ? replayZoomOut(from) : false;
  canvas.dataset.entry = replayed && !reduced ? 'zoom-out' : reduced ? 'direct' : 'intro';
  stage.classList.add('ready');

  addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    const slug = flag.get();
    flag.clear();
    resetStage();
    if (slug && replayZoomOut(slug)) canvas.dataset.entry = reduced ? 'direct' : 'zoom-out';
  });
  // Back → Forward → Back: the flag was consumed on arrival, put it back when the board is left
  addEventListener('pagehide', () => tracker.pagehide());
  // any other way out (CV, language switch, list link) must not replay a zoom-out on the next Back
  document.addEventListener(
    'click',
    (event) => {
      if (event.target instanceof Element && event.target.closest('a[href]')) tracker.forget();
    },
    true,
  );

  // ---- list ----
  const list = document.querySelector<HTMLElement>('#list');
  const listButton = document.querySelector<HTMLButtonElement>('#list-btn');
  const listClose = document.querySelector<HTMLButtonElement>('#list-close');
  const setList = (open: boolean) => {
    if (!list) return;
    list.classList.toggle('open', open);
    listButton?.setAttribute('aria-expanded', String(open));
    // a closed panel is out of the tab order and out of the accessibility tree
    if (open) {
      list.removeAttribute('inert');
      list.removeAttribute('aria-hidden');
      listClose?.focus();
    } else {
      const hadFocus = list.contains(document.activeElement);
      list.setAttribute('inert', '');
      list.setAttribute('aria-hidden', 'true');
      if (hadFocus) listButton?.focus();
    }
  };
  setList(false);
  listButton?.addEventListener('click', () => setList(!list?.classList.contains('open')));
  listClose?.addEventListener('click', () => setList(false));
  document.addEventListener('keydown', (event) => {
    // leave Escape alone when another control has already used it, or during IME composition
    if (event.key !== 'Escape' || event.defaultPrevented || event.isComposing || !list?.classList.contains('open')) return;
    event.preventDefault();
    setList(false);
  });

  document.addEventListener('themechange', readColors);

  let resizeTimer: ReturnType<typeof setTimeout>;
  addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (`${innerWidth}x${innerHeight}` !== lastSize && !diving) layout();
    }, 200);
  });

  // ---- loop ----
  const t0 = performance.now();
  let gen = 0;
  let last = 0;
  function tick(): void {
    gen++;
    stepWorld(world);
    clearBoxes(world, keepClear);
    stepStructures(world, structures, gen);
    if (gen % FEED_EVERY === 0) addFeedGlider(world);
    updateCounters(gen);
  }
  const loop = (now: number) => {
    requestAnimationFrame(loop);
    if (!reduced && now - last > RATE && now - t0 > 500) {
      last = now;
      tick();
    }
    draw({
      ctx,
      cell,
      dpr: Math.min(2, devicePixelRatio || 1),
      width: innerWidth,
      height: innerHeight,
      world,
      structures,
      colors,
      hoverId,
      ready: reduced ? 1 : Math.min(1, (now - t0) / INTRO_MS),
    });
  };
  requestAnimationFrame(loop);
}
