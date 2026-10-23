import type { Cam, Viewport } from './types';

export interface WorldSize {
  w: number;
  h: number;
}

export const toScreen = (cam: Cam, viewport: Viewport, x: number, y: number): [number, number] => [
  (x - cam.x) * cam.z + viewport.w / 2,
  (y - cam.y) * cam.z + viewport.h / 2,
];

export const toWorld = (cam: Cam, viewport: Viewport, sx: number, sy: number): [number, number] => [
  (sx - viewport.w / 2) / cam.z + cam.x,
  (sy - viewport.h / 2) / cam.z + cam.y,
];

/**
 * Never pan off the board. On a portrait screen the board is wider than it is
 * tall, so covering the viewport height would crop the home name: there we let
 * the board fit its width and centre the axis that is shorter than the screen,
 * like the prototype does on mobile.
 */
export const clampCam = (cam: Cam, viewport: Viewport, world: WorldSize): void => {
  const portrait = viewport.h > viewport.w;
  const cover = portrait
    ? Math.min(viewport.w / world.w, viewport.h / world.h)
    : Math.max(viewport.w / world.w, viewport.h / world.h);
  cam.z = Math.max(cover, Math.min(40, cam.z));
  const hw = viewport.w / 2 / cam.z;
  const hh = viewport.h / 2 / cam.z;
  cam.x = hw * 2 >= world.w ? world.w / 2 : Math.max(hw, Math.min(world.w - hw, cam.x));
  cam.y = hh * 2 >= world.h ? world.h / 2 : Math.max(hh, Math.min(world.h - hh, cam.y));
};

export const flyTo = (camT: Cam, x: number, y: number, z: number, viewport: Viewport, world: WorldSize): void => {
  camT.x = x;
  camT.y = y;
  camT.z = z;
  clampCam(camT, viewport, world);
};
