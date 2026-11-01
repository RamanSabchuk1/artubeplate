import { describe, it, expect } from 'vitest';
import { BUS_COMPRESSION, MUSIC_BUSES, SFX_BUSES, busCompression, isBusName } from '../src/audio';

describe('audio: the bus graph a game gets out of the box', () => {
  it('compresses every bus by default, with per-bus overrides and opt-outs', () => {
    for (const bus of [...MUSIC_BUSES, ...SFX_BUSES]) expect(busCompression(undefined, bus)).toEqual(BUS_COMPRESSION[bus]);
    const custom = { wins: { ratio: 6 }, ui: false as const };
    expect(busCompression(custom, 'wins')).toEqual({ ...BUS_COMPRESSION.wins, ratio: 6 });
    expect(busCompression(custom, 'ui')).toBeNull();
    expect(busCompression(custom, 'music')).toEqual(BUS_COMPRESSION.music);
    expect(busCompression(false, 'music')).toBeNull();
    expect(busCompression(true, 'reels')).toEqual(BUS_COMPRESSION.reels);
  });

  it('keeps music gentle and the one-shot buses punchy', () => {
    expect(BUS_COMPRESSION.music.ratio).toBeLessThan(BUS_COMPRESSION.wins.ratio!);
    expect(BUS_COMPRESSION.reels.attack).toBeLessThan(BUS_COMPRESSION.music.attack!);
  });

  it('knows the standard bus names (the asset pipeline maps audio folders onto them)', () => {
    expect(isBusName('reels')).toBe(true);
    expect(isBusName('music')).toBe(true);
    expect(isBusName('sfx')).toBe(false);
  });
});
