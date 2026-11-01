// IntroScene: the info screen between the loader and the game — feature cards, "click to
// continue", an optional "don't show again". Its choreography follows the classic studio intro:
//
//   0.15s  the cards spin in, staggered (scale from nothing with a back-out, unwinding a turn)
//   0.85s  the extras and the logo drop in from above
//   1.50s  the prompt fades up; only now does a click (or Space / Enter) continue
//   exit   the cards, extras and prompt fade out (0.34s) — `outro`, so `morph()` can play it
//          and the next scene's `intro` (a board scaling in) follows while the background and
//          the logo stay put
//
// Cards are either descriptors (drawn for you: art, title, text) or your own pixi Containers —
// atlas frames plus Text, centred on their origin so they spin around it. Landscape lays them out
// in a row; portrait shows one at a time and rotates them. Everything is placed in a design frame
// (1920×1080, or 1080×1920 in portrait), like the rest of a slot's art.

import { Assets, Container, Graphics, Rectangle, Sprite, Text, type Texture } from 'pixi.js';
import { gsap } from 'gsap';
import { SceneContainer, dropIn, fadeIn, fadeOut, popIn, type Fit } from './SceneContainer';
import { drawPanel, label, type PanelStyle } from '../ui/components';
import { textStyle } from '../ui/typography';

export interface IntroSlide {
  title: string;
  text: string;
  /** Card art: a URL, a data URI, or an alias already in Pixi's cache (`sym-W`, a spritesheet frame). */
  image?: string;
  /** Shown big in place of art, e.g. `"5,000×"`. */
  badge?: string;
}

export interface IntroSceneOptions {
  /** Feature cards: descriptors, or your own Containers centred on their origin. Up to three. */
  cards: Array<IntroSlide | Container>;
  /** Pieces that drop in after the cards (a volatility strip, a tagline). Faded out with the intro. */
  extras?: Container[];
  /** A persistent logo (e.g. in `director.foreground`): dropped in with the extras, kept after. */
  logo?: Container;
  /** A title drawn by the intro itself — for games without a persistent logo. */
  title?: string;
  subtitle?: string;
  /** Default: "CLICK TO CONTINUE" (or "TAP TO CONTINUE" on touch devices). */
  continueLabel?: string;
  /** Offer "Don't show again", remembered in localStorage under `key`. */
  dontShowAgain?: { key: string; label?: string } | false;
  /** The check mark and the lit carousel dot. Default white. */
  accent?: number;
  /** Card look (default: the `card` panel — near-black with a crisp light border). */
  card?: Partial<PanelStyle>;
  /** Portrait carousel: seconds per card. Default 2.6. */
  rotateEvery?: number;
  /** Card width in design units (custom cards are scaled to it). Default 480 / 760 (portrait). */
  cardWidth?: number;
}

const LANDSCAPE = { width: 1920, height: 1080 };
const PORTRAIT = { width: 1080, height: 1920 };
const LAYOUT = {
  landscape: { title: 150, subtitle: 225, extras: 285, cards: 625, cardH: 560, img: 280, gap: 60, prompt: 975, check: 1035 },
  portrait: { title: 250, subtitle: 340, extras: 430, cards: 1010, cardH: 900, img: 470, gap: 0, prompt: 1650, check: 1745 },
};

const isSlide = (c: IntroSlide | Container): c is IntroSlide => !(c instanceof Container);

/** Screen pixels per local unit of `parent` (1 when it has none). */
function screenScale(parent: Container | null): number {
  if (!parent) return 1;
  const a = parent.toGlobal({ x: 0, y: 0 });
  const b = parent.toGlobal({ x: 0, y: 100 });
  return Math.abs(b.y - a.y) / 100 || 1;
}

export class IntroScene extends SceneContainer {
  /** Resolves when the player continues. */
  readonly done: Promise<void>;

  /** The player ticked "Don't show again" for this key before. */
  static dismissed(key: string): boolean {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  }

  private resolveDone!: () => void;
  private finished = false;
  /** Clicks count once the prompt is up. */
  private ready = false;
  private dontShow = false;
  private textures: Array<Texture | null> = [];
  private cards: Container[] = [];
  private baseScale: number[] = [];
  private extras: Container[];
  private title: Text | null = null;
  private subtitle: Text | null = null;
  private prompt: Text | null = null;
  private check: Container | null = null;
  private dots: Graphics[] = [];
  private portrait: boolean | null = null;
  private page = 0;
  private carousel: gsap.core.Tween | null = null;
  private timeline: gsap.core.Timeline | null = null;
  private readonly onKey = (e: KeyboardEvent): void => {
    if (e.code !== 'Space' && e.code !== 'Enter' && e.code !== 'NumpadEnter') return;
    // Capture phase: the HUD must not read this key as a spin.
    e.preventDefault();
    e.stopPropagation();
    this.finish();
  };

  constructor(private readonly opts: IntroSceneOptions) {
    super('intro');
    this.extras = opts.extras ?? [];
    this.done = new Promise((resolve) => (this.resolveDone = resolve));
    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', () => this.finish());
  }

  async enter(): Promise<void> {
    // A card's `image` may be a URL or an alias already in Pixi's cache (a spritesheet frame): cache first.
    const art = (image: string): Promise<Texture | null> => (Assets.cache.has(image) ? Promise.resolve(Assets.get<Texture>(image)) : Assets.load<Texture>(image).catch(() => null));
    this.textures = await Promise.all(this.opts.cards.slice(0, 3).map((c) => (isSlide(c) && c.image ? art(c.image) : Promise.resolve(null))));
    this.layout(this.fit);
  }

  entered(): void {
    window.addEventListener('keydown', this.onKey, { capture: true });
    const tl = (this.timeline = gsap.timeline());
    popIn(tl, this.cards.filter((c) => c.visible), { at: 0.15, stagger: 0.12 });
    const drop = 260 * this.fit.scale; // screen pixels
    if (this.extras.length) dropIn(tl, this.extras, { at: 0.85, distance: drop });
    const logo = this.opts.logo;
    if (logo) {
      logo.visible = true;
      // The logo lives in another layer (often a SmartContainer): the same drop in its units.
      dropIn(tl, logo, { at: 0.85, distance: drop / screenScale(logo.parent) });
    }
    const tail = [this.prompt, this.check, ...this.dots].filter((x): x is NonNullable<typeof x> => !!x);
    fadeIn(tl, tail, { at: 1.5 });
    tl.call(() => {
      this.ready = true;
      if (this.prompt) gsap.to(this.prompt, { alpha: 0.35, duration: 0.9, yoyo: true, repeat: -1, ease: 'sine.inOut' });
      this.startRotation();
    }, [], 1.5);
  }

  /** The exit `morph()` plays: fade everything the intro owns (the logo stays). */
  outro(tl: gsap.core.Timeline): void {
    this.ready = false;
    this.stopRotation();
    if (this.prompt) gsap.killTweensOf(this.prompt);
    const mine = [...this.cards, ...this.extras, this.title, this.subtitle, this.prompt, this.check, ...this.dots].filter((x): x is Container => !!x);
    fadeOut(tl, mine);
  }

  left(): void {
    window.removeEventListener('keydown', this.onKey, { capture: true });
    this.stopRotation();
    this.timeline?.kill();
    gsap.killTweensOf([this.prompt, ...this.cards, ...this.extras]);
    this.destroy({ children: true });
  }

  /** Continue (also what a click or Space/Enter does once the prompt is up). */
  finish(): void {
    if (this.finished || !this.ready) return;
    this.finished = true;
    const key = this.opts.dontShowAgain ? this.opts.dontShowAgain.key : null;
    if (key && this.dontShow) {
      try {
        localStorage.setItem(key, '1');
      } catch {
        /* storage blocked: the intro shows again next time */
      }
    }
    this.stopRotation();
    this.resolveDone();
  }

  // ── layout ──────────────────────────────────────────────────────────────────
  override resize(width: number, height: number): void {
    const portrait = width / Math.max(1, height) < 0.8;
    this.design = portrait ? PORTRAIT : LANDSCAPE;
    super.resize(width, height);
  }

  override layout(fit: Fit): void {
    this.hitArea = new Rectangle(0, 0, fit.width, fit.height);
    if (!this.textures.length && this.opts.cards.some((c) => isSlide(c) && c.image)) return; // art not loaded yet
    const portrait = fit.design.height > fit.design.width;
    if (portrait !== this.portrait) {
      this.portrait = portrait;
      this.build(portrait);
    }
    const L = portrait ? LAYOUT.portrait : LAYOUT.landscape;
    const cx = fit.design.width / 2;
    const at = (obj: Container, x: number, y: number, k = 1): void => {
      const p = fit.toScreen(x, y);
      obj.position.set(p.x, p.y);
      obj.scale.set(fit.scale * k);
    };
    if (this.title) at(this.title, cx, L.title);
    if (this.subtitle) at(this.subtitle, cx, L.subtitle);
    this.extras.forEach((e, i) => at(e, cx, L.extras + i * 70));
    const cw = this.cardWidth(portrait);
    const n = this.cards.length;
    this.cards.forEach((card, i) => {
      const x = portrait ? cx : cx + (i - (n - 1) / 2) * (cw + L.gap);
      at(card, x, L.cards, this.baseScale[i] ?? 1);
    });
    this.dots.forEach((d, i) => at(d, cx + (i - (this.dots.length - 1) / 2) * 44, L.cards + L.cardH / 2 + 70));
    if (this.prompt) at(this.prompt, cx, L.prompt);
    if (this.check) at(this.check, cx, L.check);
  }

  private cardWidth(portrait: boolean): number {
    return this.opts.cardWidth ?? (portrait ? 760 : 480);
  }

  private build(portrait: boolean): void {
    this.stopRotation();
    for (const c of this.removeChildren()) if (!this.extras.includes(c) && !this.opts.cards.includes(c)) c.destroy({ children: true });
    this.cards = [];
    this.baseScale = [];
    this.dots = [];
    const L = portrait ? LAYOUT.portrait : LAYOUT.landscape;
    const accent = this.opts.accent ?? 0xffffff;
    const cw = this.cardWidth(portrait);

    if (this.opts.title) {
      this.title = label('display', this.opts.title, { fontSize: portrait ? 104 : 96, wordWrap: true, wordWrapWidth: (portrait ? PORTRAIT : LANDSCAPE).width - 120 });
      this.addChild(this.title);
    }
    if (this.opts.subtitle) {
      this.subtitle = label('body', this.opts.subtitle, { fontSize: portrait ? 40 : 34 });
      this.addChild(this.subtitle);
    }
    for (const e of this.extras) this.addChild(e);

    this.opts.cards.slice(0, 3).forEach((c, i) => {
      const card = isSlide(c) ? this.drawCard(c, this.textures[i] ?? null, cw, L.cardH, L.img, portrait) : c;
      const w = card.getLocalBounds().width || cw;
      this.baseScale.push(isSlide(c) ? 1 : cw / w);
      card.visible = !portrait || i === 0;
      this.cards.push(card);
      this.addChild(card);
    });
    // One card at a time on a phone, turning by themselves; no pager dots (they read as a
    // control nobody needs on a screen that says "tap to continue").
    if (portrait && this.cards.length > 1) this.page = 0;

    const touch = typeof window !== 'undefined' && 'ontouchstart' in window;
    this.prompt = label('prompt', this.opts.continueLabel ?? (touch ? 'Tap to continue' : 'Click to continue'), { fontSize: portrait ? 56 : 44 });
    this.addChild(this.prompt);
    if (this.opts.dontShowAgain) {
      this.check = this.checkbox(this.opts.dontShowAgain.label ?? "Don't show this again", accent, portrait ? 36 : 28);
      this.addChild(this.check);
    }
  }

  /** A descriptor card, centred on its origin: a dark panel, the art (or a badge), a title and the text. */
  private drawCard(slide: IntroSlide, texture: Texture | null, w: number, h: number, imgH: number, portrait: boolean): Container {
    const c = new Container();
    const pad = portrait ? 34 : 26;
    const left = -w / 2;
    const top = -h / 2;
    c.addChild(drawPanel(new Graphics(), left, top, w, h, this.opts.card ?? 'card'));
    const box = { x: left + pad, y: top + pad, w: w - pad * 2, h: imgH };
    c.addChild(drawPanel(new Graphics(), box.x, box.y, box.w, box.h, 'inset'));
    if (texture) {
      const art = new Sprite(texture);
      art.anchor.set(0.5);
      art.scale.set(Math.min((box.w - 24) / texture.width, (box.h - 24) / texture.height));
      art.position.set(box.x + box.w / 2, box.y + box.h / 2);
      c.addChild(art);
    } else {
      const badge = label('badge', slide.badge ?? '★', { fontSize: imgH * 0.36 });
      badge.position.set(box.x + box.w / 2, box.y + box.h / 2);
      if (badge.width > box.w - 30) badge.scale.set((box.w - 30) / badge.width);
      c.addChild(badge);
    }
    const title = label('heading', slide.title, { fontSize: portrait ? 50 : 36, wordWrap: true, wordWrapWidth: w - pad * 2 });
    title.anchor.set(0.5, 0);
    title.position.set(0, box.y + box.h + (portrait ? 26 : 20));
    c.addChild(title);
    const body = label('body', slide.text, { fontSize: portrait ? 34 : 24, wordWrap: true, wordWrapWidth: w - pad * 2 });
    body.anchor.set(0.5, 0);
    body.position.set(0, title.y + title.height + 12);
    const room = h / 2 - pad - body.y;
    if (body.height > room) body.scale.set(room / body.height);
    c.addChild(body);
    return c;
  }

  private checkbox(text: string, accent: number, size: number): Container {
    const row = new Container();
    const box = new Graphics();
    const b = size * 1.2;
    const draw = (): void => {
      box.clear().roundRect(0, -b / 2, b, b, 7).fill({ color: 0x08090c, alpha: 0.85 }).stroke({ color: 0xffffff, alpha: 0.85, width: 3 });
      if (this.dontShow) box.moveTo(b * 0.22, 0).lineTo(b * 0.42, b * 0.22).lineTo(b * 0.78, -b * 0.24).stroke({ color: accent, width: 5, cap: 'round', join: 'round' });
    };
    draw();
    const caption = new Text({ text, style: textStyle('body', { fontSize: size, align: 'left' }) });
    caption.anchor.set(0, 0.5);
    caption.position.set(b + 14, 0);
    row.addChild(box, caption);
    row.pivot.set((b + 14 + caption.width) / 2, 0);
    row.eventMode = 'static';
    row.cursor = 'pointer';
    row.hitArea = new Rectangle(-10, -b / 2 - 10, b + 34 + caption.width, b + 20);
    row.on('pointertap', (e) => {
      e.stopPropagation();
      this.dontShow = !this.dontShow;
      draw();
    });
    return row;
  }

  // ── portrait carousel ───────────────────────────────────────────────────────
  private startRotation(): void {
    if (!this.portrait || this.cards.length < 2 || this.finished) return;
    this.carousel = gsap.delayedCall(this.opts.rotateEvery ?? 2.6, () => {
      this.show((this.page + 1) % this.cards.length);
      this.startRotation();
    });
  }

  private stopRotation(): void {
    this.carousel?.kill();
    this.carousel = null;
  }

  private show(next: number): void {
    const cur = this.cards[this.page];
    const nxt = this.cards[next];
    if (!cur || !nxt || cur === nxt) return;
    const x = cur.x;
    const shift = 90 * this.fit.scale;
    gsap.to(cur, { alpha: 0, x: x - shift, duration: 0.3, ease: 'power2.in', onComplete: () => void ((cur.visible = false), (cur.x = x)) });
    nxt.visible = true;
    gsap.fromTo(nxt, { alpha: 0, x: x + shift }, { alpha: 1, x, duration: 0.4, delay: 0.2, ease: 'power2.out' });
    this.dots.forEach((d, i) => (d.alpha = i === next ? 1 : 0.3));
    this.page = next;
  }
}
