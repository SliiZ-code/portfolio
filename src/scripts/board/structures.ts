import { idx, stepBox, type World } from './life';
import type { Entity, Structure } from './types';

export interface StructureInput {
  cells: number[][];
  x: number;
  y: number;
  pad?: number;
  kind: Structure['kind'];
  entity: Entity;
  core?: Structure['core'];
}

/** Adds a structure with its own private, bounded Life simulation. */
export function addStructure(structures: Structure[], input: StructureInput): Structure {
  const { cells, x, y, pad = 0, kind, entity, core } = input;
  const h0 = cells.length;
  const w0 = cells[0].length;
  const w = w0 + pad * 2;
  const h = h0 + pad * 2;
  const cur = new Uint8Array(w * h);
  cells.forEach((row, j) => row.forEach((value, i) => (cur[(j + pad) * w + i + pad] = value)));
  const structure: Structure = {
    x: x - pad,
    y: y - pad,
    w,
    h,
    cur,
    nxt: new Uint8Array(w * h),
    hidden: new Uint16Array(w * h),
    born: new Float32Array(w * h).map(() => Math.random()),
    kind,
    entity,
    core: core ?? { x: 0, y: 0, w, h },
    hurt: false,
    shots: 0,
  };
  structures.push(structure);
  return structure;
}

/** The gun needs a wider private box so gliders can leave before being handed to the world. */
export function widenGun(structure: Structure, core: Structure['core']): void {
  const w = 52;
  const h = 34;
  const cur = new Uint8Array(w * h);
  for (let j = 0; j < structure.h; j++) {
    for (let i = 0; i < structure.w; i++) cur[j * w + i] = structure.cur[j * structure.w + i];
  }
  structure.w = w;
  structure.h = h;
  structure.cur = cur;
  structure.nxt = new Uint8Array(w * h);
  structure.hidden = new Uint16Array(w * h);
  structure.born = new Float32Array(w * h).map(() => Math.random());
  structure.core = core;
}

/** Advances every private structure and handles intrusion / healing. */
export function stepStructures(world: World, structures: Structure[], gen: number): void {
  for (const structure of structures) {
    if (structure.kind === 'osc' || structure.kind === 'gun') {
      stepBox(structure.cur, structure.nxt, structure.w, structure.h);
      [structure.cur, structure.nxt] = [structure.nxt, structure.cur];
    }
    if (structure.kind === 'gun') emitGliders(world, structure);

    // intrusion: free cells inside the core knock structure cells loose
    const core = structure.core;
    for (let j = core.y; j < core.y + core.h; j++) {
      for (let i = core.x; i < core.x + core.w; i++) {
        const worldIndex = idx(world.w, world.h, structure.x + i, structure.y + j);
        if (!world.cells[worldIndex]) continue;
        structure.hurt = true;
        for (let dj = -3; dj <= 3; dj++) {
          for (let di = -3; di <= 3; di++) {
            const ii = i + di;
            const jj = j + dj;
            if (ii < 0 || jj < 0 || ii >= structure.w || jj >= structure.h) continue;
            const k = jj * structure.w + ii;
            if (structure.cur[k] && !structure.hidden[k] && Math.random() < 0.7) {
              structure.hidden[k] = 25 + Math.random() * 45;
              const worldIndex2 = idx(world.w, world.h, structure.x + ii, structure.y + jj);
              world.cells[worldIndex2] = 1;
              world.heat[worldIndex2] = 255;
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
    // once a wound is old enough, the structure absorbs whatever debris is left in its box
    if (structure.hurt && (!still || gen % 45 === 0)) {
      for (let j = 0; j < structure.core.h; j++) {
        for (let i = 0; i < structure.core.w; i++) {
          world.cells[idx(world.w, world.h, structure.x + i, structure.y + j)] = 0;
        }
      }
      if (!still) structure.hurt = false;
    }
  }
}

/** The gun hands finished gliders to the world one time in three, so it doesn't flood. */
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
      const keep = structure.shots++ % 3 === 0;
      for (const q of component) {
        structure.cur[q] = 0;
        if (keep) world.cells[idx(world.w, world.h, structure.x + (q % structure.w), structure.y + ((q / structure.w) | 0))] = 1;
      }
    }
  }
}

export const structurePopulation = (structures: Structure[]): number =>
  structures.reduce((total, structure) => total + structure.cur.reduce((sum, value) => sum + value, 0), 0);
