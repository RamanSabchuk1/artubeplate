// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { Signal } from '@open-slot-ui/core';
import type { DomHud } from '@open-slot-ui/dom';
import { BookLines } from '../src/math/artifact';
import { livesPips } from '../src/game/hudAdapter';
import { bindMixerToHud, type MixerGroup } from '../src/audio/bind';
import { DEFAULT_WIN_TIERS, winTierIndex } from '../src/ui/announcer';
import { ensureRenderPipe } from '../src/fx/bursts';

describe('BookLines: books held as bytes, decoded one line at a time', () => {
  it('loads once, however many callers ask, and decodes any line', async () => {
    const fetchBytes = vi.fn(async () => new TextEncoder().encode('{"a":1}\n{"b":"é"}\n{"c":3}'));
    const books = new BookLines(3, fetchBytes);
    expect(books.loaded).toBe(false);
    await Promise.all([books.load(), books.load()]);
    expect(fetchBytes).toHaveBeenCalledTimes(1);
    expect(books.at(0)).toBe('{"a":1}');
    expect(books.at(1)).toBe('{"b":"é"}');
    expect(books.at(2)).toBe('{"c":3}');
  });

  it('accepts one trailing newline and refuses a count that does not match the weights', async () => {
    const ok = new BookLines(2, async () => new TextEncoder().encode('{}\n[]\n'));
    await ok.load();
    expect(ok.at(1)).toBe('[]');
    const bad = new BookLines(3, async () => new TextEncoder().encode('{}\n[]'));
    await expect(bad.load()).rejects.toThrow(/2 lines but its weights table has 3 rows/);
  });

  it('cannot read before it loads, nor past its end', async () => {
    const b = new BookLines(1, async () => new TextEncoder().encode('{}'));
    expect(() => b.at(0)).toThrow(/not loaded/);
    await b.load();
    expect(() => b.at(1)).toThrow(RangeError);
  });
});

describe('the win announcer tiers', () => {
  it('reaches the highest tier at or below the win', () => {
    expect(winTierIndex(DEFAULT_WIN_TIERS, 14.99)).toBe(-1);
    expect(winTierIndex(DEFAULT_WIN_TIERS, 15)).toBe(0);
    expect(winTierIndex(DEFAULT_WIN_TIERS, 120)).toBe(1);
    expect(winTierIndex(DEFAULT_WIN_TIERS, 5000)).toBe(2);
  });
});

describe('livesPips: Hold & Win lives in the feature counter', () => {
  it('draws one pip per life, lit up to the counter, and undoes itself', () => {
    document.body.innerHTML = '<div id="hud"><div id="FeatureCounterItem"><span id="FeatureCounterValue">0</span></div></div>';
    const freeSpins = new Signal(3);
    const hud = { root: document.getElementById('hud')!, ui: { spin: { freeSpins } } } as unknown as DomHud;
    const undo = livesPips(hud, 3);
    const item = document.getElementById('FeatureCounterItem')!;
    const lit = (): number => item.querySelectorAll('.LivesPips i:not(.is-spent)').length;
    expect(item.classList.contains('has-lives')).toBe(true);
    expect(item.querySelectorAll('.LivesPips i')).toHaveLength(3);
    expect(lit()).toBe(3);
    freeSpins.set(1);
    expect(lit()).toBe(1);
    freeSpins.set(3);
    expect(lit()).toBe(3);
    undo();
    expect(item.querySelector('.LivesPips')).toBeNull();
    expect(item.classList.contains('has-lives')).toBe(false);
  });
});

describe('bindMixerToHud: the mixer follows SOUND, MUSIC and the mute from the start', () => {
  const fakeHud = (sfxLevel = 0.5, musicLevel = 0.7, mutedAtStart = false) => {
    const sfx = new Signal(sfxLevel);
    const music = new Signal(musicLevel);
    const muted = new Signal(mutedAtStart);
    const slider = (s: Signal<number>) => ({ value: s, setNormalized: (v: number) => s.set(v) });
    const ui = { sfxSlider: slider(sfx), musicSlider: slider(music), muted, toggleMute: () => muted.set(!muted.get()) };
    return { hud: { ui } as unknown as DomHud, sfx, music, muted };
  };
  const fakeMixer = () => {
    const levels: Record<MixerGroup, number> = { music: 1, effects: 1 };
    const state = { muted: false };
    return {
      state,
      levels,
      setGroupLevel: (g: MixerGroup, v: number) => (levels[g] = v),
      getGroupLevel: (g: MixerGroup) => levels[g],
      setMuted: (m: boolean) => (state.muted = m),
    };
  };

  it('takes what the HUD restored (persist) at bind time, then every change', () => {
    const h = fakeHud(0.3, 0.7, true); // as the HUD restored them from the last visit
    const mixer = fakeMixer();
    const off = bindMixerToHud(mixer, h.hud);
    expect(mixer.state.muted).toBe(true);
    expect(mixer.levels).toEqual({ effects: 0.3, music: 0.7 });
    h.muted.set(false);
    h.sfx.set(0); // SOUND off silences the music too
    expect(mixer.state.muted).toBe(false);
    expect(mixer.levels).toEqual({ effects: 0, music: 0 });
    off();
    h.sfx.set(1);
    expect(mixer.levels.effects).toBe(0); // unbound
  });
});

describe('ensureRenderPipe: a pipe registered after the renderer was built', () => {
  class Pipe {
    constructor(readonly renderer: unknown) {}
    destroy(): void {}
  }

  it('adds the pipe once, under its name, destroyed with the renderer', () => {
    const destroyed: object[] = [];
    const renderer = { renderPipes: { sprite: {} } as Record<string, object>, runners: { destroy: { add: (p: object) => destroyed.push(p) } } };
    ensureRenderPipe(renderer, 'pylinka', Pipe as never);
    const pipe = renderer.renderPipes.pylinka as Pipe;
    expect(pipe).toBeInstanceOf(Pipe);
    expect(pipe.renderer).toBe(renderer);
    ensureRenderPipe(renderer, 'pylinka', Pipe as never);
    expect(renderer.renderPipes.pylinka).toBe(pipe);
    expect(destroyed).toEqual([pipe]);
  });

  it('leaves a renderer that already has the pipe alone', () => {
    const own = {};
    const renderer = { renderPipes: { pylinka: own } as Record<string, object> };
    ensureRenderPipe(renderer, 'pylinka', Pipe as never);
    expect(renderer.renderPipes.pylinka).toBe(own);
  });
});
