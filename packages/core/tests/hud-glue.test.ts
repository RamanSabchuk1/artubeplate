// The glue every game used to write itself: the play area above the HUD, the slam that waits for
// the last reel, the bet cues by direction, the beds under the music.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { measureHudPlayArea, hudPlayArea, slamReels } from '../src/scenes';
import { bindInputSounds } from '../src/audio';
import { startMusicOnFirstGesture } from '../src/audio/bind';
import type { DomHud } from '@open-slot-ui/dom';

type Box = { top: number; bottom: number; height: number; width: number };
const rect = (top: number, height: number, width = 390): Box => ({ top, bottom: top + height, height, width });

/** A window and a document with one HUD bar (or none), enough for the measurements. */
function stubScreen(w: number, h: number, bar: Box | null): EventTarget & { innerWidth: number; innerHeight: number } {
  const win = Object.assign(new EventTarget(), { innerWidth: w, innerHeight: h });
  vi.stubGlobal('window', win);
  vi.stubGlobal('document', { querySelector: () => (bar ? { getBoundingClientRect: () => bar } : null) });
  return win;
}
const host = (w: number, h: number) => ({ getBoundingClientRect: () => ({ top: 0, bottom: h, height: h, width: w }) }) as unknown as Element;

afterEach(() => vi.unstubAllGlobals());

describe('the play area above the HUD', () => {
  it('ends above the bar, less the message line; a short box counts the 90 px plate', () => {
    stubScreen(390, 844, rect(700, 144));
    expect(measureHudPlayArea(host(390, 844))).toEqual({ x: 0, y: 0, width: 390, height: 700 - 36 });
    stubScreen(1280, 800, rect(730, 70, 1280));
    expect(measureHudPlayArea(host(1280, 800)).height).toBe(800 - 90 - 36);
  });

  it('counts a thin strip (a phone held sideways) from its own top', () => {
    stubScreen(844, 390, rect(350, 40, 844));
    expect(measureHudPlayArea(host(844, 390), { messageGap: 20 }).height).toBe(330);
  });

  it('keeps the top 84 % with no bar, or a bar too high to be the HUD', () => {
    stubScreen(390, 844, null);
    expect(measureHudPlayArea(host(390, 844)).height).toBe(Math.round(844 * 0.84));
    stubScreen(390, 844, rect(0, 0));
    expect(measureHudPlayArea(host(390, 844)).height).toBe(Math.round(844 * 0.84));
  });

  it('measures again on a window resize, and stops after dispose', () => {
    let bar = rect(700, 144);
    const win = stubScreen(390, 844, null);
    vi.stubGlobal('document', { querySelector: () => ({ getBoundingClientRect: () => bar }) });
    const area = hudPlayArea(() => host(390, 844));
    const seen: number[] = [];
    area.subscribe(() => seen.push(area.height));
    bar = rect(600, 144);
    win.dispatchEvent(new Event('resize'));
    expect(seen).toEqual([600 - 36]);
    area.dispose();
    bar = rect(500, 144);
    win.dispatchEvent(new Event('resize'));
    expect(seen).toHaveLength(1);
  });
});

describe('the slam of a reel set', () => {
  const ticker = () => {
    const fns = new Set<() => void>();
    return { add: (fn: () => void) => fns.add(fn), remove: (fn: () => void) => fns.delete(fn), tick: () => [...fns].forEach((f) => f()), size: () => fns.size };
  };

  it('lands at once when every reel moves, or when nothing spins', () => {
    const skipSpin = vi.fn();
    slamReels({ reels: [{ speedNormalized: 1 }, { speedNormalized: 0.5 }], skipSpin }, ticker());
    slamReels({ reels: [{ speedNormalized: 0 }], skipSpin }, ticker(), { spinning: false });
    expect(skipSpin).toHaveBeenCalledTimes(2);
  });

  it('waits for the last reel to push off, then lands them all', () => {
    const reels = [{ speedNormalized: 1 }, { speedNormalized: 0 }];
    const skipSpin = vi.fn();
    const t = ticker();
    slamReels({ reels, skipSpin }, t, { now: () => 0 });
    t.tick();
    expect(skipSpin).not.toHaveBeenCalled();
    reels[1]!.speedNormalized = 0.2;
    t.tick();
    expect(skipSpin).toHaveBeenCalledTimes(1);
    expect(t.size()).toBe(0);
  });

  it('gives up waiting after maxWaitMs, and swallows a reel set that was not spinning', () => {
    let clock = 0;
    const skipSpin = vi.fn(() => {
      throw new Error('not spinning');
    });
    const t = ticker();
    slamReels({ reels: [{ speedNormalized: 0 }], skipSpin }, t, { maxWaitMs: 500, now: () => clock });
    clock = 400;
    t.tick();
    expect(skipSpin).not.toHaveBeenCalled();
    clock = 501;
    expect(() => t.tick()).not.toThrow();
    expect(skipSpin).toHaveBeenCalledTimes(1);
  });
});

/** A HUD with an event bus and a bet stepper, as the sound bindings see it. */
function fakeHud(bet: number) {
  const handlers = new Map<string, Array<(v: never) => void>>();
  const hud = {
    ui: { betStepper: { value: bet } },
    on: (event: string, fn: (v: never) => void) => {
      handlers.set(event, [...(handlers.get(event) ?? []), fn]);
      return () => handlers.set(event, (handlers.get(event) ?? []).filter((f) => f !== fn));
    },
  };
  const emit = (event: string, v?: unknown) => (handlers.get(event) ?? []).forEach((f) => f(v as never));
  return { hud: hud as unknown as DomHud, emit };
}

describe('the input cues', () => {
  it('tells a raised bet from a lowered one, and falls back to the one bet cue', () => {
    const play = vi.fn();
    const { hud, emit } = fakeHud(1);
    bindInputSounds({ play, music: vi.fn(), stopMusic: vi.fn() }, hud, { betUp: 'bet-up', betDown: 'bet-down' });
    emit('valueChanged', { id: 'bet-stepper', value: 2 });
    emit('valueChanged', { id: 'bet-stepper', value: 0.5 });
    emit('valueChanged', { id: 'bet-stepper', value: 0.5 });
    emit('valueChanged', { id: 'sound-volume', value: 0.3 });
    expect(play.mock.calls.map((c) => c[0])).toEqual(['bet-up', 'bet-down']);
    const play2 = vi.fn();
    const two = fakeHud(1);
    bindInputSounds({ play: play2, music: vi.fn(), stopMusic: vi.fn() }, two.hud, { bet: 'bet', betUp: 'bet-up' });
    two.emit('valueChanged', { id: 'bet-stepper', value: 0.5 });
    expect(play2.mock.calls.map((c) => c[0])).toEqual(['bet']);
  });
});

describe('the music on the first gesture', () => {
  it('starts the beds beside the music, or alone', async () => {
    const win = stubScreen(390, 844, null);
    const music = vi.fn();
    const ambience = vi.fn();
    const { hud } = fakeHud(1);
    startMusicOnFirstGesture({ play: vi.fn(), music, stopMusic: vi.fn(), ambience }, { unlock: vi.fn() } as never, hud, { bgm: 'base', ambience: ['subway'], ambienceFadeIn: 3 });
    win.dispatchEvent(new Event('pointerdown'));
    win.dispatchEvent(new Event('pointerdown'));
    await Promise.resolve();
    await Promise.resolve();
    expect(music).toHaveBeenCalledTimes(1);
    expect(ambience).toHaveBeenCalledWith('subway', { fadeIn: 3 });

    const music2 = vi.fn();
    const ambience2 = vi.fn();
    startMusicOnFirstGesture({ play: vi.fn(), music: music2, stopMusic: vi.fn(), ambience: ambience2 }, { unlock: vi.fn() } as never, hud, { ambience: ['rain'] });
    win.dispatchEvent(new Event('keydown'));
    await Promise.resolve();
    await Promise.resolve();
    expect(music2).not.toHaveBeenCalled();
    expect(ambience2).toHaveBeenCalledWith('rain', { fadeIn: 2 });
  });
});
