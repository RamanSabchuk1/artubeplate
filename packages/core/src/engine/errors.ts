// errorId → what the player sees and what the client does next, per the RGS error table.
// Pure (`describeRgsError`) so the policy is unit-tested; `presentRgsError` shows it on the HUD.

import { RGS_ERRORS, type RgsError } from '../rgs/errors';
import type { HudPort } from './hud-port';

export interface ErrorPolicy {
  /** `fatal` — the session is over (blocking, no way on); `notice` — dismissible;
   *  `funds` — the HUD's insufficient-funds message; `silent` — nothing to show. */
  kind: 'fatal' | 'notice' | 'funds' | 'silent';
  title: string;
  message: string;
  /** Re-read `session` afterwards (bets/modes/campaign state may have changed). */
  refresh: boolean;
}

export function describeRgsError(err: RgsError): ErrorPolicy {
  const code = err.errorId;
  switch (code) {
    case RGS_ERRORS.INSUFFICIENT_FUNDS:
      return { kind: 'funds', title: '', message: '', refresh: false };
    case RGS_ERRORS.SESSION_UNUSABLE:
    case RGS_ERRORS.SESSION_STOPPED:
      return {
        kind: 'fatal',
        title: 'Session ended',
        message: 'Your game session has ended. Close the game and open it again from the casino to keep playing.',
        refresh: false,
      };
    case RGS_ERRORS.INVALID_GAME_SETTINGS:
      return {
        kind: 'fatal',
        title: 'Game unavailable',
        message: `The game is not configured correctly (error ${code}). Please contact support.`,
        refresh: false,
      };
    case RGS_ERRORS.INVALID_BET:
      return { kind: 'notice', title: 'Bet unavailable', message: 'This bet is not available right now. Please choose another bet.', refresh: true };
    case RGS_ERRORS.UNKNOWN_MODE:
      return { kind: 'notice', title: 'Mode unavailable', message: 'This game mode is not available right now.', refresh: true };
    case RGS_ERRORS.BUY_UNAVAILABLE:
      return { kind: 'notice', title: 'Feature buy unavailable', message: 'Feature buys are not available during free rounds.', refresh: false };
    case RGS_ERRORS.FRC_NOT_FOUND:
    case RGS_ERRORS.FRC_UNAVAILABLE:
      return { kind: 'notice', title: 'Free rounds', message: 'This free rounds offer is no longer available.', refresh: true };
    case RGS_ERRORS.FRC_PLAYED_OUT:
      return { kind: 'notice', title: 'Free rounds', message: 'All free rounds have been played.', refresh: true };
    case RGS_ERRORS.FRC_ALREADY_ACTIVE:
      return { kind: 'silent', title: '', message: '', refresh: false };
    case RGS_ERRORS.RATE_LIMITED:
      return { kind: 'notice', title: 'Slow down', message: 'Too many requests. Please wait a moment and try again.', refresh: false };
    default:
      return {
        kind: 'notice',
        title: 'Something went wrong',
        message: code === undefined ? 'The connection to the game server was interrupted.' : `The game server could not complete the request (error ${code}). Please try again.`,
        refresh: true,
      };
  }
}

/** Show an RGS error on the HUD. Resolves when the player dismissed it (fatal: never). */
export async function presentRgsError(hud: HudPort, err: RgsError): Promise<ErrorPolicy> {
  const p = describeRgsError(err);
  if (typeof console !== 'undefined') console.warn(`[artubeplate] rgs error ${err.errorId ?? 'transport'} on ${err.method ?? '?'}: ${err.message}`);
  if (p.kind === 'funds') hud.showRgsError('ERR_IPB');
  else if (p.kind === 'fatal') void hud.notice({ title: p.title, message: p.message, blocking: true, actions: [] });
  else if (p.kind === 'notice') await hud.notice({ title: p.title, message: p.message });
  return p;
}
