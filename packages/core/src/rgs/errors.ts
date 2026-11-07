// RGS errors. Every failed hub call carries a numeric `errorId` (application-level — a 429 here
// is the method's own code, not an HTTP status) plus human text for logs. Client logic branches
// on `errorId` ONLY; the text changes, the codes do not.
//
// The docs do not pin down HOW the error arrives (a HubException the invoke rejects with, or an
// error object the method resolves to), so `rgsErrorFrom` accepts both. A failure with no
// errorId at all is a TRANSPORT failure — for a spin that means "outcome unknown": never retry,
// reconnect and read `session` instead.

/** The documented codes. */
export const RGS_ERRORS = Object.freeze({
  RATE_LIMITED: 429,
  TECHNICAL: 500,
  SESSION_UNUSABLE: 501,
  INVALID_BET: 502,
  INSUFFICIENT_FUNDS: 503,
  SESSION_STOPPED: 507,
  INVALID_GAME_SETTINGS: 600,
  UNKNOWN_MODE: 601,
  BUY_UNAVAILABLE: 622,
  FRC_NOT_FOUND: 631,
  FRC_PLAYED_OUT: 634,
  FRC_UNAVAILABLE: 637,
  FRC_ALREADY_ACTIVE: 638,
});

export type RgsErrorCode = (typeof RGS_ERRORS)[keyof typeof RGS_ERRORS];

const KNOWN = new Set<number>(Object.values(RGS_ERRORS));

export class RgsError extends Error {
  override readonly name = 'RgsError';
  constructor(
    /** The RGS errorId, or `undefined` for a transport failure (no answer from the server). */
    readonly errorId: number | undefined,
    message: string,
    /** The hub method that failed. */
    readonly method?: string,
  ) {
    super(message);
  }
  /** No answer came back — the connection dropped or the call timed out. */
  get transport(): boolean {
    return this.errorId === undefined;
  }
  /** The session is gone: a new one has to come from the operator. */
  get sessionOver(): boolean {
    return this.errorId === RGS_ERRORS.SESSION_UNUSABLE || this.errorId === RGS_ERRORS.SESSION_STOPPED;
  }
}

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

/** If a hub RESULT is an error envelope, return its errorId + message. */
export function errorEnvelope(result: unknown): { errorId: number; message: string } | null {
  if (!isRec(result)) return null;
  const inner = isRec(result.error) ? result.error : result;
  const id = inner.errorId ?? inner.ErrorId ?? inner.error_id;
  const n = typeof id === 'string' ? Number(id) : id;
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  const msg = inner.message ?? inner.Message ?? inner.errorMessage ?? inner.error ?? '';
  return { errorId: n, message: typeof msg === 'string' ? msg : JSON.stringify(msg) };
}

const TRANSPORT_PATTERNS = [
  /connection (?:being |was )?closed/i,
  /invocation canceled/i,
  /not in the 'connected' state/i,
  /websocket/i,
  /failed to fetch/i,
  /network/i,
  /timed? ?out/i,
  /disconnected/i,
];

/**
 * Normalize anything an invoke threw into an RgsError. A HubException's text is searched for an
 * errorId (`errorId: 503`, `"errorId":503`, `[503]`, a bare leading code…); connection-level
 * failures become transport errors.
 */
export function rgsErrorFrom(err: unknown, method?: string): RgsError {
  if (err instanceof RgsError) return err;
  const env = errorEnvelope(err);
  if (env) return new RgsError(env.errorId, env.message, method);
  const message = err instanceof Error ? err.message : typeof err === 'string' ? err : JSON.stringify(err);
  // An HTTP refusal before the hub answers at all (SignalR's negotiate: "…: Status code '501'").
  // A session the platform no longer accepts — taken over by another tab, expired — arrives this
  // way on a reload; read as a technical error, it said "cannot reach the server, reload", and
  // every reload got the same 501.
  const statusCode = (err as { statusCode?: unknown } | null)?.statusCode;
  const status = typeof statusCode === 'number' ? statusCode : Number(message.match(/status code\D{0,40}?(\d{3})/i)?.[1] ?? NaN);
  // Only the statuses that mean the same over HTTP keep an RGS code: an HTTP 502 or 503 is a
  // gateway or an outage, not "invalid bet" or "insufficient funds".
  if (Number.isFinite(status)) {
    if (status === 401 || status === 403 || status === RGS_ERRORS.SESSION_UNUSABLE) return new RgsError(RGS_ERRORS.SESSION_UNUSABLE, message, method);
    if (status === RGS_ERRORS.SESSION_STOPPED) return new RgsError(RGS_ERRORS.SESSION_STOPPED, message, method);
    if (status === RGS_ERRORS.RATE_LIMITED) return new RgsError(RGS_ERRORS.RATE_LIMITED, message, method);
    if (status >= 500) return new RgsError(RGS_ERRORS.TECHNICAL, message, method);
  }
  // JSON inside a HubException message.
  const json = message.match(/\{[\s\S]*\}/)?.[0];
  if (json) {
    try {
      const inner = errorEnvelope(JSON.parse(json));
      if (inner) return new RgsError(inner.errorId, inner.message || message, method);
    } catch {
      /* not JSON */
    }
  }
  // The hub's own wording when it ends a connection: "HubException: Operation failed with error
  // code 501. Error message: The session is invalid or cannot be retrieved". It comes inside
  // "Server returned an error on close: Connection closed with an error. …", so it must be read
  // before the text is taken for a dropped connection.
  const tagged =
    message.match(/error\s*_?id["'\s:=]*(\d{3})/i) ??
    message.match(/error\s+code\D{0,10}?(\d{3})\b/i) ??
    message.match(/\[(\d{3})\]/) ??
    message.match(/(?:HubException:\s*|^)(\d{3})\b/);
  if (tagged) {
    const code = Number(tagged[1]);
    if (KNOWN.has(code)) return new RgsError(code, message, method);
  }
  if (TRANSPORT_PATTERNS.some((re) => re.test(message))) return new RgsError(undefined, message, method);
  // A server-side exception we cannot classify: treat as a technical error (500) — which, for
  // a spin, the engine still handles as "state unknown, reconcile via session".
  return new RgsError(RGS_ERRORS.TECHNICAL, message, method);
}
