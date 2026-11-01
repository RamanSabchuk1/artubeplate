// @artubeplate/core/motion — the Lowres Labs studio motion for pixi.js 8 and GSAP 3.
//
// motion-style.json is the definition: tokens, the six eases and every primitive as a list of
// steps. This file only plays it, on a three-layer rig:
//
//   root  layout's: pin it with a SmartContainer. Never animated.
//   move  x, y, angle, alpha, rx. Turns around its centre, or around a corner for a roll.
//   body  scale, sx, sy. Scales from its centre, or from its feet when a primitive squashes.
//   art   your sprite, centred. An optional white flash layer sits above it.
//
//   import { motion } from '@artubeplate/core/motion';
//   motion.speed = () => ctx.turbo.speed;                  // 1, 0.4 or 0.12
//   const coin = motion.rig(Sprite.from('coin-cyan'));
//   area.pinChildAt(coin.root, { offsetY: 25 });            // layout owns root
//   await motion.play(coin, 'land', { on: { impact: () => sfx.play('coin-land') } });
//   motion.play(coin, 'wow', { variant: 'M' });
//
// Durations are frames at 60 fps. Steps marked `scaled` take frames x speed; the others keep
// their frames, so a wow keeps its punch at any turbo level. A new primitive on a rig replaces
// the one playing and starts from where the piece is. `skip()` jumps to the end pose.
//
// motion-style.json next to this file is the studio definition published in the Lowres Labs
// playbook (repo lowres-labs/playbook, motion/motion-style.json) and must stay byte-identical to
// it: change a number there, then copy the file here. This player is the playbook's motion.ts,
// with the token types written out (below) instead of derived with `keyof`.
// Needs pixi.js v8 and gsap (optional peers of this package).

import { Container, type ContainerChild } from 'pixi.js';
import { gsap } from 'gsap';
import style from './motion-style.json';

type Num = number | string;
type Prop = 'scale' | 'sx' | 'sy' | 'x' | 'y' | 'angle' | 'alpha' | 'rx' | 'flash' | 'path' | 'value';
type Values = Partial<Record<Prop, number>> & { pivot?: number[] };

interface Step {
  phase: string;
  frames?: Num;
  ease?: string;
  to?: Values;
  set?: Values;
  scaled?: boolean;
  with?: { frames: Num; ease?: string; to: Values }[];
  call?: string;
}

interface Primitive {
  family: string;
  use: string;
  avoid?: string;
  body?: 'center' | 'bottom';
  from?: Values;
  steps?: Step[];
  variants?: Record<string, Step[]>;
  default?: string;
  loop?: boolean;
  mirror?: boolean;
  advance?: boolean;
  oscillate?: { prop: 'x' | 'y' | 'angle' | 'scale'; amount: number; frames: number }[];
  path?: { spread: number; lift: number; bend: number };
  stagger?: string;
  arrive?: { primitive: string; variant?: string };
  finish?: { primitive: string; variant?: string };
  each?: string;
}

interface Spec {
  fps: number;
  frames: Record<string, number>;
  eases: Record<string, { gsap: string }>;
  stagger: Record<string, number>;
  primitives: Record<string, Primitive>;
}

const spec = style as unknown as Spec;

// The token types are the JSON's keys, written out so the rolled-up .d.ts stays clean: tsdown
// declares the JSON's `in` ease as `_in` with an alias, and `keyof` would let '_in' through.
// The asserts below keep the three unions equal to the JSON's keys, both ways.
export type PrimitiveName =
  | 'appear' | 'popIn' | 'land' | 'slam' | 'exit' | 'wow' | 'pulse' | 'float' | 'tease' | 'shake'
  | 'hop' | 'roll' | 'tumble' | 'turn' | 'swap' | 'flip' | 'fly' | 'count' | 'cascade';
export type FrameToken = 'tick' | 'quick' | 'snappy' | 'base' | 'settle' | 'slow' | 'beat';
export type EaseToken = 'out' | 'in' | 'glide' | 'pop' | 'wobble' | 'linear';
export type MotionEvent = 'impact' | 'pop' | 'swap' | 'advance' | 'arrive';
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type _PrimitivesMatchTheJson = Assert<Same<PrimitiveName, keyof typeof style.primitives>>;
type _FramesMatchTheJson = Assert<Same<FrameToken, keyof typeof style.frames>>;
type _EasesMatchTheJson = Assert<Same<EaseToken, keyof typeof style.eases>>;

interface Pose {
  scale: number;
  sx: number;
  sy: number;
  x: number;
  y: number;
  angle: number;
  alpha: number;
  rx: number;
  flash: number;
  px: number;
  py: number;
  path: number;
  value: number;
}

const REST: Pose = { scale: 1, sx: 1, sy: 1, x: 0, y: 0, angle: 0, alpha: 1, rx: 0, flash: 0, px: 0, py: 0, path: 0, value: 0 };

export interface Rig {
  /** Layout's. Pin this one; motion never touches it. */
  readonly root: Container;
  /** x, y, angle, alpha, rx. */
  readonly move: Container;
  /** scale, sx, sy. */
  readonly body: Container;
  readonly art: ContainerChild;
  readonly flash?: ContainerChild;
  /** The piece's size: x moves in widths, y in heights. */
  readonly w: number;
  readonly h: number;
  /** Draws the faces of a cube for `rx` (see `prism`). */
  turn?: (deg: number) => void;
}

interface State {
  /** The live pose, relative to rest: every write redraws the rig, so seek and skip always show. */
  pose: Pose;
  /** Where the piece rests inside root; a roll moves it one cell. */
  home: { x: number; y: number };
  origin: 'center' | 'bottom';
  anim?: gsap.core.Animation;
  route?: { s: Point; b: Point; c: Point; t: Point };
  onValue?: (value: number) => void;
}

interface Point {
  x: number;
  y: number;
}

export interface PlayOptions {
  /** wow: 'S' | 'M' | 'L'. */
  variant?: string;
  /** 1 or -1: mirrors x, angle and the pivot (a roll to the left). */
  dir?: 1 | -1;
  /** The turbo speed for this play. Default: `motion.speed()`. */
  speed?: number;
  /** impact, pop, swap, advance, arrive: called on their frame. */
  on?: Partial<Record<MotionEvent, () => void>>;
}

const states = new WeakMap<Rig, State>();
const state = (r: Rig): State => {
  const s = states.get(r);
  if (!s) throw new Error('motion: not a rig, make it with motion.rig()');
  return s;
};

/** Seconds for a frame token or a frame count, at speed 1. */
const seconds = (f: Num | undefined): number => (typeof f === 'number' ? f : (spec.frames[f ?? ''] ?? 0)) / spec.fps;
const easeOf = (e: string | undefined): string => spec.eases[e ?? 'glide']?.gsap ?? 'none';

/** A pose whose every write calls `changed` (GSAP tweens it like a plain object). */
function livePose(changed: () => void): Pose {
  const raw: Pose = { ...REST };
  const pose = {} as Pose;
  for (const k of Object.keys(REST) as (keyof Pose)[]) {
    Object.defineProperty(pose, k, {
      enumerable: true,
      get: () => raw[k],
      set: (v: number) => {
        if (raw[k] === v) return;
        raw[k] = v;
        changed();
      },
    });
  }
  return pose;
}

function apply(r: Rig, s: State): void {
  const p = s.pose;
  let x = p.x;
  let y = p.y;
  if (s.route) {
    const q = p.path <= 0 ? lerp(s.route.b, s.route.s, -p.path) : bezier(s.route.b, s.route.c, s.route.t, p.path);
    x = (q.x - s.route.s.x) / r.w;
    y = (q.y - s.route.s.y) / r.h;
  }
  const rad = (p.angle * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = p.px * r.w;
  const cy = p.py * r.h;
  // Turn around the pivot: keep the pivot point where it is.
  r.move.position.set(s.home.x + x * r.w + cx - (cos * cx - sin * cy), s.home.y + y * r.h + cy - (sin * cx + cos * cy));
  r.move.angle = p.angle;
  r.move.alpha = p.alpha;
  const sx = p.scale * p.sx;
  const sy = p.scale * p.sy;
  r.body.scale.set(sx, sy);
  // Scale from the feet: keep the bottom edge where it is.
  r.body.position.set(0, s.origin === 'bottom' ? (r.h / 2) * (1 - sy) : 0);
  if (r.flash) r.flash.alpha = p.flash;
  r.turn?.(p.rx);
  s.onValue?.(p.value);
}

const lerp = (a: Point, b: Point, t: number): Point => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const bezier = (a: Point, c: Point, b: Point, t: number): Point => {
  const u = 1 - t;
  return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
};

function vars(v: Values, dir: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, value] of Object.entries(v)) {
    if (k === 'pivot') {
      const [px = 0, py = 0] = value as number[];
      out.px = px * dir;
      out.py = py;
    } else out[k] = k === 'x' || k === 'angle' ? (value as number) * dir : (value as number);
  }
  return out;
}

function stepsOf(p: Primitive, variant?: string): Step[] {
  if (p.variants) {
    const v = p.variants[variant ?? p.default ?? ''] ?? Object.values(p.variants)[0];
    return v ?? [];
  }
  return p.steps ?? [];
}

function build(r: Rig, s: State, steps: Step[], o: PlayOptions, loop: boolean): gsap.core.Timeline {
  const speed = o.speed ?? motion.speed();
  const dir = o.dir ?? 1;
  const tl = gsap.timeline({ repeat: loop ? -1 : 0 });
  let t = 0;
  for (const st of steps) {
    const event = st.call as MotionEvent | undefined;
    if (event) tl.call(() => o.on?.[event]?.(), [], t);
    if (st.set) {
      tl.set(s.pose, vars(st.set, dir), t);
      continue;
    }
    const k = st.scaled ? speed : 1;
    const d = seconds(st.frames) * k;
    if (st.to && Object.keys(st.to).length) tl.to(s.pose, { ...vars(st.to, dir), duration: d, ease: easeOf(st.ease) }, t);
    for (const w of st.with ?? []) tl.to(s.pose, { ...vars(w.to, dir), duration: seconds(w.frames) * k, ease: easeOf(w.ease) }, t);
    t += d;
  }
  if (tl.duration() < t) tl.set({}, {}, t); // a closing pause still counts
  return tl;
}

/** Make the three-layer rig around `art` (centred for you). Pin `root`; animate with `play`. */
function rig(art: ContainerChild, opts: { flash?: ContainerChild; size?: [number, number] } = {}): Rig {
  const root = new Container({ label: 'rig' });
  const move = new Container({ label: 'rig-move' });
  const body = new Container({ label: 'rig-body' });
  root.addChild(move);
  move.addChild(body);
  body.addChild(art);
  const b = body.getLocalBounds();
  const cx = b.x + b.width / 2;
  const cy = b.y + b.height / 2;
  art.position.set(art.position.x - cx, art.position.y - cy);
  if (opts.flash) {
    body.addChild(opts.flash);
    opts.flash.position.set(opts.flash.position.x - cx, opts.flash.position.y - cy);
    opts.flash.alpha = 0;
  }
  const [w, h] = opts.size ?? [b.width || 1, b.height || 1];
  const r: Rig = { root, move, body, art, w, h, ...(opts.flash ? { flash: opts.flash } : {}) };
  const s: State = { pose: { ...REST }, home: { x: 0, y: 0 }, origin: 'center' };
  s.pose = livePose(() => apply(r, s));
  states.set(r, s);
  return r;
}

/** Play a primitive on a rig. Returns the GSAP animation: await it, kill it, or `skip()` it. */
function play(r: Rig, name: PrimitiveName, o: PlayOptions = {}): gsap.core.Animation {
  const s = state(r);
  const p = spec.primitives[name];
  if (!p) throw new Error(`motion: no primitive "${String(name)}"`);
  s.anim?.kill();
  s.route = undefined;
  s.onValue = undefined;
  if (p.from) {
    Object.assign(s.pose, REST, vars(p.from, o.dir ?? 1));
  }
  s.origin = p.body ?? 'center';
  if (p.oscillate) {
    const phase = p.oscillate.map(() => Math.random() * Math.PI * 2);
    const t0 = gsap.ticker.time;
    s.anim = gsap.to({}, {
      duration: 1,
      repeat: -1,
      onUpdate: () => {
        const t = gsap.ticker.time - t0;
        p.oscillate!.forEach((osc, i) => {
          s.pose[osc.prop] = REST[osc.prop] + osc.amount * Math.sin((2 * Math.PI * t * spec.fps) / osc.frames + phase[i]!);
        });
      },
    });
    return s.anim;
  }
  const tl = build(r, s, stepsOf(p, o.variant), o, !!p.loop);
  if (p.advance) {
    tl.eventCallback('onComplete', () => {
      s.home.x += s.pose.x * r.w;
      s.home.y += s.pose.y * r.h;
      s.pose.x = 0;
      s.pose.y = 0;
      apply(r, s);
    });
  }
  apply(r, s);
  s.anim = tl;
  return tl;
}

/**
 * An animation as a promise that settles when it ends OR is cut short (`stop`, `skip` of a loop,
 * or another `play` on the rig). gsap never settles `then()` on a killed animation, so code that
 * awaits a rig to clean up after it (destroy pieces, drop a listener) awaits this instead.
 */
function settled(a: gsap.core.Animation): Promise<void> {
  return new Promise((resolve) => {
    const before = a.eventCallback('onInterrupt') as ((...args: unknown[]) => void) | null | undefined;
    a.eventCallback('onInterrupt', (...args: unknown[]) => {
      before?.(...args);
      resolve();
    });
    void Promise.resolve(a).then(() => resolve());
  });
}

/** Jump to the end pose (loops: back to rest). Events still fire. */
function skip(r: Rig): void {
  const s = state(r);
  const a = s.anim;
  if (!a) return;
  if (a.repeat() === -1) stop(r);
  else a.progress(1);
}

/** Stop and put the piece at rest. */
function stop(r: Rig): void {
  const s = state(r);
  s.anim?.kill();
  s.anim = undefined;
  s.route = undefined;
  Object.assign(s.pose, REST);
  apply(r, s);
}

/**
 * Fly pieces from where they rest into `to` (a point in their parent), one after another.
 * Each arrival wows `target` (the counter or meter rig). Await `motion.settled(it)`; then remove
 * the pieces (a plain await never returns if the flight is cut short).
 */
function fly(pieces: Rig[], to: Point, o: PlayOptions & { target?: Rig } = {}): gsap.core.Timeline {
  const p = spec.primitives.fly!;
  const gap = (spec.stagger[p.stagger ?? 'burst'] ?? 2) / spec.fps;
  const all = gsap.timeline();
  pieces.forEach((r, i) => {
    const s = state(r);
    const start = { x: s.home.x, y: s.home.y };
    const end = { x: to.x - r.root.x, y: to.y - r.root.y };
    const burst = {
      x: start.x + (Math.random() - 0.5) * (p.path?.spread ?? 1) * r.w,
      y: start.y - (0.3 + Math.random() * 0.7) * (p.path?.lift ?? 1) * r.h,
    };
    const bend = { x: (burst.x + end.x) / 2 + (Math.random() - 0.5) * r.w, y: Math.min(burst.y, end.y) - (p.path?.bend ?? 1) * r.h };
    const arrive = (): void => {
      o.on?.arrive?.();
      if (o.target && p.arrive) play(o.target, p.arrive.primitive as PrimitiveName, { variant: p.arrive.variant ?? '' });
    };
    const tl = play(r, 'fly', { ...o, on: { ...o.on, arrive } });
    s.route = { s: start, b: burst, c: bend, t: end };
    apply(r, s);
    all.add(tl, i * gap);
  });
  return all;
}

/** Count a number from `from` to `to`, then wow the rig that shows it. */
function count(r: Rig, from: number, to: number, show: (value: number) => void, o: PlayOptions = {}): gsap.core.Animation {
  const s = state(r);
  const p = spec.primitives.count!;
  s.anim?.kill();
  s.pose.value = 0;
  const tl = build(r, s, p.steps ?? [], o, false);
  s.onValue = (v) => show(from + (to - from) * v);
  if (p.finish) tl.eventCallback('onComplete', () => void play(r, p.finish!.primitive as PrimitiveName, { ...o, variant: p.finish!.variant ?? '' }));
  s.anim = tl;
  return tl;
}

/** Bring a group in, one after another: in reading order, or from the centre out. */
function cascade(rigs: Rig[], o: PlayOptions & { order?: 'reading' | 'centre' } = {}): gsap.core.Timeline {
  const p = spec.primitives.cascade!;
  const step = (spec.stagger[p.stagger ?? 'group'] ?? 3) / spec.fps;
  const mid = (rigs.length - 1) / 2;
  const rank = (i: number): number => (o.order === 'centre' ? Math.abs(i - mid) : i);
  const all = gsap.timeline();
  rigs.forEach((r, i) => all.add(play(r, (p.each ?? 'popIn') as PrimitiveName, o), rank(i) * step));
  return all;
}

/**
 * Turn two faces like a cube around its horizontal axis: `next` comes over the top as rx goes
 * from 0 to 90 (an orthographic cube, shaded as a face turns away). Both faces are w x h and
 * centred (anchor 0.5); `front` is usually the rig's art. Swap their art on 'advance'.
 */
function prism(r: Rig, front: Container, next: Container, shade = 0.45): void {
  if (next.parent !== r.body) r.body.addChild(next);
  const fy = front.y;
  const ny = next.y;
  const tone = (k: number): number => {
    const v = Math.round(255 * (1 - shade + shade * Math.max(0, k)));
    return (v << 16) | (v << 8) | v;
  };
  r.turn = (deg) => {
    const t = (deg * Math.PI) / 180;
    const c = Math.cos(t);
    const s = Math.sin(t);
    front.visible = c > 0.001;
    front.scale.y = Math.max(0.001, c);
    front.y = fy + (r.h / 2) * s;
    front.tint = tone(c);
    next.visible = s > 0.001;
    next.scale.y = Math.max(0.001, s);
    next.y = ny - (r.h / 2) * c;
    next.tint = tone(s);
  };
  r.turn(0);
}

export const motion = {
  /** The turbo speed: set it to `() => ctx.turbo.speed`. */
  speed: (): number => 1,
  /** Seconds for a frame token (or a frame count), optionally on the turbo clock. */
  seconds: (f: FrameToken | number, scaled = false): number => seconds(f) * (scaled ? motion.speed() : 1),
  /** The GSAP ease for a token. */
  ease: (e: EaseToken): string => easeOf(e),
  rig,
  play,
  settled,
  skip,
  stop,
  fly,
  count,
  cascade,
  prism,
  spec: style,
};
