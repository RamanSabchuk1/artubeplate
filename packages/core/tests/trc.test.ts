import { describe, it, expect } from 'vitest';
import { normalizeRestoredRound } from '../src/rgs/protocol';
import { TurboClock } from '../src/engine/turbo';
import { currencyFor } from '../src/currency';
import { formatAmount } from '@open-slot-ui/core';

describe('the round in the session response (Artube: spinResults, the last one is the outcome)', () => {
  it('reads the payload from the last step of spinResults', () => {
    const r = normalizeRestoredRound<{ step: number }>({
      roundId: 'r-9',
      gameMode: 'bonus',
      bet: 1,
      totalWin: 42,
      spinResults: [
        { winMultiplier: 0, payload: '{"step":1}' },
        { winMultiplier: 42, payload: '{"step":2}' },
      ],
    });
    expect(r).toMatchObject({ roundId: 'r-9', gameMode: 'bonus', totalWin: 42, winMultiplier: 42, payload: { step: 2 } });
  });

  it('still takes a spin-shaped spinResult, or a flat payload', () => {
    expect(normalizeRestoredRound({ roundId: 'a', spinResult: { winMultiplier: 3, payload: { x: 1 } } })).toMatchObject({ winMultiplier: 3, payload: { x: 1 } });
    expect(normalizeRestoredRound({ roundId: 'b', payload: { x: 2 } })).toMatchObject({ payload: { x: 2 } });
    expect(normalizeRestoredRound(null)).toBeNull();
  });
});

describe('turbo: a round finishes at the speed it started with', () => {
  it('holds a level change until the round is over', () => {
    const t = new TurboClock([1, 0.4, 0.12]);
    t.hold(true); // a round starts at turbo off
    t.setLevel(2);
    expect(t.level).toBe(0);
    expect(t.speed).toBe(1);
    t.hold(false); // the round is over: the new speed counts from the next one
    expect(t.level).toBe(2);
    expect(t.speed).toBe(0.12);
  });

  it('applies at once between rounds, and the last change wins', () => {
    const t = new TurboClock([1, 0.4, 0.12]);
    t.setLevel(1);
    expect(t.level).toBe(1);
    t.hold(true);
    t.setLevel(2);
    t.setLevel(0);
    t.hold(false);
    expect(t.level).toBe(0);
  });

  it('in a bonus, a change counts from the next bonus spin (QA: "you cannot change the speed during the bonus")', () => {
    const t = new TurboClock([1, 0.4, 0.12]);
    t.hold(true); // the round that lands the bonus
    t.feature(true); // the bonus starts
    expect(t.level).toBe(0);
    t.setLevel(1, 'bonus'); // switched during the first bonus spin…
    expect(t.speed).toBe(1); // …which finishes at its own pace
    t.spin(); // the next bonus spin
    expect(t.level).toBe(1);
    expect(t.speed).toBe(0.4);
    t.setLevel(2, 'bonus');
    t.spin();
    expect(t.speed).toBe(0.12);
    t.feature(false);
    t.hold(false);
    expect(t.level).toBe(0); // the base game's own switch never moved
  });

  it('a change made on the way into the bonus counts for its first spin', () => {
    const t = new TurboClock([1, 0.4, 0.12]);
    t.hold(true);
    t.setLevel(2, 'bonus'); // switched while the trigger spin was still landing
    t.feature(true);
    expect(t.level).toBe(2);
  });
});

describe('turbo: a slam belongs to the part of the round it was pressed in', () => {
  it('a slam of the spin that lands the bonus does not carry into the bonus', async () => {
    const t = new TurboClock([1, 0.4, 0.12]);
    t.skip(); // the player slams the reels of the triggering spin
    expect(t.skipped).toBe(true);
    t.feature(true); // the game enters its bonus
    expect(t.skipped).toBe(false);
    expect(t.inFeature).toBe(true);
    let done = false;
    void t.delay(50).then(() => (done = true));
    await Promise.resolve();
    expect(done).toBe(false); // the bonus keeps its own pace: delays wait again
    await new Promise((r) => setTimeout(r, 70));
    expect(done).toBe(true);
  });

  it('a slam inside the bonus lasts until the bonus ends, and no further', () => {
    const t = new TurboClock([1, 0.4, 0.12]);
    t.feature(true);
    t.skip(); // a game that allows skipping its bonus
    t.feature(true); // saying it again changes nothing
    expect(t.skipped).toBe(true);
    t.feature(false); // back to the base game for the settle
    expect(t.skipped).toBe(false);
    expect(t.inFeature).toBe(false);
  });
});

describe('turbo: operator free rounds count as autoplay for the game\'s screens, not its pace', () => {
  it('autoplay is on while a campaign plays, and the speed stays the player\'s', () => {
    const t = new TurboClock([1, 0.4, 0.12]);
    t.setFreeRounds(true);
    expect(t.autoplay).toBe(true); // a bonus screen continues by itself
    expect(t.speed).toBe(1); // turbo off stays off
    t.setLevel(2);
    expect(t.speed).toBe(0.12); // and the player may turn it on
    t.setFreeRounds(false);
    expect(t.autoplay).toBe(false);
    t.setAutoplay(true);
    t.setLevel(0);
    expect(t.speed).toBe(0.4); // the player's own autoplay still plays at least at turbo pace
  });
});

describe('a demo session (currency null) says DEMO where the currency would be', () => {
  it('formats play money as "1.00 DEMO", with the session unit deciding the decimals', () => {
    expect(formatAmount(1, currencyFor(null))).toBe('1.00 DEMO');
    expect(formatAmount(999998, currencyFor(null, 0.01))).toBe('999,998.00 DEMO');
    expect(formatAmount(5, currencyFor(null, 1))).toBe('5 DEMO');
  });
});

describe('a currency the HUD does not know shows its ISO code, in upper case', () => {
  it('prints IRR after the amount with no decimals, however the RGS spelt it', () => {
    expect(formatAmount(1234567.5, currencyFor('irr', 1))).toBe('1,234,568 IRR');
    expect(formatAmount(1234567.5, currencyFor('IRR'))).toBe('1,234,568 IRR');
    expect(formatAmount(1234567.5, currencyFor('IRR', 0.01))).toBe('1,234,567.50 IRR');
  });
  it('keeps the symbol of a known currency, whatever the case of the code', () => {
    expect(formatAmount(5, currencyFor('eur'))).toBe('€5.00');
    expect(formatAmount(5, currencyFor('jpy'))).toBe('¥5');
  });
});
