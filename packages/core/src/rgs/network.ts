// The transport seam. Both adapters — the real SignalR client and the in-process mock — speak
// the SAME four methods and emit the same lifecycle events, so the engine never knows which one
// it has. Responses are already normalized (see protocol.ts); errors are RgsErrors.

import type { BalanceResponse, FreeRoundCampaign, RoundResponse, SessionResponse, SpinRequest } from './protocol';

export interface RgsEvents {
  /** `NotifyBalanceChanged` — a HINT: it can arrive out of order; never gate UI on it. */
  balanceChanged: { balance: number; currency: string | null };
  /** `NotifySessionClosed` — the platform ended the session; a new one must come from the operator. */
  sessionClosed: undefined;
  /** `NotifyNewConnectionHasOpened` — another client took the session over; this one is dead. */
  replaced: undefined;
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
