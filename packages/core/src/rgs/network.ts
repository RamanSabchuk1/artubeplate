// The transport seam. Both adapters — the real SignalR client and the in-process mock — speak
// the SAME four methods and emit the same lifecycle events, so the engine never knows which one
// it has. Responses are already normalized (see protocol.ts); errors are RgsErrors.

import type { BalanceResponse, FreeRoundCampaign, RoundResponse, SessionResponse, SpinRequest } from './protocol';
import { RgsError } from './errors';

export interface RgsEvents {
  /** `NotifyBalanceChanged` — a HINT: it can arrive out of order; never gate UI on it. */
  balanceChanged: { balance: number; currency: string | null };
  /** `NotifySessionClosed` — the platform ended the session; a new one must come from the operator. */
  sessionClosed: undefined;
  /** `NotifyNewConnectionHasOpened` — another client took the session over; this one is dead. */
  replaced: undefined;
  /**
   * The FIRST connection failed and the transport tries again: `attempt` of `attempts` (2 and
   * up). The boot shows a spinner meanwhile; a refused session is never retried.
   */
  connecting: { attempt: number; attempts: number; error?: Error };
  /**
   * A spin has had no answer for a while (`on: true`), and later the wait ended (`on: false`):
   * the answer came, or the client gave up on it. The game shows a spinner meanwhile.
   */
  waiting: { method: string; on: boolean };
  /** The connection dropped; the client is retrying (lock the UI, never resend a spin). */
  reconnecting: { error?: Error };
  /** The connection is back. The caller MUST call `session()` and replace its state. */
  reconnected: undefined;
  /**
   * The automatic reconnect gave up, or the connection was stopped. With `retrying`, the
   * transport keeps trying in the background (the player's network may come back long
   * after the reconnect's own attempts ran out) and emits `reconnected` when it is back;
   * without it, the connection is gone for good.
   */
  closed: { error?: Error; retrying?: boolean };
}

export type RgsEventName = keyof RgsEvents;

export interface RgsTransport {
  readonly kind: 'artube' | 'mock';
  /**
   * Whether a call can go out right now. A transport that can lose its connection says
   * so here (a call made meanwhile fails at once, as a transport error); absent = always.
   */
  readonly connected?: boolean;
  /** Open the connection (bounded retries on the first start). */
  connect(): Promise<void>;
  session<P = unknown>(): Promise<SessionResponse<P>>;
  /** ONE round. Never retried by the transport — a repeat would be a new round. */
  spin<P = unknown>(req: SpinRequest): Promise<RoundResponse<P>>;
  balance(): Promise<BalanceResponse>;
  activateFreeRoundCampaign(campaignId: string): Promise<FreeRoundCampaign | null>;
  on<K extends RgsEventName>(type: K, fn: (payload: RgsEvents[K]) => void): () => void;
  dispose(): Promise<void>;
}

/** A tiny typed emitter both adapters share. */
export class RgsEmitter {
  private readonly map = new Map<RgsEventName, Set<(p: never) => void>>();
  on<K extends RgsEventName>(type: K, fn: (payload: RgsEvents[K]) => void): () => void {
    let set = this.map.get(type);
    if (!set) this.map.set(type, (set = new Set()));
    set.add(fn as (p: never) => void);
    return () => set!.delete(fn as (p: never) => void);
  }
  emit<K extends RgsEventName>(type: K, payload: RgsEvents[K]): void {
    for (const fn of [...(this.map.get(type) ?? [])]) {
      try {
        (fn as (p: RgsEvents[K]) => void)(payload);
      } catch (e) {
        console.error(`[rgs] ${type} handler threw`, e);
      }
    }
  }
}

/** Resolve after `ms` (0 → next macrotask). */
export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, Math.max(0, ms)));

/** The waits between the first connection's attempts: 0.25 s, doubling (5 attempts ≈ 4 s). */
export const startWaits = (attempts: number): number[] => Array.from({ length: Math.max(0, attempts - 1) }, (_, i) => 250 * 2 ** i);

/**
 * Open a connection, trying again on a short exponential backoff. Says `connecting` before each
 * retry (a spinner's cue), stops at once on an error `final` calls final (a session the platform
 * refuses is refused every time), and throws the last error when the attempts run out.
 */
export async function startWithRetries(
  start: () => Promise<void>,
  opts: { attempts: number; emit: RgsEmitter; final?: (e: unknown) => boolean },
): Promise<void> {
  const attempts = Math.max(1, opts.attempts);
  const waits = startWaits(attempts);
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    if (i > 0) {
      opts.emit.emit('connecting', { attempt: i + 1, attempts, ...(last instanceof Error ? { error: last } : {}) });
      await sleep(waits[i - 1] ?? 0);
    }
    try {
      await start();
      return;
    } catch (e) {
      last = e;
      if (opts.final?.(e)) break;
    }
  }
  throw last ?? new Error('could not connect to the game server');
}

/** How long a call may go unanswered. */
export interface AnswerTimes {
  /** A spin unanswered this long says `waiting` (a spinner's cue). Default 5 s. */
  slowMs: number;
  /** Any call unanswered this long is given up: a transport error, and the connection is made
   *  again. Default 20 s. */
  timeoutMs: number;
}
export const DEFAULT_ANSWER_TIMES: Readonly<AnswerTimes> = Object.freeze({ slowMs: 5_000, timeoutMs: 20_000 });

/**
 * Wait for a call's answer. A hub can keep a connection alive (its pings arrive) and still never
 * answer a call, and SignalR waits for such an invocation forever. After `slowMs` this says
 * `waiting` (on, when `slow`); after `timeoutMs` it gives up: `onTimeout` runs (the client makes
 * the connection again: an unanswered call may hold every call behind it on the hub) and the wait
 * fails with a TRANSPORT error, so a spin's outcome is unknown and goes to recovery, never to a
 * resend. A late answer is dropped. `waiting` (off) follows whatever ends a wait that said it.
 */
export function awaitAnswer<T>(
  answer: Promise<T>,
  o: { method: string; emit: RgsEmitter; times: AnswerTimes; slow?: boolean; onTimeout?: () => void },
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let said = false;
    let done = false;
    const end = (): void => {
      done = true;
      clearTimeout(slowTimer);
      clearTimeout(hardTimer);
      if (said) o.emit.emit('waiting', { method: o.method, on: false });
    };
    const slowTimer = o.slow
      ? setTimeout(() => {
          if (done) return;
          said = true;
          o.emit.emit('waiting', { method: o.method, on: true });
        }, o.times.slowMs)
      : undefined;
    const hardTimer = setTimeout(() => {
      if (done) return;
      answer.catch(() => {}); // a late answer, or its failure, is nobody's now
      o.onTimeout?.();
      end();
      reject(new RgsError(undefined, `no answer to ${o.method} in ${Math.round(o.times.timeoutMs / 1000)} s`, o.method));
    }, o.times.timeoutMs);
    answer.then(
      (v) => {
        if (done) return;
        end();
        resolve(v);
      },
      (e: unknown) => {
        if (done) return;
        end();
        reject(e);
      },
    );
  });
}
