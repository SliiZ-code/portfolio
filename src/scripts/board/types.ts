import type { At } from './layout';
import type { PatternName } from './patterns';

/** What stays a structure on the board: the CV and the contact. Projects are an HTML list. */
export interface EntityConfig {
  id: string;
  kind: 'cv' | 'contact';
  pattern: PatternName;
  pad: number;
  at: At;
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
  kind: 'name' | 'osc' | 'gun';
  /** The entity this structure belongs to; null for the name. */
  id: string | null;
  core: { x: number; y: number; w: number; h: number };
  hurt: boolean;
  shots: number;
}
