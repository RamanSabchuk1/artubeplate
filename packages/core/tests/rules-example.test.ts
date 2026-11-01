import { describe, it, expect } from 'vitest';
import { buildSlotRules, type SlotConfig } from '../src/rules';

const slot = (image?: string): SlotConfig => ({
  board: { reels: 5, rows: 3 },
  symbols: [
    { id: 'H1', kind: 'high', name: 'Cat', ...(image ? { image } : {}) },
    { id: 'L1', kind: 'low', name: 'Ten' },
  ],
  pays: { unit: 'totalBet', table: { H1: { 3: 5, 4: 10, 5: 37.5 }, L1: { 3: 1, 4: 2, 5: 4 } } },
  paylines: [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0]],
});

const example = (s: SlotConfig) => {
  const { rules = [] } = buildSlotRules({ slot: s, modes: [], title: 'Test' });
  return rules.find((b) => b.id === 'pt-example-grid') as Extract<(typeof rules)[number], { kind: 'grid' }> | undefined;
};

describe('the winning example under the paylines', () => {
  it('draws the symbol art in the lit cells, the short name as the fallback', () => {
    const grid = example(slot('art/pt-sym-H1.png'));
    expect(grid?.cells).toEqual([[0, 1], [1, 1], [2, 1], [3, 1], [4, 1]]);
    expect(grid?.icon).toBe('art/pt-sym-H1.png');
    expect(grid?.symbol).toBe('CAT');
  });

  it('falls back to the generated tile when the symbol has no art', () => {
    expect(example(slot())?.icon).toMatch(/^data:image\/svg\+xml,/);
  });
});
