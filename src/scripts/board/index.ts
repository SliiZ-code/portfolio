import { GLIDERS, GUN, PATTERNS } from './patterns';
import { rasterize } from './rasterize';
import { createWorld, idx, stepWorld } from './life';
import { addStructure, stepStructures, structurePopulation, widenGun } from './structures';
import { clampCam, flyTo, toWorld } from './camera';
import { draw, type Colors, type RenderState } from './render';
import { drawMini } from './minimap';
import { createFromFlag, createReturnTracker, resolveFrom } from './return-flag';
import { bindInput } from './input';
import type { BoardConfig, Cam, Dive, Entity, Structure, Viewport } from './types';

const WORLD = { w: 420, h: 280 };
const RATE = 110;

const blank = () => ({ x: 0, y: 0, x2: 0, y2: 0 });

export async function initBoard(): Promise<void> {
  const source = document.getElementById('board-data');
  const canvas = document.querySelector<HTMLCanvasElement>('#board');
  if (!source?.textContent || !canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  let data: BoardConfig;
  try {
    data = JSON.parse(source.textContent) as BoardConfig;
  } catch {
    return;
  }

  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const css = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  let colors: Colors = { paper: '', ink: '', mute: '', accent: '' };
  const readColors = () => {
    colors = { paper: css('--paper'), ink: css('--ink'), mute: css('--mute'), accent: css('--accent') };
  };
  readColors();

  try {
    await Promise.all([
      document.fonts.load('32px "Geist Pixel"'),
      document.fonts.load('12px "Geist Mono"'),
      document.fonts.load('17px "Shantell Sans"'),
    ]);
  } catch {
    // the fallback font still gives a usable board
  }

  const world = createWorld(WORLD.w, WORLD.h);
  const structures: Structure[] = [];
  const viewport: Viewport = { w: innerWidth, h: innerHeight };

  const name: Entity = {
    id: 'name',
    x: 210,
    y: 122,
    text: data.home.text,
    k: data.home.k,
    box: blank(),
    labelAt: { x: 0, y: 0 },
  };
  const cv: Entity = {
    id: 'cv',
    x: 0,
    y: 0,
    text: data.cv.text,
    k: data.cv.k,
    label: data.cv.label,
    note: data.cv.note,
    url: data.cv.url,
    box: blank(),
    labelAt: { x: 0, y: 0 },
  };
  const entities: Entity[] = [name, cv, ...data.projects.map((project) => ({
    id: project.id,
    x: project.x,
    y: project.y,
    text: project.text,
    k: 1,
    emblem: project.emblem,
    pad: project.pad,
    label: project.label,
    note: project.note,
    media: project.media,
    url: project.url,
    box: blank(),
    labelAt: { x: 0, y: 0 },
  } as Entity)), {
    id: 'contact',
    x: data.contact.x,
    y: data.contact.y,
    text: data.contact.text,
    k: data.contact.k,
    gun: true,
    label: data.contact.label,
    note: data.contact.note,
    url: data.contact.url,
    box: blank(),
    labelAt: { x: 0, y: 0 },
  }];

  const nm = rasterize(name.text, name.k);
  if (nm.length && nm[0]?.length) {
    cv.x = 210 + nm[0].length / 2 - 8;
    cv.y = name.y + nm.length + 5;
  }

  for (const entity of entities) {
    const parts: Structure[] = [];
    let top = entity.y;
    if (entity.emblem) {
      const pattern = PATTERNS[entity.emblem];
      const width = pattern[0].length;
      const height = pattern.length;
      parts.push(addStructure(structures, {
        cells: pattern,
        x: Math.round(entity.x - width / 2),
        y: entity.y,
        pad: entity.pad ?? 0,
        kind: 'osc',
        entity,
      }));
      top = entity.y + height + (entity.pad ?? 0) + 2;
    }
    if (entity.gun) {
      const gun = addStructure(structures, {
        cells: GUN,
        x: entity.x,
        y: entity.y,
        pad: 0,
        kind: 'gun',
        entity,
      });
      widenGun(gun, { x: 0, y: 0, w: 37, h: 10 });
      parts.push(gun);
      top = entity.y + 11;
      entity.cx = entity.x + 18;
    }
    const text = rasterize(entity.text, entity.k);
    if (!text.length || !text[0]?.length) continue;
    const tx = entity.gun ? entity.x : Math.round(entity.x - text[0].length / 2);
    parts.push(addStructure(structures, { cells: text, x: tx, y: top, kind: 'text', entity }));
    entity.parts = parts;
    const xs = parts.flatMap((part) => [part.x, part.x + part.w]);
    const ys = parts.flatMap((part) => [part.y, part.y + part.h]);
    entity.box = {
      x: Math.min(...xs) - 2,
      y: Math.min(...ys) - 2,
      x2: Math.max(...xs) + 2,
      y2: Math.max(...ys) + (entity.label ? 5 : 2),
    };
    entity.labelAt = { x: tx, y: Math.max(...parts.map((part) => part.y + part.h)) + 2 };
  }

  const inAnyBox = (x: number, y: number, margin: number): boolean =>
    entities.some((entity) =>
      x > entity.box.x - margin && x < entity.box.x2 + margin &&
      y > entity.box.y - margin && y < entity.box.y2 + margin,
    );

  // a few soups far from everything, so the board starts alive but not chaotic
  for (let k = 0; k < 26; k++) {
    const sx = (Math.random() * WORLD.w) | 0;
    const sy = (Math.random() * WORLD.h) | 0;
    if (inAnyBox(sx, sy, 22)) continue;
    for (let j = 0; j < 12; j++) {
      for (let i = 0; i < 12; i++) {
        if (Math.random() < 0.35) world.cells[idx(WORLD.w, WORLD.h, sx + i, sy + j)] = 1;
      }
    }
  }

  const mobile = innerWidth < 760;
  const nameWidth = name.box.x2 - name.box.x;
  const nameMid = (name.box.y + name.box.y2) / 2;
  const homeZ = mobile ? innerWidth * 0.94 / nameWidth : Math.min(9, innerWidth * 0.6 / nameWidth);
  const cam: Cam = { x: name.x, y: nameMid + 4, z: homeZ };
  const camT: Cam = { ...cam };
  const home: Cam = { ...cam };
  clampCam(cam, viewport, WORLD);
  clampCam(camT, viewport, WORLD);

  let intro = reduced ? 0 : 1600;
  let introStart = performance.now();
  let dive: Dive | null = null;
  let hover: Entity | null = null;

  const cleanUrl = () => {
    const url = new URL(location.href);
    if (!url.searchParams.has('from')) return;
    url.searchParams.delete('from');
    history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const flag = createFromFlag(() => sessionStorage);
  const tracker = createReturnTracker(flag);
  const diveTarget = (entity: Entity) => !['name', 'cv', 'contact'].includes(entity.id);

  const replayZoomOut = (slug: string): boolean => {
    const target = entities.find((entity) => entity.id === slug && diveTarget(entity));
    if (!target) return false;
    tracker.remember(slug);
    intro = 0;
    introStart = performance.now();
    if (reduced) {
      // no zoom-out for reduced motion: land on the home view directly
      Object.assign(cam, home);
      Object.assign(camT, home);
      dive = null;
      cleanUrl();
    } else {
      cam.x = (target.box.x + target.box.x2) / 2;
      cam.y = (target.box.y + target.box.y2) / 2;
      cam.z = 70;
      Object.assign(camT, home);
      dive = { entity: target, t0: performance.now(), from: { ...cam }, to: { ...home }, dir: -1 };
    }
    return true;
  };

  const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
  const from = resolveFrom({
    query: new URLSearchParams(location.search).get('from'),
    navType: navigation?.type,
    stored: flag.get(),
  });
  flag.clear();
  canvas.dataset.entry = from && replayZoomOut(from) ? (reduced ? 'direct' : 'zoom-out') : reduced ? 'direct' : 'intro';

  addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    const slug = flag.get();
    flag.clear();
    if (slug && replayZoomOut(slug)) canvas.dataset.entry = reduced ? 'direct' : 'zoom-out';
  });

  // Back → Forward → Back: the flag was consumed on arrival, put it back when the board is left
  addEventListener('pagehide', () => tracker.pagehide());
  // any other way out (CV, language switch, list link) must not replay a zoom-out on the next Back
  document.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('a[href]')) tracker.forget();
  }, true);

  const resize = () => {
    const dpr = Math.min(2, devicePixelRatio || 1);
    viewport.w = innerWidth;
    viewport.h = innerHeight;
    canvas.width = viewport.w * dpr;
    canvas.height = viewport.h * dpr;
    clampCam(camT, viewport, WORLD);
    if (!dive) clampCam(cam, viewport, WORLD);
    drawMiniFrame();
  };

  const inert = (entity: Entity) => entity.id === 'contact' && !entity.url;
  const entityAt = (wx: number, wy: number): Entity | null =>
    entities.find((entity) => !inert(entity) && wx >= entity.box.x && wx <= entity.box.x2 && wy >= entity.box.y && wy <= entity.box.y2) ?? null;

  const paint = (wx: number, wy: number) => {
    const x = Math.floor(wx);
    const y = Math.floor(wy);
    if (x < 0 || y < 0 || x >= WORLD.w || y >= WORLD.h || inAnyBox(x, y, 0)) return;
    world.cells[idx(WORLD.w, WORLD.h, x, y)] = 1;
    world.heat[idx(WORLD.w, WORLD.h, x, y)] = 200;
  };

  const dropGlider = (x: number, y: number) => {
    const glider = GLIDERS[(Math.random() * 4) | 0];
    glider.forEach((row, j) => row.forEach((value, i) => {
      if (!value) return;
      const xx = x + i - 1;
      const yy = y + j - 1;
      world.cells[idx(WORLD.w, WORLD.h, xx, yy)] = 1;
      world.heat[idx(WORLD.w, WORLD.h, xx, yy)] = 255;
    }));
  };

  const activate = (entity: Entity) => {
    if (entity.id === 'name') return;
    if (entity.id === 'contact') {
      if (entity.url) location.href = entity.url;
      return;
    }
    if (reduced) {
      if (entity.url) location.href = entity.url;
      return;
    }
    const cx = (entity.box.x + entity.box.x2) / 2;
    const cy = (entity.box.y + entity.box.y2) / 2;
    dive = { entity, t0: performance.now(), from: { ...cam }, to: { x: cx, y: cy, z: 70 }, dir: 1 };
  };

  bindInput({
    canvas,
    cam,
    camT,
    viewport: () => viewport,
    clamp: (value) => clampCam(value, viewport, WORLD),
    toWorld: (sx, sy) => toWorld(cam, viewport, sx, sy),
    entityAt,
    insideEntity: (wx, wy) => inAnyBox(wx, wy, 0),
    paint,
    dropGlider,
    activate,
    setHover: (entity) => {
      hover = entity;
    },
  });

  document.querySelectorAll<HTMLElement>('[data-go="name"]').forEach((button) => {
    button.addEventListener('click', () => {
      dive = null;
      flyTo(camT, name.x, nameMid + 4, homeZ, viewport, WORLD);
    });
  });

  const list = document.querySelector<HTMLElement>('#list');
  const listButton = document.querySelector<HTMLButtonElement>('#list-btn');
  const listClose = document.querySelector<HTMLButtonElement>('#list-close');
  const setList = (open: boolean) => {
    list?.classList.toggle('open', open);
    listButton?.setAttribute('aria-expanded', String(open));
  };
  listButton?.addEventListener('click', () => setList(!list?.classList.contains('open')));
  listClose?.addEventListener('click', () => setList(false));

  const mini = document.querySelector<HTMLCanvasElement>('#mini');
  const miniCtx = mini?.getContext('2d') ?? null;
  if (mini) {
    mini.width = WORLD.w;
    mini.height = WORLD.h;
  }
  const drawMiniFrame = () => {
    if (miniCtx) drawMini(miniCtx, world, structures, cam, viewport, colors);
  };
  resize();
  addEventListener('resize', resize);
  const miniGo = (event: PointerEvent) => {
    if (!mini) return;
    const rect = mini.getBoundingClientRect();
    flyTo(camT, (event.clientX - rect.left) / rect.width * WORLD.w, (event.clientY - rect.top) / rect.height * WORLD.h, camT.z, viewport, WORLD);
  };
  mini?.addEventListener('pointerdown', (event) => {
    miniGo(event);
    mini.onpointermove = (move) => {
      if (move.buttons) miniGo(move);
    };
  });

  document.addEventListener('themechange', () => {
    readColors();
    drawMiniFrame();
  });

  const genEl = document.getElementById('gen');
  const popEl = document.getElementById('pop');
  if (popEl) popEl.textContent = String(structurePopulation(structures));

  const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
  const start = performance.now();
  let gen = 0;
  let lastGen = 0;
  let frame = 0;

  const renderState: RenderState = {
    ctx,
    viewport,
    dpr: 1,
    cam,
    world,
    structures,
    entities,
    colors,
    hover,
    diveEntity: null,
    introStart,
    intro,
    name,
    nameNote: data.nameNote,
  };

  const loop = (now: number) => {
    requestAnimationFrame(loop);
    if (dive) {
      const k = Math.min(1, (now - dive.t0) / 900);
      const e = ease(k);
      // zoom geometrically so the dive feels like falling into the cells
      cam.z = dive.from.z * (dive.to.z / dive.from.z) ** e;
      cam.x = dive.from.x + (dive.to.x - dive.from.x) * e;
      cam.y = dive.from.y + (dive.to.y - dive.from.y) * e;
      if (k === 1) {
        if (dive.dir === 1) {
          const target = dive.entity;
          dive = null;
          if (target && diveTarget(target)) tracker.remember(target.id);
          else tracker.forget();
          if (target?.url) location.href = target.url;
        } else {
          Object.assign(camT, cam);
          dive = null;
          cleanUrl();
        }
      }
    } else {
      cam.x += (camT.x - cam.x) * 0.18;
      cam.y += (camT.y - cam.y) * 0.18;
      cam.z += (camT.z - cam.z) * 0.18;
    }

    if (!reduced && now - lastGen > RATE && now - start > intro * 0.4) {
      lastGen = now;
      gen++;
      const population = stepWorld(world);
      stepStructures(world, structures, gen);
      if (genEl) genEl.textContent = String(gen).padStart(4, '0');
      if (popEl) popEl.textContent = String(population + structurePopulation(structures));
    }

    renderState.hover = hover;
    renderState.diveEntity = dive?.entity ?? null;
    renderState.colors = colors;
    renderState.dpr = Math.min(2, devicePixelRatio || 1);
    draw(renderState, now);
    if (frame++ % 6 === 0) drawMiniFrame();
  };

  requestAnimationFrame(loop);
}
