import type { World } from './life';
import { toScreen, toWorld } from './camera';
import type { Cam, Entity, Structure, Viewport } from './types';

export interface Colors {
  paper: string;
  ink: string;
  mute: string;
  accent: string;
}

export interface RenderState {
  ctx: CanvasRenderingContext2D;
  viewport: Viewport;
  dpr: number;
  cam: Cam;
  world: World;
  structures: Structure[];
  entities: Entity[];
  colors: Colors;
  hover: Entity | null;
  diveEntity: Entity | null;
  introStart: number;
  intro: number;
  name: Entity;
  nameNote: string[];
}

export function draw(state: RenderState, now: number): void {
  const { ctx, viewport, dpr, cam, world, structures, entities, colors: C, hover, diveEntity, name } = state;
  const t = Math.max(0, now - state.introStart);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = C.paper;
  ctx.fillRect(0, 0, viewport.w, viewport.h);

  const z = cam.z;
  const [x0, y0] = toWorld(cam, viewport, 0, 0);
  const [x1, y1] = toWorld(cam, viewport, viewport.w, viewport.h);
  const cx0 = Math.max(0, Math.floor(x0));
  const cy0 = Math.max(0, Math.floor(y0));
  const cx1 = Math.min(world.w, Math.ceil(x1));
  const cy1 = Math.min(world.h, Math.ceil(y1));

  // intro: the grid is drawn outward from the centre
  const reveal = state.intro ? Math.min(1, t / (state.intro * 0.5)) : 1;
  const radius = reveal * Math.hypot(viewport.w, viewport.h) / 2;
  ctx.save();
  ctx.beginPath();
  ctx.arc(viewport.w / 2, viewport.h / 2, radius, 0, 7);
  ctx.clip();

  if (z >= 4) {
    ctx.strokeStyle = C.ink;
    ctx.globalAlpha = Math.min(0.08, (z - 4) * 0.02);
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = cx0; x <= cx1; x++) {
      const [sx] = toScreen(cam, viewport, x, 0);
      ctx.moveTo(Math.round(sx) + 0.5, toScreen(cam, viewport, 0, cy0)[1]);
      ctx.lineTo(Math.round(sx) + 0.5, toScreen(cam, viewport, 0, cy1)[1]);
    }
    for (let y = cy0; y <= cy1; y++) {
      const [, sy] = toScreen(cam, viewport, 0, y);
      ctx.moveTo(toScreen(cam, viewport, cx0, 0)[0], Math.round(sy) + 0.5);
      ctx.lineTo(toScreen(cam, viewport, cx1, 0)[0], Math.round(sy) + 0.5);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // world edge
  ctx.strokeStyle = C.mute;
  ctx.setLineDash([4, 6]);
  const [ex, ey] = toScreen(cam, viewport, 0, 0);
  ctx.strokeRect(ex, ey, world.w * z, world.h * z);
  ctx.setLineDash([]);
  ctx.restore();

  const gap = z >= 6 ? 1 : 0;
  const size = z - gap;
  const cellsIn = state.intro
    ? Math.max(0, Math.min(1, (t - state.intro * 0.35) / (state.intro * 0.65 || 1)))
    : 1;

  // free cells
  ctx.globalAlpha = 0.55 * cellsIn;
  for (let y = cy0; y < cy1; y++) {
    for (let x = cx0; x < cx1; x++) {
      const i = y * world.w + x;
      if (!world.cells[i]) continue;
      ctx.fillStyle = world.heat[i] > 30 ? C.accent : C.ink;
      const [sx, sy] = toScreen(cam, viewport, x, y);
      ctx.fillRect(sx, sy, size, size);
    }
  }
  ctx.globalAlpha = 1;

  // structures
  for (const structure of structures) {
    if (structure.x > cx1 || structure.y > cy1 || structure.x + structure.w < cx0 || structure.y + structure.h < cy0) continue;
    const hot = (hover === structure.entity && structure.entity.id !== 'name') || diveEntity === structure.entity;
    ctx.fillStyle = hot ? C.accent : C.ink;
    for (let k = 0; k < structure.cur.length; k++) {
      if (!structure.cur[k] || structure.hidden[k]) continue;
      if (state.intro && structure.born[k] > cellsIn) continue;
      const [sx, sy] = toScreen(cam, viewport, structure.x + (k % structure.w), structure.y + ((k / structure.w) | 0));
      ctx.fillRect(sx, sy, size, size);
    }
  }

  // labels and margin notes, only when they'd be legible
  if (z >= 3.2 && cellsIn === 1) {
    for (const entity of entities) {
      if (entity.label) {
        const [lx, ly] = toScreen(cam, viewport, entity.labelAt.x, entity.labelAt.y);
        ctx.font = `${Math.max(10, z * 1.35)}px "Geist Mono"`;
        ctx.textBaseline = 'top';
        ctx.fillStyle = hover === entity ? C.accent : C.mute;
        ctx.fillText(entity.label.toUpperCase(), lx, ly);
      }
      if (entity.note) {
        const [nx, ny] = toScreen(cam, viewport, entity.labelAt.x - 1, entity.labelAt.y + 5);
        ctx.save();
        ctx.translate(nx, ny);
        ctx.rotate(entity.note.r);
        const fs = Math.max(12, z * 1.9);
        ctx.font = `${fs}px "Shantell Sans"`;
        ctx.fillStyle = C.accent;
        entity.note.t.split('\n').forEach((line, k) => ctx.fillText(line, 0, k * fs * 1.2));
        ctx.restore();
      }
    }

    // the one note that tells you what this is
    const [hx, hy] = toScreen(cam, viewport, name.box.x + 2, name.box.y2 + 3);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(-0.025);
    const fs = Math.max(13, z * 2);
    ctx.font = `${fs}px "Shantell Sans"`;
    ctx.fillStyle = C.accent;
    state.nameNote.forEach((line, k) => ctx.fillText(line, 0, k * Math.max(16, z * 2.4)));
    ctx.restore();
  }
}
