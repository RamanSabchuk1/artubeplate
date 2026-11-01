// The blitter: a handful of sprites bursts out of a point, hangs for a beat, then streaks into a
// target and "counts" there: coins flying into a total, sparks into a jackpot meter, paint into a
// collector. Every arrival calls back (tick the counter, pulse the target), and the promise
// resolves when the last one has landed.
//
//   const blitter = new Blitter(fxLayer);
//   await blitter.blast({
//     from: cap.getGlobalPosition(),
//     to: () => meter.getGlobalPosition(),   // a function follows a moving target
//     textures: [sparkCyan, sparkYellow],
//     count: 10,
//     onArrive: (i, n) => meter.countTo(start + (gain * (i + 1)) / n),
//   });
//
// It runs on the CPU with plain sprites (exact arrival callbacks; a few dozen sprites at a time),
// in the layer's own coordinates, so it lives happily inside a SmartContainer.

import { Container, Sprite, Ticker, type Texture } from 'pixi.js';

export interface Point {
  x: number;
  y: number;
}

export interface BlastOptions {
  /** Where the burst starts, in GLOBAL (screen) coordinates. */
  from: Point;
  /** Where the sprites fly, in global coordinates; a function is read every frame. */
  to: Point | (() => Point);
  /** One texture, or several (each sprite picks one). */
  textures: Texture | Texture[];
  /** Sprites. Default 8. */
  count?: number;
  /** Burst speed range in px/s of the layer. Default [500, 1100]. */
  speed?: [number, number];
  /** The burst's fan: a centre angle (radians, 0 = right, -PI/2 = up) and a spread. Default all round. */
  angle?: number;
  spread?: number;
  /** Seconds the burst drifts out before homing (each sprite a bit later). Default [0.18, 0.34]. */
  hang?: [number, number];
  /** Seconds of the flight into the target. Default [0.3, 0.45]. */
  flight?: [number, number];
  /** Sprite size: the texture's longest side in layer px. Default [34, 54]. */
  size?: [number, number];
  /** Spin while bursting (radians/s, random sign). Default 7. */
  spin?: number;
  /** Stretch along the flight (speed lines). Default 0.9 (0 = none). */
  stretch?: number;
  /** Duration multiplier: < 1 is faster (turbo). Default 1. */
  speedScale?: number;
  /** Called as each sprite lands, in landing order: (index, count). */
  onArrive?: (index: number, count: number) => void;
}

interface Particle {
  sprite: Sprite;
  /** Burst start and the point where the hang ends (layer coordinates). */
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** A sideways bulge for the flight's curve. */
  bend: number;
  hang: number;
  flight: number;
  spin: number;
  size: number;
  age: number;
  done: boolean;
}

const rand = (a: number, b: number): number => a + Math.random() * (b - a);

type Step = (dt: number) => boolean;

export class Blitter {
  /** Each blast in flight: advance it by `dt` seconds; true once every sprite has landed. */
  private readonly blasts = new Set<Step>();
  private readonly tick = (t: Ticker): void => {
    const dt = Math.min(0.05, t.deltaMS / 1000);
    for (const step of this.blasts) if (step(dt)) this.blasts.delete(step);
  };

  /** `layer` is where the sprites live (static: not a moving sprite). */
  constructor(
    readonly layer: Container,
    private readonly ticker: Ticker = Ticker.shared,
  ) {
    ticker.add(this.tick);
  }

  /** Burst `count` sprites out of `from` and fly them into `to`. Resolves after the last lands. */
  blast(o: BlastOptions): Promise<void> {
    const count = Math.max(1, Math.round(o.count ?? 8));
    const textures = Array.isArray(o.textures) ? o.textures : [o.textures];
    if (!textures.length || this.layer.destroyed) return Promise.resolve();
    const k = Math.max(0.05, o.speedScale ?? 1);
    const [smin, smax] = o.speed ?? [500, 1100];
    const [hmin, hmax] = o.hang ?? [0.18, 0.34];
    const [fmin, fmax] = o.flight ?? [0.3, 0.45];
    const [zmin, zmax] = o.size ?? [34, 54];
    const spread = o.spread ?? Math.PI * 2;
    const center = o.angle ?? -Math.PI / 2;
    const start = this.layer.toLocal(o.from);
    const target = (): Point => this.layer.toLocal(typeof o.to === 'function' ? o.to() : o.to);
    const parts: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const tex = textures[i % textures.length]!;
      const sprite = new Sprite(tex);
      sprite.anchor.set(0.5);
      const size = rand(zmin, zmax);
      const a = center + (spread >= Math.PI * 2 ? Math.random() * Math.PI * 2 : rand(-spread / 2, spread / 2));
      const hang = rand(hmin, hmax) * k + (i / count) * 0.12 * k;
      const v = rand(smin, smax);
      // Decelerating drift: the hang covers about a third of v * hang (ease-out).
      const reach = v * hang * 0.38;
      sprite.position.set(start.x, start.y);
      sprite.scale.set(0);
      this.layer.addChild(sprite);
      parts.push({
        sprite,
        x0: start.x,
        y0: start.y,
        x1: start.x + Math.cos(a) * reach,
        y1: start.y + Math.sin(a) * reach,
        bend: rand(-0.35, 0.35),
        hang,
        flight: rand(fmin, fmax) * k,
        spin: (Math.random() < 0.5 ? -1 : 1) * (o.spin ?? 7),
        size: size / Math.max(tex.width, tex.height),
        age: 0,
        done: false,
      });
    }
    const stretch = o.stretch ?? 0.9;
    let landed = 0;
    return new Promise((resolve) => {
      const step: Step = (dt) => {
        const end = target();
        for (const p of parts) {
          if (p.done) continue;
          p.age += dt;
          const s = p.sprite;
          if (p.age < p.hang) {
            // Burst: ease out from the start, pop in, spin.
            const t = p.age / p.hang;
            const e = 1 - (1 - t) * (1 - t) * (1 - t);
            s.position.set(p.x0 + (p.x1 - p.x0) * e, p.y0 + (p.y1 - p.y0) * e);
            const pop = t < 0.35 ? (t / 0.35) * 1.25 : 1.25 - 0.25 * Math.min(1, (t - 0.35) / 0.65);
            s.scale.set(p.size * pop);
            s.rotation += p.spin * dt;
            continue;
          }
          // Home: an accelerating quadratic curve to the (possibly moving) target.
          const t = Math.min(1, (p.age - p.hang) / p.flight);
          const e = t * t * (3 - 2 * t) * 0.35 + t * t * 0.65;
          const mx = (p.x1 + end.x) / 2 - (end.y - p.y1) * p.bend;
          const my = (p.y1 + end.y) / 2 + (end.x - p.x1) * p.bend;
          const u = 1 - e;
          const x = u * u * p.x1 + 2 * u * e * mx + e * e * end.x;
          const y = u * u * p.y1 + 2 * u * e * my + e * e * end.y;
          const vx = x - s.x;
          const vy = y - s.y;
          s.position.set(x, y);
          if (stretch > 0 && (vx || vy)) {
            s.rotation = Math.atan2(vy, vx);
            const speed = Math.hypot(vx, vy) / Math.max(1e-4, dt);
            s.scale.set(p.size * (1 + Math.min(1.6, (speed / 2400) * stretch)), p.size * (1 - 0.25 * Math.min(1, speed / 3000)));
          }
          if (t >= 1) {
            p.done = true;
            s.destroy();
            landed++;
            o.onArrive?.(landed - 1, count);
          }
        }
        if (landed >= count) {
          resolve();
          return true;
        }
        return false;
      };
      this.blasts.add(step);
    });
  }

  /** Finish every blast in flight at once (a slam-stop): the arrivals fire, the sprites go. */
  flush(): void {
    for (const step of this.blasts) if (step(1e3)) this.blasts.delete(step);
  }

  destroy(): void {
    this.ticker.remove(this.tick);
    this.flush();
    this.blasts.clear();
  }
}
