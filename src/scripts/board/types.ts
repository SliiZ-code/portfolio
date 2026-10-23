import type { EmblemName } from './patterns';

export interface Point {
  x: number;
  y: number;
}

export interface Box {
  x: number;
  y: number;
  x2: number;
  y2: number;
}

export interface Cam {
  x: number;
  y: number;
  z: number;
}

export interface Viewport {
  w: number;
  h: number;
}

export interface NoteConfig {
  t: string;
  r: number;
}

export interface MediaConfig {
  video?: string;
  image?: string;
}

export interface BoardProjectConfig {
  id: string;
  text: string;
  x: number;
  y: number;
  emblem: EmblemName;
  pad: number;
  label: string;
  note?: NoteConfig;
  media?: MediaConfig;
  url: string;
}

export interface BoardConfig {
  home: { text: string; k: number };
  cv: { text: string; k: number; label: string; note: NoteConfig; url: string };
  contact: {
    text: string;
    k: number;
    x: number;
    y: number;
    gun: boolean;
    label: string;
    note: NoteConfig;
    url: string;
  };
  projects: BoardProjectConfig[];
  nameNote: string[];
}

export interface Entity {
  id: string;
  x: number;
  y: number;
  text: string;
  k: number;
  label?: string;
  note?: NoteConfig;
  emblem?: EmblemName;
  pad?: number;
  gun?: boolean;
  url?: string;
  media?: MediaConfig;
  cx?: number;
  parts?: Structure[];
  box: Box;
  labelAt: Point;
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
  kind: 'osc' | 'gun' | 'text';
  entity: Entity;
  core: { x: number; y: number; w: number; h: number };
  hurt: boolean;
  shots: number;
}

export interface Dive {
  entity: Entity | null;
  t0: number;
  from: Cam;
  to: Cam;
  dir: 1 | -1;
}
