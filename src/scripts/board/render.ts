import type { World } from './life';
import type { Structure } from './types';

export interface Colors {
  paper: string;
  ink: string;
  mute: string;
  accent: string;
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
  /** The entity whose link is hovered or focused: its pattern takes the accent. */
  hoverId: string | null;
  /** 0 → 1 over the first moments: structures come in cell by cell, free cells fade in. */
  ready: number;
}

export function draw(state: RenderState): void {
  const { ctx, cell, dpr, width, height, world, structures, colors, hoverId, ready } = state;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, width, height);
  const gap = cell >= 4 ? 1 : 0;
  const size = cell - gap;

  ctx.globalAlpha = 0.5 * ready;
  for (let i = 0; i < world.cells.length; i++) {
    if (!world.cells[i]) continue;
    ctx.fillStyle = world.heat[i] > 30 ? colors.accent : colors.ink;
    ctx.fillRect((i % world.w) * cell + gap, ((i / world.w) | 0) * cell + gap, size, size);
  }

  ctx.globalAlpha = 1;
  for (const structure of structures) {
    ctx.fillStyle = structure.id && structure.id === hoverId ? colors.accent : colors.ink;
    for (let k = 0; k < structure.cur.length; k++) {
      if (!structure.cur[k] || structure.hidden[k] || structure.born[k] > ready) continue;
      ctx.fillRect((structure.x + (k % structure.w)) * cell + gap, (structure.y + ((k / structure.w) | 0)) * cell + gap, size, size);
    }
  }
}
