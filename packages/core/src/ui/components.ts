// Ready-made pixi pieces that look finished out of the box: text in a role, panels (cards, boxes,
// pills), a backdrop with a radial glow and a vignette, the win box, the line-win label and the
// big-win banner. All type comes from `typography()`: white, outlined, readable over any art.

import { Container, FillGradient, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { gsap } from 'gsap';
import { isUpper, textStyle, type TextRole } from './typography';

// ── text ────────────────────────────────────────────────────────────────────
/** A Text in a typography role, centred on its origin. */
export function label(role: TextRole, content: string, overrides: Partial<TextStyleOptions> = {}): Text {
  const t = new Text({ text: isUpper(role) ? content.toUpperCase() : content, style: textStyle(role, overrides) });
  t.anchor.set(0.5);
  return t;
}

/** Change a role label's text (keeps the role's capitalisation). */
export function setLabel(t: Text, role: TextRole, content: string): void {
  t.text = isUpper(role) ? content.toUpperCase() : content;
}

// ── panels ──────────────────────────────────────────────────────────────────
export interface PanelStyle {
  fill: number;
  fillAlpha: number;
  border: number;
  borderAlpha: number;
  borderWidth: number;
  radius: number;
  /** A soft sheen over the top of the panel (white, this alpha at the top edge). */
  sheen: number;
  /** A drop shadow under the panel. */
  shadowAlpha: number;
  shadowOffset: number;
}

export const PANEL_STYLES = {
  /** An info card: near-black, a crisp light border, a sheen and a shadow. */
  card: { fill: 0x15181e, fillAlpha: 0.97, border: 0xffffff, borderAlpha: 0.22, borderWidth: 2, radius: 28, sheen: 0.07, shadowAlpha: 0.45, shadowOffset: 10 },
  /** A win box / dialog: darker and translucent. */
  box: { fill: 0x08090c, fillAlpha: 0.84, border: 0xffffff, borderAlpha: 0.24, borderWidth: 2, radius: 22, sheen: 0.06, shadowAlpha: 0.35, shadowOffset: 6 },
  /** A recessed area inside a card (behind art). */
  inset: { fill: 0x0b0d11, fillAlpha: 0.92, border: 0xffffff, borderAlpha: 0.07, borderWidth: 1, radius: 20, sheen: 0, shadowAlpha: 0, shadowOffset: 0 },
  /** A pill: labels, strips, plaques. */
  pill: { fill: 0x08090c, fillAlpha: 0.76, border: 0xffffff, borderAlpha: 0.2, borderWidth: 2, radius: 999, sheen: 0.06, shadowAlpha: 0.3, shadowOffset: 4 },
} as const satisfies Record<string, PanelStyle>;

export type PanelName = keyof typeof PANEL_STYLES;

const sheens = new Map<number, FillGradient>();
function sheenGradient(alpha: number): FillGradient {
  let g = sheens.get(alpha);
  if (!g) {
    g = new FillGradient({
      type: 'linear',
      start: { x: 0, y: 0 },
      end: { x: 0, y: 1 },
      colorStops: [
        { offset: 0, color: `rgba(255,255,255,${alpha})` },
        { offset: 0.55, color: 'rgba(255,255,255,0)' },
      ],
      textureSpace: 'local',
    });
    sheens.set(alpha, g);
  }
  return g;
}

/** Draw a panel into `g` with its top-left at (x, y). */
export function drawPanel(g: Graphics, x: number, y: number, w: number, h: number, style: PanelName | Partial<PanelStyle> = 'card'): Graphics {
  const s: PanelStyle = typeof style === 'string' ? PANEL_STYLES[style] : { ...PANEL_STYLES.card, ...style };
  const r = Math.min(s.radius, h / 2, w / 2);
  if (s.shadowAlpha > 0) g.roundRect(x, y + s.shadowOffset, w, h, r).fill({ color: 0x000000, alpha: s.shadowAlpha });
  g.roundRect(x, y, w, h, r).fill({ color: s.fill, alpha: s.fillAlpha });
  if (s.sheen > 0) g.roundRect(x, y, w, h, r).fill(sheenGradient(s.sheen));
  if (s.borderWidth > 0) g.roundRect(x, y, w, h, r).stroke({ color: s.border, alpha: s.borderAlpha, width: s.borderWidth });
  return g;
}

// ── backdrop ────────────────────────────────────────────────────────────────
export interface BackdropStyle {
  /** The base colour. */
  base: number;
  /** A radial glow behind the play area. */
  glow: number;
  glowAlpha: number;
  /** Glow radius as a fraction of the screen. */
  glowRadius: number;
  /** Darkening towards the edges. */
  vignetteAlpha: number;
  /** Glow centre as fractions of the screen (default 0.5, 0.45). */
  center?: { x: number; y: number };
}

export const BACKDROPS = {
  graphite: { base: 0x111318, glow: 0x5a6477, glowAlpha: 0.8, glowRadius: 0.72, vignetteAlpha: 0.62 },
  midnight: { base: 0x0b0f19, glow: 0x34508a, glowAlpha: 0.8, glowRadius: 0.72, vignetteAlpha: 0.62 },
  violet: { base: 0x120b18, glow: 0x6a34a0, glowAlpha: 0.8, glowRadius: 0.72, vignetteAlpha: 0.64 },
  emerald: { base: 0x0a1411, glow: 0x2a6b57, glowAlpha: 0.8, glowRadius: 0.72, vignetteAlpha: 0.62 },
  crimson: { base: 0x160b0d, glow: 0x823040, glowAlpha: 0.8, glowRadius: 0.72, vignetteAlpha: 0.64 },
} as const satisfies Record<string, BackdropStyle>;

export type BackdropName = keyof typeof BACKDROPS;

const rgba = (hex: number, a: number): string => `rgba(${(hex >> 16) & 255},${(hex >> 8) & 255},${hex & 255},${a})`;
const backdropFills = new Map<BackdropStyle, { glow: FillGradient; vignette: FillGradient }>();

/** Paint a full-screen backdrop into `g` (clears it first). Gradients are cached per style. */
export function drawBackdrop(g: Graphics, width: number, height: number, style: BackdropName | BackdropStyle = 'graphite'): Graphics {
  const s: BackdropStyle = typeof style === 'string' ? BACKDROPS[style] : style;
  let fills = backdropFills.get(s);
  if (!fills) {
    const c = s.center ?? { x: 0.5, y: 0.45 };
    fills = {
      glow: new FillGradient({
        type: 'radial',
        center: c,
        innerRadius: 0,
        outerCenter: c,
        outerRadius: s.glowRadius,
        colorStops: [
          { offset: 0, color: rgba(s.glow, s.glowAlpha) },
          { offset: 1, color: rgba(s.glow, 0) },
        ],
        textureSpace: 'local',
      }),
      vignette: new FillGradient({
        type: 'radial',
        center: { x: 0.5, y: 0.5 },
        innerRadius: 0.42,
        outerCenter: { x: 0.5, y: 0.5 },
        outerRadius: 0.78,
        colorStops: [
          { offset: 0, color: 'rgba(0,0,0,0)' },
          { offset: 1, color: rgba(0x000000, s.vignetteAlpha) },
        ],
        textureSpace: 'local',
      }),
    };
    backdropFills.set(s, fills);
  }
  return g.clear().rect(0, 0, width, height).fill(s.base).rect(0, 0, width, height).fill(fills.glow).rect(0, 0, width, height).fill(fills.vignette);
}

// ── wins ────────────────────────────────────────────────────────────────────
const tween = (target: object, vars: gsap.TweenVars): Promise<void> => new Promise((resolve) => void gsap.to(target, { ...vars, onComplete: () => resolve() }));

export interface WinBoxOptions {
  /** A caption over the amount ("TOTAL WIN"). Default none: the amount alone. */
  caption?: string;
  /** Formats the amount (e.g. the HUD's currency formatter). Default: 2 decimals. */
  format?: (value: number) => string;
  /** A dark panel behind it: `true` for the default box, or a style. Default none. */
  panel?: boolean | Partial<PanelStyle>;
  /** Minimum panel width, with a panel. Default 340. */
  minWidth?: number;
}

/**
 * The win box: a big outlined amount that counts up (a caption and a panel are optional).
 * `show(amount)` pops it in and counts; `countTo` keeps counting (a free-spins total);
 * `hide()` fades it away. It animates an inner body, never its own scale, so a layout (a
 * SmartContainer pin, a SceneContainer `place`) can size it.
 */
export class WinBox extends Container {
  private readonly body = new Container({ label: 'win-box-body' });
  private readonly bg = new Graphics();
  private readonly captionText: Text;
  private readonly amountText: Text;
  private value = 0;
  private drawnWidth = 0;
  private counter: gsap.core.Tween | null = null;
  private readonly format: (value: number) => string;

  constructor(private readonly opts: WinBoxOptions = {}) {
    super({ label: 'win-box' });
    this.format = opts.format ?? ((v) => v.toFixed(2));
    this.captionText = label('winLabel', opts.caption ?? '');
    this.captionText.visible = !!opts.caption;
    this.amountText = label('winAmount', this.format(0));
    this.body.addChild(this.bg, this.captionText, this.amountText);
    this.addChild(this.body);
    this.visible = false;
    this.alpha = 0;
    this.redraw();
  }

  get amount(): number {
    return this.value;
  }

  /** Show a caption over the amount (an empty string removes it). */
  setCaption(caption: string): void {
    setLabel(this.captionText, 'winLabel', caption);
    this.captionText.visible = !!caption;
    this.redraw(true);
  }

  setAmount(value: number): void {
    this.value = value;
    this.amountText.text = this.format(value);
    this.redraw();
  }

  /** Pop in and count from `from` (default 0) up to `value`. `speed` < 1 is faster (turbo). */
  async show(value: number, opts: { from?: number; duration?: number; speed?: number } = {}): Promise<void> {
    const speed = opts.speed ?? 1;
    this.visible = true;
    gsap.killTweensOf([this, this.body.scale]);
    gsap.fromTo(this.body.scale, { x: 0.72, y: 0.72 }, { x: 1, y: 1, duration: 0.35 * speed, ease: 'back.out(2)' });
    gsap.to(this, { alpha: 1, duration: 0.15 * speed });
    await this.countTo(value, { from: opts.from ?? 0, duration: opts.duration ?? 0.8, speed });
  }

  /** Count from the current amount (or `from`) to `value`. */
  countTo(value: number, opts: { from?: number; duration?: number; speed?: number } = {}): Promise<void> {
    this.counter?.kill();
    const o = { v: opts.from ?? this.value };
    const duration = (opts.duration ?? 0.8) * (opts.speed ?? 1);
    if (duration <= 0.01) {
      this.setAmount(value);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      this.counter = gsap.to(o, {
        v: value,
        duration,
        ease: 'power2.out',
        onUpdate: () => this.setAmount(o.v),
        onComplete: () => {
          this.setAmount(value);
          resolve();
        },
      });
    });
  }

  async hide(speed = 1): Promise<void> {
    this.counter?.kill();
    if (!this.visible) return;
    await tween(this, { alpha: 0, duration: 0.2 * speed });
    this.visible = false;
  }

  private redraw(force = false): void {
    // The caption (if any) sits right over the amount; the pair is centred on the origin.
    const captioned = this.captionText.visible;
    const ch = captioned ? this.captionText.height : 0;
    const ah = this.amountText.height;
    const h = ch + ah;
    this.captionText.y = -h / 2 + ch / 2;
    this.amountText.y = h / 2 - ah / 2;
    const panel = this.opts.panel;
    if (!panel) return;
    const w = Math.max(this.opts.minWidth ?? 340, Math.ceil(Math.max(this.amountText.width, captioned ? this.captionText.width : 0) + 100));
    if (!force && Math.abs(w - this.drawnWidth) < 2) return;
    this.drawnWidth = w;
    const ph = Math.max(150, Math.ceil(h + 44));
    drawPanel(this.bg.clear(), -w / 2, -ph / 2, w, ph, { ...PANEL_STYLES.box, ...(typeof panel === 'object' ? panel : {}) });
  }
}

/** The amount over a winning line: outlined type, centred on its origin (`pill: true` adds a dark pill). */
export function lineWinLabel(text: string, opts: { pill?: boolean } = {}): Container {
  const c = new Container({ label: 'line-win' });
  const t = label('lineWin', text);
  if (opts.pill) {
    const w = t.width + 40;
    const h = t.height + 6;
    c.addChild(drawPanel(new Graphics(), -w / 2, -h / 2, w, h, 'pill'));
  }
  c.addChild(t);
  return c;
}

let shade: FillGradient | null = null;
/** A soft black oval, dark in the middle and gone at the edge (reads type over busy art). */
function shadeGradient(): FillGradient {
  return (shade ??= new FillGradient({
    type: 'radial',
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.5,
    colorStops: [
      { offset: 0, color: 'rgba(0,0,0,0.72)' },
      { offset: 0.55, color: 'rgba(0,0,0,0.5)' },
      { offset: 1, color: 'rgba(0,0,0,0)' },
    ],
    textureSpace: 'local',
  }));
}

export interface BigWinBannerOptions {
  /** A soft dark oval behind the type so it reads over any art. Default true. */
  shade?: boolean;
}

/**
 * "BIG WIN" + amount, or "FREE SPINS" + "10 SPINS": big outlined type that pops in over a soft
 * dark oval. Like the win box it animates an inner body, so its own scale is free for the layout.
 */
export class BigWinBanner extends Container {
  private readonly body = new Container({ label: 'big-win-body' });
  private readonly shade = new Graphics();
  private readonly title = label('bigWin', '');
  private readonly amount = label('bigWinAmount', '');

  constructor(private readonly opts: BigWinBannerOptions = {}) {
    super({ label: 'big-win' });
    this.body.addChild(this.shade, this.title, this.amount);
    this.addChild(this.body);
    this.visible = false;
  }

  show(title: string, amount?: string, speed = 1): void {
    setLabel(this.title, 'bigWin', title);
    this.amount.text = amount ?? '';
    this.amount.visible = !!amount;
    // The amount sits under the title with a clear gap; the pair is centred on the origin.
    const gap = 6;
    const h = this.title.height + (amount ? gap + this.amount.height : 0);
    this.title.y = -h / 2 + this.title.height / 2;
    this.amount.y = h / 2 - this.amount.height / 2;
    this.shade.clear();
    if (this.opts.shade !== false) {
      const w = Math.max(this.title.width, amount ? this.amount.width : 0) + 280;
      this.shade.ellipse(0, 0, w / 2, (h + 170) / 2).fill(shadeGradient());
    }
    this.visible = true;
    gsap.killTweensOf([this, this.body.scale]);
    this.alpha = 0;
    gsap.fromTo(this.body.scale, { x: 0.7, y: 0.7 }, { x: 1, y: 1, duration: 0.34 * speed, ease: 'back.out(1.8)' });
    gsap.to(this, { alpha: 1, duration: 0.18 * speed });
  }

  async hide(speed = 1): Promise<void> {
    gsap.killTweensOf(this);
    await tween(this, { alpha: 0, duration: 0.22 * speed });
    this.visible = false;
  }
}
