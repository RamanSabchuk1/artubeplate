// The round state machine. A round is an explicit sequence of awaited phases
// (Idle → Spin → Present → Settle); each `enter` does its work and transitions on. The core
// ships Idle/Spin/Settle; the game writes Present (and may override any). The FSM + context are
// pure — the HUD/view/audio arrive via ports, so a whole round runs headless.

import type { RgsTransport } from '../rgs/network';
import type { RootStore } from '../stores/index';
import type { GameConfig } from '../game/config';
import type { Ticker } from './ticker';
import type { TurboState } from './turbo';
import type { HudPort } from './hud-port';
import type { GameRound, InterpretBook } from './round';

/** A fixed value or a per-voice random spread (`{ base, jitter }`). */
export type AudioValue = number | { base?: number; jitter?: number };

/** A playing loop (a reel-spin bed, an anticipation riser): stop it with a fade. */
export interface AudioLoop {
  stop(opts?: { fade?: number }): void;
}

/** The audio surface phases call (satisfied by `@artubeplate/core/audio`'s GameAudio). */
export interface AudioPort {
  /** A one-shot (a variants set plays its next take). An unknown name is skipped, never thrown. */
  play(name: string, opts?: { bus?: string; volume?: AudioValue; pitch?: AudioValue }): void;
  /** Switch the music, crossfading from the track playing now. */
  music(name: string, opts?: { fadeIn?: number; fadeOut?: number }): void;
  /** Stop the music: a fade, or its authored outro at the next loop boundary. */
  stopMusic(opts?: { fade?: number; outro?: boolean }): void;
  /** Start a looping bed under the music (never crossfaded by `music`). Optional. */
  ambience?(name: string, opts?: { fadeIn?: number }): void;
  /** Start a looping sound and get its handle. Optional: a minimal port may not loop. */
  loop?(name: string, opts?: { bus?: string; volume?: AudioValue; pitch?: AudioValue; fadeIn?: number }): AudioLoop;
}

/** The boot loader surface (the Artube loader, driven by the core). */
export interface LoaderPort {
  setProgress(p: number): void;
  done(): Promise<void>;
}

/**
 * Optional hooks a view (the object `mountView` returned) may implement. The core calls them —
 * a game never overrides the network-sending phase to get these.
 */
export interface ViewHooks {
  /** A round is starting: begin the spin animation NOW, before the network answers. */
  onSpinStart?(): void;
  /** The round request failed: stop the reels on a neutral board. */
  onSpinAbort?(): void;
  /** The player slam-stopped: land the reels now. */
  slamStop?(): void;
  /**
   * Resolves once the game may start: after an intro screen, say. The core keeps the HUD hidden
   * and holds the first idle (and the free-rounds offer) until then.
   */
  whenPlayable?(): Promise<void>;
}

export interface PhaseContext<T = unknown, V = unknown, P = unknown> {
  readonly config: GameConfig;
  readonly stores: RootStore;
  readonly network: RgsTransport;
  readonly hud: HudPort;
  readonly ticker: Ticker;
  /** Whatever `mountView` returned. */
  readonly view: V;
  readonly audio: AudioPort | null;
  /** Speed + slam-stop (core-owned). Use `ctx.turbo.delay(ms)` for game animation timing. */
  readonly turbo: TurboState;
  readonly interpretBook: InterpretBook<T, P>;
  readonly fsm: FSM<T, V, P>;
  /** Set by Spin, read by Present/Settle. */
  round: GameRound<T, P> | null;
  /**
   * The spin's outcome is UNKNOWN (no answer came back). Never retry: the boot layer waits for
   * the connection, re-reads `session`, replaces local state, and shows what the platform says.
   * `notice` is shown once the state is back (a server error the player must hear about).
   */
  readonly recover: (reason: string, opts?: { notice?: { title: string; message: string } }) => Promise<void>;
  /** Called by Settle after each round (history, free-rounds bookkeeping). */
  readonly afterRound: (round: GameRound<T, P>) => Promise<void>;
}

export interface Phase<T = unknown, V = unknown, P = unknown> {
  readonly name: string;
  enter(ctx: PhaseContext<T, V, P>): Promise<void> | void;
  exit?(ctx: PhaseContext<T, V, P>): void;
}

export class FSM<T = unknown, V = unknown, P = unknown> {
  private ctx: PhaseContext<T, V, P> | null = null;
  private readonly byName = new Map<string, Phase<T, V, P>>();
  private _current = '';

  /** Later phases with the same `name` win — so a game's Present overrides the default. */
  constructor(phases: Phase<T, V, P>[]) {
    for (const p of phases) this.byName.set(p.name, p);
  }

  bind(ctx: PhaseContext<T, V, P>): void {
    this.ctx = ctx;
  }

  get current(): string {
    return this._current;
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  async transition(name: string): Promise<void> {
    if (!this.ctx) throw new Error('[FSM] not bound to a context');
    const next = this.byName.get(name);
    if (!next) throw new Error(`[FSM] unknown phase: ${name}`);
    this.byName.get(this._current)?.exit?.(this.ctx);
    this._current = name;
    await next.enter(this.ctx);
  }
}
