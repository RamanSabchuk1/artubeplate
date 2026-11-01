import { describe, it, expect } from 'vitest';
import { Container } from 'pixi.js';
import { SceneDirector } from '../src/scenes/director';

/** A director on a fake app whose renderer records what each snapshot was made of. */
function rig(underlay?: () => { width: number; height: number } | null) {
  const shots: Array<{ layers: string[]; foreground: boolean }> = [];
  let director: SceneDirector;
  const renderer = {
    on() {},
    off() {},
    resolution: 1,
    generateTexture: ({ target }: { target: Container }) => {
      shots.push({ layers: target.children.map((c) => c.label), foreground: director.foreground.visible });
      return { shot: shots.length };
    },
  };
  const app = { stage: new Container(), ticker: { add() {}, remove() {} }, renderer, screen: { width: 800, height: 600 } };
  director = new SceneDirector(app as never, underlay ? { underlay: underlay as never } : {});
  return { director, shots };
}

describe('SceneDirector snapshot', () => {
  it('draws the underlay under everything, for the shot only', () => {
    let calls = 0;
    const { director, shots } = rig(() => {
      calls++;
      return { width: 4, height: 2 };
    });
    expect(director.snapshot()).toEqual({ shot: 1 });
    expect(calls).toBe(1);
    expect(shots[0]!.layers).toEqual(['underlay', 'backdrop', 'scenes', 'foreground']);
    expect(director.content.children.map((c) => c.label)).toEqual(['backdrop', 'scenes', 'foreground']);
  });

  it('can leave the foreground out, and puts it back', () => {
    const { director, shots } = rig();
    director.snapshot({ foreground: false });
    expect(shots[0]).toEqual({ layers: ['backdrop', 'scenes', 'foreground'], foreground: false });
    expect(director.foreground.visible).toBe(true);
  });

  it('skips an underlay that has nothing to show', () => {
    const { director, shots } = rig(() => null);
    director.snapshot();
    expect(shots[0]!.layers).toEqual(['backdrop', 'scenes', 'foreground']);
  });
});
