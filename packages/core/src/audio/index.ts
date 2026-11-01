// @artubeplate/core/audio — a PRE-WIRING over @schmooky/zvuk. The core stands up the standard
// slot bus graph (nine buses in TWO groups) behind a master limiter, puts a compressor tuned per
// bus on every bus, ducks music while chosen sfx play, binds the two groups to the HUD's SOUND /
// MUSIC rows (and the mute), and pauses everything while the tab is hidden. The game declares
// its sounds and calls `audio.play('big-win')`.
//
//   master (headroom −3 dB → limiter at −1 dBFS)
//   ├── MUSIC group  (MUSIC row) → music · ambience            each: compressor → ducker
//   └── EFFECTS group (SOUND row) → reels · symbols · anticipation · wins ·
//                                   voiceover · ui · reverb     each: compressor, 8-voice cap
//
// Groups are zvuk BusGroups (one level sets every member). Keep the per-sound mix in the sound
// volumes; the HUD's rows scale whole groups. Sounds can be one file, a set of VARIANTS (a
// different take on every trigger: reel stops, coin ticks) or MUSIC (intro → loop → outro).

import {
  createEngine,
  Compressor,
  Ducker,
  type Bus,
  type BusConfig,
  type BusGroup,
  type CompressorConfig,
  type ConcurrencyConfig,
  type Engine,
  type LoudnessOptions,
  type MasterLimiterConfig,
  type MusicVoice,
  type VariantStrategy,
  type VoiceJitter,
} from '@schmooky/zvuk';
import type { DomHud } from '@open-slot-ui/dom';
import type { AudioLoop } from '../engine/fsm';
import { bindMixerToHud, type MixerLike, type MixerGroup } from './bind';

export { bindMixerToHud, type MixerLike, type MixerGroup } from './bind';
export { bindInputSounds, type InputSoundMap, type InputSoundOptions } from './inputs';
export type { AudioLoop } from '../engine/fsm';

/** Buses in the MUSIC group (driven by the MUSIC row). */
export type MusicBus = 'music' | 'ambience';
/** Buses in the EFFECTS group (driven by the SOUND row). */
export type SfxBus = 'reels' | 'symbols' | 'anticipation' | 'wins' | 'voiceover' | 'ui' | 'reverb';
export type BusName = MusicBus | SfxBus;

export const MUSIC_BUSES: readonly MusicBus[] = ['music', 'ambience'];
export const SFX_BUSES: readonly SfxBus[] = ['reels', 'symbols', 'anticipation', 'wins', 'voiceover', 'ui', 'reverb'];
const BUS_NAMES: readonly string[] = [...MUSIC_BUSES, ...SFX_BUSES];

/** Is `name` one of the standard buses? (Folder names in the asset pipeline map onto these.) */
export function isBusName(name: string): name is BusName {
  return BUS_NAMES.includes(name);
}

/**
 * The compressor on each bus, out of the box. Gentle and musical on music and ambience (glue, no
 * pumping), punchier on the one-shot buses so reel stops and wins land with weight, and a little
 * make-up gain so the compressed buses sit level with each other. Override any of them, or turn
 * them off, with `GameAudioOptions.compression`.
 */
export const BUS_COMPRESSION: Readonly<Record<BusName, CompressorConfig>> = {
  music: { threshold: -22, knee: 12, ratio: 2.5, attack: 0.02, release: 0.35, makeupGain: 2 },
  ambience: { threshold: -26, knee: 12, ratio: 2, attack: 0.03, release: 0.4, makeupGain: 1 },
  reels: { threshold: -18, knee: 8, ratio: 4, attack: 0.003, release: 0.12, makeupGain: 2 },
  symbols: { threshold: -18, knee: 8, ratio: 4, attack: 0.003, release: 0.15, makeupGain: 2 },
  anticipation: { threshold: -20, knee: 10, ratio: 3, attack: 0.01, release: 0.25, makeupGain: 2 },
  wins: { threshold: -16, knee: 8, ratio: 4, attack: 0.005, release: 0.2, makeupGain: 3 },
  voiceover: { threshold: -20, knee: 10, ratio: 3, attack: 0.005, release: 0.2, makeupGain: 3 },
  ui: { threshold: -16, knee: 6, ratio: 3, attack: 0.002, release: 0.1, makeupGain: 1 },
  reverb: { threshold: -24, knee: 12, ratio: 2, attack: 0.02, release: 0.4, makeupGain: 0 },
};

export interface GameAudioOptions {
  /** Initial MUSIC-group level (music + ambience), 0..1. Default 0.8. */
  music?: number;
  /** Initial EFFECTS-group level (reels…reverb), 0..1. Default 1. */
  effects?: number;
  /** Master headroom in dB (negative). Default −3. */
  masterHeadroom?: number;
  /** The master soft limiter. Default `{ threshold: -1 }` (just under 0 dBFS); `false` = off. */
  limiter?: MasterLimiterConfig | false;
  /**
   * The per-bus compressors. Default `true`: {@link BUS_COMPRESSION}. Pass an object to override
   * single buses (`{ wins: { ratio: 6 }, ui: false }`), or `false` to run every bus dry.
   */
  compression?: boolean | Partial<Record<BusName, Partial<CompressorConfig> | false>>;
  /** Duck the MUSIC group while THESE sfx buses are active (default `['wins']`; `null` = off). */
  duckMusicFrom?: SfxBus | SfxBus[] | null;
  /** How far the music dips under a ducking bus, 0..1. Default 0.5. */
  duckAmount?: number;
  /**
   * RMS loudness normalization applied to every loaded one-shot so the whole manifest sits at a
   * consistent level (no hand-tuned per-file gains). A per-entry `normalize` overrides this.
   * Default `true`. Pass a `LoudnessOptions` object to tune the target, or `false` off.
   */
  normalize?: boolean | LoudnessOptions;
  /**
   * Voice cap applied to EACH effects bus so stacked one-shots (a multi-pay cascade, rapid
   * contacts) don't machine-gun; steals the oldest voice when the cap is hit. Default
   * `{ max: 8, steal: 'oldest' }`. Pass `null` to leave the effects buses uncapped.
   */
  sfxConcurrency?: ConcurrencyConfig | null;
  /** Suspend all audio while the tab is hidden, resume when it is back. Default `true`. */
  pauseWhenHidden?: boolean;
}

/**
 * What the mixer loads:
 * - a SOUND: one file (or a codec ladder `['x.webm', 'x.mp3']`) on a bus;
 * - VARIANTS: several takes of one sound, a different one on every `play` (default
 *   `'shuffle-bag'`: each take once before any repeats);
 * - MUSIC: a loop with an optional intro and outro, on the `music` bus. For a plain loop with no
 *   authored intro/outro set `loopCrossfadeMs`: zvuk crossfades the loop boundary (no click).
 */
export type SoundEntry =
  | { name: string; kind?: 'sound'; url: string | string[]; bus?: BusName; normalize?: boolean | LoudnessOptions }
  | { name: string; kind: 'variants'; urls: Array<string | string[]>; strategy?: VariantStrategy; bus?: BusName; normalize?: boolean | LoudnessOptions }
  | { name: string; kind: 'music'; loop: string | string[]; intro?: string | string[]; outro?: string | string[]; loopCrossfadeMs?: number; bus?: MusicBus };

type PlayOpts = { bus?: BusName | string; volume?: number | VoiceJitter; pitch?: number | VoiceJitter };

/** The compressor a bus gets under a `GameAudioOptions.compression` value, or null when it runs dry. */
export function busCompression(option: GameAudioOptions['compression'], bus: BusName): CompressorConfig | null {
  if (option === false) return null;
  if (option === true || option === undefined) return BUS_COMPRESSION[bus];
  const own = option[bus];
  if (own === false) return null;
  return { ...BUS_COMPRESSION[bus], ...(own ?? {}) };
}

/** The pre-wired game mixer. Satisfies the core's `AudioPort` and `MixerLike`. */
export class GameAudio implements MixerLike {
  readonly engine: Engine<BusName>;
  private readonly musicGroup: BusGroup;
  private readonly effectsGroup: BusGroup;
  private readonly duckFrom: SfxBus[];
  private readonly duckAmount: number;
  private readonly normalizeDefault: boolean | LoudnessOptions;
  private readonly compression: GameAudioOptions['compression'];
  private readonly pauseWhenHidden: boolean;
  private unlocked = false;
  private currentMusic: { name: string; voice: MusicVoice } | null = null;
  /** The beds playing under the music (see `ambience`), by name. */
  private readonly beds = new Map<string, MusicVoice>();
  private readonly warned = new Set<string>();
  private readonly onVisibility = (): void => {
    if (!this.unlocked) return;
    const ctx = this.engine.context;
    if (document.hidden) void ctx.suspend().catch(() => {});
    else void ctx.resume().catch(() => {});
  };

  constructor(opts: GameAudioOptions = {}) {
    const musicLevel = opts.music ?? 0.8;
    const fxLevel = opts.effects ?? 1;
    const conc = opts.sfxConcurrency === undefined ? ({ max: 8, steal: 'oldest' } as ConcurrencyConfig) : opts.sfxConcurrency;
    this.normalizeDefault = opts.normalize ?? true;
    this.compression = opts.compression ?? true;
    this.pauseWhenHidden = opts.pauseWhenHidden ?? true;
    const buses = {} as Record<BusName, BusConfig>;
    for (const b of MUSIC_BUSES) buses[b] = { level: musicLevel };
    for (const b of SFX_BUSES) buses[b] = { level: fxLevel, ...(conc ? { concurrency: conc } : {}) };
    const limiter = opts.limiter === false ? undefined : (opts.limiter ?? { threshold: -1 });
    this.engine = createEngine<BusName>({
      buses,
      master: { headroom: opts.masterHeadroom ?? -3, ...(limiter ? { limiter } : {}) },
    });
    this.musicGroup = this.engine.busGroup('music', MUSIC_BUSES.map((b) => this.engine.bus(b)));
    this.effectsGroup = this.engine.busGroup('effects', SFX_BUSES.map((b) => this.engine.bus(b)));
    const df = opts.duckMusicFrom === undefined ? (['wins'] as SfxBus[]) : opts.duckMusicFrom;
    this.duckFrom = df == null ? [] : Array.isArray(df) ? df : [df];
    this.duckAmount = opts.duckAmount ?? 0.5;
  }

  /** The compressor settings a bus gets (merged over the defaults), or null when it runs dry. */
  compressionFor(bus: BusName): CompressorConfig | null {
    return busCompression(this.compression, bus);
  }

  /** Resume the AudioContext from a user gesture and wire the FX (compressors, then duckers). Idempotent. */
  async unlock(): Promise<void> {
    if (this.unlocked) return;
    await this.engine.unlock();
    this.unlocked = true;
    const ctx = this.engine.context;
    // Compress first, so the ducker's dip on the music is not undone by the compressor.
    for (const name of [...MUSIC_BUSES, ...SFX_BUSES]) {
      const cfg = this.compressionFor(name);
      if (cfg) this.engine.bus(name).addFx(new Compressor(ctx, cfg));
    }
    for (const src of this.duckFrom) {
      for (const target of MUSIC_BUSES) {
        this.engine.bus(target).addFx(new Ducker(ctx, this.engine.bus(src), { amount: this.duckAmount, attack: 0.05, release: 0.3 }));
      }
    }
    if (this.pauseWhenHidden && typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', this.onVisibility);
      this.onVisibility();
    }
  }

  // ── MixerLike (the HUD rows + mute drive these) ──────────────────────────────
  setGroupLevel(group: MixerGroup, level: number): void {
    (group === 'music' ? this.musicGroup : this.effectsGroup).level = level;
  }
  getGroupLevel(group: MixerGroup): number {
    return (group === 'music' ? this.musicGroup : this.effectsGroup).level;
  }
  setMuted(muted: boolean): void {
    this.musicGroup.muted = muted;
    this.effectsGroup.muted = muted;
  }

  /** A single bus (for sends, extra FX inserts, meters). */
  bus(name: BusName): Bus {
    return this.engine.bus(name);
  }
  /** A volume group handle (`'music'` or `'effects'`). */
  group(name: MixerGroup): BusGroup {
    return name === 'music' ? this.musicGroup : this.effectsGroup;
  }

  /** Load a manifest of sounds, variants and music onto their buses. A file that fails is reported, the rest still load. */
  async load(entries: SoundEntry[]): Promise<void> {
    const results = await Promise.allSettled(entries.map((e) => this.loadOne(e)));
    const failed = results.flatMap((r, i) => (r.status === 'rejected' ? [`${entries[i]!.name}: ${String(r.reason)}`] : []));
    if (failed.length) throw new Error(`${failed.length} sound(s) failed to load:\n  ${failed.join('\n  ')}`);
  }

  private async loadOne(e: SoundEntry): Promise<void> {
    if (e.kind === 'music') {
      await this.engine.loadMusic(
        e.name,
        { loop: e.loop, ...(e.intro ? { intro: e.intro } : {}), ...(e.outro ? { outro: e.outro } : {}) },
        { bus: e.bus ?? 'music', ...(e.loopCrossfadeMs != null ? { loopCrossfade: e.loopCrossfadeMs / 1000 } : {}) },
      );
      return;
    }
    const normalize = e.normalize ?? this.normalizeDefault;
    if (e.kind === 'variants') {
      await this.engine.loadVariants(e.name, e.urls, { bus: e.bus ?? 'ui', normalize, strategy: e.strategy ?? 'shuffle-bag' });
      return;
    }
    await this.engine.loadSound(e.name, e.url, { bus: e.bus ?? 'ui', normalize });
  }

  /** Is a sound (or a set of variants) of this name loaded? */
  has(name: string): boolean {
    return this.engine.hasVariants(name) || this.engine.hasSound(name);
  }

  /**
   * Fire a one-shot (a variants set plays its next take). `volume` / `pitch` take a `VoiceJitter`
   * (`{ base, jitter }`) so repeated cues vary per voice instead of sounding cloned. A name that
   * is not loaded (yet) is skipped with one warning: a missing sound never breaks a round.
   */
  play(name: string, opts?: PlayOpts): void {
    const o = {
      ...(opts?.bus ? { bus: opts.bus } : {}),
      ...(opts?.volume != null ? { volume: opts.volume } : {}),
      ...(opts?.pitch != null ? { pitch: opts.pitch } : {}),
    };
    try {
      if (this.engine.hasVariants(name)) this.engine.variants(name).play(o);
      else this.engine.sound(name).play(o);
    } catch (e) {
      this.warnOnce(name, e);
    }
  }

  /**
   * Start a looping sound (a reel-spin bed, an anticipation riser) and get its handle; stop it
   * with a fade when the moment is over. A sound that is not loaded returns a no-op handle.
   */
  loop(name: string, opts: PlayOpts & { fadeIn?: number } = {}): AudioLoop {
    try {
      const voice = this.engine.sound(name).play({
        loop: true,
        fadeIn: opts.fadeIn ?? 0.05,
        ...(opts.bus ? { bus: opts.bus } : {}),
        ...(opts.volume != null ? { volume: opts.volume } : {}),
        ...(opts.pitch != null ? { pitch: opts.pitch } : {}),
      });
      let stopped = false;
      return {
        stop: (o) => {
          if (stopped) return;
          stopped = true;
          voice.stop({ fade: o?.fade ?? 0.15 });
        },
      };
    } catch (e) {
      this.warnOnce(name, e);
      return { stop: () => {} };
    }
  }

  /**
   * Switch the music: the playing track fades out while `name` fades in (a crossfade; base ↔ bonus
   * music). Asking for the track that is already playing does nothing.
   */
  music(name: string, opts?: { fadeIn?: number; fadeOut?: number }): void {
    if (this.currentMusic?.name === name) return;
    try {
      this.currentMusic?.voice.stop({ fade: opts?.fadeOut ?? 0.6 });
      this.currentMusic = { name, voice: this.engine.music(name).play({ fadeIn: opts?.fadeIn ?? 0.8 }) };
    } catch (e) {
      this.currentMusic = null;
      this.warnOnce(name, e);
    }
  }

  /**
   * Start a bed under the music: a looping track (a street, a room, the sea) that plays beside
   * whatever music is on, rides the MUSIC row and the duck like it, and is never crossfaded by
   * `music()`. Starting a bed that plays already does nothing.
   */
  ambience(name: string, opts?: { fadeIn?: number }): void {
    if (this.beds.has(name)) return;
    try {
      this.beds.set(name, this.engine.music(name).play({ fadeIn: opts?.fadeIn ?? 2 }));
    } catch (e) {
      this.warnOnce(name, e);
    }
  }

  /** Stop one bed, or every bed with no name, fading out. */
  stopAmbience(name?: string, opts?: { fade?: number }): void {
    for (const [bed, voice] of [...this.beds]) {
      if (name !== undefined && bed !== name) continue;
      voice.stop({ fade: opts?.fade ?? 0.8 });
      this.beds.delete(bed);
    }
  }

  /** Stop the music: a fade, or with `outro: true` its authored ending at the next loop boundary. */
  stopMusic(opts?: { fade?: number; outro?: boolean }): void {
    const m = this.currentMusic;
    this.currentMusic = null;
    if (!m) return;
    if (opts?.outro && m.voice.skipToOutro) m.voice.skipToOutro({ at: 'loop-end' });
    else m.voice.stop({ fade: opts?.fade ?? 0.4 });
  }

  /** The music track playing now, if any. */
  get musicPlaying(): string | null {
    return this.currentMusic?.name ?? null;
  }

  /** Detach the page listeners and close the AudioContext. */
  async dispose(): Promise<void> {
    if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', this.onVisibility);
    await this.engine.close();
  }

  private warnOnce(name: string, e: unknown): void {
    if (this.warned.has(name)) return;
    this.warned.add(name);
    console.warn(`[artubeplate] sound "${name}" did not play: ${e instanceof Error ? e.message : String(e)}`);
  }
}

export function createGameAudio(opts?: GameAudioOptions): GameAudio {
  return new GameAudio(opts);
}

/**
 * Bind the HUD's SOUND / MUSIC rows (and the mute) to the audio groups. Returns a disposer.
 * `createArtubeGame` calls this for you when you pass `audio`; use it directly only to opt out
 * or wire a mixer the core didn't get. The HUD remembers the settings (`persist`).
 */
export function bindAudioToHud(audio: GameAudio, hud: DomHud): () => void {
  return bindMixerToHud(audio, hud);
}
