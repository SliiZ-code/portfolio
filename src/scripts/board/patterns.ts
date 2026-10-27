// Game of Life patterns. Everything here is a still life, an oscillator or the gun.
export type Pattern = number[][];

const P = (rows: string): Pattern =>
  rows
    .trim()
    .split('\n')
    .map((row) => [...row.trim()].map((cell) => (cell === 'O' ? 1 : 0)));

export const PULSAR = P(`
..OOO...OOO..
.............
O....O.O....O
O....O.O....O
O....O.O....O
..OOO...OOO..
.............
..OOO...OOO..
O....O.O....O
O....O.O....O
O....O.O....O
.............
..OOO...OOO..`);

export const PENTA = P(`
..O....O..
OO.OOOO.OO
..O....O..`);

export const BLINKERS = P(`
OOO...OOO...OOO`);

export const CLOCK = P(`
..O.
O.O.
.O.O
.O..`);

export const GALAXY = P(`
OO.OOOOOO
OO.OOOOOO
OO.......
OO.....OO
OO.....OO
OO.....OO
.......OO
OOOOOO.OO
OOOOOO.OO`);

export const BEACON = P(`
OO..
OO..
..OO
..OO`);

export const TOAD = P(`
.OOO
OOO.`);

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

export const PATTERNS = {
  pulsar: PULSAR,
  blinkers: BLINKERS,
  penta: PENTA,
  galaxy: GALAXY,
  clock: CLOCK,
  beacon: BEACON,
  toad: TOAD,
  beehive: BEEHIVE,
  gun: GUN,
} as const;

export type PatternName = keyof typeof PATTERNS;

/** Deterministic list used for projects that only exist in RxResume; beacon, toad and beehive belong to the lab, the story and the CV. */
export const OSCILLATORS: PatternName[] = ['clock', 'blinkers', 'penta', 'galaxy', 'pulsar'];
