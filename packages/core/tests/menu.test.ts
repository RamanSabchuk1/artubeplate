import { describe, it, expect } from 'vitest';
import { buildSpec, withSpacebarRow, SPACEBAR_ROW } from '../src/game/spec';
import type { SessionResponse } from '../src/rgs/protocol';
import type { GameConfig } from '../src/game/config';

// SPACEBAR TO SPIN is the HUD's own row (open-slot-ui ≥ 0.17): the core only adds it to the menu.
describe('the ☰ menu gets the HUD\'s SPACEBAR TO SPIN row', () => {
  const config = { title: 'T' } as GameConfig;

  it('before INFO, after the speeds, keeping every default row', () => {
    const hud = withSpacebarRow({ features: { superTurbo: true, history: false } }, config);
    const kinds = hud.menu!.map((r) => r.id ?? r.kind);
    expect(kinds).toContain('sound');
    expect(kinds).not.toContain('history');
    expect(kinds.indexOf(SPACEBAR_ROW.id!)).toBe(kinds.indexOf('info') - 1);
    expect(kinds.indexOf(SPACEBAR_ROW.id!)).toBeGreaterThan(kinds.lastIndexOf('super-turbo'));
    expect(hud.menu!.find((r) => r.id === 'spacebar')).toMatchObject({ kind: 'spacebar', icon: 'icon-spacebar-off' });
  });

  it('not when the jurisdiction bans the spacebar, the game wrote its own menu, or there is no menu', () => {
    expect(withSpacebarRow({}, { ...config, jurisdiction: { disabledSpacebar: true } } as GameConfig).menu).toBeUndefined();
    const own = [{ kind: 'sound' as const }];
    expect(withSpacebarRow({ menu: own }, config).menu).toBe(own);
    expect(withSpacebarRow({ features: { menu: false } }, config).menu).toBeUndefined();
  });
});

describe('operator free rounds take the round button\'s place (the HUD\'s takeover)', () => {
  const session = {
    balance: 100,
    round: null,
    sessionSettings: { currency: 'EUR', allowedBets: [1, 2], defaultBetIndex: 0 },
    gameSettings: { betCredit: 100, gameModes: [{ id: 'base', type: 'None', priceMultiplier: 1, rtp: 96 }] },
    freeRoundCampaign: null,
    gamificationToken: null,
  } as unknown as SessionResponse;
  const config = { title: 'T' } as GameConfig;

  it('on by default; a game may keep them inline', () => {
    expect(buildSpec({ session, config, language: 'en', cards: [] }).hud?.freeRounds).toBe('takeover');
    expect(buildSpec({ session, config: { ...config, hud: { freeRounds: 'inline' } }, language: 'en', cards: [] }).hud?.freeRounds).toBe('inline');
  });
});

describe('no in-game HISTORY on Artube (the platform keeps the rounds)', () => {
  const session = {
    balance: 100,
    round: null,
    sessionSettings: { currency: 'EUR', allowedBets: [1, 2], defaultBetIndex: 0 },
    gameSettings: { betCredit: 100, gameModes: [{ id: 'base', type: 'None', priceMultiplier: 1, rtp: 96 }] },
    freeRoundCampaign: null,
    gamificationToken: null,
  } as unknown as SessionResponse;

  it('drops the row and the window; the spacebar row sits before INFO', () => {
    const hud = buildSpec({ session, config: { title: 'T' } as GameConfig, language: 'en', cards: [] }).hud!;
    expect(hud.features?.history).toBe(false);
    const kinds = hud.menu!.map((r) => r.id ?? r.kind);
    expect(kinds).not.toContain('history');
    expect(kinds.indexOf(SPACEBAR_ROW.id!)).toBe(kinds.indexOf('info') - 1);
  });
});
