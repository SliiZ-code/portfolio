export const FROM_KEY = 'jpc-from';

export interface FlagStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** The sessionStorage flag, silent when storage is unavailable (private mode). */
export const createFromFlag = (getStore: () => FlagStore) => ({
  get: (): string | null => {
    try {
      return getStore().getItem(FROM_KEY);
    } catch {
      return null;
    }
  },
  set: (value: string): void => {
    try {
      getStore().setItem(FROM_KEY, value);
    } catch {
      // private mode: Back just lands on the normal board view
    }
  },
  clear: (): void => {
    try {
      getStore().removeItem(FROM_KEY);
    } catch {
      // ignore
    }
  },
});

export type FromFlag = ReturnType<typeof createFromFlag>;

/**
 * Which project the board should zoom back out of. `?from=` comes from the back link; a history
 * Back (reload without bfcache) only has the stored flag. Anything else, a normal visit or a
 * reload, must ignore a flag left behind.
 */
export const resolveFrom = (arrival: { query: string | null; navType: string | undefined; stored: string | null }): string | null =>
  arrival.query ?? (arrival.navType === 'back_forward' ? arrival.stored : null);

/**
 * The flag is consumed on arrival, so Back → Forward → Back would find it gone. The board
 * remembers the project it dived into (or just zoomed back out of) and puts the flag back when
 * the page is hidden, unless the user left through some other link.
 */
export const createReturnTracker = (flag: FromFlag) => {
  let slug: string | null = null;
  return {
    remember(value: string): void {
      slug = value;
    },
    forget(): void {
      slug = null;
    },
    pagehide(): void {
      if (slug) flag.set(slug);
    },
  };
};
