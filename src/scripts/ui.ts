const KEY = 'jpc-theme';

export const isNight = (): boolean => document.documentElement.dataset.theme === 'night';

/** The toggle shows the theme you switch to; its labels follow the page's language too (see language-switch.ts). */
const labelToggles = (night: boolean) => {
  document.querySelectorAll<HTMLElement>('[data-theme-toggle]').forEach((button) => {
    const label = night ? button.dataset.labelPaper : button.dataset.labelNight;
    if (label) {
      button.title = label;
      button.setAttribute('aria-label', label);
    }
  });
};

/** After a language switch the toggles carry the new language's labels, for the theme the page is in. */
export const syncThemeLabels = () => labelToggles(isNight());

const apply = (night: boolean, persist: boolean) => {
  document.documentElement.dataset.theme = night ? 'night' : 'paper';
  labelToggles(night);
  if (persist) {
    try {
      localStorage.setItem(KEY, night ? 'night' : 'paper');
    } catch {
      // private mode: the theme still applies for this page
    }
  }
  document.dispatchEvent(new CustomEvent('themechange'));
};

export const initUI = () => {
  apply(isNight(), false);

  document.querySelectorAll<HTMLElement>('[data-theme-toggle]').forEach((button) => {
    button.addEventListener('click', () => apply(!isNight(), true));
  });

  document.querySelectorAll<HTMLElement>('[data-print]').forEach((button) => {
    button.addEventListener('click', () => window.print());
  });
};
