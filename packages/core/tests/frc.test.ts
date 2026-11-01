// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest';
import { frcChoice, rememberFrcChoice, frcNotice, campaignExpiry, FRC_KEY } from '../src/game/frc';
import type { FreeRoundCampaign } from '../src/rgs/protocol';

const money = (n: number): string => `$${n.toFixed(2)}`;
const campaign = (over: Partial<FreeRoundCampaign> = {}): FreeRoundCampaign => ({
  campaignId: 'c-1',
  bet: 1.5,
  roundsTotal: 100,
  roundsLeft: 100,
  totalWin: 0,
  isComplete: false,
  ...over,
});

describe('free rounds: what the player chose is kept per session', () => {
  beforeEach(() => localStorage.clear());

  it('a reload (same session) finds the choice; a new session or another campaign does not', () => {
    rememberFrcChoice('s-1', 'c-1', 'accepted');
    rememberFrcChoice('s-2', 'c-1', 'declined');
    expect(frcChoice('s-1', 'c-1')).toBe('accepted');
    expect(frcChoice('s-2', 'c-1')).toBe('declined');
    expect(frcChoice('s-3', 'c-1')).toBeNull(); // a new session gets the offer again
    expect(frcChoice('s-1', 'c-2')).toBeNull(); // so does a new campaign
  });

  it('the last choice wins, only the last 20 sessions are kept, and no session means no memory', () => {
    rememberFrcChoice('s-1', 'c-1', 'declined');
    rememberFrcChoice('s-1', 'c-1', 'accepted');
    expect(frcChoice('s-1', 'c-1')).toBe('accepted');
    for (let i = 0; i < 25; i++) rememberFrcChoice(`n-${i}`, 'c-1', 'accepted');
    expect(JSON.parse(localStorage.getItem(FRC_KEY)!)).toHaveLength(20);
    expect(frcChoice('s-1', 'c-1')).toBeNull();
    rememberFrcChoice(null, 'c-1', 'declined');
    expect(frcChoice(null, 'c-1')).toBeNull();
  });

  it('ignores what it does not recognise', () => {
    localStorage.setItem(FRC_KEY, JSON.stringify([{ s: 's-1', c: 'c-1', v: 'maybe' }, null, { s: 's-2', c: 'c-1', v: 'declined' }]));
    expect(frcChoice('s-1', 'c-1')).toBeNull();
    expect(frcChoice('s-2', 'c-1')).toBe('declined');
    localStorage.setItem(FRC_KEY, '{not json');
    expect(frcChoice('s-2', 'c-1')).toBeNull();
  });
});

describe('free rounds: the notice', () => {
  it('a new campaign: the count, the bet, the expiry; Play now / Later', () => {
    const n = frcNotice(campaign({ roundsTotal: 3, roundsLeft: 3, validTo: '2026-10-09T13:04:40' }), 'offer', money);
    expect(n.title).toBe('Free rounds');
    expect(n.message).toMatch(/^You have 3 free rounds at \$1\.50 per round\. Play before .+\.$/);
    expect(n.actions.map((a) => a.label)).toEqual(['Play now', 'Later']);
  });

  it('a campaign started in an earlier session is offered again with what is left', () => {
    const n = frcNotice(campaign({ roundsLeft: 93, totalWin: 12.3 }), 'offer', money);
    expect(n.message).toBe('You have 93 of 100 free rounds left at $1.50 per round. Won so far: $12.30.');
    expect(n.actions.map((a) => a.label)).toEqual(['Continue', 'Later']);
  });

  it('a reload after accepting: one Continue', () => {
    const n = frcNotice(campaign({ roundsLeft: 1, totalWin: 0, validTo: '2026-10-09T13:04:40' }), 'resume', money);
    expect(n.message).toBe('You have 1 of 100 free rounds left at $1.50 per round.');
    expect(n.actions).toEqual([{ label: 'Continue', primary: true }]);
  });

  it('reads a zone-less validTo as UTC', () => {
    expect(campaignExpiry('2026-10-09T13:04:40').toISOString()).toBe('2026-10-09T13:04:40.000Z');
    expect(campaignExpiry('2026-10-09T13:04:40+02:00').toISOString()).toBe('2026-10-09T11:04:40.000Z');
  });
});
