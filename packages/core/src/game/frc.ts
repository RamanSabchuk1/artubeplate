// The free-rounds offer and what the player chose, per session. Artube keeps the `sessionId`
// across a reload, and Artube's TRC checklist wants three things from it:
//   - FRC Acceptance: every new session opens with the offer. That includes a campaign the
//     player started in an earlier session; its offer says how many rounds are left.
//   - Refresh During FRC: a reload after accepting carries on (one "Continue", no second offer).
//   - FRC Decline: once declined, the offer is not shown again in this session, reload included.
// Kept in localStorage for the last few sessions. Storage that throws (a private window, a
// sandboxed iframe) only means the offer is shown again.

import type { FreeRoundCampaign } from '../rgs/protocol';

export type FrcChoice = 'accepted' | 'declined';

export const FRC_KEY = 'artubeplate.frc';
const KEEP = 20;

interface Entry {
  /** sessionId */
  s: string;
  /** campaignId */
  c: string;
  v: FrcChoice;
}

function entries(): Entry[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(FRC_KEY) ?? '[]');
    if (!Array.isArray(raw)) return [];
    return raw.filter((e): e is Entry => {
      const x = e as Partial<Entry> | null;
      return !!x && typeof x.s === 'string' && typeof x.c === 'string' && (x.v === 'accepted' || x.v === 'declined');
    });
  } catch {
    return [];
  }
}

/** What the player chose for this campaign in this session, if anything. */
export function frcChoice(sessionId: string | null | undefined, campaignId: string): FrcChoice | null {
  if (!sessionId) return null; // the mock without a session: offer on every load
  return entries().find((e) => e.s === sessionId && e.c === campaignId)?.v ?? null;
}

export function rememberFrcChoice(sessionId: string | null | undefined, campaignId: string, v: FrcChoice): void {
  if (!sessionId) return;
  const next = [{ s: sessionId, c: campaignId, v }, ...entries().filter((e) => !(e.s === sessionId && e.c === campaignId))].slice(0, KEEP);
  try {
    localStorage.setItem(FRC_KEY, JSON.stringify(next));
  } catch {
    /* storage blocked: the offer is shown again next time */
  }
}

/** Artube sends `validTo` in UTC without a zone: read it as UTC (and show it in local time). */
export function campaignExpiry(validTo: string): Date {
  return new Date(/[zZ]|[+-]\d\d:?\d\d$/.test(validTo) ? validTo : `${validTo}Z`);
}

export interface FrcNotice {
  title: string;
  message: string;
  actions: Array<{ label: string; primary?: boolean }>;
}

/**
 * The free-rounds notice.
 * - `offer`, at the start of a session: "Play now" / "Later", or "Continue" / "Later" for a
 *   campaign started in an earlier session, with the rounds left and the win so far.
 * - `resume`, a reload after accepting: the same facts and one "Continue".
 */
export function frcNotice(c: FreeRoundCampaign, kind: 'offer' | 'resume', format: (n: number) => string): FrcNotice {
  const started = c.roundsLeft < c.roundsTotal;
  const count = started ? `${c.roundsLeft} of ${c.roundsTotal} free rounds left` : `${c.roundsLeft} free round${c.roundsLeft === 1 ? '' : 's'}`;
  const won = started && c.totalWin > 0 ? ` Won so far: ${format(c.totalWin)}.` : '';
  const until = kind === 'offer' && c.validTo ? ` Play before ${campaignExpiry(c.validTo).toLocaleString()}.` : '';
  const message = `You have ${count} at ${format(c.bet)} per round.${won}${until}`;
  if (kind === 'resume') return { title: 'Free rounds', message, actions: [{ label: 'Continue', primary: true }] };
  return { title: 'Free rounds', message, actions: [{ label: started ? 'Continue' : 'Play now', primary: true }, { label: 'Later' }] };
}
