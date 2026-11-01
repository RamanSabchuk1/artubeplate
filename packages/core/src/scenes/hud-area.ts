// The play area: the part of the game's canvas host the HUD leaves free. The HUD's bar (the
// desktop plate, the phone's readout strip) and the message line over it (PRESS PLAY TO SPIN!)
// sit at the bottom; every canvas of a game is fitted into the room above them.
//
//   readonly playArea = hudPlayArea(() => this.host);
//   readonly board = SmartContainer.canvas(CANVAS, { viewport: this.playArea });

import { SmartViewport, pinPosition, type Orientation, type PinChildArgs, type ViewportRect } from './smart';

/** The HUD bar's box (the skin draws the plate or the strip inside it). */
const HUD_BAR = '#open-slot-ui .UiRibbonUserPanel__container';

export interface HudPlayAreaOptions {
  /** Room kept between the bar and the play area for the HUD's message line, px. Default 36. */
  messageGap?: number;
}

/**
 * The play area right now, in the host's CSS pixels: it ends `messageGap` above the bar. The bar
 * counts from its top, or from 90 px above its bottom when that is higher (the desktop plate is
 * 90 px tall even in a shorter box); a strip under 60 px (a phone held sideways) counts from its
 * own top. With no bar on screen, or a bar too high up to be the HUD (a bonus screen hides it),
 * the area is the top 84 % of the host.
 */
export function measureHudPlayArea(host: Element | null | undefined, opts: HudPlayAreaOptions = {}): ViewportRect {
  const b = host?.getBoundingClientRect();
  const w = Math.round(b?.width ?? 0) || window.innerWidth;
  const h = Math.round(b?.height ?? 0) || window.innerHeight;
  const bar = document.querySelector(HUD_BAR)?.getBoundingClientRect();
  const top = bar ? (bar.height < 60 ? bar.top : Math.min(bar.top, bar.bottom - 90)) - (b?.top ?? 0) : h;
  const bottom = bar && top > h * 0.35 ? top - (opts.messageGap ?? 36) : h * 0.84;
  return { x: 0, y: 0, width: w, height: Math.max(1, Math.round(bottom)) };
}

/** The HUD's controls, and the boxes that take SPIN's place while it steps aside (free spins, a
 *  free-rounds campaign). */
const HUD_CONTROLS = [
  '#PlaceBetBtn',
  '#StopBtn',
  '#StartAutoplayBtn',
  '#StopAutoplayBtn',
  '#BetAmountIncrease',
  '#BetAmountDecrease',
  '#AutoplayBtn',
  '#MainMenuToggle',
  '#FeatureBuyToggle',
  '.FeaturePanel',
  '.FreeRoundsPanel.is-visible',
];

export interface HudKeepOutOptions extends HudPlayAreaOptions {
  /** Room kept around every control, px. Default 8. */
  margin?: number;
}

/** A control's box on screen, or null when it is not laid out. A turned control (the coin stands
 *  at -45°) has a bounding box bigger than itself: its own size about the same centre is used. */
function controlBox(el: Element): ViewportRect | null {
  const b = el.getBoundingClientRect();
  if (!(b.width > 0) || !(b.height > 0)) return null;
  const { offsetWidth: w = 0, offsetHeight: h = 0 } = el as HTMLElement;
  if (w > 0 && h > 0 && (w < b.width - 0.5 || h < b.height - 0.5)) {
    return { x: b.left + (b.width - w) / 2, y: b.top + (b.height - h) / 2, width: w, height: h };
  }
  return { x: b.left, y: b.top, width: b.width, height: b.height };
}

/**
 * The HUD's controls that stand over the play area, as boxes in the host's CSS pixels, each grown
 * by `margin`. On a phone held sideways that is the SPIN lane at the right edge (− SPIN + and the
 * autoplay button, or the free-spins box in their place) and ☰ with the coin at the left; on an
 * upright phone and on a desktop the controls sit in the bar under the play area and the list is
 * empty. A control the HUD only hides for a moment (a bonus screen fades the bar out) still
 * counts, so a layout does not jump when it comes back. A game keeps its logo and its board out of
 * these boxes (`clearOfHud`, `inCanvasUnits`); where nothing overlaps, nothing moves.
 */
export function measureHudKeepOut(host: Element | null | undefined, opts: HudKeepOutOptions = {}): ViewportRect[] {
  if (typeof document === 'undefined' || typeof document.querySelectorAll !== 'function') return [];
  const area = measureHudPlayArea(host, opts);
  const hb = host?.getBoundingClientRect();
  const ox = hb?.left ?? 0;
  const oy = hb?.top ?? 0;
  const m = opts.margin ?? 8;
  const out: ViewportRect[] = [];
  for (const sel of HUD_CONTROLS) {
    for (const el of Array.from(document.querySelectorAll(`#open-slot-ui ${sel}`))) {
      const c = controlBox(el);
      if (!c) continue;
      const r = { x: c.x - ox - m, y: c.y - oy - m, width: c.width + 2 * m, height: c.height + 2 * m };
      if (r.x < area.x + area.width && r.x + r.width > area.x && r.y < area.y + area.height && r.y + r.height > area.y) out.push(r);
    }
  }
  return out;
}

/**
 * Boxes on screen (the host's CSS pixels) in the design units of a canvas fitted into `area`
 * (contain, centred), the way `SmartContainer.canvas` lays a canvas out: the units a game's layout
 * code places its pins in. A box beside the canvas comes out past its edges (x < 0, x > width).
 */
export function inCanvasUnits(rects: readonly ViewportRect[], area: ViewportRect, design: readonly [number, number]): ViewportRect[] {
  const [dw, dh] = design;
  const fit = Math.min(area.width / dw, area.height / dh);
  if (!(fit > 0)) return [];
  const left = area.x + (area.width - dw * fit) / 2;
  const top = area.y + (area.height - dh * fit) / 2;
  return rects.map((r) => ({ x: (r.x - left) / fit, y: (r.y - top) / fit, width: r.width / fit, height: r.height / fit }));
}

const overlaps = (a: ViewportRect, b: ViewportRect): boolean =>
  a.x < b.x + b.width - 1e-6 && b.x < a.x + a.width - 1e-6 && a.y < b.y + b.height - 1e-6 && b.y < a.y + a.height - 1e-6;
/** How deep two boxes overlap: the smaller of the two overlaps across and down (≤ 0: apart). */
const depthOf = (a: ViewportRect, b: ViewportRect): number =>
  Math.min(Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x), Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));

/** How a piece may get out of the HUD's way. */
export type HudDodge = 'up' | 'down' | 'left' | 'right';

export interface ClearOfHudOptions {
  /** The ways the piece may move, tried in this order of preference at equal distance. Default all four. */
  ways?: readonly HudDodge[];
  /** The smallest the piece may shrink to, as a factor of its size. Default 0.6. */
  minScale?: number;
  /** Boxes the piece may not move onto (the board, for a logo beside it), though they do not move it. */
  avoid?: readonly ViewportRect[];
  /**
   * How deep the piece may lap a keep-out box and still stay put, in the boxes' units. The boxes
   * carry a margin round each control (`measureHudKeepOut`'s 8px): a slack of about that margin
   * leaves a piece that only comes near a control where it was, and one that does move keeps the
   * whole margin. Default 0.
   */
  slack?: number;
}

/**
 * Where a piece goes to keep clear of the HUD's controls. `box` is the piece at its pinned place
 * and size, `keepOut` the controls' boxes and `room` where it may go, all in the same units
 * (`measureHudKeepOut` and `inCanvasUnits` give a canvas's). A piece that overlaps no box stays
 * as it is. Otherwise it moves the shortest way out (up, down, left or right, as `ways` allows)
 * without leaving the room more than it already did; when no move clears it, it shrinks, in 5 %
 * steps down to `minScale`, and moves again. Returns the piece's new centre and the factor for its
 * scale.
 */
export function clearOfHud(box: ViewportRect, keepOut: readonly ViewportRect[], room: ViewportRect, opts: ClearOfHudOptions = {}): { x: number; y: number; scale: number } {
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const hits = (b: ViewportRect): boolean => keepOut.some((k) => overlaps(b, k));
  const slack = opts.slack ?? 0;
  if (!keepOut.some((k) => depthOf(box, k) > slack)) return { x: cx, y: cy, scale: 1 };
  const ways = opts.ways ?? ['up', 'down', 'left', 'right'];
  const minScale = opts.minScale ?? 0.6;
  const avoid = opts.avoid ?? [];
  // How far a box runs past the room's edges: a move may not make that worse on any side.
  const past = (b: ViewportRect): number[] => [room.x - b.x, room.y - b.y, b.x + b.width - (room.x + room.width), b.y + b.height - (room.y + room.height)].map((v) => Math.max(0, v));
  for (let step = 0; ; step++) {
    const k = Math.max(minScale, 1 - step * 0.05);
    const w = box.width * k;
    const h = box.height * k;
    const at: ViewportRect = { x: cx - w / 2, y: cy - h / 2, width: w, height: h };
    const allowed = past(at);
    const fits = (b: ViewportRect): boolean => !hits(b) && !avoid.some((a) => overlaps(b, a)) && past(b).every((v, i) => v <= allowed[i]! + 1e-6);
    // Shrunk in place, it may already be clear (a board it laps over before the shrink still counts).
    let best: { b: ViewportRect; d: number } | null = k < 1 && fits(at) ? { b: at, d: 0 } : null;
    if (!best) {
      for (const o of keepOut) {
        if (!overlaps(at, o)) continue;
        const moves: Record<HudDodge, ViewportRect> = {
          up: { ...at, y: o.y - h },
          down: { ...at, y: o.y + o.height },
          left: { ...at, x: o.x - w },
          right: { ...at, x: o.x + o.width },
        };
        for (const way of ways) {
          const b = moves[way];
          const d = Math.hypot(b.x - at.x, b.y - at.y);
          if (fits(b) && (!best || d < best.d - 1e-6)) best = { b, d };
        }
      }
    }
    if (best) return { x: best.b.x + w / 2, y: best.b.y + h / 2, scale: k };
    if (k <= minScale) return { x: cx, y: cy, scale: k };
  }
}

/**
 * The largest factor (at most 1) a box may be scaled by about the point (`cx`, `cy`) and stay clear
 * of every keep-out box: how a centred board makes room for the SPIN lane without moving off
 * centre. 1 when nothing overlaps by more than `slack` (as for `clearOfHud`); a board that does
 * shrink clears the whole margin.
 */
export function shrinkClearOf(box: ViewportRect, keepOut: readonly ViewportRect[], cx = box.x + box.width / 2, cy = box.y + box.height / 2, slack = 0): number {
  if (!keepOut.some((o) => depthOf(box, o) > slack)) return 1;
  let k = 1;
  for (const o of keepOut) {
    if (!overlaps(box, o)) continue;
    // The box scaled about (cx, cy) clears o once it pulls back from o on one axis: its extent on
    // the side facing o shrinks to the gap between the anchor and o's near edge.
    const fx = o.x >= cx ? (o.x - cx) / Math.max(1e-6, box.x + box.width - cx) : o.x + o.width <= cx ? (cx - (o.x + o.width)) / Math.max(1e-6, cx - box.x) : 0;
    const fy = o.y >= cy ? (o.y - cy) / Math.max(1e-6, box.y + box.height - cy) : o.y + o.height <= cy ? (cy - (o.y + o.height)) / Math.max(1e-6, cy - box.y) : 0;
    k = Math.min(k, Math.max(fx, fy));
  }
  return Math.max(0, k);
}

export interface SlideClearOptions {
  /** The point the box scales about when it has to shrink, in the boxes' units. Default its centre;
   *  a board pinned by its top edge passes that edge (its band then shrinks from the bottom). */
  anchorX?: number;
  anchorY?: number;
  /** How deep the box may lap a keep-out box and still stay put, as for `clearOfHud`. Default 0. */
  slack?: number;
}

/**
 * How a board the HUD squeezes keeps clear of the keep-out boxes by moving across, so that it takes
 * the free middle between the controls at the left (☰, the coin) and the SPIN lane at the right
 * instead of shrinking about the screen's centre. `box` is the board at its pinned place and size,
 * `room` the span it may use across (only its `x` and `width` count), all in the keep-out boxes'
 * units. A box that overlaps no keep-out box by more than `slack` stays as it is. Otherwise it
 * keeps its size and moves left or right by the least that clears every box in its band, inside
 * the room; when no move does, it shrinks about (`anchorX`, `anchorY`) by the least that lets one
 * (a shorter band may pass under a control) and takes the place nearest to where it would have
 * been. Returns how far it moved across (`dx`, after the shrink) and the factor for its scale.
 */
export function slideClearOf(box: ViewportRect, keepOut: readonly ViewportRect[], room: Pick<ViewportRect, 'x' | 'width'>, opts: SlideClearOptions = {}): { dx: number; scale: number } {
  if (!keepOut.some((o) => depthOf(box, o) > (opts.slack ?? 0))) return { dx: 0, scale: 1 };
  const ax = opts.anchorX ?? box.x + box.width / 2;
  const ay = opts.anchorY ?? box.y + box.height / 2;
  const top = box.y;
  const bottom = box.y + box.height;
  // The scale past which a keep-out box reaches into the box's band (its rows): the band scales
  // about `ay` too, so a control below the anchor enters it only once the box is that tall.
  const entry = (o: ViewportRect): number => {
    let e = 0;
    if (o.y >= ay) e = bottom - ay > 1e-6 ? (o.y - ay) / (bottom - ay) : Infinity;
    if (o.y + o.height <= ay) e = Math.max(e, ay - top > 1e-6 ? (ay - (o.y + o.height)) / (ay - top) : Infinity);
    return e;
  };
  const boxes = keepOut.map((o) => ({ o, e: entry(o) }));
  // The free stretches of the room across a band: what the boxes in it leave.
  const gaps = (k: number): [number, number][] => {
    const hit = boxes
      .filter((b) => b.e < k - 1e-9)
      .map(({ o }) => [o.x, o.x + o.width] as const)
      .sort((a, b) => a[0] - b[0]);
    const out: [number, number][] = [];
    let at = room.x;
    for (const [l, r] of hit) {
      if (l > at) out.push([at, Math.min(l, room.x + room.width)]);
      at = Math.max(at, r);
      if (at >= room.x + room.width) break;
    }
    if (at < room.x + room.width) out.push([at, room.x + room.width]);
    return out.filter(([l, r]) => r > l);
  };
  // The largest scale with a stretch wide enough: between two scales where a box enters the band,
  // the band's boxes are the same, so the best scale there is that stretch's width over the box's.
  const steps = [...new Set([...boxes.map((b) => b.e).filter((e) => e > 1e-9 && e < 1), 1])].sort((a, b) => b - a);
  for (let i = 0; i < steps.length; i++) {
    const hi = steps[i]!;
    const lo = steps[i + 1] ?? 0;
    const free = gaps(hi);
    const widest = Math.max(0, ...free.map(([l, r]) => r - l));
    const k = Math.min(hi, widest / Math.max(1e-6, box.width));
    if (k <= lo + 1e-9) continue;
    const w = box.width * k;
    const x = ax + (box.x - ax) * k;
    let dx = Infinity;
    for (const [l, r] of free) {
      if (r - l < w - 1e-6) continue;
      const d = Math.min(Math.max(x, l), r - w) - x;
      if (Math.abs(d) < Math.abs(dx)) dx = d;
    }
    if (Number.isFinite(dx)) return { dx, scale: k };
  }
  // A control across the whole room in every band: it shrinks in place, as `shrinkClearOf` does.
  return { dx: 0, scale: shrinkClearOf(box, keepOut, ax, ay) };
}

/**
 * A pin that keeps the piece it places clear of the HUD's controls: `pin` itself where the piece
 * (its local `bounds`, `getLocalBounds()`, at the pin's scale) overlaps no keep-out box by more
 * than `slack`; otherwise `pin` moved and scaled the way `clearOfHud` moves that box. `keepOut`
 * and `room` are in the design units of the canvas the pin is for (`inCanvasUnits`), `design` is
 * its size. For a logo or a side column pinned in a `SmartContainer.canvas`.
 */
export function pinClearOfHud(
  pin: PinChildArgs,
  bounds: ViewportRect,
  keepOut: readonly ViewportRect[],
  room: ViewportRect,
  design: readonly [number, number],
  orientation: Orientation = 'landscape',
  opts: ClearOfHudOptions = {},
): PinChildArgs {
  const at = pinPosition(pin, orientation, { width: design[0], height: design[1] });
  const s = at.scale ?? 1;
  const box = { x: at.x + bounds.x * s, y: at.y + bounds.y * s, width: bounds.width * s, height: bounds.height * s };
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;
  const c = clearOfHud(box, keepOut, room, opts);
  if (c.scale === 1 && c.x === cx && c.y === cy) return pin;
  // The pin point keeps its place on the piece: from the new centre, scaled with it.
  const own = { ...pin, ...pin[orientation] };
  const x = c.x - (cx - at.x) * c.scale;
  const y = c.y - (cy - at.y) * c.scale;
  return { ...pin, [orientation]: { ...pin[orientation], offsetX: (own.offsetX ?? 0) + x - at.x, offsetY: (own.offsetY ?? 0) + y - at.y, scale: s * c.scale } };
}

/** A short key for a list of boxes, in whole units: for a layout cache. */
export function rectsKey(rects: readonly ViewportRect[]): string {
  return rects.map((r) => `${Math.round(r.x)},${Math.round(r.y)},${Math.round(r.width)},${Math.round(r.height)}`).join(';');
}

/** A play area that keeps itself current; `dispose()` stops listening. */
export type HudPlayArea = SmartViewport & { dispose(): void };

/**
 * A SmartViewport of the play area (see `measureHudPlayArea`) that keeps itself current. It
 * measures again on a window resize or an orientation change, and whenever the host or the HUD
 * bar changes size: the bar settles a moment after the HUD mounts (the skin and the fonts land)
 * and changes with the HUD's state, and the area follows without a timer. `host` may be a getter
 * for a host that does not exist yet (a field initializer); it is watched once it does. When the
 * HUD's controls over the area change (`measureHudKeepOut`: the coin turns up after the HUD
 * mounts, a feature swaps SPIN for its box) its containers and subscribers are laid out again,
 * even if the area's size stayed the same.
 */
export function hudPlayArea(host: Element | (() => Element | null | undefined), opts: HudPlayAreaOptions = {}): HudPlayArea {
  const hostOf = typeof host === 'function' ? host : (): Element => host;
  const watched = new Set<Element>();
  let ro: ResizeObserver | null = null;
  let mo: MutationObserver | null = null;
  let view: HudPlayArea | null = null;
  let keep = '';
  const keepChanged = (): boolean => {
    const k = rectsKey(measureHudKeepOut(hostOf(), opts));
    if (k === keep) return false;
    keep = k;
    return true;
  };
  const update = (): void => {
    if (view) view.refresh(keepChanged());
  };
  // A size change measures again on the next frame, never inside the observer's callback: the
  // layout it sets off must not resize what is observed in the same pass (the browser reports
  // that as a "ResizeObserver loop" error).
  let queued = false;
  const later = (): void => {
    if (queued) return;
    queued = true;
    const run = (): void => {
      queued = false;
      update();
    };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
    else setTimeout(run, 0);
  };
  const watch = (el: Element | null | undefined): void => {
    if (!el || watched.has(el) || typeof ResizeObserver === 'undefined') return;
    ro ??= new ResizeObserver(later);
    ro.observe(el);
    watched.add(el);
  };
  // The HUD's state, layout and coin: what moves its controls without resizing the bar.
  const watchHud = (): void => {
    if (mo || typeof MutationObserver === 'undefined' || typeof document.getElementById !== 'function') return;
    const root = document.getElementById('open-slot-ui');
    if (!root) return;
    mo = new MutationObserver(later);
    mo.observe(root, { attributes: true, attributeFilter: ['data-state', 'data-channel', 'data-orientation'] });
    const coin = root.querySelector('#FeatureBuyToggle');
    if (coin) mo.observe(coin, { attributes: true, attributeFilter: ['class'] });
  };
  const measure = (): ViewportRect => {
    if (typeof document !== 'undefined') {
      watch(hostOf());
      watch(document.querySelector(HUD_BAR));
      watchHud();
    }
    return measureHudPlayArea(hostOf(), opts);
  };
  view = Object.assign(new SmartViewport(measure), { dispose: (): void => {} });
  keepChanged();
  if (typeof window !== 'undefined') {
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);
    view.dispose = (): void => {
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
      ro?.disconnect();
      mo?.disconnect();
      watched.clear();
    };
  }
  return view;
}
