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
      if (referrer.origin === location.origin && referrer.pathname === back.dataset.backBoard) {
        event.preventDefault();
        flag.set(back.dataset.slug ?? '');
        history.back();
      }
    } catch {
      // malformed referrer: follow the link
    }
  });
}
