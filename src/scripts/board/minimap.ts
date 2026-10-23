import { toWorld } from './camera';
import type { World } from './life';
import type { Cam, Structure, Viewport } from './types';
import type { Colors } from './render';

export function drawMini(
  ctx: CanvasRenderingContext2D,
  world: World,
  structures: Structure[],
  cam: Cam,
  viewport: Viewport,
  colors: Colors,
): void {
  ctx.fillStyle = colors.paper;
  ctx.fillRect(0, 0, world.w, world.h);
  ctx.fillStyle = colors.mute;
  for (let i = 0; i < world.cells.length; i++) {
    if (world.cells[i]) ctx.fillRect(i % world.w, (i / world.w) | 0, 1, 1);
  }
  ctx.fillStyle = colors.ink;
  for (const structure of structures) {
    for (let k = 0; k < structure.cur.length; k++) {
      if (structure.cur[k] && !structure.hidden[k]) {
        ctx.fillRect(structure.x + (k % structure.w), structure.y + ((k / structure.w) | 0), 1, 1);
      }
    }
  }
  const [x0, y0] = toWorld(cam, viewport, 0, 0);
  const [x1, y1] = toWorld(cam, viewport, viewport.w, viewport.h);
  ctx.strokeStyle = colors.accent;
  ctx.lineWidth = 3;
  ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
}
