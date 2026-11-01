import { describe, it, expect } from 'vitest';
import { orientationOf, pinPosition, resolveLayout, smartLayout, SmartViewport, type LayoutData, type ViewportRect } from '../src/scenes/smart';

/** The classic SmartContainer's `updateContainer`, written out as a reference. */
function classic(data: LayoutData, view: ViewportRect): { scaleX: number; scaleY: number; x: number; y: number } {
  const portrait = view.height > view.width;
  const d = {
    align: 'center',
    valign: 'center',
    width: 0,
    height: 0,
    stretchWidth: false,
    stretchHeight: false,
    correctionScaleX: 1,
    correctionScaleY: 1,
    correctionOffsetX: 0,
    correctionOffsetY: 0,
    fitCover: false,
    viewportWidth: portrait ? 1080 : 1920,
    viewportHeight: portrait ? 1920 : 1080,
    ...data,
  };
  const m = d.fitCover ? Math.max : Math.min;
  let scaleX = m(view.width / 1920, view.height / 1080);
  let scaleY = scaleX;
  let { width, height } = d;
  if (d.viewportWidth || d.viewportHeight) scaleX = scaleY = m(view.width / (d.viewportWidth || 1920), view.height / (d.viewportHeight || 1080));
  if (d.stretchWidth) {
    scaleX = view.width / width;
    width = view.width / scaleX;
  }
  if (d.stretchHeight) {
    scaleY = view.height / height;
    height = view.height / scaleY;
  }
  scaleX *= d.correctionScaleX;
  scaleY *= d.correctionScaleY;
  const posX = d.align === 'right' ? view.width - width * scaleX : d.align === 'center' ? (view.width - width * scaleX) / 2 : 0;
  const posY = d.valign === 'bottom' ? view.height - height * scaleY : d.valign === 'center' ? (view.height - height * scaleY) / 2 : 0;
  return { scaleX, scaleY, x: view.x + posX + d.correctionOffsetX * scaleX, y: view.y + posY + d.correctionOffsetY * scaleY };
}

const at = (data: LayoutData, view: ViewportRect) => smartLayout(resolveLayout(data, orientationOf(view)), view);

describe('SmartContainer layout', () => {
  it('anchors a point at the centre of a phone, fitted from 1080×1920', () => {
    const t = at({}, { x: 0, y: 0, width: 390, height: 844 });
    expect(t.scaleX).toBeCloseTo(390 / 1080, 6);
    expect(t.x).toBeCloseTo(195, 6);
    expect(t.y).toBeCloseTo(422, 6);
  });

  it('fits a design canvas and centres the leftover', () => {
    const t = at({ viewportWidth: 1080, viewportHeight: 1830, width: 1080, height: 1830 }, { x: 0, y: 0, width: 390, height: 700 });
    const s = Math.min(390 / 1080, 700 / 1830);
    expect(t.scaleY).toBeCloseTo(s, 6);
    expect(t.x).toBeCloseTo((390 - 1080 * s) / 2, 6);
    expect(t.y).toBeCloseTo((700 - 1830 * s) / 2, 6);
  });

  it('puts a bottom anchor on the bottom edge, nudged in design units', () => {
    const t = at({ valign: 'bottom', correctionOffsetY: -100 }, { x: 0, y: 40, width: 1920, height: 1080 });
    expect(t.scaleY).toBe(1);
    expect(t.y).toBe(40 + 1080 - 100);
  });

  it('covers with fitCover and stretches one axis', () => {
    expect(at({ fitCover: true }, { x: 0, y: 0, width: 1000, height: 1000 }).scaleX).toBeCloseTo(1000 / 1080, 6);
    const s = at({ stretchWidth: true, width: 1920, height: 100, valign: 'top' }, { x: 0, y: 0, width: 1280, height: 800 });
    expect(s.scaleX).toBeCloseTo(1280 / 1920, 6);
    expect(s.x).toBe(0);
  });

  it('matches the classic SmartContainer on random layouts', () => {
    let seed = 7;
    const rnd = (): number => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)]!;
    for (let i = 0; i < 500; i++) {
      const data: LayoutData = {
        align: pick(['left', 'center', 'right'] as const),
        valign: pick(['top', 'center', 'bottom'] as const),
        width: pick([0, 400, 1080, 1920]),
        height: pick([0, 300, 1080, 1920]),
        ...(rnd() < 0.5 ? { viewportWidth: pick([0, 1080, 1920]), viewportHeight: pick([0, 1080, 1920]) } : {}),
        correctionScaleX: pick([1, 0.8, 1.2]),
        correctionScaleY: pick([1, 0.8, 1.2]),
        correctionOffsetX: pick([0, -50, 120]),
        correctionOffsetY: pick([0, -50, 120]),
        fitCover: rnd() < 0.2,
      };
      if (data.width && rnd() < 0.2) data.stretchWidth = true;
      if (data.height && rnd() < 0.2) data.stretchHeight = true;
      const view = { x: pick([0, 20]), y: pick([0, 30]), width: pick([390, 844, 1280, 1920]), height: pick([390, 700, 844, 1080]) };
      const a = at(data, view);
      const b = classic(data, view);
      for (const k of ['scaleX', 'scaleY', 'x', 'y'] as const) expect(a[k]).toBeCloseTo(b[k], 6);
    }
  });

  it('pins in the active design viewport, with per-orientation overrides', () => {
    const args = { valign: 'top' as const, offsetY: 170, scale: 1.3, landscape: { offsetY: 80, scale: 1 } };
    expect(pinPosition(args, 'portrait', { width: 1080, height: 1830 })).toEqual({ x: 540, y: 170, scale: 1.3 });
    expect(pinPosition(args, 'landscape', { width: 1920, height: 1000 })).toEqual({ x: 960, y: 80, scale: 1 });
    expect(pinPosition({ align: 'right', valign: 'bottom', offsetX: -10 }, 'landscape', { width: 1920, height: 1000 })).toEqual({ x: 1910, y: 1000 });
  });

  it('a square screen is landscape; a viewport only tells its containers when it moved', () => {
    expect(orientationOf({ width: 800, height: 800 })).toBe('landscape');
    let rect = { x: 0, y: 0, width: 400, height: 800 };
    const v = new SmartViewport(() => rect);
    let calls = 0;
    v.subscribe(() => calls++);
    v.refresh();
    expect(calls).toBe(0);
    rect = { ...rect, height: 700 };
    v.refresh();
    expect(calls).toBe(1);
    expect(v.height).toBe(700);
  });
});
