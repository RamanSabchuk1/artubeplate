import { describe, it, expect } from 'vitest';
import { buyCardsFor } from '../src/game/spec';
import { resolveGameConfig, type GameConfig } from '../src/game/config';
import type { GameModeInfo, SessionResponse } from '../src/rgs/protocol';

const mode = (id: string, type: GameModeInfo['type'], priceMultiplier: number): GameModeInfo => ({ id, type, priceMultiplier, rtp: 96 });

const sessionWith = (gameModes: GameModeInfo[]): SessionResponse =>
  ({
    balance: 100,
    round: null,
    sessionSettings: { currency: 'EUR', allowedBets: [1, 2], defaultBetIndex: 0 },
    gameSettings: { betCredit: 100, gameModes },
    freeRoundCampaign: null,
    gamificationToken: null,
  }) as unknown as SessionResponse;

// The platform's order, as a session sends it: the base game, two boosts, then buys that are not
// sorted by price. The boost `ante` costs 3× a round; its card's `cost` is the 2× surcharge.
const modes = (): GameModeInfo[] => [
  mode('base', 'None', 1),
  mode('ante', 'LuckyBet', 3),
  mode('boost', 'LuckyBet', 1.5),
  mode('bonus', 'BuyFeature', 75),
  mode('super', 'BuyFeature', 130),
  mode('spin', 'BuyFeature', 2.5),
  mode('respin', 'BuyFeature', 75),
];

const ids = (session: SessionResponse, config: GameConfig): string[] => buyCardsFor(session, config).map((c) => c.id);

describe('the buy sheet order', () => {
  const config = { title: 'T' } as GameConfig;

  it("keeps the session's order by default, without the base game", () => {
    const session = sessionWith(modes());
    expect(ids(session, config)).toEqual(['ante', 'boost', 'bonus', 'super', 'spin', 'respin']);
    expect(ids(session, { ...config, buyOrder: 'session' })).toEqual(['ante', 'boost', 'bonus', 'super', 'spin', 'respin']);
  });

  it("'price' lists the cards cheapest first, a boost at its full price per round", () => {
    const cards = buyCardsFor(sessionWith(modes()), { ...config, buyOrder: 'price' });
    // Sorted by the card's 2× `cost`, `ante` would come before the 2.5× buy.
    expect(cards.map((c) => c.id)).toEqual(['boost', 'spin', 'ante', 'bonus', 'respin', 'super']);
    expect(cards.find((c) => c.id === 'ante')).toMatchObject({ variant: 'boost', cost: 2 });
  });

  it('keeps the session order between equal prices', () => {
    const session = sessionWith([
      mode('base', 'None', 1),
      mode('b', 'LuckyBet', 1.5),
      mode('a', 'LuckyBet', 1.5),
      mode('z', 'BuyFeature', 50),
      mode('y', 'BuyFeature', 20),
      mode('x', 'BuyFeature', 50),
    ]);
    expect(ids(session, { ...config, buyOrder: 'price' })).toEqual(['b', 'a', 'y', 'z', 'x']);
  });

  it("leaves the session's mode list as the platform sent it", () => {
    const session = sessionWith(modes());
    const before = session.gameSettings.gameModes.map((m) => m.id);
    buyCardsFor(session, { ...config, buyOrder: 'price' });
    expect(session.gameSettings.gameModes.map((m) => m.id)).toEqual(before);
  });

  it('may come from fromSession', () => {
    const session = sessionWith(modes());
    const resolved = resolveGameConfig({ ...config, fromSession: () => ({ buyOrder: 'price' }) }, session);
    expect(ids(session, resolved)).toEqual(['boost', 'spin', 'ante', 'bonus', 'respin', 'super']);
  });
});
