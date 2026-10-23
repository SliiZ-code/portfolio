import { describe, expect, it } from 'vitest';
import { createFromFlag, createReturnTracker, FROM_KEY, resolveFrom, type FlagStore } from '../src/scripts/board/return-flag';

const memoryStore = (): FlagStore & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
};

/** One board page load: read the flag like initBoard does, then hand back a tracker for this instance. */
const arrive = (store: FlagStore, navType: string, query: string | null = null) => {
  const flag = createFromFlag(() => store);
  const from = resolveFrom({ query, navType, stored: flag.get() });
  flag.clear();
  const tracker = createReturnTracker(flag);
  if (from) tracker.remember(from);
  return { from, tracker };
};

describe('resolveFrom', () => {
  it('prefers ?from= and ignores the stored flag on a normal visit or a reload', () => {
    expect(resolveFrom({ query: 'blink', navType: 'navigate', stored: 'thrive' })).toBe('blink');
    expect(resolveFrom({ query: null, navType: 'navigate', stored: 'thrive' })).toBeNull();
    expect(resolveFrom({ query: null, navType: 'reload', stored: 'thrive' })).toBeNull();
    expect(resolveFrom({ query: null, navType: 'back_forward', stored: 'thrive' })).toBe('thrive');
    expect(resolveFrom({ query: null, navType: 'back_forward', stored: null })).toBeNull();
  });
});

describe('return flag across Back / Forward / Back', () => {
  it('replays the reverse zoom on every Back to the board', () => {
    const store = memoryStore();

    // first visit: dive into blink, the board unloads
    const first = arrive(store, 'navigate');
    expect(first.from).toBeNull();
    first.tracker.remember('blink');
    first.tracker.pagehide();

    // Back: the flag is consumed
    const second = arrive(store, 'back_forward');
    expect(second.from).toBe('blink');
    expect(store.data.has(FROM_KEY)).toBe(false);

    // Forward to the project, then Back again
    second.tracker.pagehide();
    const third = arrive(store, 'back_forward');
    expect(third.from).toBe('blink');

    // and once more
    third.tracker.pagehide();
    expect(arrive(store, 'back_forward').from).toBe('blink');
  });

  it('a stale flag never hijacks a normal visit or a reload', () => {
    const store = memoryStore();
    const board = arrive(store, 'navigate');
    board.tracker.remember('thrive');
    board.tracker.pagehide();

    expect(arrive(store, 'reload').from).toBeNull();
    expect(store.data.has(FROM_KEY)).toBe(false);

    board.tracker.pagehide();
    expect(arrive(store, 'navigate').from).toBeNull();
    expect(store.data.has(FROM_KEY)).toBe(false);
  });

  it('does not set the flag when the user left by another link', () => {
    const store = memoryStore();
    const board = arrive(store, 'back_forward', 'blink');
    board.tracker.forget();
    board.tracker.pagehide();
    expect(store.data.has(FROM_KEY)).toBe(false);
    expect(arrive(store, 'back_forward').from).toBeNull();
  });

  it('does not set the flag for a board that never dived', () => {
    const store = memoryStore();
    arrive(store, 'navigate').tracker.pagehide();
    expect(store.data.has(FROM_KEY)).toBe(false);
  });

  it('survives a storage that throws (private mode)', () => {
    const broken: FlagStore = {
      getItem: () => {
        throw new Error('denied');
      },
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    const board = arrive(broken, 'back_forward');
    expect(board.from).toBeNull();
    board.tracker.remember('blink');
    expect(() => board.tracker.pagehide()).not.toThrow();
  });

  it('survives a missing storage', () => {
    const flag = createFromFlag(() => {
      throw new Error('no storage');
    });
    expect(flag.get()).toBeNull();
    expect(() => flag.set('x')).not.toThrow();
    expect(() => flag.clear()).not.toThrow();
  });
});
