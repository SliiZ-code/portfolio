import type { At, Box } from './layout';
import type { PatternName } from './patterns';

export interface EntityConfig {
  id: string;
  kind: 'project' | 'page' | 'cv' | 'contact';
  pattern: PatternName;
  pad: number;
  /** Null: the board looks for a free slot at runtime. */
  at: At | null;
}

export interface BoardConfig {
  /** The text rasterised into cells, per orientation. */
  name: { l: string; p: string };
  nameNote: { l: string; p: string };
  entities: EntityConfig[];
}

export interface Structure {
  x: number;
  y: number;
  w: number;
  h: number;
  cur: Uint8Array;
  nxt: Uint8Array;
  hidden: Uint16Array;
  born: Float32Array;
  kind: 'name' | 'osc' | 'gun';
  /** The entity this structure belongs to; null for the name. */
  id: string | null;
  core: { x: number; y: number; w: number; h: number };
  hurt: boolean;
  shots: number;
}

export type { Box };
