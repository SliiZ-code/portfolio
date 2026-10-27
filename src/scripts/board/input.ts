export type Cell = [number, number];

/** Every cell on the line between two pointer positions, so a fast stroke stays continuous. */
export function strokeCells(from: Cell, to: Cell): Cell[] {
  const n = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]));
  if (n === 0) return [[from[0], from[1]]];
  const cells: Cell[] = [];
  for (let t = 0; t <= n; t++) {
    cells.push([Math.round(from[0] + ((to[0] - from[0]) * t) / n), Math.round(from[1] + ((to[1] - from[1]) * t) / n)]);
  }
  return cells;
}

export const isTap = (x0: number, y0: number, x: number, y: number): boolean => Math.hypot(x - x0, y - y0) <= 4;

interface InputOptions {
  canvas: HTMLCanvasElement;
  cell: () => number;
  /** Draws one cell; the board decides which cells are off limits. */
  paint: (x: number, y: number) => void;
  /** A tap on empty space. */
  glider: (x: number, y: number) => void;
  /** After a stroke or a dropped glider: the board steps once when motion is reduced. */
  onChange?: () => void;
}

/** Drag to draw, tap to drop a glider. One pointer at a time, so a second finger cannot join a stroke. */
export function bindInput({ canvas, cell, paint, glider, onChange }: InputOptions): void {
  let drag: { id: number; x0: number; y0: number; at: Cell; moved: boolean } | null = null;
  const cellAt = (event: PointerEvent): Cell => [Math.floor(event.clientX / cell()), Math.floor(event.clientY / cell())];

  canvas.addEventListener('pointerdown', (event) => {
    // a stroke already in progress, a second finger and a right/ctrl click must not start or restart one
    if (drag || (event.pointerType === 'mouse' && (event.button !== 0 || event.ctrlKey))) return;
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      // the pointer is already gone: the stroke still works, it just stops at the edge
    }
    drag = { id: event.pointerId, x0: event.clientX, y0: event.clientY, at: cellAt(event), moved: false };
  });
  canvas.addEventListener('pointermove', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!isTap(drag.x0, drag.y0, event.clientX, event.clientY)) drag.moved = true;
    if (!drag.moved) return;
    const to = cellAt(event);
    for (const [x, y] of strokeCells(drag.at, to)) paint(x, y);
    drag.at = to;
  });
  canvas.addEventListener('pointerup', (event) => {
    if (!drag || event.pointerId !== drag.id) return;
    if (!drag.moved) glider(drag.at[0], drag.at[1]);
    drag = null;
    onChange?.();
  });
  canvas.addEventListener('pointercancel', (event) => {
    if (drag && event.pointerId === drag.id) drag = null;
  });
  // capture lost without a pointerup (a context menu, an alert): never leave a stroke stuck open
  canvas.addEventListener('lostpointercapture', (event) => {
    if (drag && event.pointerId === drag.id) drag = null;
  });
}
