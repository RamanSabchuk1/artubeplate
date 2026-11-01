// SceneDirector: owns the stage layers and switches scenes through transitions.
//
//   root ─┬─ content ─┬─ backdrop     persistent, below the scenes (a shared background)
//         │           ├─ scenes       the current scene's view
//         │           └─ foreground   persistent, above the scenes (a logo that stays put)
//         └─ overlay                  transitions draw here, above everything
//
// A game may draw part of its picture OUTSIDE pixi: a three.js world on its own canvas under a
// transparent pixi canvas, say. Give the director that canvas as its `underlay` and every
// snapshot it takes (shader transitions, the freeze-frames of the bonus screens) includes it.
//
// Scene changes (`go`) and in-scene changes (`play`, e.g. a theme switch when a feature starts)
// are queued, so a call made during a transition runs after it instead of tearing it apart.

import { Container, ImageSource, Rectangle, Sprite, Texture, type Application, type Ticker } from 'pixi.js';
import { cut } from './transitions';
import type { Scene, Transition } from './types';

export interface SceneDirectorOptions {
  /** Where the director's layers go (default `app.stage`, below everything else). */
  parent?: Container;
  /** Duration multiplier, read when each transition starts (e.g. `() => turbo.speed`). */
  speed?: () => number;
  /**
   * What shows UNDER the pixi canvas: a three.js world on its own canvas behind a transparent pixi
   * app, a video. Called every time the director snapshots the screen, and stretched to the
   * screen under the backdrop, so the shot holds the whole picture. Draw the canvas right before
   * returning it: a WebGL canvas without `preserveDrawingBuffer` can be read only in the same
   * task as its draw. Return null when there is nothing under the pixi canvas.
   */
  underlay?: () => HTMLCanvasElement | OffscreenCanvas | ImageBitmap | null | undefined;
}

export interface SnapshotOptions {
  /** Include the foreground layer (a logo that stays put). Default true. */
  foreground?: boolean;
}

export interface GoOptions {
  /** How to get there (default: an instant cut). */
  transition?: Transition;
  /** Passed to the scene's `enter`. */
  data?: unknown;
}

export class SceneDirector {
  readonly root = new Container({ label: 'director' });
  readonly content = new Container({ label: 'content' });
  readonly backdrop = new Container({ label: 'backdrop' });
  readonly scenes = new Container({ label: 'scenes' });
  readonly foreground = new Container({ label: 'foreground' });
  readonly overlay = new Container({ label: 'transition-overlay' });

  private readonly registry = new Map<string, Scene | (() => Scene)>();
  private currentScene: Scene | null = null;
  private queue: Promise<void> = Promise.resolve();
  private running = 0;
  private readonly tick = (t: Ticker): void => this.currentScene?.update?.(t.deltaMS);
  private readonly onResize = (): void => this.resize();

  constructor(
    readonly app: Application,
    private readonly opts: SceneDirectorOptions = {},
  ) {
    this.content.addChild(this.backdrop, this.scenes, this.foreground);
    this.root.addChild(this.content, this.overlay);
    (opts.parent ?? app.stage).addChildAt(this.root, 0);
    app.ticker.add(this.tick);
    app.renderer.on('resize', this.onResize);
  }

  /** Register a scene, or a factory that builds it on first use. */
  add(scene: Scene): this;
  add(name: string, factory: () => Scene): this;
  add(a: Scene | string, factory?: () => Scene): this {
    if (typeof a === 'string') this.registry.set(a, factory!);
    else this.registry.set(a.id, a);
    return this;
  }

  has(id: string): boolean {
    return this.registry.has(id);
  }

  get current(): Scene | null {
    return this.currentScene;
  }

  /** A transition is running. */
  get busy(): boolean {
    return this.running > 0;
  }

  /** Switch to a registered scene. Resolves when the transition is over. */
  go(id: string, opts: GoOptions = {}): Promise<void> {
    return this.enqueue(async () => {
      const to = this.resolve(id);
      const from = this.currentScene;
      if (to === from) return;
      await from?.leave?.();
      const { width, height } = this.app.screen;
      to.resize?.(width, height);
      await to.enter?.(opts.data);
      await this.run(opts.transition ?? cut(), from, to, () => {
        if (from) {
          this.scenes.removeChild(from.view);
          from.detached?.();
        }
        this.scenes.addChild(to.view);
        this.currentScene = to;
        to.attached?.();
      });
      from?.left?.();
      to.entered?.();
    });
  }

  /** Run a transition around an in-scene change (a theme switch, a mode change). */
  play(transition: Transition, change: () => void | Promise<void>): Promise<void> {
    return this.enqueue(() => this.run(transition, this.currentScene, this.currentScene, change));
  }

  /**
   * The screen as it looks now, in a new texture (destroy it when done): the underlay, the
   * backdrop, the current scene and the foreground. Transitions and freeze-frames are made of these.
   */
  snapshot(opts: SnapshotOptions = {}): Texture {
    const renderer = this.app.renderer;
    const { width, height } = this.app.screen;
    const fg = this.foreground.visible;
    if (opts.foreground === false) this.foreground.visible = false;
    const under = this.underlaySprite(width, height);
    if (under) this.content.addChildAt(under, 0);
    try {
      return renderer.generateTexture({ target: this.content, frame: new Rectangle(0, 0, width, height), resolution: renderer.resolution });
    } finally {
      this.foreground.visible = fg;
      if (under) {
        this.content.removeChild(under);
        under.destroy({ texture: true, textureSource: true }); // the GPU copy; the canvas stays
      }
    }
  }

  /** Re-layout the current scene for the renderer's size (called on the renderer's `resize`). */
  resize(): void {
    const { width, height } = this.app.screen;
    this.currentScene?.resize?.(width, height);
  }

  destroy(): void {
    this.app.ticker.remove(this.tick);
    this.app.renderer.off('resize', this.onResize);
    this.root.destroy({ children: true });
  }

  private resolve(id: string): Scene {
    const entry = this.registry.get(id);
    if (!entry) throw new Error(`SceneDirector: no scene "${id}" (registered: ${[...this.registry.keys()].join(', ') || 'none'})`);
    if (typeof entry === 'function') {
      const scene = entry();
      this.registry.set(id, scene);
      return scene;
    }
    return entry;
  }

  /** The underlay as a sprite covering the screen, uploaded from its canvas now. */
  private underlaySprite(width: number, height: number): Sprite | null {
    const canvas = this.opts.underlay?.();
    if (!canvas || !canvas.width || !canvas.height) return null;
    const source = new ImageSource({ resource: canvas, width: canvas.width, height: canvas.height, label: 'underlay' });
    const sprite = new Sprite({ texture: new Texture({ source }), label: 'underlay' });
    sprite.width = width;
    sprite.height = height;
    return sprite;
  }

  private async run(transition: Transition, from: Scene | null, to: Scene | null, change: () => void | Promise<void>): Promise<void> {
    let swapped: Promise<void> | null = null;
    const swap = (): Promise<void> => (swapped ??= Promise.resolve().then(change));
    const { width, height } = this.app.screen;
    this.running++;
    try {
      await transition({
        app: this.app,
        content: this.content,
        overlay: this.overlay,
        width,
        height,
        speed: Math.max(0.01, this.opts.speed?.() ?? 1),
        from,
        to,
        swap,
        snapshot: (opts) => this.snapshot(opts),
      });
      await swap();
    } finally {
      this.running--;
    }
  }

  private enqueue(job: () => Promise<void>): Promise<void> {
    const next = this.queue.then(job);
    this.queue = next.catch(() => {});
    return next;
  }
}
