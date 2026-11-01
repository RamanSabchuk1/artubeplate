// The built-in transitions. Each one decides when `ctx.swap()` happens:
//
//   cut()      swap at once
//   dim()      fade a veil in, swap behind it, fade it out (partial alpha = a dim, 1 = to black)
//   shader()   snapshot the old screen, swap, snapshot the new one, blend the two on the GPU
//   morph()    keep the background: animate objects away, swap, animate the new ones in (GSAP)
//
// Durations are in seconds at normal speed and are multiplied by `ctx.speed` (turbo, slam-stop).

import { Geometry, Graphics, Mesh, RendererType, Shader, type Container } from 'pixi.js';
import { gsap } from 'gsap';
import { SHADER_PRESETS, TRANSITION_VERTEX, transitionFragment, type ShaderPreset, type TransitionUniforms } from './shaders';
import type { Transition, TransitionContext } from './types';

const tween = (target: object, vars: gsap.TweenVars): Promise<void> =>
  new Promise((resolve) => {
    gsap.to(target, { ...vars, onComplete: () => resolve() });
  });

const wait = (seconds: number): Promise<void> => new Promise((resolve) => gsap.delayedCall(seconds, () => resolve()));

/** Swap at once. */
export function cut(): Transition {
  return (ctx) => ctx.swap();
}

export interface DimOptions {
  /** Veil colour. Default black. */
  color?: number;
  /** How dark the veil gets (1 = fully covered). Default 1. */
  alpha?: number;
  /** Seconds for each half (in and out). Default 0.35. */
  duration?: number;
  /** Seconds to stay dark after the swap. Default 0.1. */
  hold?: number;
}

/** Fade a veil over the screen, swap behind it, fade it away. The first scene fades in from it. */
export function dim(opts: DimOptions = {}): Transition {
  return async (ctx) => {
    const d = (opts.duration ?? 0.35) * ctx.speed;
    const peak = opts.alpha ?? 1;
    const veil = new Graphics().rect(0, 0, ctx.width, ctx.height).fill({ color: opts.color ?? 0x000000 });
    veil.eventMode = 'static'; // swallow taps while it runs
    veil.alpha = ctx.from ? 0 : peak;
    ctx.overlay.addChild(veil);
    try {
      if (ctx.from) await tween(veil, { alpha: peak, duration: d, ease: 'power1.in' });
      await ctx.swap();
      const hold = (opts.hold ?? 0.1) * ctx.speed;
      if (hold > 0) await wait(hold);
      await tween(veil, { alpha: 0, duration: d, ease: 'power1.out' });
    } finally {
      veil.destroy();
    }
  };
}

export interface ShaderTransitionOptions {
  /** Seconds. Default 0.9. */
  duration?: number;
  /** GSAP ease for `progress`. Default `power1.inOut`. */
  ease?: string;
}

export type ShaderSource = ShaderPreset | { glsl: string; uniforms?: TransitionUniforms };

function quad(width: number, height: number): Geometry {
  return new Geometry({
    attributes: {
      aPosition: [0, 0, width, 0, width, height, 0, height],
      aUV: [0, 0, 1, 0, 1, 1, 0, 1],
    },
    indexBuffer: [0, 1, 2, 0, 2, 3],
  });
}

/**
 * Blend the old screen into the new one with a fragment shader: a preset (`fade`, `dissolve`,
 * `wipe`, `iris`, `burst`, `halftone`, `peel`, `pixelate`) or your own `vec4 transition(vec2 uv)` body. Both screens are
 * snapshots (the director's underlay included), so what moves underneath freezes for the duration. WebGL only: on another
 * renderer it falls back to `dim()`.
 */
export function shader(source: ShaderSource, opts: ShaderTransitionOptions = {}): Transition {
  const body = typeof source === 'string' ? SHADER_PRESETS[source] : source.glsl;
  const extra = typeof source === 'string' ? {} : (source.uniforms ?? {});
  if (!body) throw new Error(`shader(): unknown preset "${String(source)}" (presets: ${Object.keys(SHADER_PRESETS).join(', ')})`);
  return async (ctx) => {
    if (ctx.app.renderer.type !== RendererType.WEBGL) return dim()(ctx);
    const from = ctx.snapshot();
    await ctx.swap();
    const to = ctx.snapshot();
    const uniforms: Record<string, { value: number | Float32Array; type: string }> = {
      progress: { value: 0, type: 'f32' },
      ratio: { value: ctx.width / Math.max(1, ctx.height), type: 'f32' },
    };
    for (const [name, v] of Object.entries(extra)) uniforms[name] = Array.isArray(v) ? { value: new Float32Array(v), type: 'vec2<f32>' } : { value: v, type: 'f32' };
    const program = Shader.from({
      gl: { vertex: TRANSITION_VERTEX, fragment: transitionFragment(body, extra) },
      resources: { uFrom: from.source, uTo: to.source, transition: uniforms },
    });
    const geometry = quad(ctx.width, ctx.height);
    const mesh = new Mesh({ geometry, shader: program });
    mesh.eventMode = 'static';
    ctx.overlay.addChild(mesh);
    // The quad covers the screen: skip drawing the live scenes underneath while it runs.
    ctx.content.visible = false;
    try {
      const live = (program.resources as { transition: { uniforms: { progress: number } } }).transition.uniforms;
      await tween(live, { progress: 1, duration: (opts.duration ?? 0.9) * ctx.speed, ease: opts.ease ?? 'power1.inOut' });
    } finally {
      ctx.content.visible = true;
      mesh.destroy();
      geometry.destroy();
      program.destroy();
      from.destroy(true);
      to.destroy(true);
    }
  };
}

type Targets = Container | Container[];
type Animate = Targets | ((tl: gsap.core.Timeline) => void);

export interface MorphOptions {
  /** What leaves: display objects (default animation) or your own timeline builder. Default:
   *  the outgoing scene's `outro`, else every child of its view. Ignored for in-scene changes. */
  out?: Animate;
  /** What arrives, likewise. Default: the incoming scene's `intro`, else every child of its view. */
  in?: Animate;
  /** Seconds per object for the default animations. Default 0.4. */
  duration?: number;
  /** Seconds between objects. Default 0.07. */
  stagger?: number;
  /** Pixels the default animations travel. Default 48. */
  distance?: number;
}

const list = (t: Targets): Container[] => (Array.isArray(t) ? t : [t]);

/**
 * Keep the background: animate objects away on a GSAP timeline, swap, then animate the new ones
 * in. Leavers get their alpha and position back after the swap (the swap decides what shows).
 */
export function morph(opts: MorphOptions = {}): Transition {
  return async (ctx: TransitionContext) => {
    const duration = opts.duration ?? 0.4;
    const stagger = opts.stagger ?? 0.07;
    const distance = opts.distance ?? 48;
    const sceneChange = ctx.from !== ctx.to;

    const out = gsap.timeline({ paused: true });
    const restore: Array<() => void> = [];
    const leave = (targets: Container[]): void => {
      for (const t of targets) {
        const { alpha, x, y } = t;
        restore.push(() => {
          if (t.destroyed) return;
          t.alpha = alpha;
          t.position.set(x, y);
        });
      }
      out.to(targets, { alpha: 0, y: `-=${distance}`, duration, stagger, ease: 'power2.in' });
    };
    if (typeof opts.out === 'function') opts.out(out);
    else if (opts.out) leave(list(opts.out));
    else if (sceneChange && ctx.from) {
      if (ctx.from.outro) ctx.from.outro(out);
      else leave([...ctx.from.view.children] as Container[]);
    }
    await playTimeline(out, ctx.speed);

    await ctx.swap();
    for (const r of restore) r();

    const inn = gsap.timeline({ paused: true });
    const arrive = (targets: Container[]): void => {
      inn.from(targets, { alpha: 0, y: `-=${distance}`, duration: duration * 1.25, stagger, ease: 'back.out(1.6)' });
    };
    if (typeof opts.in === 'function') opts.in(inn);
    else if (opts.in) arrive(list(opts.in));
    else if (sceneChange && ctx.to) {
      if (ctx.to.intro) ctx.to.intro(inn);
      else arrive([...ctx.to.view.children] as Container[]);
    }
    await playTimeline(inn, ctx.speed);
  };
}

function playTimeline(tl: gsap.core.Timeline, speed: number): Promise<void> {
  if (tl.duration() <= 0) {
    tl.progress(1).kill();
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    tl.eventCallback('onComplete', () => resolve());
    tl.timeScale(1 / speed).play(0);
  });
}
