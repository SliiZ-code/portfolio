import { idx, spawn, type World } from './life';
import type { Footprint } from './layout';
import type { Structure } from './types';

interface StructureInput {
  cells: number[][];
  footprint: Footprint;
}

/** Adds a structure: cells that stay where they are (the name) and answer to intrusion. */
export function addStructure(structures: Structure[], { cells, footprint }: StructureInput): Structure {
  const { x, y, w, h, core } = footprint;
  const cur = new Uint8Array(w * h);
  cells.forEach((row, j) => row.forEach((value, i) => (cur[j * w + i] = value)));
  const structure: Structure = {
    x,
    y,
    w,
    h,
    cur,
    hidden: new Uint16Array(w * h),
    core: { ...core },
    hurt: false,
  };
  structures.push(structure);
  return structure;
}

/** Handles intrusion, release, regrowth and healing of every structure. */
export function stepStructures(world: World, structures: Structure[], gen: number): void {
  for (const structure of structures) {
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
              spawn(world, idx(world.w, world.h, structure.x + ii, structure.y + jj));
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

export const structurePopulation = (structures: Structure[]): number =>
  structures.reduce((total, structure) => total + structure.cur.reduce((sum, value) => sum + value, 0), 0);
