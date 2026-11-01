// SmartContainer: a pixi Container that lays itself out from design data, per orientation, and
// keeps doing it as the screen changes. Put anything that must read the same on a phone and on a
// desktop in one — announcers, the win box, the logo, the board — and edit numbers, not code.
//
//   // An anchor: the banner's origin sits 120 design units above the screen centre.
//   const banner = new SmartContainer({ data: { correctionOffsetY: -120 } });
//   banner.addChild(new BigWinBanner());
//
//   // A design canvas: children pinned in 1080×1500 (portrait) / 1920×1000 (landscape) units.
//   const area = SmartContainer.canvas({ portrait: [1080, 1500], landscape: [1920, 1000] }, { viewport: playArea });
//   area.pinChildAt(logo, { valign: 'top', offsetY: 170, landscape: { offsetY: 80 } });
//   area.pinChildAt(board, { offsetY: -40, scale: 1.35 });
//
// The layout math (`smartLayout`, `pinPosition`) is in ./smart and is the same as the classic
// SmartContainer's, so layout data carries over unchanged.

import { Container, type ContainerChild, type DestroyOptions } from 'pixi.js';
import {
  orientationOf,
  pinPosition,
  resolveLayout,
  smartLayout,
  windowViewport,
  type LayoutData,
  type Orientation,
  type PinChildArgs,
  type SmartViewport,
} from './smart';

export interface SmartContainerArgs {
  /** One layout for both orientations (a portrait-only or landscape-only game). */
  data?: LayoutData;
  /** The layout on a screen taller than wide. Falls back to `data`. */
  portraitData?: LayoutData;
  /** The layout on a screen wider than tall (or square). Falls back to `data`. */
  landscapeData?: LayoutData;
  visible?: boolean;
  /** The area to lay out in. Default: the window. */
  viewport?: SmartViewport;
  /** Called after every layout (resize, orientation change, new data). */
  onLayout?: (container: SmartContainer) => void;
  label?: string;
}

export class SmartContainer extends Container {
  /** A container whose content box is the whole design viewport: pin children in its units. */
  static canvas(size: { portrait?: [number, number]; landscape?: [number, number] }, args: Omit<SmartContainerArgs, 'data' | 'portraitData' | 'landscapeData'> & { align?: LayoutData['align']; valign?: LayoutData['valign'] } = {}): SmartContainer {
    const box = (s: [number, number] | undefined): LayoutData | undefined =>
      s && { viewportWidth: s[0], viewportHeight: s[1], width: s[0], height: s[1], align: args.align ?? 'center', valign: args.valign ?? 'center' };
    const portrait = box(size.portrait ?? size.landscape);
    const landscape = box(size.landscape ?? size.portrait);
    return new SmartContainer({ ...args, ...(portrait ? { portraitData: portrait } : {}), ...(landscape ? { landscapeData: landscape } : {}) });
  }

  /** The orientation of the last layout. */
  orientation: Orientation = 'landscape';
  onLayout?: (container: SmartContainer) => void;
  private portrait?: LayoutData;
  private landscape?: LayoutData;
  private active: Required<LayoutData>;
  private readonly pins = new Map<ContainerChild, PinChildArgs>();
  private readonly viewport: SmartViewport;
  private readonly unsubscribe: () => void;

  constructor(args: SmartContainerArgs = {}) {
    super({ label: args.label ?? 'smart' });
    this.portrait = args.portraitData ?? args.data;
    this.landscape = args.landscapeData ?? args.data;
    this.visible = args.visible ?? true;
    if (args.onLayout) this.onLayout = args.onLayout;
    this.viewport = args.viewport ?? windowViewport();
    this.active = resolveLayout(this.landscape, 'landscape');
    this.unsubscribe = this.viewport.subscribe(this.updateContainer);
    this.updateContainer();
  }

  /** Lay out again for the viewport as it is now (the viewport calls this when it changes). */
  updateContainer = (): void => {
    if (this.destroyed) return;
    this.orientation = orientationOf(this.viewport);
    this.active = resolveLayout(this.orientation === 'portrait' ? this.portrait : this.landscape, this.orientation);
    const t = smartLayout(this.active, this.viewport);
    this.scale.set(t.scaleX, t.scaleY);
    this.position.set(t.x, t.y);
    for (const [child, args] of this.pins) this.place(child, args);
    this.onLayout?.(this);
  };

  /** The layout in effect (defaults filled in). */
  get layoutData(): Readonly<Required<LayoutData>> {
    return this.active;
  }

  /** The active design viewport, in design units. */
  get designWidth(): number {
    return this.active.viewportWidth;
  }
  get designHeight(): number {
    return this.active.viewportHeight;
  }

  /** The effective portrait layout (defaults merged with the data). */
  get portraitData(): LayoutData {
    return resolveLayout(this.portrait, 'portrait');
  }
  set portraitData(data: LayoutData) {
    this.portrait = data;
    this.updateContainer();
  }

  /** The effective landscape layout (defaults merged with the data). */
  get landscapeData(): LayoutData {
    return resolveLayout(this.landscape, 'landscape');
  }
  set landscapeData(data: LayoutData) {
    this.landscape = data;
    this.updateContainer();
  }

  /** Set one layout for both orientations. */
  set data(data: LayoutData) {
    this.portrait = data;
    this.landscape = data;
    this.updateContainer();
  }

  /**
   * Add `child` at a point of the design viewport — its centre by default — offset in design
   * units, optionally scaled, with per-orientation overrides. Re-applied on every layout, so a
   * pinned child follows the portrait/landscape switch. Use with a box that covers the design
   * viewport (`SmartContainer.canvas`), where local units are design units from its top-left.
   */
  pinChildAt<U extends ContainerChild>(child: U, args: PinChildArgs = {}): U {
    this.pins.set(child, args);
    this.addChild(child);
    this.place(child, args);
    return child;
  }

  /** Change a pinned child's placement. */
  repin(child: ContainerChild, args: PinChildArgs): void {
    if (!this.pins.has(child)) return;
    this.pins.set(child, args);
    this.place(child, args);
  }

  /** Stop re-placing `child` (it stays where it is). */
  unpin(child: ContainerChild): void {
    this.pins.delete(child);
  }

  override removeChild<U extends ContainerChild[]>(...children: U): U[0] {
    for (const c of children) this.pins.delete(c);
    return super.removeChild(...children);
  }

  override destroy(options?: DestroyOptions): void {
    this.unsubscribe();
    this.pins.clear();
    super.destroy(options);
  }

  private place(child: ContainerChild, args: PinChildArgs): void {
    if (child.destroyed) {
      this.pins.delete(child);
      return;
    }
    const p = pinPosition(args, this.orientation, { width: this.active.viewportWidth, height: this.active.viewportHeight });
    child.position.set(p.x, p.y);
    if (p.scale !== undefined) child.scale.set(p.scale);
  }
}
