// Game of Life patterns: the CV's beehive, the contact's gun, gliders and the methuselahs that seed the projects.
export type Pattern = number[][];

const P = (rows: string): Pattern =>
  rows
    .trim()
    .split('\n')
    .map((row) => [...row.trim()].map((cell) => (cell === 'O' ? 1 : 0)));

export const BEEHIVE = P(`
.OO.
O..O
.OO.`);

export const GUN = P(`
........................O...........
......................O.O...........
............OO......OO............OO
...........O...O....OO............OO
OO........O.....O...OO..............
OO........O...O.OO....O.O...........
..........O.....O.......O...........
...........O...O....................
............OO......................`);

/** Gliders by the diagonal they travel along: [dx, dy], y growing downwards. */
export const GLIDER_HEADINGS: { heading: readonly [number, number]; cells: Pattern }[] = [
  {
    heading: [1, 1],
    cells: P(`
.O.
..O
OOO`),
  },
  {
    heading: [-1, 1],
    cells: P(`
.O.
O..
OOO`),
  },
  {
    heading: [1, -1],
    cells: P(`
OOO
..O
.O.`),
  },
  {
    heading: [-1, -1],
    cells: P(`
OOO
O..
.O.`),
  },
];

export const GLIDERS: Pattern[] = GLIDER_HEADINGS.map((entry) => entry.cells);

/** Structures drawn on the board in their own private world. */
export const PATTERNS = {
  beehive: BEEHIVE,
  gun: GUN,
} as const;

export type PatternName = keyof typeof PATTERNS;

/** Small patterns that run for a long time before they settle (or vanish): one per project. */
export const R_PENTOMINO = P(`
.OO
OO.
.O.`);

export const ACORN = P(`
.O.....
...O...
OO..OOO`);

export const DIEHARD = P(`
......O.
OO......
.O...OOO`);

export const B_HEPTOMINO = P(`
O.OO
OOO.
.O..`);

export const PI_HEPTOMINO = P(`
OOO
O.O
O.O`);

export const METHUSELAH_PATTERNS = {
  'r-pentomino': R_PENTOMINO,
  acorn: ACORN,
  diehard: DIEHARD,
  'b-heptomino': B_HEPTOMINO,
  'pi-heptomino': PI_HEPTOMINO,
} as const;

export type MethuselahName = keyof typeof METHUSELAH_PATTERNS;

/** Deterministic order: a project without a seed of its own takes `METHUSELAHS[hash(slug) % length]`. */
export const METHUSELAHS: MethuselahName[] = ['r-pentomino', 'acorn', 'diehard', 'b-heptomino', 'pi-heptomino'];
