// SmartContainer layout, as plain math (no pixi import, so it runs and tests anywhere).
//
// A SmartContainer is fitted into a VIEWPORT (the window, or any area such as "the screen above
// the HUD bar") from a design viewport per orientation: 1080×1920 in portrait, 1920×1080 in
// landscape unless the data says otherwise. The fit is `contain` (or `cover` with `fitCover`),
// the content box (`width` × `height`, design units) is aligned in the viewport by `align` /
// `valign`, and the corrections nudge the result. A 0 × 0 box (the default) is a point: the
// container's origin is the anchor — `valign: 'bottom'` puts it on the bottom edge.

export type Align = 'left' | 'center' | 'right';
export type VAlign = 'top' | 'center' | 'bottom';
export type Orientation = 'portrait' | 'landscape';

/** How a SmartContainer sits in its viewport, for one orientation. Lengths are design units. */
export interface LayoutData {
  /** Where the content box sits across the viewport. Default `center`. */
  align?: Align;
  /** Where the content box sits down the viewport. Default `center`. */
  valign?: VAlign;
  /** The content box. 0 × 0 (default) makes the container's origin the anchor point. */
  width?: number;
  height?: number;
  /** The design viewport fitted into the real one. Default 1080×1920 portrait, 1920×1080 landscape. */
  viewportWidth?: number;
  viewportHeight?: number;
  /** Scale the box to the viewport's full width (height) instead of fitting it. */
  stretchWidth?: boolean;
  stretchHeight?: boolean;
  /** Extra scale on top of the fit. Default 1. */
  correctionScaleX?: number;
  correctionScaleY?: number;
  /** A nudge in design units (it scales with the container). Default 0. */
  correctionOffsetX?: number;
  correctionOffsetY?: number;
  /** Fill the viewport (the larger scale) instead of fitting inside it (the smaller). */
  fitCover?: boolean;
}

/** An area on screen, in CSS pixels of the canvas. */
export interface ViewportRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** The container's transform for a layout in a viewport. */
export interface SmartTransform {
  scaleX: number;
  scaleY: number;
  x: number;
  y: number;
}

export const PORTRAIT_DESIGN = { width: 1080, height: 1920 } as const;
export const LANDSCAPE_DESIGN = { width: 1920, height: 1080 } as const;

const BASE: Required<LayoutData> = {
  align: 'center',
  valign: 'center',
  width: 0,
  height: 0,
  viewportWidth: 0,
  viewportHeight: 0,
  stretchWidth: false,
  stretchHeight: false,
  correctionScaleX: 1,
  correctionScaleY: 1,
  correctionOffsetX: 0,
  correctionOffsetY: 0,
  fitCover: false,
};

/** Taller than wide is portrait; a square is landscape. */
export function orientationOf(view: { width: number; height: number }): Orientation {
  return view.height > view.width ? 'portrait' : 'landscape';
}

/** The data with every default filled in for `orientation`. */
export function resolveLayout(data: LayoutData | undefined, orientation: Orientation): Required<LayoutData> {
  const design = orientation === 'portrait' ? PORTRAIT_DESIGN : LANDSCAPE_DESIGN;
  return { ...BASE, viewportWidth: design.width, viewportHeight: design.height, ...data };
}

/** Where a container with this (resolved) layout goes in `view`. */
export function smartLayout(data: Required<LayoutData>, view: ViewportRect): SmartTransform {
  const pick = data.fitCover ? Math.max : Math.min;
  let scale = pick(view.width / 1920, view.height / 1080);
  if (data.viewportWidth || data.viewportHeight) scale = pick(view.width / (data.viewportWidth || 1920), view.height / (data.viewportHeight || 1080));

  let { width, height } = data;
  let scaleX = scale;
  let scaleY = scale;
  if (data.stretchWidth && width > 0) scaleX = view.width / width;
  if (data.stretchHeight && height > 0) scaleY = view.height / height;
  scaleX *= data.correctionScaleX;
  scaleY *= data.correctionScaleY;

  const free = (room: number, size: number, s: number, at: Align | VAlign): number =>
    at === 'right' || at === 'bottom' ? room - size * s : at === 'center' ? (room - size * s) / 2 : 0;
  width = Math.max(0, width);
  height = Math.max(0, height);
  return {
    scaleX,
    scaleY,
    x: view.x + free(view.width, width, scaleX, data.align) + data.correctionOffsetX * scaleX,
    y: view.y + free(view.height, height, scaleY, data.valign) + data.correctionOffsetY * scaleY,
  };
}

/** A child pinned in a container's design viewport. */
export interface PinArgs {
  align?: Align;
  valign?: VAlign;
  /** Design-unit offsets from the aligned point. */
  offsetX?: number;
  offsetY?: number;
  /** The child's scale in design units (unset: the child keeps its own). */
  scale?: number;
}

/** A pin, with optional overrides for one orientation. */
export interface PinChildArgs extends PinArgs {
  portrait?: PinArgs;
  landscape?: PinArgs;
}

/** Where a pinned child goes in its container (design units of the active viewport). */
export function pinPosition(args: PinChildArgs, orientation: Orientation, design: { width: number; height: number }): { x: number; y: number; scale?: number } {
  const p: PinArgs = { ...args, ...(orientation === 'portrait' ? args.portrait : args.landscape) };
  const { align = 'center', valign = 'center', offsetX = 0, offsetY = 0 } = p;
  return {
    x: (align === 'right' ? design.width : align === 'center' ? design.width / 2 : 0) + offsetX,
    y: (valign === 'bottom' ? design.height : valign === 'center' ? design.height / 2 : 0) + offsetY,
    ...(p.scale !== undefined ? { scale: p.scale } : {}),
  };
}

/**
 * An area SmartContainers lay out in. It measures on demand (`refresh`) and tells its containers
 * when the area moved. `windowViewport()` follows the window; make your own for, say, the screen
 * above the HUD bar and call `refresh()` from your resize handler.
 */
export class SmartViewport implements ViewportRect {
  private rect: ViewportRect;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly measure: () => ViewportRect) {
    this.rect = measure();
  }

  get x(): number {
    return this.rect.x;
  }
  get y(): number {
    return this.rect.y;
  }
  get width(): number {
    return this.rect.width;
  }
  get height(): number {
    return this.rect.height;
  }

  /** Measure again; lay out every container when the area changed (or when `force`). */
  refresh(force = false): void {
    const r = this.measure();
    const same = r.x === this.rect.x && r.y === this.rect.y && r.width === this.rect.width && r.height === this.rect.height;
    this.rect = r;
    if (same && !force) return;
    for (const fn of [...this.listeners]) fn();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

let windowView: SmartViewport | null = null;

/** The window (CSS pixels), kept up to date on resize and orientation change. */
export function windowViewport(): SmartViewport {
  if (windowView) return windowView;
  const view = new SmartViewport(() =>
    typeof window === 'undefined' ? { x: 0, y: 0, width: LANDSCAPE_DESIGN.width, height: LANDSCAPE_DESIGN.height } : { x: 0, y: 0, width: window.innerWidth, height: window.innerHeight },
  );
  if (typeof window !== 'undefined') {
    const refresh = (): void => view.refresh();
    window.addEventListener('resize', refresh);
    window.addEventListener('orientationchange', refresh);
  }
  return (windowView = view);
}
