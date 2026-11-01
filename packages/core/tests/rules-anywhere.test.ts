import { describe, it, expect } from 'vitest';
import type { BlockSpec } from '@open-slot-ui/core';
import { buildSlotRules, type SlotConfig } from '../src/rules';

const money = (x: number): string => `$${x.toFixed(2)}`;

/** A pay-anywhere tumble game: five symbols on 5×6, three count tiers. */
const anywhereSlot = (over: Partial<SlotConfig> = {}): SlotConfig => ({
  board: { reels: 5, rows: 6 },
  symbols: [
    { id: 'S5', kind: 'high', name: 'Octopus nigiri' },
    { id: 'S1', kind: 'low', name: 'Tuna maki' },
  ],
  pays: {
    unit: 'totalBet',
    anywhere: { tiers: [[10, 11], [12, 13], [14, 30]] },
    table: { S5: { 10: 0.8, 12: 3, 14: 12 }, S1: { 10: 0.1, 12: 0.5, 14: 2 } },
  },
  ...over,
});

const build = (slot: SlotConfig): BlockSpec[] => buildSlotRules({ slot, modes: [], title: 'Sushi', money }).rules ?? [];
const block = <K extends BlockSpec['kind']>(rules: BlockSpec[], id: string, kind: K) =>
  rules.find((b) => b.id === id && b.kind === kind) as Extract<BlockSpec, { kind: K }> | undefined;
const glance = (rules: BlockSpec[]) => block(rules, 'glance', 'stat-grid')?.items ?? [];
const text = (rules: BlockSpec[], id: string) => block(rules, id, 'text')?.text;

describe('a pay-anywhere game in the rules', () => {
  it('says so at a glance, with no paylines and no ways', () => {
    const items = glance(build(anywhereSlot()));
    expect(items).toContainEqual({ label: 'Pays', value: 'Anywhere, 10+ of a kind' });
    expect(items.map((i) => i.label)).not.toContain('Paylines');
    expect(items.map((i) => i.label)).not.toContain('Ways');
  });

  it('describes pays anywhere in the default about text', () => {
    expect(text(build(anywhereSlot()), 'r-about')).toBe(
      'Sushi is a 5×6 video slot where symbols pay anywhere on the board: 10 or more of one symbol pay, wherever they land; the more of them, the more they pay.',
    );
  });

  it("keeps the math's own about text", () => {
    expect(text(build(anywhereSlot({ texts: { about: '{{title}} pays anywhere.' } })), 'r-about')).toBe('Sushi pays anywhere.');
  });

  it('heads the paytable columns with the tiers, biggest first', () => {
    const table = block(build(anywhereSlot()), 'pt-symbols', 'symbols');
    expect(table?.counts).toEqual(['14+', '12-13', '10-11']);
    expect(table?.rows[0]).toMatchObject({ name: 'Octopus nigiri', pays: ['12×', '3×', '0.8×'] });
  });

  it('words the worked example as a count anywhere, in money', () => {
    expect(text(build(anywhereSlot()), 'pt-example')).toBe('Example, at a bet of $1.00: 14 or more Octopus nigiri anywhere on the board pay 12× the bet: $12.00.');
  });

  it('draws no paylines and no line example', () => {
    const rules = build(anywhereSlot());
    expect(rules.find((b) => b.kind === 'paylines')).toBeUndefined();
    expect(rules.find((b) => b.id === 'pt-example-grid')).toBeUndefined();
  });

  it('a table whose tiers reach the whole board says "or more" at the top only', () => {
    const slot = anywhereSlot({ pays: { unit: 'totalBet', anywhere: { tiers: [[8, 9], [10, 11], [12, 30]] }, table: { S5: { 8: 1, 10: 2, 12: 5 } } } });
    expect(block(build(slot), 'pt-symbols', 'symbols')?.counts).toEqual(['12+', '10-11', '8-9']);
  });

  it('a game with paylines ignores a stray anywhere block', () => {
    const slot = anywhereSlot({ paylines: [[0, 0, 0, 0, 0]] });
    expect(glance(build(slot)).map((i) => i.label)).toContain('Paylines');
    expect(block(build(slot), 'pt-symbols', 'symbols')?.counts).toEqual(['14×', '12×', '10×']);
  });
});
