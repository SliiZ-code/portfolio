import type { Cam, Entity, Viewport } from './types';

export interface InputDeps {
  canvas: HTMLCanvasElement;
  cam: Cam;
  camT: Cam;
  viewport: () => Viewport;
  clamp: (cam: Cam) => void;
  toWorld: (sx: number, sy: number) => [number, number];
  entityAt: (wx: number, wy: number) => Entity | null;
  insideEntity: (wx: number, wy: number) => boolean;
  paint: (wx: number, wy: number) => void;
  dropGlider: (x: number, y: number) => void;
  activate: (entity: Entity) => void;
  setHover: (entity: Entity | null) => void;
}

interface Pointer {
  x: number;
  y: number;
}

interface Drag {
  x: number;
  y: number;
  cx: number;
  cy: number;
  moved: boolean;
}

export function bindInput(deps: InputDeps): void {
  const { canvas, cam, camT } = deps;
  const pointers = new Map<number, Pointer>();
  let drag: Drag | null = null;
  let pinch: { d: number; z: number } | null = null;
  let drawMode = false;

  const pen = document.querySelector<HTMLButtonElement>('#pen');
  if (pen) {
    pen.addEventListener('click', () => {
      drawMode = !drawMode;
      pen.classList.toggle('on', drawMode);
      canvas.classList.toggle('draw', drawMode);
    });
  }

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), z: camT.z };
      drag = null;
      return;
    }
    drag = { x: event.clientX, y: event.clientY, cx: camT.x, cy: camT.y, moved: false };
    if (drawMode) {
      const [wx, wy] = deps.toWorld(event.clientX, event.clientY);
      deps.paint(wx, wy);
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    if (pointers.has(event.pointerId)) pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (pinch && pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      camT.z = pinch.z * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d;
      deps.clamp(camT);
      return;
    }
    if (drag) {
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      if (Math.hypot(dx, dy) > 5) drag.moved = true;
      if (drawMode) {
        const [wx, wy] = deps.toWorld(event.clientX, event.clientY);
        deps.paint(wx, wy);
        return;
      }
      if (drag.moved) {
        canvas.classList.add('panning');
        camT.x = drag.cx - dx / cam.z;
        camT.y = drag.cy - dy / cam.z;
        deps.clamp(camT);
        cam.x = camT.x;
        cam.y = camT.y;
      }
      return;
    }
    const [wx, wy] = deps.toWorld(event.clientX, event.clientY);
    const hover = deps.entityAt(wx, wy);
    deps.setHover(hover);
    canvas.classList.toggle('over', Boolean(hover) && hover!.id !== 'name' && !drawMode);
  });

  const end = (event: PointerEvent) => {
    pointers.delete(event.pointerId);
    if (pointers.size < 2) pinch = null;
    if (!drag) return;
    canvas.classList.remove('panning');
    if (!drag.moved && !drawMode) {
      const [wx, wy] = deps.toWorld(event.clientX, event.clientY);
      const hit = deps.entityAt(wx, wy);
      if (hit && hit.id !== 'name') deps.activate(hit);
      else if (!hit && !deps.insideEntity(wx, wy)) deps.dropGlider(Math.floor(wx), Math.floor(wy));
    }
    drag = null;
  };

  canvas.addEventListener('pointerup', end);
  canvas.addEventListener('pointercancel', end);

  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    const [wx, wy] = deps.toWorld(event.clientX, event.clientY);
    camT.z *= Math.exp(-event.deltaY * 0.0015);
    deps.clamp(camT);
    // keep the cell under the cursor fixed
    camT.x = wx - (event.clientX - deps.viewport().w / 2) / camT.z;
    camT.y = wy - (event.clientY - deps.viewport().h / 2) / camT.z;
    deps.clamp(camT);
  }, { passive: false });
}
