// The command palette's behaviour (its markup is CommandPalette.astro): ⌘K, Ctrl+K or "/" opens it, the list filters as
// you type, Enter or a click runs the item. Its listeners live on one AbortController, so a second init after a
// language switch (language-switch.ts) replaces the first instead of stacking a second palette on the same keys.
import { foldForSearch } from './palette';

let session: AbortController | null = null;

export function initCommandPalette(): void {
  session?.abort();
  session = new AbortController();
  const { signal } = session;

  const dialog = document.querySelector<HTMLDialogElement>('dialog.cmdk');
  const input = dialog?.querySelector<HTMLInputElement>('.cmdk-input');
  if (!dialog || !input || typeof dialog.showModal !== 'function') return;

  const items = [...dialog.querySelectorAll<HTMLElement>('.cmdk-item')];
  const groups = [...dialog.querySelectorAll<HTMLElement>('.cmdk-group')];
  const empty = dialog.querySelector<HTMLElement>('.cmdk-empty')!;
  const status = dialog.querySelector<HTMLElement>('[data-cmdk-status]');
  const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  let closeTimer = 0;
  const keys = new Map(items.map((item) => [item, foldForSearch(item.textContent ?? '')]));
  let visible = items;
  let at = 0;

  // the keyboard scrolls the list to the selection; the pointer is already on it, and scrolling under it would
  // fire a new pointermove and walk the selection down the list
  const select = (index: number, scroll = true) => {
    if (!visible.length) return;
    at = (index + visible.length) % visible.length;
    visible.forEach((item, i) => item.setAttribute('aria-selected', String(i === at)));
    const current = visible[at]!;
    input.setAttribute('aria-activedescendant', current.id);
    if (scroll) current.scrollIntoView({ block: 'nearest' });
  };
  const filter = () => {
    const words = foldForSearch(input.value).split(/\s+/).filter(Boolean);
    items.forEach((item) => {
      const key = keys.get(item) ?? '';
      item.hidden = !words.every((word) => key.includes(word));
      item.setAttribute('aria-selected', 'false');
    });
    groups.forEach((group) => {
      group.hidden = !group.querySelector('.cmdk-item:not([hidden])');
    });
    visible = items.filter((item) => !item.hidden);
    empty.hidden = visible.length > 0;
    if (status) status.textContent = visible.length ? '' : empty.textContent ?? '';
    if (!visible.length) input.removeAttribute('aria-activedescendant');
    select(0);
  };
  const open = () => {
    if (dialog.open) return;
    clearTimeout(closeTimer);
    input.value = '';
    filter();
    dialog.showModal();
    // the page behind the modal stays put
    document.documentElement.classList.add('cmdk-lock');
    input.focus();
  };
  const toast = (text: string) => {
    input.value = '';
    input.placeholder = text;
    if (status) status.textContent = text;
    clearTimeout(closeTimer);
    closeTimer = window.setTimeout(() => dialog.close(), 700);
  };
  const placeholder = input.placeholder;
  dialog.addEventListener(
    'close',
    () => {
      // a timer left from "copied" must not close the palette once it is reopened
      clearTimeout(closeTimer);
      input.placeholder = placeholder;
      if (status) status.textContent = '';
      document.documentElement.classList.remove('cmdk-lock');
    },
    { signal },
  );
  const run = async (item: HTMLElement) => {
    const { href, action } = item.dataset;
    if (action === 'copy-email') {
      try {
        await navigator.clipboard.writeText(dialog.dataset.email ?? '');
        toast(dialog.dataset.copied ?? '');
      } catch {
        dialog.close();
        location.href = `mailto:${dialog.dataset.email}`;
      }
      return;
    }
    dialog.close();
    if (action === 'theme') document.querySelector<HTMLElement>('[data-theme-toggle]')?.click();
    else if (action === 'top') scrollTo({ top: 0, behavior: reduced() ? 'instant' : 'smooth' });
    else if (href?.startsWith('#')) document.querySelector(href)?.scrollIntoView({ behavior: reduced() ? 'instant' : 'smooth' });
    else if (href && item.dataset.external !== undefined) window.open(href, '_blank', 'noopener');
    else if (href && item.dataset.lang !== undefined) {
      // the language is the flag's job: the same link, so the page morphs there (language-switch.ts)
      const flag = document.querySelector<HTMLAnchorElement>(`a[data-lang-switch][href="${href}"]`);
      if (flag) flag.click();
      else location.href = href;
    } else if (href) location.href = href;
  };

  input.addEventListener('input', filter, { signal });
  input.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'ArrowDown') select(at + 1);
      else if (event.key === 'ArrowUp') select(at - 1);
      // an input method confirming a word also sends Enter: that one is not a choice
      else if (event.key === 'Enter' && !event.isComposing && visible[at]) run(visible[at]!);
      else return;
      event.preventDefault();
    },
    { signal },
  );
  dialog.addEventListener(
    'pointermove',
    (event) => {
      const item = (event.target as Element).closest<HTMLElement>('.cmdk-item');
      const index = item ? visible.indexOf(item) : -1;
      if (index >= 0 && index !== at) select(index, false);
    },
    { signal },
  );
  dialog.addEventListener(
    'click',
    (event) => {
      // a click on the backdrop lands on the dialog itself
      if (event.target === dialog) return dialog.close();
      const item = (event.target as Element).closest<HTMLElement>('.cmdk-item');
      if (item) run(item);
    },
    { signal },
  );
  document.addEventListener(
    'keydown',
    (event) => {
      const typing = (event.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])');
      if ((event.key === 'k' || event.key === 'K') && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        if (dialog.open) dialog.close();
        else open();
      } else if (event.key === '/' && !typing && !dialog.open && !event.metaKey && !event.ctrlKey && !event.altKey) {
        event.preventDefault();
        open();
      }
    },
    { signal },
  );

  // the key cap says what this keyboard uses
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const mac = /Mac|iPhone|iPad/i.test(nav.userAgentData?.platform || navigator.userAgent);
  document.querySelectorAll<HTMLElement>('[data-cmdk-open]').forEach((el) => {
    el.hidden = false;
    if (el.tagName !== 'BUTTON') return;
    el.setAttribute('aria-haspopup', 'dialog');
    el.addEventListener('click', open, { signal });
    const key = el.querySelector('.cmdk-key');
    if (key && !mac) key.textContent = 'Ctrl K';
  });
}
