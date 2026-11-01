// Cartoon particle bursts on pylinka (GPU particles for pixi v8): SPARKLE stars, SHARDs (bolts,
// splinters), dust PUFFs, CONFETTI, a soft GLOW flash. One call, anywhere on screen:
//
//   const fx = await CartoonFx.create(app, { layer: fxLayer, textures: { sparkle: [starCyan, starYellow] } });
//   fx.burst('sparkle', cap.getGlobalPosition());
//   fx.burst('confetti', { x: w / 2, y: h * 0.3 }, 120);
//
// Every kind keeps a small pool of emitters, so several bursts in one frame each start where they
// were asked for. A burst pops one frame after the call: pylinka spawns along the emitter's path
// since its last step (a moving emitter leaves a trail), so the emitter moves first and spawns on
// the next frame, from a standstill. The presets are plain data: tune them, or pass `presets` to
// override a field. Sizes and speeds are in the layer's units, so a burst inside a SmartContainer
// scales with the board.
//
// pylinka needs WebGL2 or WebGPU. If it cannot start (an old device), `create` still resolves and
// every burst is a no-op: the game plays on without the sparkle.

import { Sprite, type Application, type Container, type Renderer, type Texture } from 'pixi.js';
import type { Literal, Node, PylinkaProject, System } from '@pylinka/graph';
// pylinka is an optional peer: loaded in `create()` only, so a game that imports `@artubeplate/core/fx`
// for the Blitter alone never needs it installed.
import type { PylinkaRuntime, TextureInput } from '@pylinka/core/pixi';
import { confettiCanvas, dotCanvas, puffCanvas, sparkleCanvas, squareCanvas } from './textures';

export type BurstKind = 'sparkle' | 'shard' | 'puff' | 'confetti' | 'glow';

export interface BurstPreset {
  /** Particles per burst unless the call says otherwise. */
  count: number;
  /** Launch speed range (layer units/s) and direction range (radians; 0 = right, -PI/2 = up). */
  speed: [number, number];
  angle?: [number, number];
  /** Spawn ring around the burst point: inner and outer radius. */
  radius?: [number, number];
  /** Seconds each particle lives. */
  life: [number, number];
  /** Particle size range (layer units, the longest side). */
  size: [number, number];
  /** Size over life, as a multiple of the particle's size. */
  grow?: [number, number];
  /** Alpha over life. */
  fade?: [number, number];
  fadeEase?: string;
  /** Spin range, degrees/s (random sign). */
  spin?: number;
  gravity?: number;
  drag?: number;
  blend?: 'normal' | 'add' | 'screen';
  /** Pool size: emitters for this kind (bursts in the same frame at different spots). */
  pool?: number;
  capacity?: number;
}

export const BURST_PRESETS: Readonly<Record<BurstKind, BurstPreset>> = Object.freeze({
  sparkle: { count: 14, speed: [180, 560], radius: [0, 12], life: [0.45, 0.8], size: [26, 50], grow: [1, 0.15], fade: [1, 0], fadeEase: 'power2.in', spin: 360, drag: 2.4, pool: 6, capacity: 600 },
  shard: { count: 6, speed: [320, 760], radius: [6, 20], life: [0.35, 0.6], size: [34, 58], grow: [1, 0.4], fade: [1, 0], fadeEase: 'power2.in', spin: 720, drag: 3, pool: 4, capacity: 200 },
  puff: { count: 7, speed: [60, 220], radius: [8, 26], life: [0.5, 0.9], size: [44, 84], grow: [0.55, 1.35], fade: [0.95, 0], fadeEase: 'sine.in', spin: 60, drag: 3.2, pool: 4, capacity: 240 },
  confetti: { count: 70, speed: [420, 980], angle: [-Math.PI + 0.35, -0.35], radius: [0, 30], life: [1.4, 2.4], size: [16, 26], grow: [1, 1], fade: [1, 0], fadeEase: 'power3.in', spin: 540, gravity: 900, drag: 0.8, pool: 2, capacity: 900 },
  glow: { count: 1, speed: [0, 0], life: [0.32, 0.32], size: [180, 180], grow: [0.6, 1.6], fade: [0.85, 0], fadeEase: 'power2.out', blend: 'add', pool: 3, capacity: 12 },
});

/** One texture, several (each particle picks one), or a canvas/URL. */
export type FxImage = Texture | HTMLCanvasElement | string;

export interface CartoonFxOptions {
  /** Where the particles draw. A STATIC container (not a moving sprite); bursts are placed in its units. */
  layer: Container;
  /** Art per kind; the defaults are drawn on a canvas (white sparkle, puff, confetti, glow). */
  textures?: Partial<Record<BurstKind, FxImage | FxImage[]>>;
  /** Per-kind overrides of the presets. */
  presets?: Partial<Record<BurstKind, Partial<BurstPreset>>>;
}

// ── a small graph builder (one system per emitter) ─────────────────────────────
const f = (v: number): Literal => ({ t: 'f32', v });
const v2 = (x: number, y: number): Literal => ({ t: 'vec2', v: [x, y] });

function burstSystem(id: string, p: BurstPreset): System {
  const nodes: Node[] = [];
  const edges: System['graph']['edges'] = [];
  let n = 0;
  let e = 0;
  const node = (kind: string, values: Record<string, Literal> = {}, structural?: Record<string, string>): string => {
    const nid = `${id}n${n++}`;
    nodes.push({ id: nid, kind, values, ...(structural ? { structural } : {}) } as Node);
    return nid;
  };
  const link = (from: string, fromPort: string, to: string, toPort: string): void => {
    edges.push({ id: `${id}e${e++}`, from: { nodeId: from, portId: fromPort }, to: { nodeId: to, portId: toPort } });
  };
  const [r0, r1] = p.radius ?? [0, 0];
  link(node('shape.torus', { innerRadius: f(r0), outerRadius: f(Math.max(r0, r1)) }), 'pos', node('output.spawnPosition'), 'pos');
  link(node('gen.randomRange', { min: f(p.life[0]), max: f(p.life[1]) }), 'out', node('output.initLife'), 'life');
  // Radial launch: a speed along +x, turned by a random angle.
  const [a0, a1] = p.angle ?? [0, Math.PI * 2];
  const speed = node('gen.randomRange', { min: f(p.speed[0]), max: f(p.speed[1]) });
  const vec = node('math.makeVec2', { y: f(0) });
  link(speed, 'out', vec, 'x');
  const rot = node('math.rotate2d');
  link(vec, 'out', rot, 'v');
  link(node('gen.randomRange', { min: f(a0), max: f(a1) }), 'out', rot, 'angle');
  link(rot, 'out', node('output.initVelocity'), 'vel');
  if (p.gravity) link(node('field.gravity', { g: v2(0, p.gravity) }), 'force', node('output.addForce'), 'force');
  if (p.drag) link(node('field.drag', { coefficient: f(p.drag) }), 'drag', node('output.drag'), 'drag');
  // A random start angle plus a random spin.
  const spinRate = node('gen.randomRange', { min: f(-(p.spin ?? 0)), max: f(p.spin ?? 0) });
  const spin = node('gen.spin', {}, { unit: 'degrees' });
  link(spinRate, 'out', spin, 'rate');
  const angle = node('math.add');
  link(node('gen.randomRange', { min: f(0), max: f(360) }), 'out', angle, 'a');
  link(spin, 'out', angle, 'b');
  link(angle, 'out', node('output.writeRotation', {}, { unit: 'degrees' }), 'rot');
  // Size: a random size (in 8px sprite units) times the grow curve.
  const size = node('gen.randomRange', { min: f(p.size[0] / 8), max: f(p.size[1] / 8) });
  const [g0, g1] = p.grow ?? [1, 1];
  const grow = node('gen.scaleOverLife', { from: f(g0), to: f(g1) }, { ease: 'power1.out' });
  const scale = node('math.mul');
  link(size, 'out', scale, 'a');
  link(grow, 'out', scale, 'b');
  link(scale, 'out', node('output.writeScale'), 'scale');
  const [o0, o1] = p.fade ?? [1, 0];
  link(node('gen.alphaOverLife', { from: f(o0), to: f(o1) }, { ease: p.fadeEase ?? 'linear' }), 'out', node('output.writeAlpha'), 'alpha');
  return {
    id,
    name: id,
    capacity: p.capacity ?? 300,
    blendMode: p.blend ?? 'normal',
    enabled: true,
    space: 'world',
    emitter: { mode: 'flow', rate: 0 },
    graph: { nodes, edges },
  } as System;
}

// ── textures → square atlas rows ───────────────────────────────────────────────
type Drawable = CanvasImageSource & { width: number; height: number };

function drawableOf(img: Texture | HTMLCanvasElement, renderer: Renderer): HTMLCanvasElement {
  if (img instanceof HTMLCanvasElement) return img;
  const src = img.source.resource as Drawable | undefined;
  const drawable = !!src && (typeof ImageBitmap !== 'undefined' && src instanceof ImageBitmap || src instanceof HTMLCanvasElement || src instanceof HTMLImageElement || src instanceof HTMLVideoElement);
  if (!drawable) {
    // A render texture (a tinted copy, a baked sticker) has no image: read its pixels back.
    const sprite = new Sprite(img);
    const c = renderer.extract.canvas({ target: sprite, resolution: 1 }) as HTMLCanvasElement;
    sprite.destroy();
    return c;
  }
  const fr = img.frame;
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(fr.width));
  c.height = Math.max(1, Math.round(fr.height));
  c.getContext('2d')!.drawImage(src, fr.x, fr.y, fr.width, fr.height, 0, 0, c.width, c.height);
  return c;
}

async function loadDrawable(img: FxImage, renderer: Renderer): Promise<HTMLCanvasElement> {
  if (typeof img !== 'string') return drawableOf(img, renderer);
  const el = new Image();
  el.crossOrigin = 'anonymous';
  el.src = img;
  await el.decode();
  return squareCanvas(el);
}

/** Stack images as rows of one square-celled atlas (pylinka picks a random row per particle). */
async function atlas(images: FxImage[], renderer: Renderer): Promise<TextureInput> {
  const cells = await Promise.all(images.map(async (i) => squareCanvas(await loadDrawable(i, renderer))));
  const size = Math.min(256, Math.max(...cells.map((c) => c.width)));
  const sheet = document.createElement('canvas');
  sheet.width = size;
  sheet.height = size * cells.length;
  const g = sheet.getContext('2d')!;
  cells.forEach((c, i) => g.drawImage(c, 0, i * size, size, size));
  return { image: sheet, cols: 1, rows: cells.length, fps: 1, play: 'hold', pick: 'per-particle' };
}

const DEFAULT_IMAGES = (): Record<BurstKind, FxImage[]> => ({
  sparkle: [sparkleCanvas(96, '#ffffff'), sparkleCanvas(96, '#fff07a'), sparkleCanvas(96, '#7ef0ff')],
  shard: [sparkleCanvas(96, '#ffffff')],
  puff: [puffCanvas(128)],
  confetti: [confettiCanvas()],
  glow: [dotCanvas(128)],
});

interface Slot {
  name: string;
  /** The frame this emitter was last moved or fired in. */
  usedAt: number;
  /** Particles to spawn once the move to the burst's place has been simulated (0: none). */
  pending: number;
}

/**
 * Give a renderer a render pipe that was registered after the renderer was built. Pixi creates a
 * renderer's pipes once, from the extensions known at that moment, so a pipe registered later (a
 * lazily loaded library's) never reaches an existing renderer by itself. Does nothing if the
 * renderer already has a pipe of that name.
 */
export function ensureRenderPipe(renderer: object, name: string, Pipe: new (renderer: never) => object): void {
  const r = renderer as { renderPipes?: Record<string, object>; runners?: { destroy?: { add(item: object): unknown } } };
  if (!r.renderPipes || r.renderPipes[name]) return;
  const pipe = new Pipe(renderer as never);
  r.renderPipes[name] = pipe;
  // As pixi does for its own pipes: destroyed with the renderer.
  r.runners?.destroy?.add(pipe);
}

export class CartoonFx {
  private readonly slots = new Map<BurstKind, Slot[]>();
  private readonly cursor = new Map<BurstKind, number>();
  private readonly queue: Array<{ kind: BurstKind; x: number; y: number; count: number }> = [];
  private frame = 0;
  private readonly tick = (t: { deltaMS: number }): void => this.update(t.deltaMS / 1000);

  private constructor(
    private readonly app: Application,
    readonly layer: Container,
    private readonly runtime: PylinkaRuntime | null,
    private readonly presets: Record<BurstKind, BurstPreset>,
  ) {
    if (runtime) {
      for (const [kind, p] of Object.entries(presets) as Array<[BurstKind, BurstPreset]>) {
        const slots: Slot[] = [];
        for (let i = 0; i < (p.pool ?? 3); i++) {
          const name = `${kind}${i}`;
          const sys = runtime.systems[name];
          if (!sys) continue;
          layer.addChild(sys.view);
          slots.push({ name, usedAt: -10, pending: 0 });
        }
        this.slots.set(kind, slots);
      }
    }
    app.ticker.add(this.tick);
  }

  /** Build the systems (async: shaders compile, textures upload). Never rejects. */
  static async create(app: Application, opts: CartoonFxOptions): Promise<CartoonFx> {
    const presets = { ...BURST_PRESETS } as Record<BurstKind, BurstPreset>;
    for (const [k, p] of Object.entries(opts.presets ?? {}) as Array<[BurstKind, Partial<BurstPreset>]>) presets[k] = { ...presets[k], ...p };
    try {
      const { createPylinka, registerPylinka, PylinkaRenderPipe } = await import('@pylinka/core/pixi');
      registerPylinka();
      // The game's renderer was built before pylinka loaded, so it lacks pylinka's render pipe:
      // without it the particles never draw, and moving their layer throws inside pixi.
      ensureRenderPipe(app.renderer, PylinkaRenderPipe.extension.name, PylinkaRenderPipe);
      const defaults = DEFAULT_IMAGES();
      const systems: System[] = [];
      const textures: Record<string, TextureInput> = {};
      for (const [kind, p] of Object.entries(presets) as Array<[BurstKind, BurstPreset]>) {
        const given = opts.textures?.[kind];
        const tex = await atlas(given ? (Array.isArray(given) ? given : [given]) : defaults[kind], app.renderer);
        for (let i = 0; i < (p.pool ?? 3); i++) {
          const name = `${kind}${i}`;
          systems.push(burstSystem(name, p));
          textures[name] = tex;
        }
      }
      const now = new Date().toISOString();
      const project: PylinkaProject = { format: 'pylinka/v1', version: 1, catalogVersion: 1, id: 'cartoon-fx', name: 'cartoon-fx', createdAt: now, updatedAt: now, params: [], assets: [], systems };
      const runtime = await createPylinka(project, { renderer: app.renderer, textures });
      // pylinka uploads its sprites outside pixi's render pass and leaves the GL premultiply
      // flag off while pixi's texture system still believes it is on: re-sync it, or the next
      // canvas texture pixi uploads (a gradient, a text) comes out un-premultiplied (white bands).
      (app.renderer as unknown as { texture?: { resetState?: () => void } }).texture?.resetState?.();
      return new CartoonFx(app, opts.layer, runtime, presets);
    } catch (err) {
      console.warn('[fx] pylinka could not start; bursts are off', err);
      return new CartoonFx(app, opts.layer, null, presets);
    }
  }

  /** Whether the GPU particles run (false: every burst is a no-op). */
  get enabled(): boolean {
    return !!this.runtime;
  }

  /** A burst of `kind` at a GLOBAL point. `count` defaults to the preset's. */
  burst(kind: BurstKind, at: { x: number; y: number }, count?: number): void {
    if (!this.runtime || this.layer.destroyed) return;
    const p = this.layer.toLocal(at);
    // Queued for the next update: the emitter has to move inside pixi's update, before the render
    // simulates the particles, or the render's step puts it back where it was.
    this.queue.push({ kind, x: p.x, y: p.y, count: Math.max(1, Math.round(count ?? this.presets[kind].count)) });
  }

  /** Bursts spread along a horizontal span (a rain of confetti over the board). */
  shower(kind: BurstKind, from: { x: number; y: number }, to: { x: number; y: number }, bursts = 3, count?: number): void {
    for (let i = 0; i < bursts; i++) {
      const t = bursts === 1 ? 0.5 : i / (bursts - 1);
      this.burst(kind, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t }, count);
    }
  }

  update(dt: number): void {
    this.frame++;
    this.flush();
    this.runtime?.update(Math.min(0.05, dt));
  }

  destroy(): void {
    this.app.ticker.remove(this.tick);
    this.runtime?.destroy();
  }

  /** Fire the emitters moved last frame, then move free emitters to the queued bursts (what does
   *  not fit this frame waits for the next). */
  private flush(): void {
    if (!this.runtime) return;
    for (const slots of this.slots.values()) {
      for (const s of slots) {
        if (s.pending > 0 && s.usedAt < this.frame) {
          this.runtime.systems[s.name]!.spawnBurst(s.pending);
          s.pending = 0;
          s.usedAt = this.frame;
        }
      }
    }
    for (let i = 0; i < this.queue.length; ) {
      const b = this.queue[i]!;
      const slots = this.slots.get(b.kind) ?? [];
      const start = this.cursor.get(b.kind) ?? 0;
      let slot: Slot | undefined;
      for (let k = 0; k < slots.length; k++) {
        const s = slots[(start + k) % slots.length]!;
        // Two frames after its last burst: that spawn has surely run on the GPU by then.
        if (s.pending === 0 && s.usedAt < this.frame - 1) {
          slot = s;
          this.cursor.set(b.kind, (start + k + 1) % slots.length);
          break;
        }
      }
      if (!slot) {
        i++;
        continue;
      }
      this.runtime.systems[slot.name]!.setEmitterPosition(b.x, b.y);
      slot.pending = b.count;
      slot.usedAt = this.frame;
      this.queue.splice(i, 1);
    }
  }
}
