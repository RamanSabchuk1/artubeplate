// createArtubeGame — the one-call façade. `start()` runs the whole Artube boot with zero game
// involvement:
//
//   Artube loader → connect (real SignalR hub, or the mock playing the game's own math) →
//   `session` → HUD (open-slot-ui DOM, built from the SESSION: currency, bets, modes, prices,
//   RTP) → the game's scene → idle, then the operator's free-rounds offer and a round left
//   unseen by a reload.
//
// …and then it owns the platform's rules for the life of the session: stake by INDEX, never
// replay a spin, reconnect → `session` → replace state, free rounds (`betIndex: null`, activate
// once per connection, re-activate after a reconnect), errors by `errorId`, the max-win cap
// modal, one-connection-per-session, session end, demo sessions, autoplay, speed + slam-stop,
// buy features and lucky bets, audio, gamification.
//
// The game supplies config + a pure `interpretBook` + `mountView` (+ its Present phase, audio).

import { mountDomHud, type DomHud, type DomHudOptions } from '@open-slot-ui/dom';
import type { CurrencySpec } from '@open-slot-ui/core';
import { readRuntime, isArtubeLaunch, type RuntimeConfig } from '../rgs/runtime';
import { loadNetwork, type CreateNetworkOptions } from '../rgs/index';
import type { MockRgsOptions } from '../rgs/MockRgs';
import type { RgsTransport } from '../rgs/network';
import { RgsError, RGS_ERRORS, rgsErrorFrom } from '../rgs/errors';
import type { FreeRoundCampaign, SessionResponse } from '../rgs/protocol';
import { RootStore } from '../stores/index';
import { RealTicker, type Ticker } from '../engine/ticker';
import { TurboClock, type TurboState } from '../engine/turbo';
import { FSM, type AudioPort, type Phase, type PhaseContext, type ViewHooks } from '../engine/fsm';
import { defaultPhases, SettlePhase } from '../engine/phases';
import { presentRgsError } from '../engine/errors';
import { roundMoney, type GameRound, type InterpretBook, type RoundInfo } from '../engine/round';
import type { HudPort } from '../engine/hud-port';
import { currencyFor } from '../currency';
import { artubeplateSkinCss } from '../skin';
import { fitToSlot } from '../skin/fit';
import { bindMixerToHud, startMusicOnFirstGesture, type MixerLike } from '../audio/bind';
import { bindInputSounds, type InputSoundMap } from '../audio/inputs';
import type { GameAudioOptions, SoundEntry } from '../audio';
import { resolveGameConfig, type GameConfig } from './config';
import { buildSpec, buyCardsFor, baseModeOf } from './spec';
import { frcChoice, frcNotice, rememberFrcChoice } from './frc';
import { domHudPort, livesPips } from './hudAdapter';
import { createArtubeLoader, type GameLoader } from './loader';
import { showBootError } from './bootError';
import { gamificationView, startGamification, type GamificationOptions, type GamificationView } from './gamification';
import { autoplayLoop } from './autoplay';

/** Declarative audio: the core builds the zvuk mixer (in its own lazy chunk) and wires it. */
export interface AudioSpec extends GameAudioOptions {
  sounds: SoundEntry[];
  inputSounds?: InputSoundMap;
  /** A `kind:'music'` entry the core starts on the first user gesture. */
  bgm?: string;
  bgmFadeIn?: number;
  /**
   * Beds under the music (`kind:'music'` entries, an ambience track say) the core starts on the
   * first user gesture beside the bgm. They loop on the MUSIC row and are never crossfaded.
   */
  ambience?: string | string[];
  /** Seconds the beds fade in over. Default 2. */
  ambienceFadeIn?: number;
}

/** Handed to `mountView` — everything the scene needs, after the session is known. */
export interface ViewContext {
  config: GameConfig;
  stores: RootStore;
  hud: DomHud;
  ticker: Ticker;
  audio: AudioPort | null;
  turbo: TurboState;
  loader: GameLoader;
  /** The session as the RGS sent it. */
  session: SessionResponse;
  /** `gameSettings.config` — the manifest's `settings.config`, verbatim. */
  gameConfig: unknown;
  /** `mock` when running on the local mock RGS. */
  transport: 'artube' | 'mock';
}

export interface CreateArtubeGameOptions<T = unknown, V = unknown, P = unknown> {
  config: GameConfig;
  /** The book payload (`spinResult.payload`, typed `P`) → your model. Pure. */
  interpretBook: InterpretBook<T, P>;
  /** Mount your scene; the returned object is `ctx.view` in the phases (may implement ViewHooks). */
  mountView: (host: HTMLElement, ctx: ViewContext) => V | Promise<V>;
  /** Your Present phase (+ any overrides). Idle/Spin/Settle are provided. */
  phases?: Phase<T, V, P>[];
  audio?: AudioPort | AudioSpec | null;
  /** Override the transport entirely (tests). */
  network?: RgsTransport;
  /** Override launch params (tests / embedding). */
  runtime?: Partial<RuntimeConfig>;
  /** Defaults for the local mock RGS (the math URL, starting balance…); the URL's knobs win. */
  mock?: MockRgsOptions;
  /** Options for the real SignalR client. */
  artube?: CreateNetworkOptions['artube'];
  /** Where the HUD mounts (default `document.body`). */
  hudHost?: HTMLElement;
  /** Where the scene mounts (default `hudHost`). */
  sceneHost?: HTMLElement;
  /** Passthrough to `mountDomHud` (icons, keyboard, motion, channel…). */
  hudOptions?: Omit<DomHudOptions, 'container' | 'skin' | 'features' | 'onBuy'>;
  /** `manual: true` → the game calls `ctx.loader.done()` when its art is in. */
  loader?: { manual?: boolean };
  /** The platform's gamification widget — started only when the session carries a token. */
  gamification?: GamificationOptions | false;
}

export interface GameSnapshot {
  phase: string;
  balance: number;
  bet: number;
  betIndex: number;
  lastWin: number;
  currency: string | null;
  spinning: boolean;
  freeRounds: FreeRoundCampaign | null;
  freeRoundsActive: boolean;
  transport: 'artube' | 'mock';
}

export interface ArtubeGame {
  start(): Promise<void>;
  dispose(): void;
  /** Current phase + store values (for harnesses and tests — no screenshots needed). */
  inspect(): GameSnapshot;
  /** Spin exactly as the round button does (only from idle). */
  requestSpin(): boolean;
  /** Play a mode once (a bought feature) exactly as the buy sheet does. */
  requestBuy(modeId: string): boolean;
  /** The transport — the MockRgs instance in local dev (script it: forceRow, failNext…). */
  readonly network: RgsTransport;
  /** The HUD, once mounted. */
  readonly hud: DomHud | null;
}

const LAST_SEEN_KEY = 'artubeplate.lastRound';

// The last round this player saw to the end, per GAME and kept across sessions: Artube's
// `session` hands back the player's last round even in a brand-new session, so "you missed this"
// must mean missed on this device — not "new tab".
function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function storageSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage blocked — the unseen-round replay just won't be offered */
  }
}

function isAudioSpec(a: unknown): a is AudioSpec {
  return !!a && typeof a === 'object' && Array.isArray((a as AudioSpec).sounds);
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The bar's buttons are glyph-only — give each an accessible name. */
const ARIA_LABELS: Record<string, string> = {
  PlaceBetBtn: 'Spin',
  StopBtn: 'Stop',
  StartAutoplayBtn: 'Start autoplay',
  StopAutoplayBtn: 'Stop autoplay',
  AutoplayBtn: 'Autoplay',
  MainMenuToggle: 'Menu',
  BetAmountIncrease: 'Increase bet',
  BetAmountDecrease: 'Decrease bet',
  FeatureBuyToggle: 'Buy feature',
  FeatureBuyAmountIncrease: 'Increase bet',
  FeatureBuyAmountDecrease: 'Decrease bet',
};
function labelHud(root: HTMLElement): void {
  for (const [id, label] of Object.entries(ARIA_LABELS)) root.querySelector(`[id="${id}"]`)?.setAttribute('aria-label', label);
}

/** How often an idle, visible game reads the wallet again (see `refreshBalance`). */
const BALANCE_POLL_MS = 30_000;

export function createArtubeGame<T = unknown, V = unknown, P = unknown>(opts: CreateArtubeGameOptions<T, V, P>): ArtubeGame {
  const runtime = readRuntime({ overrides: opts.runtime, ...(opts.config.gameServerId ? { gameServerId: opts.config.gameServerId } : {}) });
  const lastSeenKey = (): string => `${LAST_SEEN_KEY}.${runtime.game || opts.config.title}`;
  const stores = new RootStore();
  const ticker = new RealTicker();
  const turbo = new TurboClock(opts.config.turboSpeeds);
  /** The effective config (the game's, merged with `fromSession` once the session is known). */
  let config: GameConfig = opts.config;
  let audio: AudioPort | null = opts.audio && !isAudioSpec(opts.audio) ? opts.audio : null;
  const disposers: Array<() => void> = [];
  let hud: DomHud | null = null;
  let port: HudPort | null = null;
  let fsm: FSM<T, V, P> | null = null;
  let ctx: PhaseContext<T, V, P> | null = null;
  let currency: CurrencySpec = currencyFor('EUR');
  let settle: SettlePhase<T, V, P> | null = null;
  /** Once the session is over (closed, replaced, fatal) nothing else is shown or sent. */
  let terminal = false;
  let recovering: Promise<void> | null = null;

  /** A transport that refuses everything with `err`: what the game holds until `start()` has
   *  picked the real one, or when it could not (a real launch with no game id). */
  const refusing = (err: unknown, kind: RgsTransport['kind']): RgsTransport => ({
    kind,
    connect: () => Promise.reject(err),
    session: () => Promise.reject(err),
    spin: () => Promise.reject(err),
    balance: () => Promise.reject(err),
    activateFreeRoundCampaign: () => Promise.reject(err),
    on: () => () => {},
    dispose: async () => {},
  });
  const networkOptions: CreateNetworkOptions = { ...(opts.mock ? { mock: opts.mock } : {}), ...(opts.artube ? { artube: opts.artube } : {}) };
  /** The game's own transport, or the one `start()` loads for this launch (see `loadNetwork`). */
  let network: RgsTransport = opts.network ?? refusing(new Error('[artubeplate] the game has not started'), runtime.mock ? 'mock' : 'artube');

  // ── helpers ──────────────────────────────────────────────────────────────────
  const fatal = (title: string, message: string, actions: Array<{ label: string; primary?: boolean }> = []): void => {
    if (terminal) return;
    terminal = true;
    revealHud(); // a fatal notice must be seen even over an intro screen
    hud?.ui.autoplay.stop();
    void port?.notice({ title, message, actions, blocking: true }).then((i) => {
      if (actions[i]?.label === 'Reload') location.reload();
    });
  };

  /**
   * The connection is down: a blocking notice with RELOAD (the player can always start over),
   * the way Artube's own reconnect shows it. It is not terminal: it goes away by itself when the
   * connection comes back, and the game carries on from what `session` says.
   */
  let connectionNoticeUp = false;
  let connectionNoticeToken = 0;
  const showConnectionLost = (message: string): void => {
    if (terminal || !port) return;
    revealHud();
    hud?.ui.autoplay.stop();
    const token = ++connectionNoticeToken;
    connectionNoticeUp = true;
    void port.notice({ title: 'Connection lost', message, actions: [{ label: 'Reload', primary: true }], blocking: true }).then((i) => {
      if (token === connectionNoticeToken) connectionNoticeUp = false;
      if (i === 0) location.reload();
    });
  };
  const hideConnectionLost = (): void => {
    if (!connectionNoticeUp) return;
    connectionNoticeUp = false;
    connectionNoticeToken++;
    port?.hideNotice();
  };
  /**
   * Read the wallet's balance and show it — between rounds only (a round in flight owns the
   * balance until its settle), when the transport can send, one read at a time. A failed read
   * changes nothing: the next one, or the next round's answer, brings the balance.
   */
  let balanceRead: Promise<void> | null = null;
  const between = (): boolean => !!fsm && fsm.current === 'idle' && !stores.ui.spinning.get();
  const refreshBalance = (): Promise<void> => {
    if (balanceRead) return balanceRead;
    if (terminal || recovering || network.connected === false || !between()) return Promise.resolve();
    balanceRead = (async () => {
      try {
        const { balance } = await network.balance();
        if (between() && Number.isFinite(balance)) stores.balance.balance.set(balance);
      } catch {
        /* the next read, or the next round, brings it */
      }
    })().finally(() => {
      balanceRead = null;
    });
    return balanceRead;
  };

  /** Resolve once the transport can send again (it says so through `connected`). */
  const untilConnected = async (): Promise<void> => {
    while (!terminal && network.connected === false) await new Promise((r) => setTimeout(r, 500));
  };

  /**
   * The HUD stays hidden until the view is playable (an intro screen may cover the game first).
   * Not via `visibility` (the HUD toggles that itself while its skin loads): transparent, inert
   * and click-through, so taps on the intro never reach an invisible button.
   */
  let hudHidden = false;
  const hideHud = (): void => {
    if (!hud) return;
    hudHidden = true;
    hud.root.inert = true;
    hud.root.style.opacity = '0';
    hud.root.style.pointerEvents = 'none';
  };
  const revealHud = (): void => {
    const root = hud?.root;
    if (!root || !hudHidden) return;
    hudHidden = false;
    root.inert = false;
    root.style.pointerEvents = '';
    root.style.transition = 'opacity 0.35s ease';
    requestAnimationFrame(() => (root.style.opacity = '1'));
    root.addEventListener(
      'transitionend',
      () => {
        root.style.transition = '';
        root.style.opacity = '';
      },
      { once: true },
    );
  };

  /** Apply a (fresh) session to the stores + HUD. `replace` = after a reconnect. */
  const applySession = (s: SessionResponse, replace: boolean): void => {
    stores.session.current.set(s);
    const ss = s.sessionSettings;
    currency = currencyFor(ss.currency, ss.currencyMinimalUnit);
    stores.ui.baseMode = baseModeOf(s.gameSettings.gameModes)?.id ?? 'base';
    stores.balance.balance.set(s.balance);
    if (hud && replace) {
      hud.setCurrency(currency);
      const levels = ss.allowedBets.length ? ss.allowedBets : [1];
      // Keep the player's bet if it is still offered, else the session default.
      const keep = levels.indexOf(stores.balance.bet.get());
      const idx = keep >= 0 ? keep : Math.max(0, Math.min(levels.length - 1, ss.defaultBetIndex));
      hud.ui.betStepper.setLevels(levels, idx);
      syncBetFromHud();
    }
    stores.frc.campaign.set(s.freeRoundCampaign);
  };

  /** Read the base bet + index from the HUD's stepper (the source of truth for the stake). */
  const syncBetFromHud = (): void => {
    if (!hud) return;
    stores.balance.betIndex.set(hud.ui.betStepper.index.get());
    stores.balance.bet.set(hud.ui.betStepper.value);
    applyBetDisplay();
  };

  /** The bet readout shows the EFFECTIVE stake while a lucky bet (ante) is on. */
  const applyBetDisplay = (): void => {
    if (!hud) return;
    if (stores.frc.active) {
      hud.ui.bet.set(stores.frc.campaign.get()?.bet ?? stores.balance.bet.get());
      hud.ui.bet.setEmphasis(false);
      return;
    }
    const ante = stores.ui.activeMode.get();
    const mult = ante ? (stores.session.mode(ante)?.priceMultiplier ?? 1) : 1;
    hud.ui.bet.set(roundMoney(stores.balance.bet.get() * mult, stores.session.current.get()?.sessionSettings.currencyMinimalUnit ?? 0.01));
    hud.ui.bet.setEmphasis(mult !== 1);
  };

  /**
   * Round controls: bet steppers, the buy coin and the autoplay button are off while a round
   * runs, autoplay is on, or free rounds play. SPIN stays live (mid-round it is the slam-stop), and
   * so does STOP of a running autoplay (the HUD never locks that). An open buy or autoplay sheet
   * closes. The HUD root says so too (`data-round-busy`), for a game's own styling.
   */
  const syncControls = (): void => {
    if (!hud) return;
    const u = hud.ui;
    const busy = stores.ui.spinning.get() || stores.frc.active || terminal || u.autoplay.isActive;
    if (hud.root.dataset.roundBusy !== String(busy)) hud.root.dataset.roundBusy = String(busy);
    if (busy) {
      u.betPlus.disable();
      u.betMinus.disable();
      u.bonusButton.disable();
      u.autoplayMenuButton.disable();
      if (u.autoplayPanel.isOpen && !u.autoplay.isActive) u.autoplayPanel.closePanel();
      if (hud.root.querySelector('#FeatureBuyWindow.is-visible')) (hud.root.querySelector('#FeatureBuyClose') as HTMLElement | null)?.click();
    } else {
      u.betStepper.canInc ? u.betPlus.enable() : u.betPlus.disable();
      u.betStepper.canDec ? u.betMinus.enable() : u.betMinus.disable();
      u.bonusButton.enable();
      u.autoplayMenuButton.enable();
    }
  };

  const clearAnte = (): void => {
    if (!hud || !stores.ui.activeMode.get()) return;
    stores.ui.activeMode.set(null);
    hud.ui.setBetModifier(null);
    applyBetDisplay();
  };

  // ── free rounds ──────────────────────────────────────────────────────────────
  let frcPrevBetIndex: number | null = null;
  const enterFreeRounds = (c: FreeRoundCampaign): void => {
    if (!hud) return;
    clearAnte();
    stores.frc.campaign.set(c);
    stores.frc.activated.set(true);
    // Remember the player's own bet — once (a re-activation after a reconnect must not
    // overwrite it with the campaign's).
    if (frcPrevBetIndex === null) frcPrevBetIndex = stores.balance.betIndex.get();
    const idx = stores.session.allowedBets.indexOf(c.bet);
    if (idx >= 0) hud.ui.betStepper.setIndex(idx);
    hud.setFreeRounds(c.roundsLeft);
    hud.setTotalWin(c.totalWin);
    applyBetDisplay();
    syncControls();
  };
  const exitFreeRounds = (): void => {
    if (!hud) return;
    stores.frc.activated.set(false);
    hud.setFreeRounds(0);
    hud.setTotalWin(0);
    if (frcPrevBetIndex !== null) hud.ui.betStepper.setIndex(frcPrevBetIndex);
    frcPrevBetIndex = null;
    syncBetFromHud();
    syncControls();
  };

  const activateCampaign = async (c: FreeRoundCampaign): Promise<void> => {
    if (!port) return;
    if (!stores.session.allowedBets.includes(c.bet)) {
      // The docs: a campaign whose bet is not in allowedBets is an error — never activate it.
      console.warn(`[artubeplate] free rounds bet ${c.bet} is not in allowedBets — the campaign is not activated`);
      await port.notice({ title: 'Free rounds', message: 'This free rounds offer cannot be played in this session.' });
      return;
    }
    try {
      const state = await network.activateFreeRoundCampaign(c.campaignId);
      enterFreeRounds(state ?? c);
    } catch (e) {
      const err = rgsErrorFrom(e, 'activateFreeRoundCampaign');
      if (err.errorId === RGS_ERRORS.FRC_ALREADY_ACTIVE) enterFreeRounds(c); // already on: keep spinning
      else {
        await presentRgsError(port, err);
        if (err.errorId === RGS_ERRORS.FRC_PLAYED_OUT || err.errorId === RGS_ERRORS.FRC_NOT_FOUND || err.errorId === RGS_ERRORS.FRC_UNAVAILABLE) {
          stores.frc.campaign.set(null);
          exitFreeRounds();
        }
      }
    }
  };

  /**
   * The operator's campaign at the start of a session, or silently again after a reconnect.
   * Every new session opens with the offer, a campaign started in an earlier session included
   * (it says what is left). A reload after accepting says where the campaign stands and carries
   * on. Once declined, it is not offered again in this session. See ./frc.
   */
  const offerCampaign = async (reactivate: boolean): Promise<void> => {
    const c = stores.frc.campaign.get();
    if (!port || !c || c.isComplete || c.roundsLeft <= 0 || terminal) return;
    // A reconnect: Artube's activation is per connection, so activate again — no second offer.
    if (reactivate) return activateCampaign(c);
    const before = frcChoice(runtime.sessionId, c.campaignId);
    if (before === 'declined') return;
    const choice = await port.notice(frcNotice(c, before === 'accepted' ? 'resume' : 'offer', port.format));
    if (terminal) return;
    if (before === 'accepted' || choice === 0) {
      rememberFrcChoice(runtime.sessionId, c.campaignId, 'accepted');
      await activateCampaign(c);
    } else if (choice === 1) rememberFrcChoice(runtime.sessionId, c.campaignId, 'declined');
  };

  // ── rounds: free-rounds bookkeeping, the unseen-round replay ───────────────────
  const afterRound = async (r: GameRound<T, P>): Promise<void> => {
    if (r.replay) return;
    storageSet(lastSeenKey(), r.roundId);
    if (r.freeRound) {
      const c = stores.frc.campaign.get();
      if (c) {
        hud?.setFreeRounds(c.roundsLeft);
        hud?.setTotalWin(c.totalWin);
        if (c.isComplete || c.roundsLeft <= 0) {
          hud?.ui.autoplay.stop();
          await port!.notice({ title: 'Free rounds complete', message: `You won ${port!.format(c.totalWin)} in free rounds.` });
          stores.frc.campaign.set(null);
          exitFreeRounds();
        }
      }
    }
  };

  /** Build a round from a restored one (session.round) so the Present phase can replay it. */
  const restoredToRound = (s: SessionResponse): GameRound<T, P> | null => {
    const rr = s.round;
    if (!rr || rr.payload === undefined) return null;
    const mode = stores.session.mode(rr.gameMode ?? stores.ui.baseMode);
    const bet = rr.bet ?? stores.balance.bet.get();
    const info: RoundInfo = {
      roundId: rr.roundId ?? 'restored',
      mode: mode?.id ?? stores.ui.baseMode,
      modeType: mode?.type ?? 'None',
      bet,
      priceMultiplier: mode?.priceMultiplier ?? 1,
      stake: 0, // already paid and settled — the replay must not count it again
      multiplier: rr.winMultiplier ?? (bet > 0 && rr.totalWin ? rr.totalWin / bet : 0),
      totalWin: rr.totalWin ?? 0,
      maxWinReached: false,
      freeRound: false,
    };
    try {
      return { ...info, data: opts.interpretBook(rr.payload as P, info), balance: s.balance, raw: rr.raw as GameRound<T, P>['raw'], replay: true };
    } catch {
      return null;
    }
  };

  /** Resolve once the round machine is back at idle (or after `ms`). */
  const whenIdle = async (ms = 8000): Promise<boolean> => {
    const until = Date.now() + ms;
    while (fsm && fsm.current !== 'idle' && Date.now() < until) await new Promise((r) => setTimeout(r, 50));
    return fsm?.current === 'idle';
  };

  /** A restored round the player has not seen (a reload mid-animation) → offer the replay. */
  const offerUnseenRound = async (s: SessionResponse): Promise<void> => {
    const rr = s.round;
    if (!rr?.roundId || !port || !fsm || !ctx) return;
    if (storageGet(lastSeenKey()) === rr.roundId) return;
    storageSet(lastSeenKey(), rr.roundId);
    // Free rounds play themselves: no replay prompt in their way. That round is already in the
    // balance and in the campaign's win.
    if (stores.frc.active) return;
    const round = restoredToRound(s);
    if (!round) return;
    const choice = await port.notice({
      title: 'Your last round',
      message: `Your last round finished while you were away${round.totalWin > 0 ? ` — it paid ${port.format(round.totalWin)}` : ''}. Watch it now?`,
      actions: [{ label: 'Watch', primary: true }, { label: 'Skip' }],
    });
    if (choice !== 0) return;
    await replayRound(round);
  };

  /** Play a settled round through Present (`replay` — no money, history or net position). */
  const replayRound = async (round: GameRound<T, P>): Promise<void> => {
    if (!fsm || !ctx || !(await whenIdle())) return;
    hud?.ui.lock();
    try {
      ctx.round = round;
      stores.ui.spinning.set(true);
      await fsm.transition('present');
    } finally {
      hud?.ui.unlock();
      if (fsm.current !== 'idle') await fsm.transition('idle');
    }
  };

  /**
   * RECOVERY — the spin's outcome is unknown, or the connection came back. Never resend the
   * spin: wait for the connection, re-read `session`, replace local state wholesale, restore
   * free rounds (activation is per connection), and show what the platform says happened.
   */
  const recover = (reason: string, opts: { notice?: { title: string; message: string } } = {}): Promise<void> => {
    if (recovering) return recovering;
    recovering = (async () => {
      if (terminal || !port) return;
      console.info(`[artubeplate] recovering (${reason})`);
      hud?.ui.autoplay.stop();
      const wasFrc = stores.frc.activated.get();
      let s: SessionResponse | null = null;
      for (let failures = 0; !terminal; ) {
        try {
          s = await network.session();
          break;
        } catch (e) {
          const err = rgsErrorFrom(e, 'session');
          if (err.sessionOver) {
            await presentRgsError(port, err);
            terminal = true;
            return;
          }
          // No connection: wait for it to come back, however long that takes. The connection
          // notice (with RELOAD) is up meanwhile, and the transport keeps trying. Counting these
          // as failures gave up after ~20 s and stranded a game whose network came back later.
          if (network.connected === false) {
            await untilConnected();
            continue;
          }
          if (++failures >= 6) break;
          await new Promise((r) => setTimeout(r, 1000 * failures));
        }
      }
      if (!s) {
        if (!terminal) fatal('Connection lost', 'The game could not reach the server. Reload to continue — your balance is safe.', [{ label: 'Reload', primary: true }]);
        return;
      }
      hideConnectionLost();
      applySession(s, true);
      stores.frc.activated.set(false);
      if (wasFrc && s.freeRoundCampaign && !s.freeRoundCampaign.isComplete) await offerCampaign(true);
      else if (wasFrc) exitFreeRounds();
      syncControls();
      if (opts.notice && !terminal) await port.notice({ ...opts.notice, actions: [{ label: 'OK', primary: true }] });
      // What the platform says happened — shown once the interrupted round has wound down.
      const restored = s;
      void whenIdle().then((idle) => (idle ? offerUnseenRound(restored) : undefined));
    })().finally(() => {
      recovering = null;
    });
    return recovering;
  };

  // ── audio ────────────────────────────────────────────────────────────────────
  let audioLoaded: Promise<unknown> = Promise.resolve();
  const resolveAudio = async (): Promise<void> => {
    if (!isAudioSpec(opts.audio)) return;
    try {
      const { createGameAudio } = await import('../audio');
      const mixer = createGameAudio(opts.audio);
      audioLoaded = mixer.load(opts.audio.sounds).catch((e) => console.warn('[artubeplate] some sounds failed to load', e));
      audio = mixer;
    } catch (e) {
      console.warn('[artubeplate] audio unavailable — the game continues silently', e);
    }
  };

  // ── the boot ─────────────────────────────────────────────────────────────────
  let loader: GameLoader | null = null;

  async function start(): Promise<void> {
    // The transport for this launch. The mock RGS is a dynamic import that a build for Artube does
    // not contain at all; a real launch with no game id fails here and is reported below.
    if (!opts.network) {
      try {
        network = await loadNetwork(runtime, networkOptions);
      } catch (e) {
        network = refusing(e, 'artube');
      }
    }
    const hudHost = opts.hudHost ?? document.body;
    const sceneHost = opts.sceneHost ?? hudHost;
    loader = await createArtubeLoader();
    loader.setProgress(0.05);
    const phases = [...defaultPhases<T, V, P>(), ...(opts.phases ?? [])];
    settle = phases.filter((p): p is SettlePhase<T, V, P> => p instanceof SettlePhase).pop() ?? null;
    const machine = (fsm = new FSM<T, V, P>(phases));
    await resolveAudio();
    loader.setProgress(0.15);

    let session: SessionResponse;
    try {
      await network.connect();
      loader.setProgress(0.35);
      session = await network.session();
      loader.setProgress(0.55);
    } catch (e) {
      loader.remove();
      const err = e instanceof RgsError ? e : rgsErrorFrom(e);
      const noSession = !runtime.sessionId && network.kind === 'artube';
      showBootError({
        title: err.sessionOver ? 'Session ended' : network.kind === 'mock' ? 'Cannot load the math' : noSession ? 'No game session' : 'Cannot reach the game server',
        message: err.sessionOver
          ? 'This game session is no longer valid: the game was opened in another window or tab, or the session expired. Continue in the other window, or open the game again from the casino.'
          : network.kind === 'mock'
            ? 'The local mock RGS could not read the math folder. Run `npm run math:check`, and make sure the dev server serves math/ (the artubeplate Vite plugin).'
            : noSession
              ? 'Open the game from the casino, or from Artube Hub with PLAY or DEMO: the launch URL carries the session (?sessionId=…).'
              : 'The game could not connect to the game server. Please reload to try again.',
        // No session: nothing reached the RGS, so there is no errorId to quote.
        detail: noSession ? errText(e) : `${err.errorId ? `errorId ${err.errorId}, ` : ''}${errText(e)}`,
        // A reload cannot bring back a session the platform ended: no button that only fails again.
        ...(noSession || err.sessionOver ? { reload: false } : {}),
      });
      return;
    }

    applySession(session, false);
    // The effective config: the game's own, plus whatever it derives from the session's math.
    config = resolveGameConfig(opts.config, session);
    const cards = buyCardsFor(session, config);
    const spec = buildSpec({ session, config, language: runtime.language, ...(runtime.lobbyUrl ? { lobbyUrl: runtime.lobbyUrl } : {}), cards });
    const hudObj = (hud = mountDomHud(spec, {
      // What the player chose comes back on the next visit, per game: sound, music, the mute,
      // every speed switch and SPACEBAR TO SPIN (the HUD keeps them; a game may pass its own).
      persist: `artubeplate.hud.${runtime.game || opts.config.title}`,
      ...opts.hudOptions,
      container: hudHost,
      // One look, built in: the classic slot bar (see ../skin).
      skin: { css: artubeplateSkinCss },
      ...(runtime.channel ? { channel: runtime.channel } : {}),
      features: cards,
      onBuy: (id) => onBuy(id),
    }));
    port = domHudPort(hudObj, () => currency);
    if (config.featureCounter?.lives) disposers.push(livesPips(hudObj, config.featureCounter.lives));
    labelHud(hudObj.root);
    // The stake's box is narrow: its value shrinks to fit whatever the platform's font (../skin/fit).
    const betValue = hudObj.root.querySelector<HTMLElement>('#BetAmountValue');
    if (betValue) disposers.push(fitToSlot(betValue));
    hideHud();
    // A page still titled with a scaffold placeholder takes the game's name.
    if (!document.title || document.title.includes('{{')) document.title = config.title;
    // BALANCE, WIN and TOTAL WIN at the currency's minimal unit, rounded down (Artube's checklist:
    // never more than the player has; 1449.987 KRW reads 1,449). open-slot-ui would otherwise show
    // a sub-unit amount in full ("1,449.987"), as Stake asks.
    for (const v of [hudObj.ui.balance, hudObj.ui.win, hudObj.ui.totalWin]) v.autoPrecision = false;
    hudObj.setCurrency(currency);
    hudObj.setBalance(session.balance);
    if (config.maxWinX) hudObj.setMaxWin(config.maxWinX);
    syncBetFromHud();
    loader.setProgress(0.7);

    const view = await opts.mountView(sceneHost, {
      config,
      stores,
      hud: hudObj,
      ticker,
      audio,
      turbo,
      loader,
      session,
      gameConfig: session.gameSettings.config,
      transport: network.kind,
    });
    loader.setProgress(0.9);

    ctx = {
      config,
      stores,
      network,
      hud: port,
      ticker,
      view,
      audio,
      turbo,
      interpretBook: opts.interpretBook,
      fsm: machine,
      round: null,
      recover,
      afterRound,
    };
    machine.bind(ctx);

    // ── store → HUD ──────────────────────────────────────────────────────────────
    disposers.push(stores.balance.balance.subscribe((b) => hudObj.setBalance(b)));
    disposers.push(stores.ui.spinning.subscribe(syncControls));
    disposers.push(stores.ui.activeMode.subscribe(applyBetDisplay));
    // The stepper is the base-bet source of truth; its value lands a tick after the index.
    disposers.push(hudObj.ui.betStepper.index.subscribe(() => queueMicrotask(syncBetFromHud)));

    // ── spin, slam-stop, speed ────────────────────────────────────────────────────
    const view_ = (): ViewHooks | null => view as unknown as ViewHooks | null;
    // PRESS PLAY TO SPIN! stays on the bar until the first round starts (a spin, a buy, a replay).
    let greeting = true;
    disposers.push(
      stores.ui.spinning.subscribe((spinning) => {
        if (!spinning || !greeting) return;
        greeting = false;
        hudObj.ui.clearFeedback();
      }),
    );
    const beginSpin = (): boolean => {
      if (machine.current !== 'idle' || terminal || recovering) return false;
      turbo.resetSkip();
      settle?.markStart(ticker.now());
      void machine.transition('spin').catch((e) => console.error('[artubeplate] round failed', e));
      return true;
    };
    // A bonus plays out unless the game allows skipping it. It starts when the game says so
    // (`ctx.turbo.feature(true)`), which is before its first screen hides the bar: a slam during
    // the bonus's intro (its trigger, its BONUS GAME slam) is a slam in the bonus too.
    const inBonus = (): boolean => {
      const state = hudObj.root.dataset.state ?? '';
      return turbo.inFeature || state.startsWith('feature') || state === 'hidden';
    };
    // The slam's cue (`inputSounds.skip`) plays here, once for every slam that lands: the round
    // button and the spacebar slam through spinRequested, an autoplay tap through skipRequested.
    const slamCue = isAudioSpec(opts.audio) ? opts.audio.inputSounds?.skip : undefined;
    const slam = (): void => {
      if (machine.current === 'idle') return;
      if (inBonus() && !config.bonusSkip) return;
      turbo.skip();
      if (slamCue) audio?.play(slamCue, { bus: 'ui' });
      view_()?.slamStop?.();
    };
    // In the STOP state the round button emits spinRequested again — mid-round that IS the slam.
    disposers.push(hudObj.on('spinRequested', () => (machine.current === 'idle' ? void beginSpin() : slam())));
    disposers.push(hudObj.on('skipRequested', slam));
    // The bonus bar has no round button: where the game allows skipping, a tap on the game skips.
    if (config.bonusSkip) {
      const tapToSkip = (e: PointerEvent): void => {
        if (!inBonus()) return;
        if ((e.target as Element | null)?.closest?.('button, a, input, label, li, .Modal, #DialogWindow')) return;
        slam();
      };
      window.addEventListener('pointerdown', tapToSkip);
      disposers.push(() => window.removeEventListener('pointerdown', tapToSkip));
    }
    const syncSpeed = (): void => {
      const speeds = hudObj.ui.speeds;
      let base = 0;
      let bonus = 0;
      speeds.forEach((s, i) => {
        if (s.base.isOn || (s.scopes.length === 0 && s.isOn)) base = Math.max(base, i + 1);
        if (s.bonus.isOn || (s.scopes.length === 0 && s.isOn)) bonus = Math.max(bonus, i + 1);
      });
      turbo.setLevel(base, 'base');
      turbo.setLevel(bonus, 'bonus');
    };
    // The speed switches came back from the last visit with the HUD (`persist` above).
    for (const s of hudObj.ui.speeds) disposers.push(s.base.state.subscribe(syncSpeed), s.bonus.state.subscribe(syncSpeed));
    syncSpeed();
    // A round finishes at the speed it started with; a turbo change counts from the next round.
    disposers.push(stores.ui.spinning.subscribe((spinning) => turbo.hold(spinning)));

    // iOS Safari ignores `user-scalable=no`: no pinch-zoom on the page either (the HUD and the
    // game canvases refuse it already). Panning stays, so the rules still scroll.
    for (const el of [document.documentElement, document.body]) el.style.touchAction = 'pan-x pan-y';
    const noPinch = (e: Event): void => e.preventDefault();
    const noTwoFingers = (e: TouchEvent): void => {
      if (e.touches.length > 1) e.preventDefault();
    };
    document.addEventListener('gesturestart', noPinch, { passive: false });
    document.addEventListener('gesturechange', noPinch, { passive: false });
    document.addEventListener('touchmove', noTwoFingers, { passive: false });
    disposers.push(() => {
      document.removeEventListener('gesturestart', noPinch);
      document.removeEventListener('gesturechange', noPinch);
      document.removeEventListener('touchmove', noTwoFingers);
    });

    // SPACEBAR TO SPIN is the HUD's own (`ui.spacebar`, kept with the other settings). A demo
    // session says so in the currency itself (1.00 DEMO, ../currency): never `data-demo` on the
    // root, which would draw the HUD's DEMO pill as well.
    disposers.push(hudObj.on('autoplayStarted', syncControls), hudObj.on('autoplayStopped', syncControls));

    // ── hold to spin: the round button held down plays rounds until it is let go, at the
    //    autoplay pace (the HUD arms the press, `spin.press` in the spec) ──
    let holding = false;
    disposers.push(
      hudObj.on('holdSpinStarted', () => {
        holding = true;
        turbo.setAutoplay(true);
        if (machine.current === 'idle') void beginSpin();
      }),
    );
    disposers.push(
      hudObj.on('holdSpinStopped', () => {
        holding = false;
        if (!hudObj.ui.autoplay.isActive) turbo.setAutoplay(false);
      }),
    );
    const gapMs = config.autoplayGapMs ?? 250;
    // ── autoplay: the HUD owns the run (its count, its limits, its stop); the core plays it and
    //    ends it on what only the core sees: a bonus, a win, a notice, a balance (./autoplay) ──
    disposers.push(
      autoplayLoop({
        ui: hudObj.ui,
        turbo,
        stores,
        beginSpin,
        idle: () => machine.current === 'idle',
        terminal: () => terminal,
        holding: () => holding,
        noFunds: () => port?.showRgsError('ERR_IPB'),
        gapMs,
      }),
    );

    // ── operator free rounds play themselves: the first right after activation, each next one
    //    once the last has settled. Never over a notice (the summary, an error), never during a
    //    recovery and never alongside the player's own autoplay. It waits those out rather than
    //    giving up, so the campaign never stalls. SPIN still slam-stops the round in play. ──────
    let frcQueued = false;
    const frcNext = (): void => {
      if (frcQueued) return;
      frcQueued = true;
      void (async () => {
        await turbo.delay(gapMs);
        while (stores.frc.active && !terminal && (hudObj.ui.noticePanel.isOpen || recovering || machine.current !== 'idle'))
          await new Promise((r) => setTimeout(r, 200));
        frcQueued = false;
        if (!stores.frc.active || terminal || hudObj.ui.autoplay.isActive) return;
        beginSpin();
      })();
    };
    disposers.push(stores.frc.activated.subscribe((on) => on && frcNext()));
    // …and while they do, a bonus inside one continues by itself, as in autoplay.
    disposers.push(stores.frc.activated.subscribe((on) => turbo.setFreeRounds(on)));
    disposers.push(hudObj.on('autoplayStopped', () => stores.frc.active && frcNext()));
    let frcWasSpinning = false;
    disposers.push(
      stores.ui.spinning.subscribe((spinning) => {
        const settled = frcWasSpinning && !spinning;
        frcWasSpinning = spinning;
        if (settled && stores.frc.active) frcNext();
      }),
    );

    // ── buy features + lucky bets (from the session's gameModes) ─────────────────────────
    function onBuy(id: string): void {
      const mode = stores.session.mode(id);
      if (!mode || machine.current !== 'idle' || stores.frc.active) return;
      if (mode.type === 'LuckyBet') {
        stores.ui.activeMode.set(id);
        hudObj.ui.setBetModifier({ id, name: config.modes?.[id]?.name ?? id, cost: Math.max(0, mode.priceMultiplier - 1) });
        applyBetDisplay();
        return;
      }
      clearAnte(); // a buy plays at the base bet
      stores.ui.oneShotMode.set(id);
      beginSpin();
    }
    disposers.push(
      hudObj.on('buttonActivated', ({ id }) => {
        if (id === 'disable-modifier') clearAnte();
        else if (id === 'lobby' && runtime.lobbyUrl) {
          try {
            (window.top ?? window).location.href = runtime.lobbyUrl;
          } catch {
            window.location.href = runtime.lobbyUrl;
          }
        }
      }),
    );

    // ── the connection's life ─────────────────────────────────────────────────────
    // Lost: autoplay stops and a notice with RELOAD blocks the game (the spacebar too: the HUD
    // answers no key while a notice is up). Back: the notice goes by itself and `recover` reads
    // `session` — the balance, the round that was in flight, free rounds — and the game goes on.
    disposers.push(
      network.on('reconnecting', () => {
        if (terminal) return;
        hudObj.ui.autoplay.stop();
        showConnectionLost('Reconnecting to the game server…');
      }),
      network.on('reconnected', () => {
        if (terminal) return;
        hideConnectionLost();
        void recover('reconnected');
      }),
      network.on('closed', ({ retrying }) => {
        if (terminal) return;
        // The reconnect's own attempts ran out, but the transport keeps trying: say so, keep
        // RELOAD in reach, and carry on by ourselves when the network is back.
        if (retrying) {
          showConnectionLost('The game cannot reach the server. It keeps trying and carries on by itself when the connection is back — or reload now. Your balance is safe.');
          return;
        }
        fatal('Connection lost', 'The connection to the game server was lost. Reload to continue — your balance is safe.', [{ label: 'Reload', primary: true }]);
      }),
      network.on('sessionClosed', () =>
        fatal('Session ended', 'Your game session has ended. Open the game again from the casino to keep playing.'),
      ),
      network.on('replaced', () =>
        fatal('Opened elsewhere', 'This game was opened in another window, so this one has stopped. Continue playing there.'),
      ),
      // A HINT (may arrive out of order): only applied when no round is in flight.
      network.on('balanceChanged', ({ balance }) => {
        if (machine.current === 'idle' && !stores.ui.spinning.get()) stores.balance.balance.set(balance);
      }),
    );

    // ── the wallet, read again between rounds ────────────────────────────────────
    // A deposit in the lobby or a withdrawal changes the wallet outside the game, and the
    // platform's NotifyBalanceChanged is a hint that may never come (QA: after topping up, the
    // game showed the old balance until a reload, and a bar showing MORE than the wallet holds
    // ends in "insufficient funds"). Between rounds the core reads `balance` when the game comes
    // back into view and every 30 s while it sits idle and visible; the spin phase reads it too
    // before it refuses a spin for want of funds, and after the server refuses one.
    const onVisible = (): void => {
      if (document.visibilityState !== 'hidden') void refreshBalance();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    const balanceTimer = setInterval(onVisible, BALANCE_POLL_MS);
    disposers.push(() => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      clearInterval(balanceTimer);
    });

    // ── audio wiring ──────────────────────────────────────────────────────────────
    const mixer = audio as unknown as MixerLike | null;
    if (mixer && typeof mixer.setGroupLevel === 'function') {
      disposers.push(bindMixerToHud(mixer, hudObj));
      const spec = isAudioSpec(opts.audio) ? opts.audio : null;
      const bgm = spec?.bgm;
      const beds = spec?.ambience === undefined ? [] : [spec.ambience].flat();
      if ((bgm || beds.length) && audio)
        disposers.push(
          startMusicOnFirstGesture(audio, mixer, hudObj, {
            loaded: audioLoaded,
            ...(bgm ? { bgm } : {}),
            ...(spec?.bgmFadeIn ? { fadeIn: spec.bgmFadeIn } : {}),
            ...(beds.length ? { ambience: beds } : {}),
            ...(spec?.ambienceFadeIn ? { ambienceFadeIn: spec.ambienceFadeIn } : {}),
          }),
        );
      else if (typeof mixer.unlock === 'function') {
        const off = hudObj.on('spinRequested', () => {
          void mixer.unlock!();
          off();
        });
        disposers.push(off);
      }
    }
    if (audio && isAudioSpec(opts.audio) && opts.audio.inputSounds) {
      // Every cue but the slam's, which the slam plays itself (above), so it never sounds twice.
      const inputs = { ...opts.audio.inputSounds };
      delete inputs.skip;
      disposers.push(bindInputSounds(audio, hudObj, inputs));
    }

    // ── gamification (only with a token; never blocks) ─────────────────────────────
    // The widget's position functions see the HUD's own layout (its channel, not a guess from the
    // pointer); `?gamificationEnv=` overrides the environment read from the host.
    if (session.gamificationToken && opts.gamification !== false) {
      if (network.kind === 'mock') console.info('[artubeplate] gamification token present — the widget is skipped on the mock RGS');
      else {
        const widget: GamificationOptions = { ...(opts.gamification || {}), ...(runtime.gamificationEnv ? { env: runtime.gamificationEnv } : {}) };
        const view = (): GamificationView => ({ ...gamificationView(), touch: hudObj.root.dataset.channel === 'mobile' });
        void startGamification({ token: session.gamificationToken, sessionId: runtime.sessionId ?? '', lang: runtime.language, options: widget, view }).then((d) => disposers.push(d));
      }
    }

    if (!opts.loader?.manual) await loader.done();
    // An intro (or any screen before the game) holds the first idle until the player is in.
    const playable = (view as unknown as ViewHooks | null)?.whenPlayable?.();
    if (playable) await playable.catch((e) => console.warn('[artubeplate] whenPlayable failed — starting anyway', e));
    revealHud();
    await machine.transition('idle');
    syncControls();
    // Desktop only: the touch bar keeps the space over the round button clear.
    const greet = (): void => {
      if (greeting && !terminal && hudObj.root.dataset.channel !== 'mobile') hudObj.showFeedback('press_play', { ms: 0 });
    };
    // A demo session says "DEMO" where the currency would be; no extra notice over the bar.
    greet();

    // After the game is on screen: the operator's free rounds first (the offer opens every
    // session), then a round the player never saw, unless free rounds now play.
    await offerCampaign(false);
    await offerUnseenRound(session);
  }

  function dispose(): void {
    terminal = true; // tearing down is not a lost connection
    for (const d of disposers.splice(0)) d();
    hud?.dispose();
    void network.dispose();
  }

  function inspect(): GameSnapshot {
    return {
      phase: fsm?.current ?? 'boot',
      balance: stores.balance.balance.get(),
      bet: stores.balance.bet.get(),
      betIndex: stores.balance.betIndex.get(),
      lastWin: stores.balance.lastWin.get(),
      currency: stores.session.current.get()?.sessionSettings.currency ?? null,
      spinning: stores.ui.spinning.get(),
      freeRounds: stores.frc.campaign.get(),
      freeRoundsActive: stores.frc.active,
      transport: network.kind,
    };
  }

  function requestSpin(): boolean {
    if (!fsm || fsm.current !== 'idle' || terminal) return false;
    turbo.resetSkip();
    settle?.markStart(ticker.now());
    void fsm.transition('spin');
    return true;
  }

  function requestBuy(modeId: string): boolean {
    if (!fsm || fsm.current !== 'idle' || stores.frc.active || !stores.session.mode(modeId)) return false;
    stores.ui.oneShotMode.set(modeId);
    return requestSpin();
  }

  return {
    start,
    dispose,
    inspect,
    requestSpin,
    requestBuy,
    get network() {
      return network;
    },
    get hud() {
      return hud;
    },
  };
}

export { isArtubeLaunch };
