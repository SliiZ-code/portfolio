/**
 * The name as drawn on the board: first name on its own line, and on a phone (`p`) the
 * surname also breaks after its hyphen. A run of hyphens ("Petit--Colboc") breaks once.
 */
export const boardName = (name: string): { l: string; p: string } => {
  const [first, ...rest] = name.split(' ');
  const l = rest.length ? `${first}\n${rest.join(' ')}` : first;
  return { l, p: l.replace(/(?<=\S)-+(?=[^\s-])/g, '$&\n') };
};
