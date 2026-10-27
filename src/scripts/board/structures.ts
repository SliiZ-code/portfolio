import { idx, stepBox, type World } from './life';
import type { Footprint } from './layout';
import type { Structure } from './types';

interface StructureInput {
  cells: number[][];
  footprint: Footprint;
  /** Offset of the pattern inside its board. */
  pad: number;
  kind: Structure['kind'];
  id: string | null;
}

/** Adds a structure with its own private, bounded Life simulation. */
export function addStructure(structures: Structure[], { cells, footprint, pad, kind, id }: StructureInput): Structure {
  const { x, y, w, h, core } = footprint;
  const cur = new Uint8Array(w * h);
  cells.forEach((row, j) => row.forEach((value, i) => (cur[(j + pad) * w + i + pad] = value)));
  const structure: Structure = {
    x,
    y,
    w,
    h,
    cur,
    nxt: new Uint8Array(w * h),
    hidden: new Uint16Array(w * h),
    born: new Float32Array(w * h).map(() => Math.random()),
    kind,
    id,
    core: { ...core },
    hurt: false,
    shots: 0,
  };
  structures.push(structure);
  return structure;
}

/** Advances every private structure and handles intrusion, release, regrowth and healing. */
export function stepStructures(world: World, structures: Structure[], gen: number): void {
  for (const structure of structures) {
    if (structure.kind !== 'name') {
      stepBox(structure.cur, structure.nxt, structure.w, structure.h);
      [structure.cur, structure.nxt] = [structure.nxt, structure.cur];
    }
    if (structure.kind === 'gun') emitGliders(world, structure);

    // intrusion: free cells inside the core knock structure cells loose
    const { core } = structure;
    for (let j = core.y; j < core.y + core.h; j++) {
      for (let i = core.x; i < core.x + core.w; i++) {
        if (!world.cells[idx(world.w, world.h, structure.x + i, structure.y + j)]) continue;
        structure.hurt = true;
        for (let dj = -2; dj <= 2; dj++) {
          for (let di = -2; di <= 2; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= structure.w || jj >= structure.h) continue;
            const k = jj * structure.w + ii;
            if (structure.cur[k] && !structure.hidden[k] && Math.random() < 0.6) {
              structure.hidden[k] = 20 + Math.random() * 40;
              const at = idx(world.w, world.h, structure.x + ii, structure.y + jj);
              world.cells[at] = 1;
              world.heat[at] = 255;
            }
          }
        }
      }
    }

    // regrow
    let still = false;
    for (let k = 0; k < structure.hidden.length; k++) {
      if (structure.hidden[k]) {
        structure.hidden[k]--;
        still = true;
      }
    }
    // heal: once the wound is old enough, the structure absorbs whatever debris is left in its core
    if (structure.hurt && (!still || gen % 40 === 0)) {
      for (let j = 0; j < core.h; j++) {
        for (let i = 0; i < core.w; i++) world.cells[idx(world.w, world.h, structure.x + i, structure.y + j)] = 0;
      }
      if (!still) structure.hurt = false;
    }
  }
}

/** Gliders leave the gun's board column by column; every other one is handed to the world. */
function emitGliders(world: World, structure: Structure): void {
  const seen = new Uint8Array(structure.w * structure.h);
  for (let k = 0; k < structure.cur.length; k++) {
    if (!structure.cur[k] || seen[k]) continue;
    const component = [k];
    const stack = [k];
    seen[k] = 1;
    while (stack.length) {
      const q = stack.pop()!;
      const qx = q % structure.w;
      const qy = (q / structure.w) | 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const xx = qx + dx;
          const yy = qy + dy;
          if (xx < 0 || yy < 0 || xx >= structure.w || yy >= structure.h) continue;
          const n = yy * structure.w + xx;
          if (structure.cur[n] && !seen[n]) {
            seen[n] = 1;
            component.push(n);
            stack.push(n);
          }
        }
      }
    }
    if (component.every((q) => q % structure.w >= 38)) {
      const keep = structure.shots++ % 2 === 0;
      for (const q of component) {
        structure.cur[q] = 0;
        if (keep) world.cells[idx(world.w, world.h, structure.x + (q % structure.w), structure.y + ((q / structure.w) | 0))] = 1;
      }
    }
  }
}

export const structurePopulation = (structures: Structure[]): number =>
  structures.reduce((total, structure) => total + structure.cur.reduce((sum, value) => sum + value, 0), 0);
