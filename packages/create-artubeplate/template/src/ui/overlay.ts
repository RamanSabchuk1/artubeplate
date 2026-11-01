// In-canvas win presentation, from `@artubeplate/core/ui` (white, outlined type that reads over
// any art): the BANNER for announcements (FREE SPINS / RETRIGGER), the WIN ANNOUNCER that counts a
// big win up through BIG → MEGA → EPIC (each tier slams in and calls `onTier`: a stinger, a burst),
// the WIN BOX that a base round's line amounts fly into and that counts them up, and LINE-WIN
// labels floating over winning cells.
//
// All of it lives in a SmartContainer canvas fitted into the play area, the same canvas as the
// board, so it is sized for the screen it is on: where the banner and the win box sit (and how
// big they are) per orientation is in ../layout (`PINS.banner`, `PINS.winBox`, `LINE_WIN`).

import { Container } from 'pixi.js';
import { gsap } from 'gsap';
import { SmartContainer, type PinChildArgs, type SmartViewport } from '@artubeplate/core/scenes';
import { BigWinBanner, WinAnnouncer, WinBox, lineWinLabel, type WinTier } from '@artubeplate/core/ui';
import type { Rect } from '../scene/Scene';
import { CANVAS, LINE_WIN, PINS } from '../layout';

export interface OverlayOptions {
  /** A big win entered a tier (BIG, MEGA, EPIC): play its stinger, fire its FX. */
  onTier?: (tier: WinTier, index: number) => void;
  /** The pins for the screen as it is now (the scene's `pins()`): where the HUD's controls move the
   *  board, the win box and the banner follow it. Default ../layout's PINS. */
  pins?: () => { winBox: PinChildArgs; banner: PinChildArgs };
}

/** How much the win box grows with each hit, and the most it grows (1 = as pinned). */
const GROW = { step: 0.07, max: 1.35 };

export class Overlay {
  readonly banner = new BigWinBanner();
  readonly winBox: WinBox;
  /** The pinned slot the win box sits in: the pin sizes the slot, so the box's own scale is free to grow with the hits. */
  private readonly winSlot = new Container({ label: 'win-slot' });
  /** How far the box has grown with the hits (1 = as pinned). */
  private grow = 1;
  private growTween: gsap.core.Timeline | null = null;
  /** BIG → MEGA → EPIC WIN, counted up (`announce`); a slam-stop skips to the end. */
  readonly announcer: WinAnnouncer;
  /** The design canvas the announcements are pinned in. */
  readonly area: SmartContainer;
  private readonly labels = new Container({ label: 'line-wins' });
  /** Each live label's timeline, so a clear can stop it before the label is destroyed. */
  private readonly timelines = new Map<Container, gsap.core.Timeline>();

  constructor(layer: Container, format: (amount: number) => string, viewport: SmartViewport, opts: OverlayOptions = {}) {
    this.area = SmartContainer.canvas(CANVAS, { viewport, label: 'overlay-area' });
    this.area.eventMode = 'none';
    this.winBox = new WinBox({ format });
    this.announcer = new WinAnnouncer({ format, ...(opts.onTier ? { onTier: opts.onTier } : {}) });
    this.area.addChild(this.labels);
    this.winSlot.addChild(this.winBox);
    const pins = opts.pins ?? ((): typeof PINS => PINS);
    const at = pins();
    this.area.pinChildAt(this.winSlot, at.winBox);
    this.area.pinChildAt(this.banner, at.banner);
    this.area.pinChildAt(this.announcer, at.banner);
    viewport.subscribe(() => {
      const now = pins();
      this.area.repin(this.winSlot, now.winBox);
      this.area.repin(this.banner, now.banner);
      this.area.repin(this.announcer, now.banner);
    });
    layer.addChild(this.area);
  }

  /** An announcement: a title and an optional line under it. */
  show(title: string, sub?: string): void {
    this.banner.show(title, sub);
  }

  hide(): void {
    void this.banner.hide();
  }

  /** A big win: count it up through every tier it reaches (nothing below the first, 15× by default). */
  async announce(amount: number, x: number, speed = 1): Promise<void> {
    if (this.announcer.tierFor(x) < 0) return;
    await this.announcer.play(amount, x, { speed });
  }

  /** Count a win up in the win box. If it is already up, keep counting. */
  async showWin(amount: number, speed = 1): Promise<void> {
    if (this.boxUp()) return this.winBox.countTo(amount, { speed });
    await this.winBox.show(amount, { speed });
  }

  /** Fade the win box away (resolves when it is gone); it comes back at its pinned size. */
  async hideWin(speed = 1): Promise<void> {
    this.growTween?.kill();
    await this.winBox.hide(speed);
    this.winBox.scale.set(1);
    this.grow = 1;
  }

  /** Where the win box is, on screen (the line amounts fly into it). */
  winBoxPoint(): { x: number; y: number } {
    return this.winSlot.getGlobalPosition();
  }

  /**
   * A line's amount pops over its cells, holds a beat, then flies into the win box along a small
   * arc, shrinking as it goes. Resolves when it hits (the caller counts the box up then). `to`
   * sends it somewhere else on screen, `hold` scales the beat over the line, `onLaunch` fires as
   * the flight begins (sparks that leave with it).
   */
  flyWinLabel(rects: Rect[], text: string, speed = 1, opts: { to?: () => { x: number; y: number }; hold?: number; onLaunch?: () => void } = {}): Promise<void> {
    if (!rects.length) return Promise.resolve();
    const cx = rects.reduce((s, r) => s + r.x + r.w / 2, 0) / rects.length;
    const cy = rects.reduce((s, r) => s + r.y + r.h / 2, 0) / rects.length;
    const ui = this.area;
    const from = ui.toLocal({ x: cx, y: cy });
    const t = lineWinLabel(text);
    const k = LINE_WIN.scale[ui.orientation];
    t.scale.set(k * 0.6);
    t.position.set(from.x, from.y);
    t.alpha = 0;
    this.labels.addChild(t);
    return new Promise((resolve) => {
      const tl = gsap.timeline({
        onComplete: () => {
          this.timelines.delete(t);
          t.destroy({ children: true });
        },
      });
      // Pop and hold over the line.
      const hold = opts.hold ?? 1;
      const lift = from.y - LINE_WIN.rise * 0.6;
      tl.to(t, { alpha: 1, duration: 0.12 * speed }, 0);
      tl.to(t.scale, { x: k, y: k, duration: 0.32 * speed * hold, ease: 'back.out(2.2)' }, 0);
      tl.to(t, { y: lift, duration: 0.5 * speed * hold, ease: 'power1.out' }, 0);
      // Then into the box: a quadratic arc bowing upward, the label shrinking into it. The target
      // is read every frame, so a box that moves with the layout is still hit.
      const flight = 0.42 * speed;
      const launch = Math.max(0, 0.5 * speed * hold - 0.05 * speed);
      const prog = { p: 0 };
      tl.to(
        prog,
        {
          p: 1,
          duration: flight,
          ease: 'power2.in',
          onUpdate: () => {
            const to = ui.toLocal(opts.to?.() ?? this.winBoxPoint());
            const mx = (from.x + to.x) / 2;
            const my = Math.min(lift, to.y) - 90;
            const u = prog.p;
            const v = 1 - u;
            t.position.set(v * v * from.x + 2 * v * u * mx + u * u * to.x, v * v * lift + 2 * v * u * my + u * u * to.y);
          },
        },
        launch,
      );
      tl.to(t.scale, { x: k * 0.35, y: k * 0.35, duration: flight, ease: 'power2.in' }, '<');
      tl.to(t, { alpha: 0, duration: 0.08 * speed }, `>-${0.08 * speed}`);
      tl.call(() => resolve(), [], `>-${0.04 * speed}`);
      if (opts.onLaunch) tl.call(opts.onLaunch, [], launch);
      this.timelines.set(t, tl);
    });
  }

  /**
   * The win box takes a hit: it appears on the first one, counts up to `amount` and grows a
   * notch with every hit (up to `GROW.max`), so the total swells as the lines come in.
   */
  hitWin(amount: number, speed = 1): void {
    if (this.boxUp()) void this.winBox.countTo(amount, { duration: 0.35, speed });
    else void this.winBox.show(amount, { duration: 0.35, speed });
    this.grow = Math.min(GROW.max, this.grow + GROW.step);
    this.growTween?.kill();
    const punch = this.grow * 1.08;
    this.growTween = gsap
      .timeline()
      .to(this.winBox.scale, { x: punch, y: punch, duration: 0.09 * speed, ease: 'power2.out' })
      .to(this.winBox.scale, { x: this.grow, y: this.grow, duration: 0.22 * speed, ease: 'back.out(1.6)' });
  }

  /** The hits are in: a beat for the box to settle at its grown size (it shrinks back when it hides). */
  async settleWin(speed = 1): Promise<void> {
    await new Promise((r) => gsap.delayedCall(0.3 * speed, r));
  }

  /** Float a win amount over a group of cells (screen rects, e.g. `scene.cellRect`). */
  winLabel(rects: Rect[], text: string): void {
    if (!rects.length) return;
    const cx = rects.reduce((s, r) => s + r.x + r.w / 2, 0) / rects.length;
    const cy = rects.reduce((s, r) => s + r.y + r.h / 2, 0) / rects.length;
    const at = this.area.toLocal({ x: cx, y: cy });
    const t = lineWinLabel(text);
    t.scale.set(LINE_WIN.scale[this.area.orientation]);
    t.position.set(at.x, at.y);
    t.alpha = 0;
    this.labels.addChild(t);
    const tl = gsap.timeline({
      onComplete: () => {
        this.timelines.delete(t);
        t.destroy({ children: true });
      },
    });
    tl.to(t, { alpha: 1, duration: 0.15 }).to(t, { y: at.y - LINE_WIN.rise, duration: 0.9, ease: 'power1.out' }, 0).to(t, { alpha: 0, duration: 0.3 }, 0.75);
    this.timelines.set(t, tl);
  }

  clear(): void {
    for (const [t, tl] of this.timelines) {
      tl.kill();
      t.destroy({ children: true });
    }
    this.timelines.clear();
    this.labels.removeChildren();
  }

  /** The win box is showing (not hidden, not fading out). */
  private boxUp(): boolean {
    return this.winBox.visible && this.winBox.alpha > 0.5;
  }
}
