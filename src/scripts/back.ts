import { createFromFlag } from './board/return-flag';

/**
 * "Back to the board" on a page reached by a dive: when the board is the previous history entry,
 * go back to it (flagging the zoom-out) instead of pushing a new entry.
 */
export function initBackLink(): void {
  const back = document.querySelector<HTMLAnchorElement>('[data-back-board]');
  const flag = createFromFlag(() => sessionStorage);
  back?.addEventListener('click', (event) => {
    if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!document.referrer) return;
    try {
      const referrer = new URL(document.referrer);
      if (referrer.origin !== location.origin || referrer.pathname !== back.dataset.backBoard) return;
      // a project opened in a new tab has the board as referrer but nothing to go back to:
      // go to the board plainly rather than replay a zoom-out of a project the user never dived into
      if (history.length <= 1) {
        event.preventDefault();
        location.assign(back.dataset.backBoard || back.href);
        return;
      }
      event.preventDefault();
      flag.set(back.dataset.slug ?? '');
      // if the history entry is not there after all, follow the link rather than do nothing
      const fallback = setTimeout(() => {
        flag.clear();
        location.assign(back.dataset.backBoard || back.href);
      }, 400);
      addEventListener('pagehide', () => clearTimeout(fallback), { once: true });
      history.back();
    } catch {
      // malformed referrer: follow the link
    }
  });
}
