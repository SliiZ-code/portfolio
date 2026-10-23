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
OOO...OOO...OOO...OOO`);

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

export const GLIDERS: Pattern[] = [
  P(`.O.\n..O\nOOO`),
  P(`.O.\nO..\nOOO`),
  P(`OOO\n..O\n.O.`),
  P(`OOO\nO..\n.O.`),
];

export const PATTERNS = {
  pulsar: PULSAR,
  blinkers: BLINKERS,
  penta: PENTA,
  galaxy: GALAXY,
  clock: CLOCK,
  beacon: BEACON,
  toad: TOAD,
} as const;

export type EmblemName = keyof typeof PATTERNS;

/** Deterministic list used for projects that only exist in RxResume; beacon and toad are reserved for the lab and story pages. */
export const OSCILLATORS: EmblemName[] = ['clock', 'blinkers', 'penta', 'galaxy', 'pulsar'];
