/** Text folded for a forgiving search: lower case, no accents, single spaces. "Expériences" matches "experi". */
export const foldForSearch = (text: string): string =>
  text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
