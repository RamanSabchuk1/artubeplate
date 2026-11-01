// The reels — a pixi-reels board built FROM THE MATH's slot config (reels × rows, the symbol set),
// wrapped in a motion-blur snapshot while they spin. A symbol with `image` in the config is drawn
// from that picture; the rest get placeholder tiles (`TileSymbol`: colour + label in the game's
// font). For animated art, swap the inner symbol for an AnimatedSpriteSymbol / SpineSymbol.
//
// It implements the core's view hooks (`onSpinStart` — the reels start the moment a round begins,
// before the server answers; `onSpinAbort`; `slamStop`; `whenPlayable` — the intro holds the game
// until the player continues) and the verbs the Present phases drive.
//
// Screens run through a SceneDirector (`@artubeplate/core/scenes`). The backdrop and the logo are
// persistent layers; the intro, the game and the bonus screens are scenes; the moves between them
// are transitions:
//   intro → game             morph()              the intro fades, the board scales in; backdrop + logo stay
//   game → bonus rules       shader('fade')       the colour drains into a grey freeze-frame; the rules slam in
//   bonus rules → bonus      shader('dissolve')   a GPU burn into the board in the bonus look
//   bonus → total win        shader('fade')       the last free spin drains to grey; the total counts up
//   total win → base game    dim()                a dark dip; the base look returns behind it
//
// Layout: the logo, the board and the overlay's announcements are pinned in SmartContainer design
// canvases fitted into the PLAY AREA (the screen above the HUD bar). The numbers are in ../layout.

import { Application, Assets, Container, Graphics, Sprite, Texture } from 'pixi.js';
import { gsap } from 'gsap';
import { ReelSetBuilder, SpeedPresets, SpinTextureCache, StaticSpinSymbol, WinPresenter, anticipationForScatters, type ReelSet, type Win } from 'pixi-reels';
import type { AudioLoop, AudioPort, TurboState, ViewHooks } from '@artubeplate/core';
import { Blitter, LineShow, SilhouetteMask } from '@artubeplate/core/fx';
import { motion } from '@artubeplate/core/motion';
import type { SlotConfig } from '@artubeplate/core/rules';
import { KIND_COLORS, symbolTile } from '@artubeplate/core/rules';
import {
  BonusIntroScene,
  IntroScene,
  SceneContainer,
  SceneDirector,
  SmartContainer,
  TotalWinScene,
  dim,
  morph,
  scaleIn,
  shader,
  hudPlayArea,
  measureHudKeepOut,
  inCanvasUnits,
  slideClearOf,
  pinClearOfHud,
  rectsKey,
  slamReels,
  type BonusIntroOptions,
  type IntroSceneOptions,
  type PinChildArgs,
  type TotalWinOptions,
} from '@artubeplate/core/scenes';
import { drawBackdrop, type BackdropName } from '@artubeplate/core/ui';
import { plaque } from './plaque';
import { makeLogo } from './logo';
import { CANVAS, LOGO_MAX_WIDTH, PINS } from '../layout';
import { TileSymbol } from './TileSymbol';
import { ArtSymbol } from './ArtSymbol';
import { symbolOf } from '../game/slot';
import type { Board, Cell } from '../game/model';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Theme = 'base' | 'free';

/** Where the logo, the board, the win box and the banner go (../layout's PINS, or `Scene.pins()`). */
export type Pins = Record<keyof typeof PINS, PinChildArgs>;

const SPEED_BY_LEVEL = ['normal', 'turbo', 'superTurbo'] as const;
const CELL = 132;
const GAP = 8;
const hex = (c: string): number => parseInt(c.replace('#', ''), 16);
const THEMES: Record<Theme, { backdrop: BackdropName; frame: number; edge: number; edgeAlpha: number }> = {
  base: { backdrop: 'graphite', frame: 0x0b0d11, edge: 0xffffff, edgeAlpha: 0.14 },
  free: { backdrop: 'violet', frame: 0x0e0a14, edge: 0xb983ff, edgeAlpha: 0.7 },
};

/** The game scene: the board (frame, reels, the feature plaque) in its design canvas. Its `intro` is the reveal. */
class GameScene extends SceneContainer {
  constructor(
    area: SmartContainer,
    private readonly board: Container,
    private readonly relayout: () => void,
  ) {
    super('game');
    this.addChild(area);
  }

  override resize(): void {
    this.relayout();
  }

  /** After the intro: the board scales in around its centre while the backdrop and logo stay. */
  intro(tl: gsap.core.Timeline): void {
    scaleIn(tl, this.board, { duration: 0.5 });
  }
}

export class Scene implements ViewHooks {
  readonly app = new Application();
  readonly fx = new Container();
  /** Scenes + transitions: `director.backdrop` / `director.foreground` are the persistent layers. */
  director!: SceneDirector;
  /** The screen above the HUD bar: every SmartContainer of the game is fitted into it. */
  readonly playArea = hudPlayArea(() => this.host);
  /** Persistent, in the director's foreground: the logo, pinned in its own canvas. */
  readonly logo = new Container({ label: 'logo' });
  private readonly logoArea = SmartContainer.canvas(CANVAS, { viewport: this.playArea, label: 'logo-area' });
  private readonly boardArea = SmartContainer.canvas(CANVAS, { viewport: this.playArea, label: 'board-area' });
  /** The pins for the screen as it is now (`pins()`), and the screen they were worked out for. */
  private fitted: Pins = PINS;
  private fittedFor = '';
  private intro: IntroScene | null = null;
  /** Frame, reels and the feature plaque, pivoting on the grid's centre. */
  private readonly board = new Container({ label: 'board' });
  private readonly game: GameScene;
  private readonly featurePlaque: Container;
  private theme: Theme = 'base';
  /** Resolves once the loader has faded away: the intro's choreography must be seen. */
  private revealed: Promise<void> = Promise.resolve();
  private host!: HTMLElement;
  private reels!: ReelSet;
  private readonly audio: AudioPort | null;
  /** Lights every winning cell at once (the blocking part of a round). */
  private flasher!: WinPresenter;
  /** Cycles the wins line by line while the game is idle, until the next spin. */
  private cycler!: WinPresenter;
  /** The win lines, in board units under the reels: the core's LineShow draws them (`showLines`, `runLine`), masked out under the winning symbols' silhouettes. */
  private readonly lineLayer = new Container({ label: 'lines' });
  private lines: LineShow | null = null;
  private lineMask: SilhouetteMask | null = null;
  private readonly frame = new Graphics();
  /** The code-drawn backdrop, under the backdrop art (bg-base / bg-bonus from raw-assets) when there is some. */
  private readonly bg = new Graphics();
  private readonly bgArt = new Sprite();
  /** Coins and sparks that burst out and fly somewhere fast (scatters → the FREE SPINS plaque). */
  private blitter!: Blitter;
  /** The reel-spin bed: loops while any reel spins. */
  private spinLoop: AudioLoop | null = null;
  /** The tension bed under teasing reels (scatter anticipation). */
  private teaseLoop: AudioLoop | null = null;
  private pending: Promise<unknown> | null = null;
  private readonly ready: Promise<void>;
  private readonly reelsN: number;
  private readonly rowsN: number;
  private readonly ids: string[];

  constructor(
    host: HTMLElement,
    private readonly slot: SlotConfig,
    private readonly turbo: TurboState,
    opts: { title: string; intro?: Omit<IntroSceneOptions, 'logo'> | null; audio?: AudioPort | null },
  ) {
    this.audio = opts.audio ?? null;
    // The symbols wow on the studio's motion rig: its clock is the turbo's (a slam-stop makes the scaled beats near-instant).
    motion.speed = () => (turbo.skipped ? 0.05 : turbo.speed);
    this.reelsN = slot.board.reels;
    this.rowsN = slot.board.rows;
    this.ids = slot.symbols.length ? slot.symbols.map((s) => s.id) : ['A', 'K', 'Q', 'J', 'T'];
    // The title art, shrunk to fit when it is long; the pin sizes and places the holder.
    const title = makeLogo(opts.title);
    title.scale.set(Math.min(1, LOGO_MAX_WIDTH / Math.max(1, title.width)));
    this.logo.addChild(title);
    this.logoArea.pinChildAt(this.logo, PINS.logo);
    this.featurePlaque = plaque('Free spins', 0xb983ff);
    this.featurePlaque.visible = false;
    this.boardArea.pinChildAt(this.board, PINS.board);
    this.game = new GameScene(this.boardArea, this.board, () => this.layout());
    if (opts.intro) this.intro = new IntroScene({ ...opts.intro, logo: this.logo });
    this.ready = this.init(host);
  }

  whenReady(): Promise<void> {
    return this.ready;
  }

  /** Hold the intro until this resolves (the loader's fade-out). */
  startAfter(revealed: Promise<void>): void {
    this.revealed = revealed;
  }

  /** Core hook: resolves when the player is past the intro and the board is in. */
  async whenPlayable(): Promise<void> {
    await this.ready;
    if (!this.intro) return;
    await this.revealed.catch(() => {});
    await this.director.go('intro');
    await this.intro.done;
    await this.director.go('game', { transition: morph() });
    this.intro = null;
    // The intro dropped the logo in and scaled the board in: pin both for the screen as it is now.
    this.fitPins();
  }

  /**
   * The bonus's rules over a grey freeze-frame of the board, the scatter and the wild either side.
   * Resolves when the player continues (or by itself after `autoContinueMs`).
   */
  async bonusIntro(opts: Omit<BonusIntroOptions, 'director' | 'left' | 'right'>): Promise<void> {
    await this.ready;
    const [left, right] = await Promise.all([this.tileArt('scatter', -0.14), this.tileArt('wild', 0.14)]);
    const screen = new BonusIntroScene({ ...opts, director: this.director, ...(left ? { left } : {}), ...(right ? { right } : {}) });
    this.director.add(screen);
    await this.director.go(screen.id, { transition: shader('fade', { duration: 0.6 }) });
    await screen.done;
  }

  /** The bonus's total over a grey freeze-frame of the last free spin. Resolves when the player continues. */
  async totalWin(opts: Omit<TotalWinOptions, 'director'>): Promise<void> {
    await this.ready;
    const screen = new TotalWinScene({ ...opts, director: this.director });
    this.director.add(screen);
    await this.director.go(screen.id, { transition: shader('fade', { duration: 0.6 }) });
    await screen.done;
  }

  /** Into the bonus look: from the rules screen (a GPU dissolve onto the board), or in place. */
  async enterFeature(): Promise<void> {
    if (this.director.current?.id === 'game') {
      if (this.theme === 'free') return;
      await this.director.play(shader('dissolve', { duration: 1 }), () => this.setTheme('free'));
      return;
    }
    this.setTheme('free'); // the board is off stage: it changes unseen
    await this.director.go('game', { transition: shader('dissolve', { duration: 1 }) });
  }

  /** Back to the base look: from the total screen (a dark dip), or in place. */
  async exitFeature(): Promise<void> {
    if (this.director.current?.id === 'game') {
      if (this.theme === 'base') return;
      await this.director.play(dim({ alpha: 0.9, duration: 0.3, hold: 0.15 }), () => this.setTheme('base'));
      return;
    }
    this.setTheme('base');
    await this.director.go('game', { transition: dim({ alpha: 1, duration: 0.35, hold: 0.1 }) });
  }

  /** A symbol's art (its image, else its tile), tilted: the bonus screen's side pieces. */
  private async tileArt(kind: 'scatter' | 'wild', tilt: number): Promise<Container | undefined> {
    const sym = this.slot.symbols.find((s) => s.kind === kind) ?? this.slot.symbols.find((s) => s.id === (kind === 'wild' ? this.slot.wild?.symbol : this.slot.scatter?.symbol));
    if (!sym) return undefined;
    const packed = `sym-${sym.id}`;
    const texture = Assets.cache.has(packed) ? Texture.from(packed) : await Assets.load<Texture>(sym.image ?? symbolTile(sym, 320)).catch(() => null);
    if (!texture) return undefined;
    const art = new Sprite(texture);
    art.anchor.set(0.5);
    art.rotation = tilt;
    return art;
  }

  private setTheme(theme: Theme): void {
    this.theme = theme;
    this.featurePlaque.visible = theme === 'free';
    this.layout();
  }

  private async init(host: HTMLElement): Promise<void> {
    this.host = host;
    await this.app.init({ backgroundAlpha: 0, antialias: true, resolution: Math.min(window.devicePixelRatio || 1, 2), autoDensity: true, resizeTo: host });
    host.appendChild(this.app.canvas);
    // A slam-stop makes transitions near-instant; turbo shortens them.
    this.director = new SceneDirector(this.app, { speed: () => (this.turbo.skipped ? 0.08 : this.turbo.speed) });
    this.director.backdrop.addChild(this.bg, this.bgArt);
    this.blitter = new Blitter(this.fx, this.app.ticker);
    this.director.foreground.addChild(this.logoArea);
    this.app.stage.addChild(this.fx); // win labels + announcer, above every scene
    this.board.addChild(this.frame);

    // Symbol art: a frame named `sym-<id>` in a raw-assets spritesheet (the asset pipeline packs
    // it, hashes it and picks @0.5x/@1x, png/webp per device), else the config's `image` URL
    // (keep those files in public/ under a new name for every change: the Artube CDN caches each
    // file for a year), else the code-drawn placeholder tile.
    const art = new Map<string, Texture>();
    for (const id of this.ids) if (Assets.cache.has(`sym-${id}`)) art.set(id, Texture.from(`sym-${id}`));
    await Promise.all(
      this.ids.map(async (id) => {
        const url = symbolOf(this.slot, id).image;
        if (!url || art.has(id)) return;
        try {
          art.set(id, await Assets.load<Texture>(url));
        } catch (e) {
          console.warn(`[scene] symbol ${id}: cannot load ${url.slice(0, 80)}; using a placeholder tile`, e);
        }
      }),
    );

    const cache = new SpinTextureCache({ renderer: this.app.renderer });
    this.reels = new ReelSetBuilder()
      .reels(this.reelsN)
      .visibleCells(this.rowsN)
      .symbolSize(CELL, CELL)
      .symbolGap(GAP, GAP)
      // Declaring any profile replaces the built-in set, so register all three the speed maps to.
      .speed('normal', SpeedPresets.NORMAL)
      .speed('turbo', SpeedPresets.TURBO)
      .speed('superTurbo', SpeedPresets.SUPER_TURBO)
      .symbols((r) => {
        for (const id of this.ids) {
          const s = symbolOf(this.slot, id);
          const color = hex(s.color ?? KIND_COLORS[s.kind ?? 'low']);
          const texture = art.get(id);
          r.register(id, StaticSpinSymbol, {
            // The art's tile stays still and its glyph does the win (raw-assets `tile-<id>` +
            // `glyph-<id>`); a single image animates whole, from its centre; no art at all gets
            // the code-drawn tile.
            createInner: () => {
              const glyph = Assets.cache.has(`glyph-${id}`) ? Texture.from(`glyph-${id}`) : null;
              if (glyph) return new ArtSymbol({ tile: Assets.cache.has(`tile-${id}`) ? Texture.from(`tile-${id}`) : null, glyph });
              if (texture) return new ArtSymbol({ glyph: texture });
              return new TileSymbol({ color, label: s.label ?? s.id });
            },
            cache,
            spinTexture: 'blurred',
            blurRampMs: 120,
          });
        }
      })
      .weights(Object.fromEntries(this.ids.map((id) => [id, ['wild', 'scatter'].includes(symbolOf(this.slot, id).kind ?? '') ? 2 : 10])))
      .initialFrame(this.toFrame(this.randomBoard()))
      .ticker(this.app.ticker)
      .gsap(gsap)
      .build();
    // The win lines draw under the reels, and an inverse mask over them hides a line under each
    // winning symbol's hole-filled silhouette: it passes behind the symbol and never shows
    // through a gap in its art. The mask covers the grid plus room for a wowing symbol's overshoot.
    this.board.addChild(this.lineLayer, this.reels as unknown as Container, this.featurePlaque);
    const gridW = this.reelsN * CELL + (this.reelsN - 1) * GAP;
    const gridH = this.rowsN * CELL + (this.rowsN - 1) * GAP;
    const pad = CELL * 0.4;
    this.lineMask = new SilhouetteMask({
      renderer: this.app.renderer,
      ticker: this.app.ticker,
      layer: this.lineLayer,
      space: this.board,
      area: { x: -pad, y: -pad, width: gridW + 2 * pad, height: gridH + 2 * pad },
    });
    this.lines = new LineShow({ layer: this.lineLayer, center: (c) => this.cellCenter(c), cell: CELL, onCells: (cells) => this.maskCells(cells) });
    // Sound: a thunk as each reel lands, a chime when a scatter is among its symbols.
    const scatterId = this.slot.symbols.find((s) => s.kind === 'scatter')?.id;
    this.reels.events.on('spin:start', () => {
      this.spinLoop?.stop({ fade: 0.05 });
      this.spinLoop = this.audio?.loop?.('spin-loop', { bus: 'reels', volume: 0.5, fadeIn: 0.08 }) ?? null;
    });
    this.reels.events.on('spin:allLanded', () => {
      this.spinLoop?.stop({ fade: 0.12 });
      this.spinLoop = null;
      this.teaseLoop?.stop({ fade: 0.2 });
      this.teaseLoop = null;
    });
    // Scatter anticipation: the teasing reels get the tension bed on the anticipation bus.
    this.reels.events.on('anticipation:reel', () => {
      this.teaseLoop ??= this.audio?.loop?.('anticipation', { bus: 'anticipation', fadeIn: 0.15 }) ?? null;
    });
    let lastStop = 0;
    this.reels.events.on('spin:reelLanded', (_reel: number, symbols: string[]) => {
      // A slam lands every reel in one tick: one thunk, not five stacked.
      const now = performance.now();
      if (now - lastStop > 45) this.audio?.play('reel-stop', { bus: 'reels' });
      lastStop = now;
      if (scatterId && symbols.includes(scatterId)) this.audio?.play('scatter', { bus: 'symbols' });
    });
    this.flasher = new WinPresenter(this.reels, { cycles: -1, cycleGap: 0, dimLosers: { alpha: 0.3 }, symbolAnim: 'win' });
    this.cycler = new WinPresenter(this.reels, { cycles: -1, stagger: 60, cycleGap: 450, dimLosers: { alpha: 0.3 }, symbolAnim: 'win' });

    const resize = (): void => this.layout();
    new ResizeObserver(resize).observe(host);
    window.addEventListener('resize', resize);
    // The HUD's controls over the play area move the pins (`pins()`): pin again whenever it changes.
    this.playArea.subscribe(() => this.fitPins());
    resize();

    // Draw the board once off-screen while the loader is still up: its first real frame (text,
    // card tiles, the spin snapshots) would otherwise stall the reveal after the intro.
    this.app.renderer.generateTexture({ target: this.board }).destroy(true);

    this.director.add(this.game);
    if (this.intro) {
      // The intro enters once the loader is gone (`whenPlayable`); it drops the logo in itself.
      this.director.add(this.intro);
      this.logo.visible = false;
    } else {
      await this.director.go('game');
      this.fitPins();
    }
  }

  /** Paint the backdrop and the frame, and re-fit every SmartContainer to the play area. */
  private layout(): void {
    const b = this.host.getBoundingClientRect();
    const w = Math.round(b.width) || window.innerWidth;
    const h = Math.round(b.height) || window.innerHeight;
    const t = THEMES[this.theme];
    drawBackdrop(this.bg, w, h, t.backdrop);
    const bgAlias = this.theme === 'free' ? 'bg-bonus' : 'bg-base';
    this.bgArt.visible = Assets.cache.has(bgAlias);
    if (this.bgArt.visible) {
      // Cover the screen, centred: the art keeps its calm middle behind the board.
      this.bgArt.texture = Assets.get<Texture>(bgAlias);
      const k = Math.max(w / this.bgArt.texture.width, h / this.bgArt.texture.height);
      this.bgArt.scale.set(k);
      this.bgArt.anchor.set(0.5);
      this.bgArt.position.set(w / 2, h / 2);
    }
    this.intro?.resize(w, h);

    const gridW = this.reelsN * CELL + (this.reelsN - 1) * GAP;
    const gridH = this.rowsN * CELL + (this.rowsN - 1) * GAP;
    // Pivot on the grid's centre: the pin places that point, and the reveal scales around it.
    this.board.pivot.set(gridW / 2, gridH / 2);
    this.featurePlaque.position.set(gridW / 2, -20);
    this.frame
      .clear()
      .roundRect(-20, -20, gridW + 40, gridH + 40, 28)
      .fill({ color: t.frame, alpha: 0.9 })
      .stroke({ color: t.edge, alpha: t.edgeAlpha, width: this.theme === 'free' ? 3 : 2 });
    this.playArea.refresh(true);
  }

  /**
   * The pins for the screen as it is now: ../layout's PINS, except where the HUD's controls stand
   * over the play area (a phone held sideways: the SPIN lane at the right edge, ☰ and the coin at
   * the left). There the board slides across into the free middle beside the lane, shrinking only
   * when sliding is not enough, and the win box and the banner move with it; the logo keeps its
   * place unless the coin is under it. Where nothing overlaps, nothing moves.
   */
  pins(): Pins {
    const area = { x: this.playArea.x, y: this.playArea.y, width: this.playArea.width, height: this.playArea.height };
    const [dw, dh] = CANVAS.landscape;
    const fit = Math.min(area.width / dw, area.height / dh);
    // The controls over the play area in the landscape canvas's units: none on an upright phone or a desktop.
    const keep = this.host && fit > 0 ? inCanvasUnits(measureHudKeepOut(this.host), area, [dw, dh]) : [];
    const key = `${Math.round(area.width)}x${Math.round(area.height)} ${rectsKey(keep)}`;
    if (key === this.fittedFor) return this.fitted;
    this.fittedFor = key;
    this.fitted = PINS;
    if (!keep.length) return PINS;
    const slack = 11 / fit; // a piece that only comes near a control (into its 8px margin, 3px past it) stays put
    const visibleW = area.width / fit;
    const visibleH = area.height / fit;
    const left = -(visibleW - dw) / 2; // the screen's edges in canvas units
    const top = -(visibleH - dh) / 2;
    // The board's frame where its pin puts it; it slides out of the lane's way, 48 units in from the screen's edges.
    const { offsetY, scale } = PINS.board.landscape;
    const w = (this.reelsN * CELL + (this.reelsN - 1) * GAP + 40) * scale;
    const h = (this.rowsN * CELL + (this.rowsN - 1) * GAP + 40) * scale;
    const { dx, scale: k } = slideClearOf({ x: dw / 2 - w / 2, y: dh / 2 + offsetY - h / 2, width: w, height: h }, keep, { x: left + 48, width: visibleW - 96 }, { slack });
    const board = { x: dw / 2 + dx - (w * k) / 2, y: dh / 2 + offsetY - (h * k) / 2, width: w * k, height: h * k };
    // The logo out of the coin's way: up, or right short of the board.
    const line = 44 / fit; // the HUD's top line: the clock, the title, the max win
    const room = { x: left, y: top + line, width: visibleW, height: visibleH - line };
    const logo = pinClearOfHud(PINS.logo, this.logo.getLocalBounds(), keep, room, [dw, dh], 'landscape', { ways: ['up', 'right'], slack, avoid: [board] });
    if (dx === 0 && k === 1 && logo === PINS.logo) return PINS;
    const grow = Math.sqrt(k); // the win box and the banner shrink a little with the board
    this.fitted = {
      logo,
      board: { ...PINS.board, landscape: { offsetX: dx, offsetY, scale: scale * k } },
      winBox: { ...PINS.winBox, landscape: { ...PINS.winBox.landscape, offsetX: dx, scale: PINS.winBox.landscape.scale * grow } },
      banner: { ...PINS.banner, landscape: { ...PINS.banner.landscape, offsetX: dx, scale: PINS.banner.landscape.scale * grow } },
    };
    return this.fitted;
  }

  /** Pin the logo and the board where `pins()` puts them (the logo not while the intro drops it in). */
  private fitPins(): void {
    const pins = this.pins();
    if (!gsap.isTweening(this.logo)) this.logoArea.repin(this.logo, pins.logo);
    this.boardArea.repin(this.board, pins.board);
  }

  private toFrame(board: Board): { visible: string[] }[] {
    return Array.from({ length: this.reelsN }, (_, r) => ({ visible: (board[r] ?? []).slice(0, this.rowsN).map((id) => (this.ids.includes(id) ? id : this.ids[0]!)) }));
  }

  private randomBoard(): Board {
    const pool = this.ids.filter((id) => !['wild', 'scatter'].includes(symbolOf(this.slot, id).kind ?? ''));
    const from = pool.length ? pool : this.ids;
    return Array.from({ length: this.reelsN }, () => Array.from({ length: this.rowsN }, () => from[Math.floor(Math.random() * from.length)]!));
  }

  /** The reel tempo for the next spin: the player's speed level, `boost` levels faster. */
  private applySpeed(boost = 0): void {
    try {
      this.reels.setSpeed(SPEED_BY_LEVEL[Math.min(2, this.turbo.level + boost)] ?? 'normal');
    } catch {
      /* speed not registered */
    }
  }

  private readonly spinListeners: Array<() => void> = [];
  /** Called whenever a round starts (e.g. to clear the win box). */
  onSpin(listener: () => void): void {
    this.spinListeners.push(listener);
  }

  // ── core view hooks ──────────────────────────────────────────────────────────
  onSpinStart(): void {
    for (const l of this.spinListeners) l();
    void this.ready.then(() => {
      this.stopWins();
      if (!this.pending) {
        this.applySpeed();
        this.pending = this.reels.spin();
      }
    });
  }

  onSpinAbort(): void {
    void this.ready.then(async () => {
      if (!this.pending) return;
      this.reels.setResult(this.toFrame(this.randomBoard()));
      await this.pending.catch(() => {});
      this.pending = null;
    });
  }

  slamStop(): void {
    // Every reel lands at once; one that has not pushed off yet is waited for (slamReels).
    slamReels(this.reels, this.app.ticker, { spinning: !!this.pending });
    for (const l of this.slamListeners) l();
  }

  private readonly slamListeners: Array<() => void> = [];
  /** Called on every slam-stop (e.g. to skip the win announcer to its final amount). */
  onSlam(listener: () => void): void {
    this.slamListeners.push(listener);
  }

  // ── verbs for the Present phases ─────────────────────────────────────────────
  /** Land the base board (starting a spin first if the round began without one — a replay). */
  async land(board: Board): Promise<void> {
    await this.ready;
    if (!this.pending) {
      this.applySpeed();
      this.pending = this.reels.spin();
    }
    this.anticipate(this.toFrame(board));
    await this.pending;
    this.pending = null;
  }

  /**
   * Set the result and, when two scatters have landed, tease the reels after them: they slow
   * down one by one (pixi-reels' anticipation) while the tension bed plays. Turbo skips the tease.
   */
  private anticipate(frame: { visible: string[] }[]): void {
    this.reels.setResult(frame);
    const scatter = this.slot.symbols.find((s) => s.kind === 'scatter')?.id;
    if (!scatter || this.turbo.skipped) return;
    const reels = anticipationForScatters(frame, { symbol: scatter, trigger: 2 });
    if (reels.length) this.reels.setAnticipation(reels, { stagger: 'sequential', slowdown: { from: 0.4, to: 0.1 } });
  }

  /** A follow-up spin (respin / free spin), optionally holding reels in place. `feature` spins
   *  run one speed level faster than the player's setting, as feature rounds usually do. */
  async spinTo(board: Board, holdReels: number[] = [], feature = false): Promise<void> {
    await this.ready;
    this.stopWins();
    this.applySpeed(feature ? 1 : 0);
    this.pending = this.reels.spin(holdReels.length ? { holdReels } : undefined);
    this.anticipate(this.toFrame(board));
    await this.pending;
    this.pending = null;
  }

  /** Pin a sticky wild so it stays through the next spins. */
  stickyWild(reel: number, row: number, id: string): void {
    try {
      this.reels.pin(reel, row, id, { turns: 'permanent' });
    } catch {
      /* already pinned / out of range */
    }
  }

  clearPins(): void {
    for (let c = 0; c < this.reelsN; c++)
      for (let r = 0; r < this.rowsN; r++)
        try {
          this.reels.unpin(c, r);
        } catch {
          /* not pinned */
        }
  }

  /**
   * The scatters pay out into the feature: from each scatter cell coins and sparks burst out,
   * hang for a beat and fly into the FREE SPINS plaque. Resolves when the last one lands.
   */
  async scattersToPlaque(cells: Cell[]): Promise<void> {
    await this.ready;
    const textures = ['fx-coin', 'fx-spark'].filter((a) => Assets.cache.has(a)).map((a) => Texture.from(a));
    if (!textures.length || !cells.length) return;
    const to = this.featurePlaque.toGlobal({ x: 0, y: 0 });
    await Promise.all(
      cells.map((c, i) => {
        const r = this.cellRect(c.reel, c.row);
        // Turbo and a slam-stop shorten the stagger and the flights alike (speedScale multiplies
        // the Blitter's durations: below 1 is faster).
        return this.turbo.delay(i * 90).then(() =>
          this.blitter.blast({
            from: { x: r.x + r.w / 2, y: r.y + r.h / 2 },
            to,
            textures,
            count: 12,
            size: [r.w * 0.22, r.w * 0.34],
            speedScale: this.turbo.skipped ? 0.05 : this.turbo.speed,
            onArrive: (n) => n % 4 === 0 && this.audio?.play('click', { bus: 'symbols', pitch: { base: 1.6, jitter: 0.15 }, volume: 0.6 }),
          }),
        );
      }),
    );
  }

  /** Screen rect of the whole grid (for the win box). */
  boardRect(): Rect {
    const a = this.cellRect(0, 0);
    const z = this.cellRect(this.reelsN - 1, this.rowsN - 1);
    return { x: a.x, y: a.y, w: z.x + z.w - a.x, h: z.y + z.h - a.y };
  }

  /** Screen rect of a cell (for overlays). */
  cellRect(reel: number, row: number): Rect {
    const b = this.reels.getCellBounds(reel, row);
    const c = this.reels as unknown as Container;
    const a = c.toGlobal({ x: b.x, y: b.y });
    const z = c.toGlobal({ x: b.x + b.width, y: b.y + b.height });
    return { x: a.x, y: a.y, w: z.x - a.x, h: z.y - a.y };
  }

  /**
   * The blocking win beat: every winning cell pulses at once for `holdMs`. `wait` is the core's
   * turbo- and slam-stop-aware delay, so turbo shortens the beat and a slam-stop ends it.
   */
  async flashWins(cells: Cell[], holdMs: number, wait: (ms: number) => Promise<void>): Promise<void> {
    await this.ready;
    this.cycler.abort();
    const unique = [...new Map(cells.map((c) => [`${c.reel},${c.row}`, c])).values()];
    if (!unique.length) return;
    const shown = this.flasher.show([{ id: 0, value: 0, cells: unique.map((c) => ({ reelIndex: c.reel, cellIndex: c.row })) }]);
    await wait(holdMs);
    this.flasher.abort();
    await shown;
  }

  /**
   * The idle attract: cycle the wins line by line until the next spin. Each line in its turn:
   * the one before fades, the white snake races this one from its first cell into its last and
   * its trail stays set while the symbols wow, and `onGroup` gets the line (its cells, its value
   * and its index in `groups`) to float its amount. Does not block.
   */
  cycleWins(groups: Array<{ cells: Cell[]; value: number }>, onGroup?: (cells: Cell[], value: number, index: number) => void): void {
    if (!groups.length) return;
    void this.ready.then(async () => {
      const wins: Win[] = groups.map((g, i) => ({ id: i, value: g.value, cells: g.cells.map((c) => ({ reelIndex: c.reel, cellIndex: c.row })) }));
      const fn = (win: Win): void => {
        if (!wins.includes(win)) return; // the flasher emits on the same bus
        const i = win.id ?? 0;
        const g = groups[i];
        if (!g) return;
        this.clearLines();
        void this.runLine(g.cells, () => undefined, this.turbo.speed, { trail: true });
        onGroup?.(g.cells, g.value, i);
      };
      this.attractOff?.();
      this.reels.events.on('win:group', fn as never);
      const off = (): void => {
        this.reels.events.off('win:group', fn as never);
        if (this.attractOff === off) this.attractOff = null;
      };
      this.attractOff = off;
      try {
        await this.cycler.show(wins);
      } finally {
        off();
      }
    });
  }

  /** Takes the idle cycle's win:group listener off (see cycleWins / stopWins). */
  private attractOff: (() => void) | null = null;

  /** Stop any win presentation (a new spin is starting): the pulses, the cycle and the lines. */
  stopWins(): void {
    this.flasher.abort();
    this.cycler.abort();
    // The cycle's show() may still be waiting on a wow the abort cut short; its listener goes now.
    this.attractOff?.();
    this.clearLines();
  }

  // ── win lines ────────────────────────────────────────────────────────────────
  /**
   * The round's overview: every win line at once as a bold white line under the symbols, and
   * every winning symbol waking (left to right, once however many lines it is on). The lines
   * stay until `clearLines`. `speed` < 1 is faster (turbo).
   */
  showLines(lines: Cell[][], speed = 1): void {
    this.lines?.overview(lines, { speed, onCell: (c) => this.wowCell(c) });
  }

  /**
   * A win line lights up: the white snake races the line from the first cell into the last,
   * calling `onCell` as its head reaches each cell; resolves at the last cell. With `trail` a
   * thin line stays set along the path until `clearLines` (the idle cycle).
   */
  runLine(cells: Cell[], onCell: (c: Cell, i: number) => void, speed = 1, opts: { trail?: boolean } = {}): Promise<void> {
    return this.lines?.run(cells, { speed, onCell, ...(opts.trail ? { trail: true } : {}) }) ?? Promise.resolve();
  }

  /** Every line and snake fades out (the next spin, the settle, the next attract group); the mask follows once they are gone. */
  clearLines(): void {
    this.lines?.clear(200);
    this.lineMask?.clear(240);
  }

  /** A winning symbol wakes: its wow (the L one: a tilt, a held beat), joined if it is already playing. */
  private wowCell(c: Cell): void {
    try {
      void this.reels.getReel(c.reel).getSymbolAt(c.row).playWin();
    } catch {
      /* not on the board */
    }
  }

  /**
   * Cover these cells' symbols with the line mask, so a line runs behind a symbol and never
   * shows through a gap in its art (a letter's counter). Art symbols only: a code-drawn tile is
   * opaque and stops the line at its edge by itself.
   */
  private maskCells(cells: Cell[]): void {
    const mask = this.lineMask;
    if (!mask) return;
    for (const c of cells) {
      try {
        const sym = this.reels.getReel(c.reel).getSymbolAt(c.row);
        const inner = sym instanceof StaticSpinSymbol ? sym.inner : sym;
        if (inner instanceof ArtSymbol) mask.cover(`${c.reel},${c.row}`, inner.artSprite);
      } catch {
        /* not on the board */
      }
    }
  }

  /** A cell's centre in board units (the lines draw there, under the reels). */
  private cellCenter(c: Cell): { x: number; y: number } {
    return { x: c.reel * (CELL + GAP) + CELL / 2, y: c.row * (CELL + GAP) + CELL / 2 };
  }
}
