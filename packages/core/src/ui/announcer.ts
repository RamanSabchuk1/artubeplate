// The universal win announcer: BIG WIN → MEGA WIN → EPIC WIN, counted up. The amount climbs
// through every tier the win reaches; each new tier slams its title in (text, or your art) and
// calls `onTier` (confetti, a sound, a mascot cheer). A tap or a slam-stop `skip()`s to the final
// tier and amount, which hold briefly and fade.
//
//   const announcer = new WinAnnouncer({ format: hud.format, onTier: (t) => fx.burst('confetti', top) });
//   area.pinChildAt(announcer, PINS.banner);       // it animates an inner body, so pins can size it
//   if (announcer.tierFor(x) >= 0) await announcer.play(totalWin, x, { speed: turbo.speed });
//
// Custom look: `tiers: [{ at: 20, title: 'Nice', art: () => sprite('word-big') }, …]`, `shade`
// for the dark oval, `titleRole`/`amountRole` for the type.

import { Container, FillGradient, Graphics, Text, type TextStyleOptions } from 'pixi.js';
import { gsap } from 'gsap';
import { label } from './components';
import type { TextRole } from './typography';

export interface WinTier {
  /** The smallest win (× bet) that reaches this tier. */
  at: number;
  /** The title, as text (used when there is no `art`). */
  title: string;
  /** Art for the title instead of the text: a centred Container (word art, a Spine). Built when the tier shows. */
  art?: () => Container;
}

export const DEFAULT_WIN_TIERS: readonly WinTier[] = Object.freeze([
  { at: 15, title: 'Big win' },
  { at: 50, title: 'Mega win' },
  { at: 200, title: 'Epic win' },
]);

export interface WinAnnouncerOptions {
  /** Formats the amount (the HUD's currency formatter). */
  format: (amount: number) => string;
  /** Lowest first. Default BIG 15× · MEGA 50× · EPIC 200×. */
  tiers?: readonly WinTier[];
  /** Seconds the count spends climbing through each tier. Default 1.3. */
  tierSeconds?: number;
  /** Seconds it holds on the final amount. Default 1.4. */
  holdSeconds?: number;
  /** Seconds it holds on the final amount after a `skip()`. Default 0.8. */
  skipHoldSeconds?: number;
  /** A soft dark oval behind it. Default true. */
  shade?: boolean;
  /** The amount's role. Default `bigWinAmount`. */
  amountRole?: TextRole;
  /** Overrides for the amount's style (a bigger `fontSize`, another `fill`). */
  amountStyle?: Partial<TextStyleOptions>;
  /** The text title's role. Default `bigWin`. */
  titleRole?: TextRole;
  /** The count entered tier `index` (FX and sounds hook in here). */
  onTier?: (tier: WinTier, index: number) => void;
  /** The count finished (a last burst, a cheer). */
  onCounted?: (amount: number) => void;
}

/** The highest tier a win of `x` × bet reaches in `tiers` (sorted lowest first); -1 below the first. */
export function winTierIndex(tiers: readonly WinTier[], x: number): number {
  let t = -1;
  tiers.forEach((tier, i) => {
    if (x >= tier.at) t = i;
  });
  return t;
}

let shadeFill: FillGradient | null = null;
const shadeGradient = (): FillGradient =>
  (shadeFill ??= new FillGradient({
    type: 'radial',
    center: { x: 0.5, y: 0.5 },
    innerRadius: 0,
    outerCenter: { x: 0.5, y: 0.5 },
    outerRadius: 0.5,
    colorStops: [
      { offset: 0, color: 'rgba(0,0,0,0.74)' },
      { offset: 0.6, color: 'rgba(0,0,0,0.5)' },
      { offset: 1, color: 'rgba(0,0,0,0)' },
    ],
    textureSpace: 'local',
  }));

export class WinAnnouncer extends Container {
  private readonly body = new Container({ label: 'announcer-body' });
  private readonly shade = new Graphics();
  private readonly titleHolder = new Container({ label: 'title' });
  private readonly amount: Text;
  private readonly tiers: readonly WinTier[];
  private tl: gsap.core.Timeline | null = null;
  private current = -1;
  /** The highest tier whose `onTier` has fired in this announcement. */
  private announced = -1;
  /** The final amount is on screen and `onCounted` has fired. */
  private counted = false;
  /** Where a skip lands: the final tier and amount, at this announcement's speed. */
  private landing: { amount: number; top: number; speed: number } | null = null;
  private resolveDone: (() => void) | null = null;

  constructor(private readonly opts: WinAnnouncerOptions) {
    super({ label: 'win-announcer' });
    this.tiers = [...(opts.tiers ?? DEFAULT_WIN_TIERS)].sort((a, b) => a.at - b.at);
    this.amount = label(opts.amountRole ?? 'bigWinAmount', opts.format(0), opts.amountStyle);
    this.body.addChild(this.shade, this.titleHolder, this.amount);
    this.addChild(this.body);
    this.visible = false;
  }

  /** The highest tier a win of `x` × bet reaches (-1: below the first). */
  tierFor(x: number): number {
    return winTierIndex(this.tiers, x);
  }

  /** Count `amount` (money) up for a win of `x` × bet. Resolves when the announcement is over. */
  play(amount: number, x: number, opts: { speed?: number } = {}): Promise<void> {
    const top = this.tierFor(x);
    if (top < 0) return Promise.resolve();
    this.stop();
    const speed = opts.speed ?? 1;
    const per = (this.opts.tierSeconds ?? 1.3) * speed;
    const hold = (this.opts.holdSeconds ?? 1.4) * speed;
    const unit = x > 0 ? amount / x : 0; // the bet
    this.visible = true;
    this.alpha = 0;
    this.current = -1;
    this.announced = -1;
    this.counted = false;
    this.landing = { amount, top, speed };
    this.showTier(0, false);
    this.amount.text = this.opts.format(0);
    this.layoutBody();
    return new Promise((resolve) => {
      this.resolveDone = resolve;
      const o = { v: 0 };
      const tl = (this.tl = gsap.timeline({ onComplete: () => this.finish() }));
      tl.to(this, { alpha: 1, duration: 0.18 * speed }, 0);
      tl.fromTo(this.body.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.4 * speed, ease: 'back.out(1.8)' }, 0);
      // Climb: each tier's segment ends where the next tier starts (the last one at the amount).
      for (let i = 0; i <= top; i++) {
        const to = i < top ? this.tiers[i + 1]!.at * unit : amount;
        tl.to(o, { v: to, duration: per, ease: i < top ? 'none' : 'power2.out', onUpdate: () => void (this.amount.text = this.opts.format(o.v)) });
        if (i < top) tl.call(() => this.showTier(i + 1, true));
      }
      tl.call(() => this.markCounted());
      this.outro(tl, hold, speed);
      // The first tier announces itself as the count starts.
      tl.call(() => this.announce(0), [], 0.05);
    });
  }

  /**
   * Hurry to the end (a tap, a slam-stop). During the count it lands on the final tier and
   * amount at once: the final tier slams in and calls `onTier` (the tiers it jumps over stay
   * silent), then the amount holds for `skipHoldSeconds` × speed and fades. After the count it
   * ends the announcement.
   */
  skip(): void {
    const tl = this.tl;
    const landing = this.landing;
    if (!tl || !landing) return;
    if (this.counted) {
      tl.progress(1);
      return;
    }
    tl.kill();
    this.alpha = 1;
    this.body.scale.set(1);
    this.showTier(landing.top, true);
    this.announce(landing.top);
    this.markCounted();
    const outro = (this.tl = gsap.timeline({ onComplete: () => this.finish() }));
    this.outro(outro, (this.opts.skipHoldSeconds ?? 0.8) * landing.speed, landing.speed);
  }

  /** Hide at once (the round moved on). */
  stop(): void {
    this.tl?.kill();
    this.tl = null;
    this.landing = null;
    this.visible = false;
    this.resolveDone?.();
    this.resolveDone = null;
  }

  private finish(): void {
    this.tl = null;
    this.landing = null;
    this.visible = false;
    const done = this.resolveDone;
    this.resolveDone = null;
    done?.();
  }

  /** The final amount pulses, holds for `hold` seconds, and the announcer fades out. */
  private outro(tl: gsap.core.Timeline, hold: number, speed: number): void {
    tl.to(this.amount.scale, { x: 1.14, y: 1.14, duration: 0.14, yoyo: true, repeat: 1, ease: 'power1.out' });
    tl.to({}, { duration: hold });
    tl.to(this, { alpha: 0, duration: 0.25 * speed });
  }

  /** Put the final amount up and call `onCounted`, once per announcement. */
  private markCounted(): void {
    const landing = this.landing;
    if (this.counted || !landing) return;
    this.counted = true;
    this.amount.text = this.opts.format(landing.amount);
    this.opts.onCounted?.(landing.amount);
  }

  /** Call `onTier` for tier `i`, once, and never for a tier below one already announced. */
  private announce(i: number): void {
    if (i <= this.announced) return;
    this.announced = i;
    this.opts.onTier?.(this.tiers[i]!, i);
  }

  private showTier(i: number, slam: boolean): void {
    if (i === this.current) return;
    this.current = i;
    const tier = this.tiers[i]!;
    this.titleHolder.removeChildren().forEach((c) => c.destroy({ children: true }));
    const title = tier.art ? tier.art() : label(this.opts.titleRole ?? 'bigWin', tier.title);
    this.titleHolder.addChild(title);
    this.layoutBody();
    if (slam) {
      gsap.fromTo(this.titleHolder.scale, { x: 1.7, y: 1.7 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(2.2)', overwrite: true });
      gsap.fromTo(this.titleHolder, { rotation: -0.12 }, { rotation: 0, duration: 0.6, ease: 'elastic.out(1, 0.4)', overwrite: true });
      this.announce(i);
    }
  }

  /** Title over amount, centred on the origin, the shade behind both. */
  private layoutBody(): void {
    const th = this.titleHolder.height / Math.max(1e-6, this.titleHolder.scale.y);
    const ah = this.amount.height / Math.max(1e-6, this.amount.scale.y);
    const gap = 10;
    const h = th + gap + ah;
    // The title's art is centred on its origin: put its centre at the top half.
    this.titleHolder.y = -h / 2 + th / 2;
    this.amount.y = h / 2 - ah / 2;
    this.shade.clear();
    if (this.opts.shade !== false) {
      const w = Math.max(this.titleHolder.width, this.amount.width) + 300;
      this.shade.ellipse(0, 0, w / 2, (h + 200) / 2).fill(shadeGradient());
    }
  }
}
