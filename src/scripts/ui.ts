const KEY = 'jpc-theme';

export const isNight = (): boolean => document.documentElement.dataset.theme === 'night';

const apply = (night: boolean, persist: boolean) => {
  document.documentElement.dataset.theme = night ? 'night' : 'paper';
  document.querySelectorAll<HTMLElement>('[data-theme-toggle]').forEach((button) => {
    // the button shows the theme you switch to
    const label = night ? button.dataset.labelPaper : button.dataset.labelNight;
    if (label) {
      button.title = label;
      button.setAttribute('aria-label', label);
    }
  });
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
