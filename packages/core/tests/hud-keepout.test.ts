// The HUD's controls over the play area, and the helpers a game keeps its pieces clear of them with.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { measureHudKeepOut, inCanvasUnits, clearOfHud, shrinkClearOf, slideClearOf, pinClearOfHud, pinPosition, rectsKey, hudPlayArea } from '../src/scenes';

type Box = { left: number; top: number; width: number; height: number };
const box = (left: number, top: number, width: number, height: number) => ({
  left, top, width, height, right: left + width, bottom: top + height,
});

/** A screen with the HUD's bar and some controls: id → its bounding box (and laid-out size). */
function stubHud(w: number, h: number, bar: Box, controls: Record<string, Box & { offsetWidth?: number; offsetHeight?: number }>): void {
  vi.stubGlobal('window', Object.assign(new EventTarget(), { innerWidth: w, innerHeight: h }));
  const el = (b: Box & { offsetWidth?: number; offsetHeight?: number }) => ({
    getBoundingClientRect: () => box(b.left, b.top, b.width, b.height),
    offsetWidth: b.offsetWidth ?? b.width,
    offsetHeight: b.offsetHeight ?? b.height,
  });
  vi.stubGlobal('document', {
    querySelector: () => el(bar),
    querySelectorAll: (sel: string) => {
      const id = /#open-slot-ui #(\w+)/.exec(sel)?.[1];
      return id && controls[id] ? [el(controls[id]!)] : [];
    },
  });
}
const host = (w: number, h: number) => ({ getBoundingClientRect: () => box(0, 0, w, h) }) as unknown as Element;

afterEach(() => vi.unstubAllGlobals());

describe('the HUD controls over the play area', () => {
  it('lists the controls that reach into the area, grown by the margin; the bar under it lists none', () => {
    // A phone held sideways, 640x220: the 40px strip, the SPIN column at the right, the coin at the left.
    stubHud(640, 220, box(0, 180, 640, 40), {
      PlaceBetBtn: box(525, 42, 107, 107),
      AutoplayBtn: box(473, 73, 44, 44),
      MainMenuToggle: box(8, 128, 44, 44),
      // the coin stands at -45°: its bounding box is wider than the disc
      FeatureBuyToggle: { ...box(-2.8, 57.2, 73.5, 73.5), offsetWidth: 52, offsetHeight: 52 },
    });
    const keep = measureHudKeepOut(host(640, 220));
    expect(keep).toContainEqual({ x: 517, y: 34, width: 123, height: 123 });
    const coin = keep.find((r) => r.x < 1 && r.y > 50 && r.y < 70)!;
    expect([coin.x, coin.y, coin.width, coin.height].map((v) => Math.round(v) + 0)).toEqual([0, 60, 68, 68]);
    // ☰ starts above the area's bottom (220 - 40 - 36 = 144) by its margin
    expect(keep).toContainEqual({ x: 0, y: 120, width: 60, height: 60 });
    expect(measureHudKeepOut(host(640, 220), { margin: 0 })).toContainEqual({ x: 8, y: 128, width: 44, height: 44 });
    // An upright phone: SPIN sits in the bar, under the area (844 - 144 - 36 = 664).
    stubHud(390, 844, box(0, 700, 390, 144), { PlaceBetBtn: box(141.5, 694.5, 107, 107) });
    expect(measureHudKeepOut(host(390, 844))).toEqual([]);
  });

  it('turns screen boxes into a canvas’s design units, past its edges beside it', () => {
    // A 1920x1000 canvas in a 640x144 area: fit 0.144, the canvas 276.48px wide, centred.
    const [r] = inCanvasUnits([{ x: 0, y: 72, width: 68, height: 72 }], { x: 0, y: 0, width: 640, height: 144 }, [1920, 1000]);
    expect(r!.x).toBeCloseTo(-(640 - 276.48) / 2 / 0.144);
    expect(r!.y).toBeCloseTo(500);
    expect(r!.width).toBeCloseTo(68 / 0.144);
    expect(inCanvasUnits([{ x: 0, y: 0, width: 1, height: 1 }], { x: 0, y: 0, width: 0, height: 0 }, [1920, 1000])).toEqual([]);
    expect(rectsKey([{ x: 1.4, y: 2.6, width: 3, height: 4 }, { x: 0, y: 0, width: 1, height: 1 }])).toBe('1,3,3,4;0,0,1,1');
  });
});

describe('keeping a piece clear of the HUD', () => {
  const room = { x: 0, y: 0, width: 1000, height: 600 };

  it('leaves a piece that overlaps nothing exactly where it was', () => {
    expect(clearOfHud({ x: 10, y: 10, width: 100, height: 50 }, [{ x: 200, y: 200, width: 50, height: 50 }], room)).toEqual({ x: 60, y: 35, scale: 1 });
  });

  it('leaves a piece that only comes into the margin, and clears the whole margin once it moves', () => {
    const coin = { x: 0, y: 280, width: 70, height: 70 }; // a 54-unit control with its 8-unit margin
    const near = { x: 10, y: 190, width: 200, height: 96 }; // 6 units into the margin
    expect(clearOfHud(near, [coin], room, { ways: ['up'], slack: 11 })).toEqual({ x: 110, y: 238, scale: 1 });
    const on = { x: 10, y: 200, width: 200, height: 100 }; // 20 units in: on the control
    expect(clearOfHud(on, [coin], room, { ways: ['up'], slack: 11 })).toEqual({ x: 110, y: 230, scale: 1 });
    const board = { x: 100, y: 50, width: 800, height: 400 };
    expect(shrinkClearOf(board, [{ x: 895, y: 100, width: 150, height: 300 }], 500, 250, 11)).toBe(1);
    expect(shrinkClearOf(board, [{ x: 880, y: 100, width: 150, height: 300 }], 500, 250, 11)).toBeCloseTo(380 / 400);
  });

  it('moves it the shortest way out: a logo over the coin goes up', () => {
    const logo = { x: 10, y: 200, width: 200, height: 100 };
    const coin = { x: 0, y: 280, width: 70, height: 70 };
    expect(clearOfHud(logo, [coin], room, { ways: ['up', 'right'] })).toEqual({ x: 110, y: 230, scale: 1 });
  });

  it('keeps to the room and the allowed ways, and shrinks when no move clears it', () => {
    // pinned under the room's top: up is out, right runs into the board
    const logo = { x: 10, y: 0, width: 200, height: 100 };
    const coin = { x: 0, y: 80, width: 70, height: 70 };
    const board = { x: 230, y: 0, width: 500, height: 600 };
    const r = clearOfHud(logo, [coin, board], room, { ways: ['up', 'right'] });
    expect(r.scale).toBeLessThan(1);
    const w = 200 * r.scale;
    const h = 100 * r.scale;
    const placed = { x: r.x - w / 2, y: r.y - h / 2, width: w, height: h };
    expect(placed.y).toBeGreaterThanOrEqual(-1e-6);
    expect(placed.y + placed.height <= coin.y || placed.x >= coin.x + coin.width).toBe(true);
    expect(placed.x + placed.width).toBeLessThanOrEqual(board.x + 1e-6);
  });

  it('never moves onto a box it must avoid, though that box alone does not move it', () => {
    const logo = { x: 10, y: 200, width: 200, height: 100 };
    const board = { x: 205, y: 0, width: 600, height: 600 };
    // lapping the board's edge by 5 units, clear of the HUD: it stays
    expect(clearOfHud(logo, [], room, { avoid: [board] })).toEqual({ x: 110, y: 250, scale: 1 });
    // under the coin, the board to its right and little room above: not onto the board, but smaller
    const coin = { x: 0, y: 280, width: 70, height: 70 };
    const r = clearOfHud({ x: 10, y: 200, width: 150, height: 100 }, [coin], { x: 0, y: 190, width: 1000, height: 410 }, { ways: ['up', 'right'], avoid: [board] });
    expect(r).toEqual({ x: 85, y: 235, scale: 0.9 });
  });

  it('gives up at the smallest scale, in place, when nothing clears it', () => {
    const r = clearOfHud({ x: 0, y: 0, width: 100, height: 100 }, [{ x: -10, y: -10, width: 120, height: 120 }], room, { ways: ['up', 'left'], minScale: 0.8 });
    expect(r).toEqual({ x: 50, y: 50, scale: 0.8 });
  });

  it('shrinks a centred board just enough for the SPIN lane beside it', () => {
    const board = { x: 100, y: 50, width: 800, height: 400 };
    const lane = { x: 850, y: 100, width: 150, height: 300 };
    const k = shrinkClearOf(board, [lane], 500, 250);
    expect(k).toBeCloseTo(350 / 400);
    expect(shrinkClearOf(board, [{ x: 950, y: 0, width: 10, height: 10 }])).toBe(1);
  });
});

describe('sliding a squeezed board into the free middle', () => {
  // A board pinned by its top edge (it scales about the middle of that edge), the SPIN lane at the right.
  const board = { x: 100, y: 50, width: 800, height: 400 };
  const top = { anchorX: 500, anchorY: 50 };
  const lane = { x: 850, y: 100, width: 150, height: 300 };
  const wide = { x: 0, width: 1000 };

  it('leaves a board that overlaps nothing, or only comes into a margin, where it is', () => {
    expect(slideClearOf(board, [{ x: 950, y: 0, width: 10, height: 10 }], wide, top)).toEqual({ dx: 0, scale: 1 });
    expect(slideClearOf(board, [{ ...lane, x: 895 }], wide, { ...top, slack: 11 })).toEqual({ dx: 0, scale: 1 });
    // 20 units in: it moves, and clears the whole margin
    expect(slideClearOf(board, [{ ...lane, x: 880 }], wide, { ...top, slack: 11 })).toEqual({ dx: -20, scale: 1 });
  });

  it('keeps its size and moves across by the least that clears the lane', () => {
    expect(slideClearOf(board, [lane], wide, top)).toEqual({ dx: -50, scale: 1 });
  });

  it('fills the span between the coin at the left and the lane when it is wider than that', () => {
    const coin = { x: 0, y: 300, width: 120, height: 120 };
    const r = slideClearOf(board, [coin, lane], wide, top);
    expect(r.scale).toBeCloseTo(730 / 800);
    // 730 wide from the coin's edge: its left edge, scaled about the anchor, was at 135
    expect(r.dx).toBeCloseTo(-15);
  });

  it('shrinks only as far as a shorter band that passes over a control below', () => {
    // Beside the coin there is no room (550 units); 350 units down its band no longer reaches it.
    const coin = { x: 0, y: 400, width: 300, height: 120 };
    const r = slideClearOf(board, [coin, lane], wide, top);
    expect(r.scale).toBeCloseTo(0.875);
    expect(r.dx).toBeCloseTo(0);
  });

  it('stays inside its room', () => {
    const r = slideClearOf(board, [lane], { x: 80, width: 900 }, top);
    expect(r.scale).toBeCloseTo(770 / 800);
    expect(r.dx).toBeCloseTo(80 - 115);
  });

  it('takes the nearer side of a control in the middle', () => {
    const box = { x: 300, y: 0, width: 400, height: 100 };
    expect(slideClearOf(box, [{ x: 450, y: 0, width: 50, height: 100 }], wide)).toEqual({ dx: 200, scale: 1 });
    expect(slideClearOf(box, [{ x: 500, y: 0, width: 50, height: 100 }], wide)).toEqual({ dx: -200, scale: 1 });
  });

  it('shrinks in place, as shrinkClearOf does, when a control spans the whole room', () => {
    const box = { x: 0, y: 0, width: 100, height: 100 };
    const over = [{ x: -10, y: 40, width: 120, height: 20 }];
    expect(slideClearOf(box, over, { x: 0, width: 100 })).toEqual({ dx: 0, scale: shrinkClearOf(box, over) });
  });
});

describe('a pin kept clear of the HUD', () => {
  const design = [1920, 1000] as const;
  const room = { x: 0, y: 0, width: 1920, height: 1000 };
  const coin = { x: 0, y: 420, width: 180, height: 120 };
  /** The piece's box where a pin puts it (bounds at the pin's scale). */
  const placed = (pin: Parameters<typeof pinClearOfHud>[0], b: { x: number; y: number; width: number; height: number }) => {
    const at = pinPosition(pin, 'landscape', { width: design[0], height: design[1] });
    const k = at.scale ?? 1;
    return { x: at.x + b.x * k, y: at.y + b.y * k, width: b.width * k, height: b.height * k };
  };

  it('is the same pin where the piece overlaps nothing', () => {
    const pin = { align: 'left' as const, valign: 'top' as const, landscape: { offsetX: 200, offsetY: 200, scale: 0.5 } };
    expect(pinClearOfHud(pin, { x: -150, y: -100, width: 300, height: 200 }, [coin], room, design)).toBe(pin);
  });

  it('moves the pin the way clearOfHud moves the piece, and leaves the other orientation alone', () => {
    const pin = { align: 'left' as const, valign: 'top' as const, portrait: { offsetY: 99 }, landscape: { offsetX: 200, offsetY: 400, scale: 0.5 } };
    const centred = { x: -150, y: -100, width: 300, height: 200 };
    const out = pinClearOfHud(pin, centred, [coin], room, design, 'landscape', { ways: ['up', 'right'] });
    expect(out).toEqual({ ...pin, landscape: { offsetX: 200, offsetY: 370, scale: 0.5 } });
    expect(out.portrait).toBe(pin.portrait);
    // A piece drawn from its top-left corner keeps that corner on the pin point.
    const corner = { x: 0, y: 0, width: 300, height: 200 };
    const low = { ...pin, landscape: { offsetX: 200, offsetY: 400, scale: 0.5 } };
    const moved = pinClearOfHud(low, corner, [{ x: 0, y: 450, width: 260, height: 120 }], room, design, 'landscape', { ways: ['up', 'right'] });
    expect(placed(moved, corner)).toEqual({ x: 200, y: 350, width: 150, height: 100 });
  });

  it('scales the pin when no move clears the piece', () => {
    const pin = { valign: 'top' as const, landscape: { offsetX: -960, offsetY: 0, scale: 1 } };
    const b = { x: 0, y: 0, width: 200, height: 100 }; // at the screen's top-left corner, the room's top edge
    const under = { x: 0, y: 80, width: 70, height: 70 };
    const out = pinClearOfHud(pin, b, [under], room, design, 'landscape', { ways: ['up'] });
    expect(out.landscape!.scale).toBeLessThan(1);
    const box = placed(out, b);
    expect(box.y + box.height <= under.y + 1e-6 || box.x >= under.x + under.width - 1e-6).toBe(true);
  });
});

describe('the play area follows the HUD controls', () => {
  it('lays out again when the controls over it change, though its size did not', () => {
    const controls: Record<string, Box> = {};
    stubHud(640, 220, box(0, 180, 640, 40), controls);
    const area = hudPlayArea(() => host(640, 220));
    const seen: number[] = [];
    area.subscribe(() => seen.push(area.height));
    (window as unknown as EventTarget).dispatchEvent(new Event('resize'));
    expect(seen).toEqual([]);
    controls.FeatureBuyToggle = box(8, 68, 52, 52);
    (window as unknown as EventTarget).dispatchEvent(new Event('resize'));
    expect(seen).toEqual([144]);
    area.dispose();
  });
});
