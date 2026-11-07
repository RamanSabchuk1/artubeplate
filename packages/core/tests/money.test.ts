// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { mountDomHud } from '@open-slot-ui/dom';
import { domHudPort } from '../src/game/hudAdapter';
import { rulesKit } from '../src/game/config';
import { currencyFor } from '../src/currency';
import type { SessionResponse } from '../src/rgs/protocol';

/**
 * MONEY ON SCREEN IS ROUNDED DOWN.
 *
 * Artube's checklist ("Balance and win"): in every currency the balance and the win on screen are
 * rounded down to the currency's minimal unit and never exceed the actual values. QA, Mad Dogs in
 * KRW: the wallet held 1449.987, the bar read ₩1,450, and a bet of ₩1,450 was refused for funds.
 */

const krw = currencyFor('KRW', 1);
const kwd = currencyFor('KWD', 0.001);

describe('the canvas formats a win the way the bar does', () => {
  it('a win reads at the minimal unit, rounded down (hud.format)', () => {
    document.body.innerHTML = '';
    const hud = mountDomHud({ game: { name: 'T' } });
    let cur = krw;
    const port = domHudPort(hud, () => cur);
    expect(port.format(1986.5)).toBe('₩1,986');
    expect(port.format(1449.987)).toBe('₩1,449');
    expect(port.format(0.7 * 3 * 1000)).toBe('₩2,100'); // binary noise never costs a unit
    cur = kwd;
    expect(port.format(12.3459)).toBe('KD12.345');
    hud.dispose();
  });

  it('a paytable amount never reads more than that symbol pays', () => {
    const session = {
      balance: 1000,
      sessionSettings: { currency: 'KRW', currencyMinimalUnit: 1, allowedBets: [1450], defaultBetIndex: 0 },
      gameSettings: { gameModes: [] },
    } as unknown as SessionResponse;
    expect(rulesKit(session).money(1.37)).toBe('₩1,986'); // 1986.5
  });
});
