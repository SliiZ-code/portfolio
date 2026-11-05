/** What the script reads from the page: the name, rasterised, and the note under it. */
export interface BoardConfig {
  /** The text rasterised into cells, per orientation. */
  name: { l: string; p: string };
  nameNote: { l: string; p: string };
}

/** A fixed shape drawn over the world with its own cells: the name. */
export interface Structure {
  x: number;
  y: number;
  w: number;
  h: number;
  cur: Uint8Array;
  hidden: Uint16Array;
  core: { x: number; y: number; w: number; h: number };
  hurt: boolean;
}
