// @artubeplate/core/motion, stepped by hand in Node: the playbook's browser checks
// (docs/playbook/motion/test/motion.check.ts) without the renderer. pixi's scene graph is a few
// stand-ins with the fields the rig touches; GSAP's root clock is moved by the tests, not the ticker.
import { describe, it, expect, vi, beforeAll, afterAll, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gsap } from 'gsap';
import type { PrimitiveName, Rig } from '../src/motion';

vi.mock('pixi.js', () => {
  class Point {
    constructor(
      public x = 0,
      public y = 0,
    ) {}
    set(x: number, y = x): void {
      this.x = x;
      this.y = y;
    }
  }
  /** A 64 × 64 piece centred on its origin (a sprite with anchor 0.5), with what the rig touches. */
  class Container {
    label: string;
    children: Container[] = [];
    parent: Container | null = null;
    position = new Point();
    scale = new Point(1, 1);
    angle = 0;
    alpha = 1;
    visible = true;
    tint = 0xffffff;
    constructor(opts: { label?: string } = {}) {
      this.label = opts.label ?? '';
    }
    get x(): number {
      return this.position.x;
    }
    set x(v: number) {
      this.position.x = v;
    }
    get y(): number {
      return this.position.y;
    }
    set y(v: number) {
      this.position.y = v;
    }
    addChild(...c: Container[]): Container {
      for (const child of c) {
        child.parent = this;
        this.children.push(child);
      }
      return c[0]!;
    }
    getLocalBounds(): { x: number; y: number; width: number; height: number } {
      return { x: -32, y: -32, width: 64, height: 64 };
    }
  }
  return { Container };
});

const { Container } = await import('pixi.js');
const { motion } = await import('../src/motion');

// The spec as the player reads it (the JSON's own type is the literal shape of every primitive).
interface SpecStep {
  frames?: number | string;
  scaled?: boolean;
  set?: object;
  call?: string;
}
interface SpecPrimitive {
  steps?: SpecStep[];
  variants?: Record<string, SpecStep[]>;
  oscillate?: object[];
  each?: string;
}
const spec = motion.spec as unknown as { fps: number; frames: Record<string, number>; primitives: Record<string, SpecPrimitive> };

const F = (frames: number): number => frames / spec.fps;
const framesOf = (f: number | string | undefined): number => (typeof f === 'number' ? f : (spec.frames[f ?? ''] ?? 0));
/** What `build` makes of a step list at a turbo speed: scaled steps take frames × speed, `set` steps no time. */
const secondsOf = (steps: SpecStep[], speed: number): number =>
  steps.reduce((t, s) => t + (s.set ? 0 : framesOf(s.frames) * (s.scaled ? speed : 1)), 0) / spec.fps;

/** Every step list in the spec: [label, primitive, variant, steps]. */
const plays: [string, PrimitiveName, string | undefined, SpecStep[]][] = [];
for (const [name, p] of Object.entries(spec.primitives)) {
  if (p.variants) for (const [v, steps] of Object.entries(p.variants)) plays.push([`${name} ${v}`, name as PrimitiveName, v, steps]);
  else if (p.steps) plays.push([name, name as PrimitiveName, undefined, p.steps]);
}

const piece = (): Rig => motion.rig(new Container());
/** The rig as drawn: the move layer's place and the body's scale and feet offset. */
const drawn = (r: Rig) => ({ x: r.move.x, y: r.move.y, angle: r.move.angle, alpha: r.move.alpha, sx: r.body.scale.x, sy: r.body.scale.y, feet: r.body.y });
function expectRest(r: Rig, x = 0): void {
  const d = drawn(r);
  expect(d.x, 'move.x').toBeCloseTo(x, 3);
  expect(d.y, 'move.y').toBeCloseTo(0, 3);
  expect(d.angle, 'move.angle').toBeCloseTo(0, 3);
  expect(d.alpha, 'move.alpha').toBeCloseTo(1, 3);
  expect(d.sx, 'body.scale.x').toBeCloseTo(1, 3);
  expect(d.sy, 'body.scale.y').toBeCloseTo(1, 3);
  expect(d.feet, 'body.y').toBeCloseTo(0, 3);
}
/** Move GSAP's root clock by `frames`, as the ticker would: for the animations a callback started. */
const tickRoot = (frames: number): void => void gsap.updateRoot(gsap.globalTimeline.time() + F(frames));
const onRoot = (): unknown[] => gsap.globalTimeline.getChildren(false, true, true);

// Step every timeline by hand: nothing moves unless a test moves it.
beforeAll(() => void gsap.ticker.remove(gsap.updateRoot));
afterAll(() => void gsap.ticker.add(gsap.updateRoot));
afterEach(() => {
  motion.speed = () => 1;
});

describe('the spec', () => {
  const published = join(__dirname, '../../../docs/playbook/motion/motion-style.json');
  it.skipIf(!existsSync(published))('is the playbook definition, byte for byte', () => {
    const shipped = join(__dirname, '../src/motion/motion-style.json');
    expect(readFileSync(shipped).equals(readFileSync(published))).toBe(true);
    expect(motion.spec).toEqual(JSON.parse(readFileSync(shipped, 'utf8')));
  });

  it('has the frame scale, the six eases by name, and a step list for every primitive but float and cascade', () => {
    expect(spec.fps).toBe(60);
    expect(motion.spec.frames).toEqual({ tick: 5, quick: 8, snappy: 13, base: 21, settle: 34, slow: 55, beat: 89 });
    expect(Object.keys(motion.spec.eases)).toEqual(['out', 'in', 'glide', 'pop', 'wobble', 'linear']);
    const stepped = new Set(plays.map(([, name]) => name));
    for (const [name, p] of Object.entries(spec.primitives)) expect(stepped.has(name as PrimitiveName) || !!p.oscillate || !!p.each, name).toBe(true);
    expect(plays.length).toBeGreaterThanOrEqual(19); // 17 step primitives, wow in three sizes
    // @ts-expect-error — only the spec's primitives are names
    const bad: PrimitiveName = 'nope';
    void bad;
  });

  it('hands out the tokens: seconds on the turbo clock when asked, the GSAP ease by intent', () => {
    expect(motion.seconds('quick')).toBeCloseTo(8 / 60, 9);
    expect(motion.seconds(30)).toBeCloseTo(0.5, 9);
    motion.speed = () => 0.4;
    expect(motion.seconds('quick')).toBeCloseTo(8 / 60, 9);
    expect(motion.seconds('quick', true)).toBeCloseTo((8 * 0.4) / 60, 9);
    expect(motion.ease('pop')).toBe('back.out(1.8)');
    expect(motion.ease('wobble')).toBe('elastic.out(1, 0.4)');
    expect(motion.ease('in')).toBe('power2.in');
    expect(motion.ease('linear')).toBe('none');
  });
});

describe('every primitive plays to its end pose on a stub rig', () => {
  for (const [label, name, variant] of plays) {
    it(`${label} ends at rest`, () => {
      const r = piece();
      motion.play(r, name, { variant }).progress(1);
      const d = drawn(r);
      if (name === 'exit') {
        // Hidden and small, by design.
        expect(d.alpha).toBeCloseTo(0, 3);
        expect(d.sx).toBeCloseTo(0.5, 3);
        expect(d.x).toBeCloseTo(0, 3);
        expect(d.angle).toBeCloseTo(0, 3);
      } else if (name === 'fly') {
        // On its target (with no route: its own rest point) at 0.8, for the caller to remove.
        expect(d.sx).toBeCloseTo(0.8, 3);
        expect(d.x).toBeCloseTo(0, 3);
        expect(d.y).toBeCloseTo(0, 3);
        expect(d.alpha).toBeCloseTo(1, 3);
      } else expectRest(r, name === 'roll' ? r.w : 0); // a roll rests one cell on
      motion.stop(r);
    });
  }
});

describe('turbo: steps marked scaled take frames × speed, the others keep their frames', () => {
  for (const [label, name, variant, steps] of plays) {
    const scaled = steps.reduce((n, s) => n + (!s.set && s.scaled ? framesOf(s.frames) : 0), 0);
    it(`${label}: ${scaled} of ${Math.round(secondsOf(steps, 1) * 60)} frames follow the clock`, () => {
      const r = piece();
      const full = motion.play(r, name, { variant }).duration();
      motion.speed = () => 0.4;
      const turbo = motion.play(r, name, { variant }).duration();
      expect(full, 'at speed 1').toBeCloseTo(secondsOf(steps, 1), 6);
      expect(turbo, 'at speed 0.4').toBeCloseTo(secondsOf(steps, 0.4), 6);
      expect(full - turbo, 'what turbo took').toBeCloseTo(F(scaled * 0.6), 6);
      motion.stop(r);
    });
  }

  it('wow M: 60 frames; at 0.4 only the 13-frame wait shortens; the play option wins over motion.speed', () => {
    const r = piece();
    expect(motion.play(r, 'wow', { variant: 'M' }).duration()).toBeCloseTo(F(60), 6); // GSAP keeps 1e-7
    motion.speed = () => 0.4;
    expect(motion.play(r, 'wow', { variant: 'M' }).duration()).toBeCloseTo(F(5 + 8 + 13 * 0.4 + 34), 6);
    expect(motion.play(r, 'wow', { variant: 'M', speed: 0.12 }).duration()).toBeCloseTo(F(5 + 8 + 13 * 0.12 + 34), 6);
  });

  it('wow M poses: anticipate 0.95, wow 1.15, hold 1.165', () => {
    const r = piece();
    const a = motion.play(r, 'wow', { variant: 'M' });
    a.pause();
    a.seek(F(5));
    expect(drawn(r).sx).toBeCloseTo(0.95, 2);
    a.seek(F(13));
    expect(drawn(r).sx).toBeCloseTo(1.15, 2);
    a.seek(F(26));
    expect(drawn(r).sx).toBeCloseTo(1.165, 2);
  });
});

describe('events', () => {
  it('a land fires impact once, on the frame the fall ends', () => {
    const impact = vi.fn();
    const r = piece();
    const a = motion.play(r, 'land', { on: { impact } });
    a.pause();
    a.time(F(12.9)); // time(), not seek(): seek suppresses events
    expect(impact).not.toHaveBeenCalled();
    a.time(F(13.1));
    expect(impact).toHaveBeenCalledTimes(1);
    a.progress(1);
    expect(impact).toHaveBeenCalledTimes(1);
    expectRest(r);
  });

  it('every contact calls back: pop, swap, advance, arrive, and the three impacts of a tumble', () => {
    const on = { impact: vi.fn(), pop: vi.fn(), swap: vi.fn(), advance: vi.fn(), arrive: vi.fn() };
    motion.play(piece(), 'wow', { variant: 'M', on }).progress(1);
    motion.play(piece(), 'swap', { on }).progress(1);
    motion.play(piece(), 'turn', { on }).progress(1);
    motion.play(piece(), 'fly', { on }).progress(1);
    motion.play(piece(), 'tumble', { on }).progress(1);
    expect(on.pop).toHaveBeenCalledTimes(1);
    expect(on.swap).toHaveBeenCalledTimes(1);
    expect(on.advance).toHaveBeenCalledTimes(1);
    expect(on.arrive).toHaveBeenCalledTimes(1);
    expect(on.impact).toHaveBeenCalledTimes(3);
  });

  it('still fire on a skip', () => {
    const impact = vi.fn();
    const r = piece();
    motion.play(r, 'land', { on: { impact } });
    motion.skip(r);
    expect(impact).toHaveBeenCalledTimes(1);
  });
});

describe('skip lands the end pose', () => {
  it('a wow skipped mid-hold is at rest, and complete', () => {
    const r = piece();
    const a = motion.play(r, 'wow', { variant: 'L' });
    a.pause();
    a.seek(F(30));
    expect(drawn(r).sx).toBeGreaterThan(1.2);
    motion.skip(r);
    expectRest(r);
    expect(a.progress()).toBe(1);
  });

  it('a land skipped mid-fall is on its feet', () => {
    const r = piece();
    const a = motion.play(r, 'land');
    a.pause();
    a.seek(F(6));
    expect(drawn(r).y).toBeLessThan(-10);
    motion.skip(r);
    expectRest(r);
  });

  it('a loop skipped stops at rest: a pulse, and a float with its drift', async () => {
    const r = piece();
    const a = motion.play(r, 'pulse');
    a.pause();
    a.seek(F(55));
    expect(drawn(r).sx).toBeCloseTo(1.05, 3);
    motion.skip(r);
    expectRest(r);
    expect(onRoot()).not.toContain(a); // killed, not rewound
    const f = piece();
    const b = motion.play(f, 'float');
    expect(b.repeat()).toBe(-1);
    await new Promise((done) => setTimeout(done, 40)); // the drift reads the ticker's clock
    gsap.ticker.tick();
    tickRoot(1);
    const d = drawn(f);
    expect(d.y !== 0 || d.angle !== 0, 'the float drifts').toBe(true);
    expect(Math.abs(d.y)).toBeLessThanOrEqual(0.04 * f.h + 1e-9);
    expect(Math.abs(d.angle)).toBeLessThanOrEqual(1.5 + 1e-9);
    motion.skip(f);
    expectRest(f);
    expect(onRoot()).not.toContain(b);
  });

  it('with nothing playing it is a no-op; a plain object is not a rig', () => {
    const r = piece();
    motion.skip(r);
    motion.stop(r);
    expectRest(r);
    expect(() => motion.play({} as unknown as Rig, 'wow')).toThrow(/not a rig/);
  });
});

describe('the rig', () => {
  it('wraps the art in root → move → body, sized from its bounds (or the size option), with an optional flash', () => {
    const art = new Container();
    art.position.set(10, 20);
    const r = motion.rig(art);
    expect([r.w, r.h]).toEqual([64, 64]);
    expect([art.x, art.y]).toEqual([10, 20]); // the stub's bounds are already centred
    expect(r.move.parent).toBe(r.root);
    expect(r.body.parent).toBe(r.move);
    expect(art.parent).toBe(r.body);
    expect(motion.rig(new Container(), { size: [100, 50] }).w).toBe(100);
    const flash = new Container();
    const f = motion.rig(new Container(), { flash });
    expect(f.flash).toBe(flash);
    expect(flash.alpha).toBe(0);
    motion.play(f, 'swap').pause().seek(F(5 + 8)); // the wow: flash 1
    expect(flash.alpha).toBeCloseTo(1, 2);
  });

  it('a land squashes from the feet: the bottom edge stays put', () => {
    const r = piece();
    const a = motion.play(r, 'land');
    a.pause();
    expect(drawn(r).y).toBeCloseTo(-1.6 * 64, 3); // from: 1.6 heights up
    a.seek(F(13 + 5));
    const d = drawn(r);
    expect(d.y).toBeCloseTo(0, 2);
    expect(d.sx).toBeCloseTo(1.2, 2);
    expect(d.sy).toBeCloseTo(0.8, 2);
    expect(d.feet).toBeCloseTo((64 / 2) * (1 - 0.8), 2);
  });

  it('a roll turns on its corner, rests one cell on, and rolls back with dir -1', () => {
    const r = piece();
    const impact = vi.fn();
    const a = motion.play(r, 'roll', { on: { impact } });
    a.pause();
    a.seek(F(5 + 13)); // the tip: 38°
    const d = drawn(r);
    expect(d.angle).toBeCloseTo(38, 2);
    const t = (d.angle * Math.PI) / 180;
    expect(d.x + Math.cos(t) * 32 - Math.sin(t) * 32).toBeCloseTo(32, 2); // the bottom-right corner
    expect(d.y + Math.sin(t) * 32 + Math.cos(t) * 32).toBeCloseTo(32, 2);
    a.progress(1);
    expect(impact).toHaveBeenCalledTimes(1);
    expectRest(r, 64);
    motion.play(r, 'roll', { dir: -1 }).progress(1);
    expectRest(r, 0);
  });

  it('a new primitive starts from where the piece is; the replaced one leaves the clock', () => {
    const r = piece();
    const a = motion.play(r, 'wow', { variant: 'L' });
    a.pause();
    a.seek(F(30));
    const { sx: before, angle } = drawn(r);
    expect(before).toBeGreaterThan(1.2);
    expect(angle).toBeGreaterThan(3);
    const b = motion.play(r, 'wow', { variant: 'S' });
    expect(onRoot()).not.toContain(a);
    b.pause();
    b.seek(0.0001);
    expect(drawn(r).sx).toBeCloseTo(before, 2);
    b.progress(1);
    expect(drawn(r).sx).toBeCloseTo(1, 3);
    expect(drawn(r).angle).toBeCloseTo(angle, 3); // S only tweens scale: the tilt L gave it stays until a stop
    motion.stop(r);
    expectRest(r);
  });

  it('a turn with a prism: the next face comes over the top, then the front is whole again', () => {
    const front = new Container();
    const next = new Container();
    const r = motion.rig(front);
    motion.prism(r, front, next);
    expect(next.parent).toBe(r.body);
    expect(front.visible).toBe(true);
    expect(next.visible).toBe(false);
    const advance = vi.fn();
    const a = motion.play(r, 'turn', { on: { advance } });
    a.pause();
    a.seek(F(5 + 13)); // rx 100: the front has turned away, the next face is almost flat on
    expect(front.visible).toBe(false);
    expect(next.visible).toBe(true);
    expect(next.scale.y).toBeCloseTo(Math.sin((100 * Math.PI) / 180), 2);
    a.progress(1); // 'next face' sets rx back to 0 and calls advance
    expect(advance).toHaveBeenCalledTimes(1);
    expect(front.visible).toBe(true);
    expect(front.scale.y).toBeCloseTo(1, 3);
    expect(front.tint).toBe(0xffffff);
    expect(next.visible).toBe(false);
    expectRest(r);
  });

  it('a count climbs to the amount, never back, then wows the counter', () => {
    const r = piece();
    const seen: number[] = [];
    const a = motion.count(r, 0, 100, (v) => seen.push(v));
    a.pause();
    for (let f = 0; f < 55; f += 5) a.seek(F(f)); // short of the end: progress(1) is the step that completes it
    a.progress(1);
    expect(seen.length).toBeGreaterThan(10);
    expect(seen.at(-1)).toBeCloseTo(100, 6);
    expect(seen.every((v, i) => i === 0 || v >= seen[i - 1]!)).toBe(true);
    expectRest(r);
    tickRoot(8); // the finish (wow S) that the count's end started is at its wow
    expect(drawn(r).sx).toBeCloseTo(1.08, 2);
    motion.stop(r);
  });

  it('a fly lands every piece on the target two frames apart, and the target wows on arrival', () => {
    const layer = new Container();
    const target = piece();
    const pieces = [piece(), piece(), piece()];
    pieces.forEach((p, i) => {
      p.root.position.set(20 * i, 0);
      layer.addChild(p.root);
    });
    const arrive = vi.fn();
    const all = motion.fly(pieces, { x: 300, y: -200 }, { target, on: { arrive } });
    expect(all.duration()).toBeCloseTo(F(13 + 21 + 2 * 2), 6); // burst + arc, the last piece two places later
    all.progress(1);
    for (const p of pieces) {
      expect(p.root.x + p.move.x).toBeCloseTo(300, 6);
      expect(p.root.y + p.move.y).toBeCloseTo(-200, 6);
    }
    expect(arrive).toHaveBeenCalledTimes(3);
    tickRoot(8);
    expect(drawn(target).sx).toBeCloseTo(1.08, 2); // wow S, from the last arrival
    motion.stop(target);
  });

  it('a cascade pops a group in three frames apart, in reading order or from the centre out', () => {
    const rigs = [piece(), piece(), piece(), piece(), piece()];
    const centre = motion.cascade(rigs, { order: 'centre' });
    expect(rigs.every((r) => drawn(r).sx === 0), 'starts hidden').toBe(true);
    expect(centre.duration()).toBeCloseTo(F(55 + 2 * 3), 6); // popIn, the outer pieces two ranks later
    centre.pause();
    centre.seek(F(2));
    expect(rigs.map((r) => drawn(r).sx > 0)).toEqual([false, false, true, false, false]);
    centre.progress(1);
    for (const r of rigs) expectRest(r);
    const reading = motion.cascade(rigs);
    expect(reading.duration()).toBeCloseTo(F(55 + 4 * 3), 6);
    reading.pause();
    reading.seek(F(2));
    expect(rigs.map((r) => drawn(r).sx > 0)).toEqual([true, false, false, false, false]);
    reading.progress(1);
    for (const r of rigs) expectRest(r);
  });
});

describe('motion.settled: an await that returns when the animation is cut short', () => {
  const within = (p: Promise<void>, ms = 300): Promise<string> =>
    Promise.race([p.then(() => 'settled'), new Promise<string>((res) => setTimeout(() => res('hung'), ms))]);

  it('settles when stop() kills it (a plain await of the animation never would)', async () => {
    const r = piece();
    const a = motion.play(r, 'wow', { variant: 'L' });
    const done = motion.settled(a);
    motion.stop(r);
    expect(await within(done)).toBe('settled');
  });

  it('settles when another play() replaces it, and when it ends', async () => {
    const r = piece();
    const first = motion.settled(motion.play(r, 'wow', { variant: 'L' }));
    const second = motion.play(r, 'wow', { variant: 'S' });
    expect(await within(first)).toBe('settled');
    const done = motion.settled(second);
    second.progress(1);
    expect(await within(done)).toBe('settled');
    motion.stop(r);
  });
});
