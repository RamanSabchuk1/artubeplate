import { describe, it, expect } from 'vitest';
import type { AssetsManifest } from 'pixi.js';
import { soundsFromManifest, textureManifest } from '../src/assets';

// AssetPack's aliases: with and without the source extension, long and short.
const audio = (path: string, ext = 'wav') => ({ alias: [`${path}.${ext}`, path, `${path.split('/').pop()!}.${ext}`, path.split('/').pop()!], src: [`${path}-h1.mp3`, `${path}-h2.webm`] });
const manifest: AssetsManifest = {
  bundles: [
    { name: 'default', assets: [] },
    {
      name: 'game',
      assets: [
        { alias: ['game/bg/bg-base', 'bg-base'], src: ['game/bg/bg-base-a.jpg', 'game/bg/bg-base-b.webp'] },
        { alias: ['game/symbols', 'symbols'], src: ['game/symbols-c.png.json', 'game/symbols-d.webp.json'] },
      ],
    },
    {
      name: 'audio',
      assets: [
        audio('audio/reels/reel-stop.1'),
        audio('audio/reels/reel-stop.2'),
        audio('audio/wins/big-win'),
        audio('audio/music/base.intro', 'mp3'),
        audio('audio/music/base.loop'),
        audio('audio/music/bonus'),
        audio('audio/click'),
      ],
    },
  ],
};

describe('the asset pipeline manifest, game side', () => {
  it('keeps audio away from Pixi: texture bundles only, empty ones dropped', () => {
    expect(textureManifest(manifest).bundles.map((b) => b.name)).toEqual(['game']);
  });

  it('turns the audio folders into zvuk entries: folder = bus, .N = variants, music stems', () => {
    const s = Object.fromEntries(soundsFromManifest(manifest).map((e) => [e.name, e]));
    expect(s['reel-stop']).toEqual({
      name: 'reel-stop',
      kind: 'variants',
      bus: 'reels',
      urls: [
        ['assets/audio/reels/reel-stop.1-h2.webm', 'assets/audio/reels/reel-stop.1-h1.mp3'],
        ['assets/audio/reels/reel-stop.2-h2.webm', 'assets/audio/reels/reel-stop.2-h1.mp3'],
      ],
    });
    expect(s['big-win']).toMatchObject({ name: 'big-win', bus: 'wins', url: ['assets/audio/wins/big-win-h2.webm', 'assets/audio/wins/big-win-h1.mp3'] });
    expect(s['base']).toMatchObject({ kind: 'music', bus: 'music', intro: ['assets/audio/music/base.intro-h2.webm', 'assets/audio/music/base.intro-h1.mp3'] });
    expect(s['base']).not.toHaveProperty('loopCrossfadeMs'); // authored stems loop as written
    expect(s['bonus']).toMatchObject({ kind: 'music', loopCrossfadeMs: 400 }); // a plain loop gets a seamless crossfade
    expect(s['click']).toMatchObject({ bus: 'ui' }); // outside a bus folder: the default bus
  });

  it('honours a custom base path and default bus', () => {
    const s = soundsFromManifest(manifest, { basePath: 'cdn/a', defaultBus: 'symbols' });
    expect(s.find((e) => e.name === 'click')).toMatchObject({ bus: 'symbols', url: ['cdn/a/audio/click-h2.webm', 'cdn/a/audio/click-h1.mp3'] });
  });
});
