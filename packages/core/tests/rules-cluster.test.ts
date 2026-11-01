import { describe, expect, it } from 'vitest';
import { buildSlotRules, type SlotConfig } from '../src/rules';

/** A cluster game: five plates on 5×5, seven size tiers. */
const clusterSlot = (over: Partial<SlotConfig> = {}): SlotConfig => ({
  schema: 'artubeplate/slot@1',
  title: 'Gym',
  board: { reels: 5, rows: 5 },
  symbols: [
    { id: 'P5', name: 'Purple plate', kind: 'high' },
    { id: 'P1', name: 'Blue plate', kind: 'low' },
  ],
  pays: {
    unit: 'totalBet',
    cluster: { tiers: [[5, 5], [6, 6], [7, 7], [8, 9], [10, 14], [15, 19], [20, 100]] },
    table: { P5: { '5': 2, '6': 4, '7': 8, '8': 15, '10': 40, '15': 100, '20': 200 }, P1: { '5': 0.3, '6': 0.6, '7': 1.2, '8': 2.5, '10': 6, '15': 15, '20': 30 } },
  },
  maxWin: 10000,
  ...over,
});
const modes = [{ id: 'base', name: 'Base', type: 'None' as const, rtp: 96, priceMultiplier: 1, volatility: 'high' }];
const build = (slot: SlotConfig) => buildSlotRules({ slot, modes, title: 'Gym', money: (x) => `€${x.toFixed(2)}` });
const texts = (blocks: ReturnType<typeof build>): string => JSON.stringify(blocks);

describe('a cluster game in the rules', () => {
  it('says the symbols pay in clusters of touching symbols', () => {
    const s = texts(build(clusterSlot()));
    expect(s).toContain('In clusters, 5+ touching');
    expect(s).toContain('5 or more of one symbol touching horizontally or vertically pay');
    expect(s).not.toContain('wherever they land');
  });
  it('heads the paytable columns by the tiers', () => {
    const s = texts(build(clusterSlot()));
    for (const label of ['"5"', '"6"', '"7"', '"8-9"', '"10-14"', '"15-19"', '"20+"']) expect(s).toContain(label);
  });
  it('words the example as a cluster', () => {
    const s = texts(build(clusterSlot()));
    expect(s).toContain('20 or more Purple plate touching horizontally or vertically pay 200× the bet: €200.00');
  });
});
