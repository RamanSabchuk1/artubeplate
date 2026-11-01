// Bonus screens: the rules of a bonus before it plays, and the total after it. Each is a scene over
// a grey, softened freeze-frame of whatever was on screen when it arrived, with big outlined type
// and "click to continue"; `done` resolves when the player continues (or by itself after
// `autoContinueMs`, for autoplay and replays). The first click while the screen is still animating
// finishes the animation (the count of a total); the next one continues.
//
//   const rules = new BonusIntroScene({ director, title: 'Paw Parade', headline: 'You won 12 free spins!', body });
//   director.add(rules);
//   await director.go(rules.id, { transition: shader('fade', { duration: 0.6 }) });
//   await rules.done;
//   await director.go('game', { transition: shader('dissolve') });   // into the bonus
//   …
//   const total = new TotalWinScene({ director, amount: 46.8, format: hud.format, note: '9 free spins played' });
//
// While a screen is up the director's foreground (the logo) steps aside, in step with the
// transition's swap. Everything is laid out in a SmartContainer canvas: 1920×1080 in landscape,
// 1080×1920 in portrait.

import { BlurFilter, ColorMatrixFilter, Container, Graphics, Rectangle, Sprite, Text, type ColorMatrix, type Texture } from 'pixi.js';
import { gsap } from 'gsap';
import { SceneContainer } from './SceneContainer';
import { SmartContainer } from './SmartContainer';
import { SmartViewport } from './smart';
import type { SceneDirector } from './director';
import { drawPanel, label } from '../ui/components';
import { typography } from '../ui/typography';

export interface PromptSceneOptions {
  /** The director: what it shows when this scene arrives becomes the grey backdrop, and its
   *  foreground (the logo) steps aside while the scene is up. Without it: a plain dark screen. */
  director?: SceneDirector;
  /** The freeze-frame's look: `saturation` 0 (black and white) to 1, `brightness`, `blur`.
   *  Default `{ saturation: 0, brightness: 0.6, blur: 3 }`. */
  backdrop?: { saturation?: number; brightness?: number; blur?: number };
  /** Default "Click to continue" ("Tap to continue" on touch screens). */
  continueLabel?: string;
  /** Continue by itself this long after the prompt shows (autoplay, replays). Default: wait. */
  autoContinueMs?: number;
}

/** A 4×5 colour matrix: grey by `saturation` (0 = none left), then scaled by `brightness`. */
function grade(saturation: number, brightness: number): ColorMatrix {
  const [lr, lg, lb] = [0.2126, 0.7152, 0.0722];
  const k = 1 - saturation;
  const row = (own: number): number[] => [lr * k + (own === 0 ? saturation : 0), lg * k + (own === 1 ? saturation : 0), lb * k + (own === 2 ? saturation : 0)].map((v) => v * brightness);
  return [...row(0), 0, 0, ...row(1), 0, 0, ...row(2), 0, 0, 0, 0, 0, 1, 0] as unknown as ColorMatrix;
}

/** Scale `holder` down (never up) so `content` is at most `max` design units wide. */
function fitWidth(holder: Container, content: Container, max: number, k = 1): void {
  const w = content.width / Math.max(1e-6, Math.abs(content.scale.x));
  holder.scale.set(Math.min(k, (max / Math.max(1, w)) * k));
}

/**
 * The shared part of a "click to continue" screen: the freeze-frame backdrop, the canvas, the
 * prompt, input, auto-continue. Subclasses build their parts, `arrange` them per orientation and
 * `choreograph` their entrance (returning the time the prompt shows).
 */
export abstract class PromptScene extends SceneContainer {
  /** Resolves when the player continues. */
  readonly done: Promise<void>;
  /** Everything but the backdrop, in design units (1920×1080 / 1080×1920). */
  protected readonly canvas: SmartContainer;
  protected readonly promptPart = new Container({ label: 'prompt' });
  protected readonly prompt: Text;
  protected ready = false;
  private readonly viewport: SmartViewport;
  private size = { width: 1920, height: 1080 };
  private readonly dark = new Graphics();
  private backdrop: Sprite | null = null;
  private backdropTexture: Texture | null = null;
  private stepAside: Array<{ layer: Container; visible: boolean }> = [];
  private resolveDone!: () => void;
  private finished = false;
  private timeline: gsap.core.Timeline | null = null;
  private autoContinue: gsap.core.Tween | null = null;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    // Capture phase: the HUD must not read this key as a spin.
    e.preventDefault();
    e.stopPropagation();
    this.press();
  };

  constructor(
    id: string,
    private readonly base: PromptSceneOptions,
  ) {
    super(id);
    this.done = new Promise((resolve) => (this.resolveDone = resolve));
    this.viewport = new SmartViewport(() => ({ x: 0, y: 0, width: this.size.width, height: this.size.height }));
    this.canvas = SmartContainer.canvas({ portrait: [1080, 1920], landscape: [1920, 1080] }, { viewport: this.viewport, label: `${id}-canvas` });
    const touch = typeof window !== 'undefined' && 'ontouchstart' in window;
    this.prompt = label('prompt', base.continueLabel ?? (touch ? 'Tap to continue' : 'Click to continue'));
    this.promptPart.addChild(this.prompt);
    this.canvas.addChild(this.promptPart);
    this.addChild(this.dark, this.canvas);
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', () => this.press());
  }

  /** Place the parts for an orientation (design units of the canvas). */
  protected abstract arrange(portrait: boolean): void;
  /** Animate the parts in on `tl`; return the time (s) the prompt shows. */
  protected abstract choreograph(tl: gsap.core.Timeline): number;
  /** Put the parts in their before-entrance state (called before the transition reveals them). */
  protected abstract prime(): void;

  override resize(width: number, height: number): void {
    this.size = { width, height };
    super.resize(width, height);
    this.hitArea = new Rectangle(0, 0, width, height);
    this.dark.clear().rect(0, 0, width, height).fill({ color: 0x050608, alpha: this.base.director ? 1 : 0.86 });
    this.coverBackdrop();
    this.viewport.refresh(true);
    this.arrange(this.canvas.orientation === 'portrait');
  }

  async enter(): Promise<void> {
    this.captureBackdrop();
    this.prompt.alpha = 0;
    this.prime();
  }

  attached(): void {
    const fg = this.base.director?.foreground;
    if (fg) {
      this.stepAside = [{ layer: fg, visible: fg.visible }];
      fg.visible = false;
    }
  }

  detached(): void {
    for (const s of this.stepAside) s.layer.visible = s.visible;
    this.stepAside = [];
  }

  entered(): void {
    window.addEventListener('keydown', this.onKey, { capture: true });
    const tl = (this.timeline = gsap.timeline());
    const at = this.choreograph(tl);
    tl.to(this.prompt, { alpha: 1, duration: 0.35, ease: 'none' }, at);
    tl.call(() => this.becomeReady(), [], at);
  }

  leave(): void {
    this.ready = false;
    this.autoContinue?.kill();
    gsap.killTweensOf(this.prompt);
  }

  left(): void {
    window.removeEventListener('keydown', this.onKey, { capture: true });
    this.timeline?.kill();
    this.autoContinue?.kill();
    gsap.killTweensOf(this.prompt);
    this.backdropTexture?.destroy(true);
    this.backdropTexture = null;
    this.destroy({ children: true, context: true });
  }

  /** What a click, a tap, Space or Enter does: finish the entrance first, then continue. */
  press(): void {
    if (this.finished) return;
    if (!this.ready) {
      this.timeline?.progress(1);
      return;
    }
    this.finish();
  }

  /** Continue now. */
  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.ready = false;
    this.autoContinue?.kill();
    this.resolveDone();
  }

  private becomeReady(): void {
    if (this.finished) return;
    this.ready = true;
    gsap.to(this.prompt, { alpha: 0.35, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
    const ms = this.base.autoContinueMs;
    if (ms !== undefined) this.autoContinue = gsap.delayedCall(Math.max(0, ms) / 1000, () => this.finish());
  }

  /** Freeze what the director shows (without its foreground), grey and soften it, bake it once. */
  private captureBackdrop(): void {
    const d = this.base.director;
    if (!d || this.backdrop) return;
    const renderer = d.app.renderer;
    const { width, height } = d.app.screen;
    const frame = new Rectangle(0, 0, width, height);
    const shot = d.snapshot({ foreground: false });
    const o = this.base.backdrop ?? {};
    const colour = new ColorMatrixFilter();
    colour.matrix = grade(o.saturation ?? 0, o.brightness ?? 0.6);
    const raw = new Sprite(shot);
    const blur = o.blur ?? 3;
    raw.filters = blur > 0 ? [new BlurFilter({ strength: blur, quality: 3 }), colour] : [colour];
    // Bake: a filter would otherwise run every frame for a picture that never changes.
    this.backdropTexture = renderer.generateTexture({ target: raw, frame, resolution: renderer.resolution });
    const filters = raw.filters ?? [];
    raw.destroy();
    for (const f of filters) f.destroy();
    shot.destroy(true);
    this.backdrop = new Sprite(this.backdropTexture);
    this.addChildAt(this.backdrop, 1);
    this.coverBackdrop();
  }

  /** The freeze-frame covers the screen (a resize while it is up just scales it). */
  private coverBackdrop(): void {
    const b = this.backdrop;
    if (!b || !this.backdropTexture) return;
    const { width, height } = this.size;
    const k = Math.max(width / this.backdropTexture.width, height / this.backdropTexture.height) * 1.02; // hide the blur's soft rim
    b.scale.set(k);
    b.position.set((width - this.backdropTexture.width * k) / 2, (height - this.backdropTexture.height * k) / 2);
  }
}

// ── the rules of a bonus ──────────────────────────────────────────────────────

export interface BonusIntroOptions extends PromptSceneOptions {
  /** The bonus's name, big: "Free spins", "Paw Parade". */
  title: string;
  /** Art for the title instead of the text (word art, a logo), centred on its origin. */
  titleArt?: Container;
  /** The award: "You won 12 free spins!" */
  headline?: string;
  /** What the bonus does, a paragraph each (on a dark card). */
  body?: string[];
  /** Art either side of the card (characters, symbols), centred on their origin. Portrait puts
   *  them under the card. */
  left?: Container;
  right?: Container;
}

export class BonusIntroScene extends PromptScene {
  private readonly titlePart = new Container({ label: 'title' });
  private readonly titleText: Container;
  private readonly cardPart = new Container({ label: 'card' });
  private readonly cardBody = new Container();
  private readonly panel = new Graphics();
  private readonly headlineText: Text | null;
  private readonly bodyText: Text | null;
  private readonly leftPart = new Container({ label: 'art-left' });
  private readonly rightPart = new Container({ label: 'art-right' });

  constructor(private readonly opts: BonusIntroOptions) {
    super('bonus-intro', opts);
    this.titleText = opts.titleArt ?? label('bigWin', opts.title, { fontSize: 150 });
    this.titlePart.addChild(this.titleText);
    // The headline wraps inside the card (960 wide, 56 padding), centred, so a long one never runs past it.
    this.headlineText = opts.headline ? label('title', opts.headline, { fontSize: 54, wordWrap: true, wordWrapWidth: 848, align: 'center' }) : null;
    this.bodyText = opts.body?.length ? label('body', opts.body.join('\n\n'), { fontSize: 34, fill: typography().fill, wordWrap: true, wordWrapWidth: 820 }) : null;
    this.cardBody.addChild(this.panel, ...[this.headlineText, this.bodyText].filter((t): t is Text => !!t));
    this.cardPart.addChild(this.cardBody);
    if (opts.left) this.leftPart.addChild(opts.left);
    if (opts.right) this.rightPart.addChild(opts.right);
    this.canvas.addChild(this.leftPart, this.rightPart, this.cardPart, this.titlePart);
    this.drawCard();
  }

  private drawCard(): void {
    const w = 960;
    const pad = 56;
    const gap = 30;
    const hh = this.headlineText?.height ?? 0;
    const bh = this.bodyText?.height ?? 0;
    const h = pad * 2 + hh + (hh && bh ? gap : 0) + bh;
    drawPanel(this.panel.clear(), -w / 2, -h / 2, w, h, 'card');
    let y = -h / 2 + pad;
    if (this.headlineText) {
      this.headlineText.y = y + hh / 2;
      y += hh + gap;
    }
    if (this.bodyText) this.bodyText.y = y + bh / 2;
  }

  protected arrange(portrait: boolean): void {
    const cardH = this.cardBody.height;
    if (portrait) {
      this.titlePart.position.set(540, 330);
      fitWidth(this.titlePart, this.titleText, 980, 0.9);
      this.cardPart.position.set(540, 860);
      this.cardPart.scale.set(Math.min(1, 1000 / 960, 900 / Math.max(1, cardH)));
      const below = 860 + (cardH * this.cardPart.scale.y) / 2 + 250;
      this.leftPart.position.set(290, Math.min(1520, below));
      this.rightPart.position.set(790, Math.min(1520, below));
      for (const p of [this.leftPart, this.rightPart]) this.fitArt(p, 380);
      this.promptPart.position.set(540, 1780);
      this.promptPart.scale.set(1.25);
    } else {
      this.titlePart.position.set(960, 175);
      fitWidth(this.titlePart, this.titleText, 1700);
      // The card fills the room between the title and the prompt, never more.
      const k = Math.min(1, 560 / Math.max(1, cardH));
      this.cardPart.scale.set(k);
      this.cardPart.position.set(960, 325 + (cardH * k) / 2);
      this.leftPart.position.set(300, 600);
      this.rightPart.position.set(1620, 600);
      for (const p of [this.leftPart, this.rightPart]) this.fitArt(p, 400);
      this.promptPart.position.set(960, 985);
      this.promptPart.scale.set(1);
    }
  }

  private fitArt(part: Container, size: number): void {
    const art = part.children[0];
    if (!art) return;
    part.scale.set(1);
    const b = art.getLocalBounds();
    part.scale.set(Math.min(size / Math.max(1, b.width), size / Math.max(1, b.height)));
  }

  protected prime(): void {
    this.titleText.alpha = 0;
    this.cardBody.alpha = 0;
    for (const p of [this.leftPart, this.rightPart]) if (p.children[0]) p.children[0].alpha = 0;
  }

  protected choreograph(tl: gsap.core.Timeline): number {
    // The name slams in, the card rises into place, the art slides in from the sides.
    tl.fromTo(this.titleText.scale, { x: 1.45, y: 1.45 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(1.4)' }, 0);
    tl.to(this.titleText, { alpha: 1, duration: 0.2, ease: 'none' }, 0);
    tl.fromTo(this.cardBody, { y: 70 }, { y: 0, duration: 0.5, ease: 'power3.out' }, 0.25);
    tl.to(this.cardBody, { alpha: 1, duration: 0.35, ease: 'none' }, 0.25);
    const art = [this.leftPart.children[0], this.rightPart.children[0]];
    art.forEach((a, i) => {
      if (!a) return;
      tl.fromTo(a, { x: i === 0 ? -160 : 160 }, { x: 0, duration: 0.55, ease: 'back.out(1.3)' }, 0.35);
      tl.to(a, { alpha: 1, duration: 0.3, ease: 'none' }, 0.35);
    });
    return 0.95;
  }
}

// ── the total after a bonus ───────────────────────────────────────────────────

export interface TotalWinOptions extends PromptSceneOptions {
  /** The bonus's total, in money. */
  amount: number;
  /** Formats it (the HUD's currency formatter). */
  format: (value: number) => string;
  /** Default "Total win". */
  title?: string;
  /** Art for the title instead of the text (word art), centred on its origin. */
  titleArt?: Container;
  /** The line under the amount: "9 free spins played". */
  note?: string;
  /** Art (characters), centred on its origin. */
  art?: Container;
  /** Where the art goes: `behind` the amount (default), or at the `side` (beside the type on a
   *  wide screen, under it on a phone): for a character that should not cover the numbers. */
  artAt?: 'behind' | 'side';
  /** Seconds the amount counts up. Default 1.6; 0 shows it at once. */
  countSeconds?: number;
}

export class TotalWinScene extends PromptScene {
  private readonly titlePart = new Container({ label: 'title' });
  private readonly titleText: Container;
  private readonly amountPart = new Container({ label: 'amount' });
  private readonly amountText: Text;
  private readonly notePart = new Container({ label: 'note' });
  private readonly noteText: Text | null;
  private readonly artPart = new Container({ label: 'art' });
  /** The amount's width when counted up, so the count never changes its size. */
  private readonly finalWidth: number;

  constructor(private readonly opts: TotalWinOptions) {
    super('total-win', opts);
    this.titleText = opts.titleArt ?? label('bigWin', opts.title ?? 'Total win', { fontSize: 150 });
    this.titlePart.addChild(this.titleText);
    this.amountText = label('bigWinAmount', opts.format(opts.amount), { fontSize: 200 });
    this.finalWidth = this.amountText.width;
    this.amountText.text = opts.format(0);
    this.amountPart.addChild(this.amountText);
    this.noteText = opts.note ? label('heading', opts.note, { fontSize: 50 }) : null;
    if (this.noteText) this.notePart.addChild(this.noteText);
    if (opts.art) this.artPart.addChild(opts.art);
    this.canvas.addChild(this.artPart, this.titlePart, this.amountPart, this.notePart);
  }

  protected arrange(portrait: boolean): void {
    const amountFit = (max: number, k: number): void => {
      this.amountPart.scale.set(Math.min(k, (max / Math.max(1, this.finalWidth)) * k));
    };
    if (portrait) {
      this.titlePart.position.set(540, 560);
      fitWidth(this.titlePart, this.titleText, 980, 0.9);
      this.artPart.position.set(540, this.opts.artAt === 'side' ? 1420 : 760);
      this.amountPart.position.set(540, 900);
      amountFit(1000, 0.9);
      this.notePart.position.set(540, 1100);
      if (this.noteText) fitWidth(this.notePart, this.noteText, 980);
      this.promptPart.position.set(540, 1780);
      this.promptPart.scale.set(1.25);
    } else {
      this.titlePart.position.set(960, 250);
      fitWidth(this.titlePart, this.titleText, 1700);
      // Beside the amount, the art needs the amount to leave it room: a wide amount (a currency
      // with big numbers) is fitted to the space left of the art instead of running under it.
      const side = this.opts.artAt === 'side';
      this.artPart.position.set(side ? 1660 : 960, side ? 590 : 470);
      this.amountPart.position.set(side ? 880 : 960, 590);
      amountFit(side ? 1080 : 1700, 1);
      this.notePart.position.set(960, 790);
      if (this.noteText) fitWidth(this.notePart, this.noteText, 1700);
      this.promptPart.position.set(960, 985);
      this.promptPart.scale.set(1);
    }
  }

  protected prime(): void {
    this.titleText.alpha = 0;
    this.amountText.alpha = 0;
    if (this.noteText) this.noteText.alpha = 0;
    const art = this.artPart.children[0];
    if (art) art.alpha = 0;
  }

  protected choreograph(tl: gsap.core.Timeline): number {
    const { amount, format } = this.opts;
    const count = Math.max(0, this.opts.countSeconds ?? 1.6);
    tl.fromTo(this.titleText.scale, { x: 1.45, y: 1.45 }, { x: 1, y: 1, duration: 0.45, ease: 'back.out(1.4)' }, 0);
    tl.to(this.titleText, { alpha: 1, duration: 0.2, ease: 'none' }, 0);
    const art = this.artPart.children[0];
    if (art) tl.to(art, { alpha: 1, duration: 0.4, ease: 'none' }, 0.15);
    tl.fromTo(this.amountText.scale, { x: 0.6, y: 0.6 }, { x: 1, y: 1, duration: 0.4, ease: 'back.out(1.8)' }, 0.25);
    tl.to(this.amountText, { alpha: 1, duration: 0.2, ease: 'none' }, 0.25);
    const o = { v: 0 };
    tl.to(o, { v: amount, duration: count, ease: 'power2.out', onUpdate: () => void (this.amountText.text = format(o.v)) }, 0.3);
    const end = 0.3 + count;
    tl.call(() => void (this.amountText.text = format(amount)), [], end);
    tl.to(this.amountText.scale, { x: 1.12, y: 1.12, duration: 0.12, yoyo: true, repeat: 1, ease: 'power1.out' }, end);
    if (this.noteText) tl.to(this.noteText, { alpha: 1, duration: 0.35, ease: 'none' }, end + 0.1);
    return end + 0.3;
  }
}
