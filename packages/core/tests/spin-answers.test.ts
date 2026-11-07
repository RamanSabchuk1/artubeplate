import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { ArtubeRgsClient, type HubConnectionLike } from '../src/rgs/ArtubeRgsClient';
import { MockRgs } from '../src/rgs/MockRgs';
import { RgsError, RGS_ERRORS } from '../src/rgs/errors';
import { FSM, defaultPhases, InstantTicker, TurboClock, type PhaseContext } from '../src/engine/index';
import { RootStore } from '../src/stores/index';
import { mockHud } from '../src/testing/index';
import type { LoadedArtifact } from '../src/math/artifact';
import type { RgsTransport } from '../src/rgs/network';
import { loadTemplateMath } from './helpers';

/**
 * EVERY WAY A SPIN CAN FAIL, AND WHAT THE PLAYER GETS.
 *
 * The user, after Artube QA on DEV: "if we get a server not responding on the spin we need to
 * handle it correctly, or if we get an error, cover how we handle it". Artube's rules
 * (/en/backend/rgs/errors-and-retries/): a spin is NEVER sent again (no idempotency key: a repeat is
 * a new round, charged again); a spin with an unknown result (the connection dropped, no answer)
 * means: block input, reconnect, call `session`, show the restored state.
 *
 * SignalR waits for an invocation's answer forever as long as the hub's pings arrive, so a hub that
 * never answers a spin left the reels spinning for good. Now a spin unanswered for 5 s shows a
 * spinner, and after 20 s the client gives up on it and makes the connection again; `session` then
 * says whether the round was played.
 */

/** A hub connection whose `spin` answers when the test says (or never). */
function hub() {
  let onclose: ((e?: Error) => void) | undefined;
  const pending: Array<{ method: string; resolve: (v: unknown) => void; reject: (e: unknown) => void }> = [];
  const conn = {
    state: 'Disconnected',
    starts: 0,
    stops: 0,
    invoked: [] as string[],
    startFails: 0,
    startError: (): Error => new Error('WebSocket failed to connect.'),
    async start() {
      this.starts++;
      if (this.startFails > 0) {
        this.startFails--;
        throw this.startError();
      }
      this.state = 'Connected';
    },
    async stop() {
      this.stops++;
      this.state = 'Disconnected';
      for (const p of pending.splice(0)) p.reject(new Error('Invocation canceled due to the underlying connection being closed.'));
      onclose?.();
    },
    invoke<T>(method: string): Promise<T> {
      this.invoked.push(method);
      return new Promise<T>((resolve, reject) => pending.push({ method, resolve: resolve as (v: unknown) => void, reject }));
    },
    /** The hub answers the oldest open call. */
    answer(value: unknown) {
      pending.shift()?.resolve(value);
    },
    get open() {
      return pending.length;
    },
    on() {},
    onclose(cb: (e?: Error) => void) {
      onclose = cb;
    },
    onreconnecting() {},
    onreconnected() {},
  };
  return conn as typeof conn & HubConnectionLike;
}

const round = { roundId: 'r1', gameMode: 'base', bet: 1, balance: 99, totalWin: 0, spinResult: { winMultiplier: 0, payload: {} } };

afterEach(() => vi.useRealTimers());

describe('a spin the hub does not answer', () => {
  it('a late answer: the spinner after 5 s, gone when the answer lands, and the round plays', async () => {
    vi.useFakeTimers();
    const conn = hub();
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    const seen: string[] = [];
    c.on('waiting', (p) => seen.push(`waiting:${p.on}`));
    c.on('reconnecting', () => seen.push('reconnecting'));
    await c.connect();
    const spin = c.spin({ gameMode: 'base', betIndex: 0 });
    await vi.advanceTimersByTimeAsync(4999);
    expect(seen).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(seen).toEqual(['waiting:true']);
    await vi.advanceTimersByTimeAsync(2000);
    conn.answer(round);
    await expect(spin).resolves.toMatchObject({ roundId: 'r1', balance: 99 });
    expect(seen).toEqual(['waiting:true', 'waiting:false']);
    expect(conn.stops).toBe(0);
  });

  it('no answer in 20 s: given up as unknown (a transport error), never sent again, and the connection is made again', async () => {
    vi.useFakeTimers();
    const conn = hub();
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    const seen: string[] = [];
    c.on('waiting', (p) => seen.push(`waiting:${p.on}`));
    c.on('reconnecting', () => seen.push('reconnecting'));
    c.on('reconnected', () => seen.push('reconnected'));
    c.on('closed', () => seen.push('closed'));
    await c.connect();
    const spin = c.spin({ gameMode: 'base', betIndex: 0 }).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    const err = (await spin) as RgsError;
    expect(err).toBeInstanceOf(RgsError);
    expect(err.transport).toBe(true); // outcome unknown: recovery through `session`
    expect(err.message).toBe('no answer to spin in 20 s');
    await vi.advanceTimersByTimeAsync(10);
    expect(seen).toEqual(['waiting:true', 'reconnecting', 'waiting:false', 'reconnected']);
    expect(conn.stops).toBe(1);
    expect(conn.starts).toBe(2);
    expect(c.connected).toBe(true);
    expect(conn.invoked.filter((m) => m === 'spin')).toHaveLength(1);
    // the next spin goes out on the new connection
    const next = c.spin({ gameMode: 'base', betIndex: 0 });
    conn.answer(round);
    await expect(next).resolves.toMatchObject({ roundId: 'r1' });
  });

  it('any other call unanswered: no spinner of its own, the same give-up and new connection', async () => {
    vi.useFakeTimers();
    const conn = hub();
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn, technicalRetries: 0 });
    const seen: string[] = [];
    c.on('waiting', () => seen.push('waiting'));
    c.on('reconnecting', () => seen.push('reconnecting'));
    await c.connect();
    const read = c.balance().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(((await read) as RgsError).transport).toBe(true);
    expect(seen).toEqual(['reconnecting']);
  });

  it('the new connection cannot be made: "closed", still trying in the background', async () => {
    vi.useFakeTimers();
    const conn = hub();
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn, reviveDelays: [60_000] });
    const seen: string[] = [];
    c.on('closed', (p) => seen.push(`closed${p.retrying ? ':retrying' : ''}`));
    c.on('reconnected', () => seen.push('reconnected'));
    await c.connect();
    const spin = c.spin({ gameMode: 'base', betIndex: 0 }).catch(() => null);
    conn.startFails = 99;
    await vi.advanceTimersByTimeAsync(20_000 + 3_750);
    await spin;
    expect(seen).toEqual(['closed:retrying']);
    conn.startFails = 0;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(seen).toEqual(['closed:retrying', 'reconnected']);
  });

  it('the hub refuses the session on the new connection: the session is over', async () => {
    vi.useFakeTimers();
    const conn = hub();
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    const seen: string[] = [];
    c.on('sessionClosed', () => seen.push('sessionClosed'));
    c.on('closed', () => seen.push('closed'));
    await c.connect();
    const spin = c.spin({ gameMode: 'base', betIndex: 0 }).catch(() => null);
    conn.startFails = 99;
    conn.startError = () =>
      new Error('Server returned an error on close: Connection closed with an error. HubException: Operation failed with error code 501. Error message: The session is invalid or cannot be retrieved');
    await vi.advanceTimersByTimeAsync(20_010);
    await spin;
    expect(seen).toEqual(['sessionClosed']);
    expect(conn.starts).toBe(2); // refused once is enough
  });
});

describe('the mock reproduces a spin with no answer, or a late one', () => {
  let art: LoadedArtifact;
  beforeAll(async () => {
    art = await loadTemplateMath();
  });

  // Real time (short waits): the mock's books load from disk, which a fake clock never waits for.
  const until = async (f: () => boolean, ms = 3000): Promise<void> => {
    const t0 = Date.now();
    while (!f() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 20));
  };

  it('played on the server, no answer: the spin fails as unknown, the connection comes back, `session` has the round', async () => {
    const m = new MockRgs({ math: art, latency: 0, balance: 100, seed: 1 });
    await m.connect();
    const seen: string[] = [];
    m.on('waiting', (p) => seen.push(`waiting:${p.on}`));
    m.on('reconnecting', () => seen.push('reconnecting'));
    m.on('reconnected', () => seen.push('reconnected'));
    m.simulateNoAnswer({ played: true, slowMs: 100, timeoutMs: 400 });
    const err = (await m.spin({ gameMode: 'base', betIndex: 0 }).catch((e: unknown) => e)) as RgsError;
    expect(err.transport).toBe(true);
    expect(m.connected).toBe(false);
    await until(() => m.connected);
    expect(seen).toEqual(['waiting:true', 'reconnecting', 'waiting:false', 'reconnected']);
    const s = await m.session();
    expect(s.round?.roundId).toBeTruthy(); // the round the answer never brought
    expect(s.balance).not.toBe(100);
  });

  it('never played, no answer: `session` shows the balance untouched', async () => {
    const m = new MockRgs({ math: art, latency: 0, balance: 100, seed: 1 });
    await m.connect();
    m.simulateNoAnswer({ played: false, slowMs: 100, timeoutMs: 400 });
    const err = (await m.spin({ gameMode: 'base', betIndex: 0 }).catch((e: unknown) => e)) as RgsError;
    expect(err.transport).toBe(true);
    await until(() => m.connected);
    const s = await m.session();
    expect(s.balance).toBe(100);
    expect(s.round).toBeNull();
  });

  it('a late answer: waiting on, then off, and the round arrives', async () => {
    const m = new MockRgs({ math: art, latency: 0, balance: 100, seed: 1 });
    await m.connect();
    const seen: boolean[] = [];
    m.on('waiting', (p) => seen.push(p.on));
    m.simulateSlowAnswer(500, { slowMs: 200 });
    await expect(m.spin({ gameMode: 'base', betIndex: 0 })).resolves.toMatchObject({ roundId: expect.any(String) });
    expect(seen).toEqual([true, false]);
  });
});

/** The round machine, headless, with the mock failing the next spin with `errorId`. */
let art2: LoadedArtifact;
beforeAll(async () => {
  art2 = await loadTemplateMath();
});
async function spinFailingWith(errorId: number | 'no-answer' | 'lost') {
  const base = new MockRgs({ math: art2, latency: 0, seed: 3, balance: 100, ...(typeof errorId === 'number' ? { errors: [errorId] } : {}) });
  const network: RgsTransport =
    errorId === 'no-answer'
      ? Object.assign(Object.create(base), { spin: async () => Promise.reject(new RgsError(undefined, 'no answer to spin in 20 s', 'spin')), session: () => base.session() })
      : errorId === 'lost'
        ? Object.assign(Object.create(base), {
            spin: async () => Promise.reject(new Error('Invocation canceled due to the underlying connection being closed.')),
            session: () => base.session(),
          })
        : base;
  const session = await network.session();
  const stores = new RootStore();
  stores.session.current.set(session);
  stores.balance.balance.set(session.balance);
  stores.balance.betIndex.set(3);
  stores.balance.bet.set(session.sessionSettings.allowedBets[3]!);
  const hud = mockHud();
  const recovered: Array<{ reason: string; notice?: string }> = [];
  const fsm = new FSM<unknown, null, unknown>(defaultPhases());
  let spins = 0;
  const counting: RgsTransport = Object.assign(Object.create(network), {
    spin: (req: Parameters<RgsTransport['spin']>[0]) => {
      spins++;
      return network.spin(req);
    },
  });
  const ctx: PhaseContext<unknown, null, unknown> = {
    config: { title: 't' },
    stores,
    network: counting,
    hud,
    ticker: new InstantTicker(),
    view: null,
    audio: null,
    turbo: new TurboClock(),
    interpretBook: (payload) => payload,
    fsm,
    round: null,
    recover: async (reason, o) => void recovered.push({ reason, ...(o?.notice ? { notice: o.notice.title } : {}) }),
    afterRound: async () => {},
  };
  fsm.bind(ctx);
  await fsm.transition('idle');
  await fsm.transition('spin');
  const titles = hud.notices.map((n) => n.title);
  const reload = hud.notices.some((n) => n.actions?.some((a) => a.label === 'Reload'));
  return { balance: stores.balance.balance.get(), titles, reload, ipb: hud.calls.some((c) => c.m === 'showRgsError'), recovered, spins, phase: fsm.current, reported: hud.reportedRounds() };
}

describe('every spin error, and what the player gets (the stake is 1 of a balance of 100)', () => {
  it('503 insufficient funds: the HUD says so; the stake goes back; the wallet is read again', async () => {
    const r = await spinFailingWith(RGS_ERRORS.INSUFFICIENT_FUNDS);
    expect(r).toMatchObject({ balance: 100, ipb: true, titles: [], recovered: [], spins: 1, phase: 'idle', reported: [] });
  });

  it('502 invalid bet: "Bet unavailable"; the stake goes back; the session is read again', async () => {
    const r = await spinFailingWith(RGS_ERRORS.INVALID_BET);
    expect(r).toMatchObject({ balance: 100, titles: ['Bet unavailable'], recovered: [{ reason: 'refresh after error' }], spins: 1, phase: 'idle' });
  });

  it('601 unknown mode: "Mode unavailable"; the stake goes back; the session is read again', async () => {
    const r = await spinFailingWith(RGS_ERRORS.UNKNOWN_MODE);
    expect(r).toMatchObject({ balance: 100, titles: ['Mode unavailable'], recovered: [{ reason: 'refresh after error' }], spins: 1 });
  });

  it('622 buy unavailable: "Feature buy unavailable"; the stake goes back', async () => {
    const r = await spinFailingWith(RGS_ERRORS.BUY_UNAVAILABLE);
    expect(r).toMatchObject({ balance: 100, titles: ['Feature buy unavailable'], recovered: [], spins: 1 });
  });

  it('429 rate limited (after the client\'s own retries): "Slow down"; the stake goes back', async () => {
    const r = await spinFailingWith(RGS_ERRORS.RATE_LIMITED);
    expect(r).toMatchObject({ balance: 100, titles: ['Slow down'], spins: 1 });
  });

  it('500 server error: not sent again; the session is read again and the player told "Something went wrong"', async () => {
    const r = await spinFailingWith(RGS_ERRORS.TECHNICAL);
    expect(r).toMatchObject({ titles: [], recovered: [{ notice: 'Something went wrong' }], spins: 1, phase: 'idle', reported: [] });
  });

  it('501 / 507 the session is over: "Session ended" with RELOAD; the stake goes back', async () => {
    for (const code of [RGS_ERRORS.SESSION_UNUSABLE, RGS_ERRORS.SESSION_STOPPED]) {
      const r = await spinFailingWith(code);
      expect(r).toMatchObject({ balance: 100, titles: ['Session ended'], reload: true, spins: 1 });
    }
  });

  it('600 game settings: "Game unavailable" with RELOAD', async () => {
    const r = await spinFailingWith(RGS_ERRORS.INVALID_GAME_SETTINGS);
    expect(r).toMatchObject({ titles: ['Game unavailable'], reload: true, spins: 1 });
  });

  it('the connection drops with the spin out, or no answer comes: unknown, never sent again, recovered through `session`', async () => {
    for (const how of ['lost', 'no-answer'] as const) {
      const r = await spinFailingWith(how);
      // the stake stays off until `session` says what happened (the recovery replaces the balance)
      expect(r).toMatchObject({ balance: 99, titles: [], spins: 1, phase: 'idle', reported: [] });
      expect(r.recovered).toHaveLength(1);
      expect(r.recovered[0]!.notice).toBeUndefined(); // the reconnect has its own spinner
    }
  });
});
