import { describe, expect, it } from 'vitest';
import { clampCam } from '../src/scripts/board/camera';

const WORLD = { w: 420, h: 280 };

describe('clampCam', () => {
  it('keeps the desktop board covering the viewport', () => {
    const cam = { x: 0, y: 140, z: 1 };
    clampCam(cam, { w: 1440, h: 900 }, WORLD);
    expect(cam.z).toBeCloseTo(1440 / 420);
    expect(cam.x).toBeCloseTo(210);
    expect(cam.y).toBeCloseTo(140);
  });

  it('allows the prototype mobile home zoom and centres the short axis', () => {
    const cam = { x: 210, y: 139, z: 2.335 };
    clampCam(cam, { w: 390, h: 844 }, WORLD);
    expect(cam.z).toBeCloseTo(2.335);
    expect(cam.x).toBeCloseTo(210);
    expect(cam.y).toBeCloseTo(140);
  });

  it('still keeps the camera inside the board on the axis that overflows', () => {
    const cam = { x: 0, y: 0, z: 8 };
    clampCam(cam, { w: 1440, h: 900 }, WORLD);
    expect(cam.x).toBeCloseTo(90);
    expect(cam.y).toBeCloseTo(56.25);
  });
});
