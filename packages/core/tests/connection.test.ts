// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { ArtubeRgsClient, type HubConnectionLike } from '../src/rgs/ArtubeRgsClient';
import { MockRgs } from '../src/rgs/MockRgs';
import { buildSpec } from '../src/game/spec';
import type { LoadedArtifact } from '../src/math/artifact';
import type { SessionResponse } from '../src/rgs/protocol';
import type { GameConfig } from '../src/game/config';
import { loadTemplateMath } from './helpers';

/**
 * A LOST CONNECTION IS NOT THE END OF THE GAME.
 *
 * Artube QA: during a spin and during autoplay, the connection-lost popup had no way to
 * reload, stayed up after the connection came back, and the game stayed dead until a
 * manual reload. The transport now keeps trying after the automatic reconnect gives up,
 * says whether it can send, and the mock can lose the connection the same way, so the
 * game's recovery runs in development exactly as it will on the platform.
 */

/** A hub connection whose life the test drives: drop it, let starts fail or succeed. */
function scriptedConnection() {
  let onclose: ((e?: Error) => void) | undefined;
  let onreconnecting: ((e?: Error) => void) | undefined;
  let onreconnected: (() => void) | undefined;
  const conn = {
    state: 'Disconnected',
    starts: 0,
    startFails: 0,
    async start() {
      this.starts++;
      if (this.startFails > 0) {
        this.startFails--;
        throw new Error('Failed to fetch');
      }
      this.state = 'Connected';
    },
    async stop() {
      this.state = 'Disconnected';
      onclose?.();
    },
    async invoke<T>(): Promise<T> {
      return { balance: 1, sessionSettings: { allowedBets: [1], defaultBetIndex: 0 }, gameSettings: { gameModes: [] } } as T;
    },
    on() {},
    onclose(cb: (e?: Error) => void) {
      onclose = cb;
    },
    onreconnecting(cb: (e?: Error) => void) {
      onreconnecting = cb;
    },
    onreconnected(cb: () => void) {
      onreconnected = cb;
    },
    /** The network drops: SignalR's automatic reconnect starts. */
    drop() {
      this.state = 'Reconnecting';
      onreconnecting?.(new Error('WebSocket closed with status code: 1006'));
    },
    /** The automatic reconnect's attempts ran out. */
    giveUp() {
      this.state = 'Disconnected';
      onclose?.();
    },
    /** The automatic reconnect made it. */
    back() {
      this.state = 'Connected';
      onreconnected?.();
    },
  };
  return conn as typeof conn & HubConnectionLike;
}

afterEach(() => {
  vi.useRealTimers();
});

describe('the SignalR client after its automatic reconnect gives up', () => {
  it('says it is still trying, and keeps starting the connection until it takes', async () => {
    vi.useFakeTimers();
    const conn = scriptedConnection();
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn, reviveDelays: [1000, 2000] });
    const seen: string[] = [];
    c.on('reconnecting', () => seen.push('reconnecting'));
    c.on('closed', (p) => seen.push(`closed${p.retrying ? ':retrying' : ''}`));
    c.on('reconnected', () => seen.push('reconnected'));
    await c.connect();
    expect(c.connected).toBe(true);

    conn.drop();
    expect(c.connected).toBe(false);
    conn.startFails = 2;
    conn.giveUp();
    expect(seen).toEqual(['reconnecting', 'closed:retrying']);

    await vi.advanceTimersByTimeAsync(1000); // attempt 1: still down
    await vi.advanceTimersByTimeAsync(2000); // attempt 2: still down
    expect(seen).not.toContain('reconnected');
    await vi.advanceTimersByTimeAsync(2000); // attempt 3: back
    expect(seen).toEqual(['reconnecting', 'closed:retrying', 'reconnected']);
    expect(conn.starts).toBe(4); // the first connect + three attempts
    expect(c.connected).toBe(true);
  });

  it('tries at once when the browser says it is online again', async () => {
    vi.useFakeTimers();
    const conn = scriptedConnection();
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn, reviveDelays: [60_000] });
    const back = vi.fn();
    c.on('reconnected', back);
    await c.connect();
    conn.drop();
    conn.giveUp();
    window.dispatchEvent(new Event('online'));
    await vi.advanceTimersByTimeAsync(0);
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('the automatic reconnect making it is a plain reconnected', async () => {
    const conn = scriptedConnection();
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    const seen: string[] = [];
    c.on('closed', () => seen.push('closed'));
    c.on('reconnected', () => seen.push('reconnected'));
    await c.connect();
    conn.drop();
    conn.back();
    expect(seen).toEqual(['reconnected']);
  });

  it('a session that was replaced, closed or disposed is final: no retrying, no attempts', async () => {
    vi.useFakeTimers();
    const conn = scriptedConnection();
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn, reviveDelays: [10] });
    const closed: Array<boolean | undefined> = [];
    c.on('closed', (p) => closed.push(p.retrying));
    await c.connect();
    await c.dispose();
    await vi.advanceTimersByTimeAsync(100);
    expect(closed).toEqual([undefined]);
    expect(conn.starts).toBe(1);
  });

  it('reviveDelays: [] keeps the old behaviour, where closed is final', async () => {
    const conn = scriptedConnection();
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn, reviveDelays: [] });
    const closed: Array<boolean | undefined> = [];
    c.on('closed', (p) => closed.push(p.retrying));
    await c.connect();
    conn.drop();
    conn.giveUp();
    expect(closed).toEqual([undefined]);
  });
});

describe('the mock loses the connection the way the platform does', () => {
  let art: LoadedArtifact;
  beforeAll(async () => {
    art = await loadTemplateMath();
  });
  const mock = (o: ConstructorParameters<typeof MockRgs>[0] = {}) => new MockRgs({ math: art, latency: 0, seed: 1, balance: 100, ...o });

  const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it('a spin caught in it loses its answer; the server played it, and session tells', async () => {
    const m = mock();
    const seen: string[] = [];
    m.on('reconnecting', () => seen.push('reconnecting'));
    m.on('reconnected', () => seen.push('reconnected'));
    m.simulateOutage(60);
    expect(m.connected).toBe(true); // armed for the next spin, not down yet
    await expect(m.spin({ gameMode: 'base', betIndex: 3 })).rejects.toMatchObject({ errorId: undefined });
    expect(m.connected).toBe(false);
    expect(seen).toEqual(['reconnecting']);
    // every call meanwhile fails as the real client's does
    await expect(m.session()).rejects.toMatchObject({ errorId: undefined });
    await expect(m.spin({ gameMode: 'base', betIndex: 3 })).rejects.toMatchObject({ errorId: undefined });
    await wait(80);
    expect(seen).toEqual(['reconnecting', 'reconnected']);
    const s = await m.session();
    expect(s.round?.roundId).toBeTruthy(); // the round that was in flight
    expect(s.balance).not.toBe(100); // it was charged (and paid, if it won)
  });

  it("lost: 'request' — the spin never arrived, so nothing was charged", async () => {
    const m = mock();
    m.simulateOutage(40, { lost: 'request' });
    await expect(m.spin({ gameMode: 'base', betIndex: 3 })).rejects.toMatchObject({ errorId: undefined });
    await wait(60);
    const s = await m.session();
    expect(s.balance).toBe(100);
    expect(s.round).toBeNull();
  });

  it('an outage longer than the automatic reconnect: closed (still retrying), then back', async () => {
    vi.useFakeTimers();
    const m = mock();
    const seen: string[] = [];
    m.on('reconnecting', () => seen.push('reconnecting'));
    m.on('closed', (p) => seen.push(`closed${p.retrying ? ':retrying' : ''}`));
    m.on('reconnected', () => seen.push('reconnected'));
    m.simulateOutage(30_000, { at: 'now', giveUpAfter: 18_000 });
    await vi.advanceTimersByTimeAsync(18_000);
    expect(seen).toEqual(['reconnecting', 'closed:retrying']);
    await vi.advanceTimersByTimeAsync(12_000);
    expect(seen).toEqual(['reconnecting', 'closed:retrying', 'reconnected']);
    expect(m.connected).toBe(true);
  });
});

describe("the HUD Artube's TRC checklist asks for", () => {
  const session = {
    balance: 100,
    round: null,
    sessionSettings: { currency: 'EUR', allowedBets: [1, 2], defaultBetIndex: 0 },
    gameSettings: { betCredit: 100, gameModes: [{ id: 'base', type: 'None', priceMultiplier: 1, rtp: 96 }] },
    freeRoundCampaign: null,
    gamificationToken: null,
  } as unknown as SessionResponse;

  it('a number of rounds starts the run; the autoplay button stops it; speed rows open without switching; a tap on the game closes the popovers', () => {
    const spec = buildSpec({ session, config: { title: 'T' } as GameConfig, language: 'en', cards: [] });
    expect(spec.autoplay).toMatchObject({ startOnSelect: true, stopControl: 'autoplay-button' });
    expect(spec.hud).toMatchObject({ speedRow: 'expand', closeOnOutsideTap: true });
  });

  it('a game may keep the reference behaviour', () => {
    const spec = buildSpec({ session, config: { title: 'T', hud: { speedRow: 'toggle', closeOnOutsideTap: false } } as GameConfig, language: 'en', cards: [] });
    expect(spec.hud).toMatchObject({ speedRow: 'toggle', closeOnOutsideTap: false });
  });
});

describe('a session the platform no longer accepts (QA: "after opening a second session, the first tab gets 501 after a refresh")', () => {
  it('an HTTP refusal of the hub reads as the session being over, not as the server being down', async () => {
    const { rgsErrorFrom, RGS_ERRORS } = await import('../src/rgs/errors');
    const negotiate = Object.assign(new Error("Failed to complete negotiation with the server: Error: Session is not valid: Status code '501'"), { statusCode: 501 });
    expect(rgsErrorFrom(negotiate, 'connect')).toMatchObject({ errorId: RGS_ERRORS.SESSION_UNUSABLE, sessionOver: true });
    expect(rgsErrorFrom(new Error("Unexpected status code returned from negotiate '501'"), 'connect').sessionOver).toBe(true);
    expect(rgsErrorFrom(Object.assign(new Error("Unauthorized: Status code '401'"), { statusCode: 401 })).sessionOver).toBe(true);
    // an HTTP 502 / 503 is a gateway or an outage, never "invalid bet" / "insufficient funds"
    expect(rgsErrorFrom(Object.assign(new Error("Bad gateway: Status code '502'"), { statusCode: 502 })).errorId).toBe(RGS_ERRORS.TECHNICAL);
    expect(rgsErrorFrom(Object.assign(new Error("Service unavailable: Status code '503'"), { statusCode: 503 })).errorId).toBe(RGS_ERRORS.TECHNICAL);
    expect(rgsErrorFrom(Object.assign(new Error("Service unavailable: Status code '520'"), { statusCode: 520 })).errorId).toBe(RGS_ERRORS.TECHNICAL);
  });
});

describe('the wallet changes outside the game (QA: "after replenishing the wallet you need to reload the page")', () => {
  it('a balance notification the client cannot read is ignored, never shown as 0', async () => {
    const { balanceIn } = await import('../src/rgs/protocol');
    expect(balanceIn({ balance: 12.5, currency: 'EUR' })).toBe(12.5);
    expect(balanceIn({ Balance: '40' })).toBe(40);
    expect(balanceIn(7)).toBe(7);
    expect(balanceIn({ amount: 12 })).toBeNull();
    expect(balanceIn(null)).toBeNull();
    expect(balanceIn({ balance: 'n/a' })).toBeNull();
  });
});
