// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest';
import { HttpTransportType } from '@microsoft/signalr';
import { mountDomHud } from '@open-slot-ui/dom';
import { ArtubeRgsClient, connectionOptions, type HubConnectionLike } from '../src/rgs/ArtubeRgsClient';
import { MockRgs } from '../src/rgs/MockRgs';
import { RgsError, RGS_ERRORS, rgsErrorFrom } from '../src/rgs/errors';
import { startWaits } from '../src/rgs/network';
import { presentRgsError, SESSION_ENDED_MESSAGE } from '../src/engine/errors';
import type { HudPort, NoticeRequest } from '../src/engine/hud-port';
import { domHudPort } from '../src/game/hudAdapter';
import { bootScreen, showBootError } from '../src/game/bootError';
import { createArtubeGame } from '../src/game/createArtubeGame';
import { currencyFor } from '../src/currency';
import type { LoadedArtifact } from '../src/math/artifact';
import { loadTemplateMath } from './helpers';

/**
 * A RELOAD NEVER ENDS IN A 500.
 *
 * Artube QA on DEV, after a reload: "Cannot reach the game server … errorId 500, No Connection
 * with that ID: Status code '404'", and on a session that had ended, sometimes that and sometimes
 * the session's own 501. Measured on DEV: the hub runs on more than one server with no sticky
 * routing, so a negotiated connection id was missing on the server the next request reached (5 of
 * 8 connects failed). The client now opens its WebSocket directly (8 of 8 connected, a dead
 * session always 501), tries a failed first connection again on a short backoff behind the loader,
 * and every screen that ends a session is the HUD's own dialog with RELOAD (the game designer:
 * "just a reload button, and after a reload no 500 on any session").
 */

const wsClose501 = (): Error =>
  new Error('Server returned an error on close: Connection closed with an error. HubException: Operation failed with error code 501. Error message: The session is invalid or cannot be retrieved');

/** A hub connection whose starts fail `fails` times with `error`, then connect. */
function startsFailing(fails: number, error: () => Error) {
  const conn = {
    state: 'Disconnected',
    starts: 0,
    async start() {
      this.starts++;
      if (this.starts <= fails) throw error();
      this.state = 'Connected';
    },
    async stop() {
      this.state = 'Disconnected';
    },
    async invoke<T>(): Promise<T> {
      return {} as T;
    },
    on() {},
    onclose() {},
    onreconnecting() {},
    onreconnected() {},
  };
  return conn as typeof conn & HubConnectionLike;
}

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

describe('the hub runs on more than one server', () => {
  it('the connection is a WebSocket opened directly: no negotiate request to land on another server', () => {
    expect(connectionOptions()).toEqual({ skipNegotiation: true, transport: HttpTransportType.WebSockets });
    // the negotiated transports stay one switch away, for a host with sticky routing
    expect(connectionOptions(true)).not.toHaveProperty('skipNegotiation');
    expect(connectionOptions(true)).toHaveProperty('timeout', 30_000);
  });

  it('"No Connection with that ID" is a transport failure, never a 500', () => {
    const one = rgsErrorFrom(new Error("No Connection with that ID: Status code '404'"), 'connect');
    expect(one.transport).toBe(true);
    expect(one.errorId).toBeUndefined();
    const all = rgsErrorFrom(
      new Error(
        "Unable to connect to the server with any of the available transports. Error: WebSockets failed: Error: WebSocket failed to connect. Error: ServerSentEvents failed: Error: EventSource failed to connect. Error: LongPolling failed: Error: No Connection with that ID: Status code '404'",
      ),
      'connect',
    );
    expect(all.transport).toBe(true);
    // the same text carrying the hub's session-over code is the session ending
    expect(rgsErrorFrom(new Error(`WebSockets failed: ${wsClose501().message}. LongPolling failed: No Connection with that ID: Status code '404'`)).sessionOver).toBe(true);
  });
});

describe('the first connection is tried again, briefly, behind the loader', () => {
  it('5 attempts, 0.25 s apart and doubling (about 4 s), saying `connecting` before each retry', async () => {
    expect(startWaits(5)).toEqual([250, 500, 1000, 2000]);
    vi.useFakeTimers();
    const conn = startsFailing(99, () => new Error('WebSocket failed to connect.'));
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    const seen: string[] = [];
    c.on('connecting', (p) => seen.push(`${p.attempt}/${p.attempts}`));
    const done = c.connect().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(3749);
    expect(conn.starts).toBe(4);
    await vi.advanceTimersByTimeAsync(1);
    const err = (await done) as RgsError;
    expect(conn.starts).toBe(5);
    expect(seen).toEqual(['2/5', '3/5', '4/5', '5/5']);
    expect(err.transport).toBe(true);
  });

  it('a server that answers on the third attempt connects after two retries', async () => {
    vi.useFakeTimers();
    const conn = startsFailing(2, () => new Error("No Connection with that ID: Status code '404'"));
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    const seen: number[] = [];
    c.on('connecting', (p) => seen.push(p.attempt));
    const done = c.connect();
    await vi.advanceTimersByTimeAsync(750);
    await done;
    expect(conn.starts).toBe(3);
    expect(seen).toEqual([2, 3]);
    expect(c.connected).toBe(true);
  });

  it('a session the hub refuses is not tried again', async () => {
    const conn = startsFailing(99, wsClose501);
    const c = new ArtubeRgsClient({ url: 'x', connectionFactory: () => conn });
    const seen: number[] = [];
    c.on('connecting', (p) => seen.push(p.attempt));
    await expect(c.connect()).rejects.toMatchObject({ sessionOver: true, errorId: RGS_ERRORS.SESSION_UNUSABLE });
    expect(conn.starts).toBe(1);
    expect(seen).toEqual([]);
  });
});

describe('the mock scripts the first connection (`?mockBoot=`)', () => {
  let art: LoadedArtifact;
  beforeAll(async () => {
    art = await loadTemplateMath();
  });
  const mock = (boot: 'session-over' | 'offline' | 'flaky') => new MockRgs({ math: art, latency: 0, boot });

  it('session-over: refused at once, as the hub refuses it', async () => {
    const m = mock('session-over');
    const seen: number[] = [];
    m.on('connecting', (p) => seen.push(p.attempt));
    await expect(m.connect()).rejects.toMatchObject({ sessionOver: true });
    expect(seen).toEqual([]);
  });

  it('flaky: the third attempt connects; offline: five attempts, then a transport error', async () => {
    vi.useFakeTimers();
    const f = mock('flaky');
    const fSeen: number[] = [];
    f.on('connecting', (p) => fSeen.push(p.attempt));
    const fDone = f.connect();
    await vi.advanceTimersByTimeAsync(1000);
    await fDone;
    expect(fSeen).toEqual([2, 3]);

    const o = mock('offline');
    const oSeen: number[] = [];
    o.on('connecting', (p) => oSeen.push(p.attempt));
    const oDone = o.connect().catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(5000);
    expect(((await oDone) as RgsError).transport).toBe(true);
    expect(oSeen).toEqual([2, 3, 4, 5]);
  });
});

describe('the screens wear the HUD dialog, with RELOAD', () => {
  it('the boot screen: the HUD dialog with RELOAD, dressed by the HUD skin; nothing until the boot fails', () => {
    const boot = bootScreen(document.body);
    expect(document.querySelector('.artubeplate-boot')).toBeNull(); // the loader alone while it tries
    boot.error({ title: 'Session ended', message: SESSION_ENDED_MESSAGE });
    const root = document.querySelector<HTMLElement>('.OpenSlotUiContainer.artubeplate-boot')!;
    expect(Number(root.style.zIndex)).toBeGreaterThan(9999); // over the Artube loader
    expect(document.getElementById('artubeplate-boot-skin')?.textContent).toContain('.Dialog__title');
    expect(root.querySelector('#DialogWindow')!.className).toBe('DialogWindow is-visible');
    expect(root.querySelector('.Dialog__title')!.textContent).toBe('Session ended');
    expect(root.querySelector('.Dialog__action')!.textContent).toBe('Reload');
    expect(root.querySelector('.Dialog__action')!.className).toContain('Button--primary');
    expect(root.querySelectorAll('#DialogWindow')).toHaveLength(1);
    // no technical detail unless asked for (the player is never shown a code)
    expect(root.querySelector('.Dialog__detail')).toBeNull();

    boot.remove();
    expect(document.querySelector('.artubeplate-boot')).toBeNull();
    expect(document.getElementById('artubeplate-boot-skin')).toBeNull();
  });

  it('showBootError: detail in small print when given; RELOAD can be left out', () => {
    const el = showBootError({ title: 'No game session', message: 'Open the game from the casino.', detail: 'no sessionId', reload: false });
    expect(el.querySelector('.Dialog__detail')!.textContent).toBe('no sessionId');
    expect(el.querySelector('.Dialog__action')).toBeNull();
  });

  it('in play: a busy notice marks the dialog for the spinner, and the next notice takes the mark off', async () => {
    const hud = mountDomHud({ game: { name: 'T' } });
    const port = domHudPort(hud, () => currencyFor('EUR'));
    const host = hud.root.querySelector('#DialogWindow')!;
    void port.notice({ message: 'Reconnecting…', busy: true, blocking: true });
    expect(host.classList.contains('is-busy')).toBe(true);
    expect(host.classList.contains('is-visible')).toBe(true);
    expect(host.querySelector('.Dialog__action')).toBeNull(); // a spinner has no OK
    const lost = port.notice({ title: 'Connection lost', message: 'Reload now.', actions: [{ label: 'Reload', primary: true }], blocking: true });
    expect(host.classList.contains('is-busy')).toBe(false);
    expect(host.querySelector('.Dialog__action')!.textContent).toBe('Reload');
    port.hideNotice();
    expect(await lost).toBe(-1);
    void port.notice({ message: 'Reconnecting…', busy: true });
    port.hideNotice();
    expect(host.classList.contains('is-busy')).toBe(false);
    hud.dispose();
  });

  it('a session-over error in play is the "Session ended" dialog with RELOAD', async () => {
    const asked: NoticeRequest[] = [];
    const hud = { notice: async (r: NoticeRequest) => (asked.push(r), -1), showRgsError: () => {} } as unknown as HudPort;
    await presentRgsError(hud, new RgsError(RGS_ERRORS.SESSION_UNUSABLE, 'The session is invalid or cannot be retrieved', 'spin'));
    expect(asked[0]).toMatchObject({ title: 'Session ended', message: SESSION_ENDED_MESSAGE, blocking: true, actions: [{ label: 'Reload', primary: true }] });
  });

  it('a boot on a session the hub refuses: "Session ended" with RELOAD at once, never "Cannot reach the game server"', async () => {
    const art = await loadTemplateMath();
    const game = createArtubeGame({
      config: { title: 'T' } as never,
      interpretBook: () => null,
      mountView: () => {
        throw new Error('the view must not mount');
      },
      network: new MockRgs({ math: art, latency: 0, boot: 'session-over' }),
    });
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    await game.start();
    warn.mockRestore();
    const root = document.querySelector('.artubeplate-boot')!;
    expect(root.querySelector('.Dialog__title')!.textContent).toBe('Session ended');
    expect(root.querySelector('.Dialog__body-inner p')!.textContent).toBe(SESSION_ENDED_MESSAGE);
    expect(root.querySelector('.Dialog__action')!.textContent).toBe('Reload');
    expect(root.textContent).not.toMatch(/500|501|errorId/);
  });

  it('a boot that cannot reach the server: the loader alone while it tries (no spinner over it), then "No connection" with RELOAD', async () => {
    const art = await loadTemplateMath();
    const game = createArtubeGame({
      config: { title: 'T' } as never,
      interpretBook: () => null,
      mountView: () => {
        throw new Error('the view must not mount');
      },
      network: new MockRgs({ math: art, latency: 0, boot: 'offline' }),
    });
    const warn = vi.spyOn(console, 'error').mockImplementation(() => {});
    let retried = 0;
    let screenWhileTrying = false;
    (game.network as MockRgs).on('connecting', () => {
      retried++;
      screenWhileTrying ||= !!document.querySelector('.artubeplate-boot');
    });
    await game.start();
    warn.mockRestore();
    expect(retried).toBe(4);
    expect(screenWhileTrying).toBe(false);
    const root = document.querySelector('.artubeplate-boot')!;
    expect(root.querySelector('.Dialog__title')!.textContent).toBe('No connection');
    expect(root.querySelector('.Dialog__action')!.textContent).toBe('Reload');
  }, 15_000);
});
