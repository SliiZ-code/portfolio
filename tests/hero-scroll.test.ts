import { describe, expect, it } from 'vitest';
import { isScrolled, needsLayout } from '../src/scripts/board';

describe('isScrolled', () => {
  it('counts the hero as scrolling away only past 40 pixels', () => {
    expect(isScrolled(0)).toBe(false);
    expect(isScrolled(40)).toBe(false);
    expect(isScrolled(41)).toBe(true);
  });
});

describe('needsLayout', () => {
  const laid = { w: 390, h: 844 };

  it('keeps the layout when nothing changed', () => {
    expect(needsLayout(laid, { w: 390, h: 844 })).toBe(false);
  });

  it('keeps the layout when a phone toolbar slides in or out', () => {
    expect(needsLayout(laid, { w: 390, h: 760 })).toBe(false);
    expect(needsLayout(laid, { w: 390, h: 940 })).toBe(false);
  });

  it('lays out again for a width change or a height change beyond the toolbar', () => {
    expect(needsLayout(laid, { w: 844, h: 390 })).toBe(true);
    expect(needsLayout(laid, { w: 389, h: 844 })).toBe(true);
    expect(needsLayout(laid, { w: 390, h: 700 })).toBe(true);
  });
});
