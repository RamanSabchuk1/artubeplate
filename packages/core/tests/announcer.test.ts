import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { gsap } from 'gsap';

// The announcer only needs pixi's scene graph, not a renderer: a few stand-ins with the fields
// it touches, so the timelines can be stepped by hand in Node.
vi.mock('pixi.js', () => {
  class Point {
    constructor(
      public x = 1,
      public y = 1,
    ) {}
    set(x: number, y = x): void {
      this.x = x;
      this.y = y;
    }
  }
  class Container {
    children: Container[] = [];
    scale = new Point();
    alpha = 1;
    visible = true;
    rotation = 0;
    x = 0;
    y = 0;
    addChild(...c: Container[]): Container {
      this.children.push(...c);
      return c[0]!;
    }
    removeChildren(): Container[] {
      const c = this.children;
      this.children = [];
      return c;
    }
    destroy(): void {}
    get width(): number {
      return 300 * this.scale.x;
    }
    get height(): number {
      return 80 * this.scale.y;
    }
  }
  class Graphics extends Container {
    clear(): this {
      return this;
    }
    ellipse(): this {
      return this;
    }
    fill(): this {
      return this;
    }
  }
  class Text extends Container {
    constructor(public text = '') {
      super();
    }
  }
  class FillGradient {}
  return { Container, Graphics, Text, FillGradient };
});
vi.mock('../src/ui/components', async () => {
  const { Text } = (await import('pixi.js')) as unknown as { Text: new (text: string) => { text: string } };
  return { label: (_role: string, text: string) => new Text(text) };
});

const { WinAnnouncer } = await import('../src/ui/announcer');

interface Internals {
  tl: gsap.core.Timeline | null;
  titleHolder: { children: Array<{ text: string }> };
  amount: { text: string };
}
const inside = (a: InstanceType<typeof WinAnnouncer>): Internals => a as unknown as Internals;

function announcer() {
  const tiers: number[] = [];
  const counted: number[] = [];
  const a = new WinAnnouncer({ format: (n) => n.toFixed(2), onTier: (_t, i) => tiers.push(i), onCounted: (n) => counted.push(n) });
  const title = (): string => inside(a).titleHolder.children[0]!.text;
  const timeline = (): gsap.core.Timeline => inside(a).tl!;
  return { a, tiers, counted, title, timeline };
}

// Step every timeline by hand: nothing moves unless a test moves it.
beforeAll(() => void gsap.ticker.remove(gsap.updateRoot));
afterAll(() => void gsap.ticker.add(gsap.updateRoot));

describe('WinAnnouncer', () => {
  it('climbs through every tier, announcing each once, then counts once', async () => {
    const { a, tiers, counted, timeline } = announcer();
    const done = a.play(300, 300); // EPIC: BIG at 15×, MEGA at 50×, EPIC at 200×
    timeline().progress(1);
    await done;
    expect(tiers).toEqual([0, 1, 2]);
    expect(counted).toEqual([300]);
    expect(a.visible).toBe(false);
  });

  it('skips from the middle of the count to the final tier: only that tier is announced', async () => {
    const { a, tiers, counted, title, timeline } = announcer();
    const done = a.play(300, 300);
    timeline().time(0.5); // counting inside BIG
    expect(tiers).toEqual([0]);
    expect(title()).toBe('Big win');
    a.skip();
    expect(tiers).toEqual([0, 2]); // MEGA was jumped over and stays silent
    expect(title()).toBe('Epic win');
    expect(inside(a).amount.text).toBe('300.00');
    expect(counted).toEqual([300]);
    // The final amount still holds: pulse 0.28 s, hold 0.8 s, fade 0.25 s at normal speed.
    expect(timeline().duration()).toBeCloseTo(0.28 + 0.8 + 0.25, 5);
    expect(a.visible).toBe(true);
    timeline().progress(1);
    await done;
    expect(a.visible).toBe(false);
    expect(counted).toEqual([300]);
  });

  it('keeps the hold after a skip at turbo speed, scaled', () => {
    const { a, timeline } = announcer();
    void a.play(300, 300, { speed: 0.4 });
    timeline().time(0.1);
    a.skip();
    expect(timeline().duration()).toBeCloseTo(0.28 + 0.8 * 0.4 + 0.25 * 0.4, 5);
    timeline().time(0.5); // mid-hold: still up
    expect(a.visible).toBe(true);
    a.stop();
  });

  it('ends at once when skipped after the count', async () => {
    const { a, tiers, counted, timeline } = announcer();
    const done = a.play(300, 300);
    timeline().time(0.4 + 3 * 1.3 + 0.1); // counted, pulsing
    expect(counted).toEqual([300]);
    a.skip();
    await done;
    expect(a.visible).toBe(false);
    expect(tiers).toEqual([0, 1, 2]);
  });

  it('announces the only tier once when skipped before it was announced', async () => {
    const { a, tiers, counted, title } = announcer();
    const done = a.play(20, 20); // BIG only
    a.skip(); // before the first tier's 0.05 s call
    expect(tiers).toEqual([0]);
    expect(title()).toBe('Big win');
    expect(counted).toEqual([20]);
    a.skip(); // a second tap ends it
    await done;
    expect(a.visible).toBe(false);
    expect(tiers).toEqual([0]);
  });
});
