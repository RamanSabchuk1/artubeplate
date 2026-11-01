import { describe, it, expect } from 'vitest';
import type { BlockSpec } from '@open-slot-ui/core';
import { buildSlotRules, type SlotConfig } from '../src/rules';

const money = (x: number): string => `$${x.toFixed(2)}`;

const waysSlot = (over: Partial<SlotConfig> = {}): SlotConfig => ({
  board: { reels: 5, rows: 5 },
  symbols: [
    { id: 'H1', kind: 'high', name: 'Bone' },
    { id: 'L1', kind: 'low', name: 'Ten' },
  ],
  pays: { unit: 'totalBet', ways: 3125, table: { H1: { 3: 1, 4: 2.5, 5: 5 }, L1: { 3: 0.1, 4: 0.2, 5: 0.5 } } },
  ...over,
});

const lineSlot = (over: Partial<SlotConfig> = {}): SlotConfig => ({
  board: { reels: 5, rows: 3 },
  symbols: [{ id: 'H1', kind: 'high', name: 'Cat' }],
  pays: { unit: 'totalBet', table: { H1: { 3: 5, 4: 10, 5: 37.5 } } },
  paylines: [[1, 1, 1, 1, 1], [0, 0, 0, 0, 0]],
  ...over,
});

const build = (slot: SlotConfig): BlockSpec[] => buildSlotRules({ slot, modes: [], title: 'Test', money }).rules ?? [];
const block = <K extends BlockSpec['kind']>(rules: BlockSpec[], id: string, kind: K) =>
  rules.find((b) => b.id === id && b.kind === kind) as Extract<BlockSpec, { kind: K }> | undefined;
const glance = (rules: BlockSpec[]) => block(rules, 'glance', 'stat-grid')?.items ?? [];
const text = (rules: BlockSpec[], id: string) => block(rules, id, 'text')?.text;

describe('a ways game in the rules', () => {
  it('states the ways at a glance, grouped en-US', () => {
    const items = glance(build(waysSlot()));
    expect(items).toContainEqual({ label: 'Ways', value: '3,125' });
    expect(items.map((i) => i.label)).not.toContain('Paylines');
  });

  it('describes a ways win in the default about text', () => {
    expect(text(build(waysSlot()), 'r-about')).toBe(
      'Test is a 5×5 video slot with 3,125 ways. Wins pay left to right on adjacent reels, starting from the leftmost reel, in any position; a win pays once per way.',
    );
  });

  it("keeps the math's own about text", () => {
    expect(text(build(waysSlot({ texts: { about: '{{title}} pays 3,125 ways.' } })), 'r-about')).toBe('Test pays 3,125 ways.');
  });

  it('words the worked example as a ways win, in money', () => {
    expect(text(build(waysSlot()), 'pt-example')).toBe(
      'Example, at a bet of $1.00: 5 × Bone, one on each reel, make one way and pay 5× the bet: $5.00. Two of them on the first reel make two ways and pay 10× the bet: $10.00.',
    );
  });

  it('names the reels when the longest win is shorter than the board', () => {
    const slot = waysSlot({ board: { reels: 6, rows: 4 }, pays: { unit: 'totalBet', ways: 4096, table: { H1: { 3: 1, 4: 2.5, 5: 5 } } } });
    expect(text(build(slot), 'pt-example')).toMatch(/^Example, at a bet of \$1\.00: 5 × Bone, one on each of the first 5 reels, make one way/);
  });

  it('draws no paylines and no line example', () => {
    const rules = build(waysSlot());
    expect(rules.find((b) => b.id === 'pt-lines' || b.id === 'pt-example-grid')).toBeUndefined();
    expect(text(rules, 'pt-example')).not.toMatch(/on a line/);
  });

  it('ignores a ways count that is not a positive whole number', () => {
    const rules = build(waysSlot({ pays: { unit: 'totalBet', ways: 0, table: { H1: { 5: 5 } } } }));
    expect(glance(rules).map((i) => i.label)).not.toContain('Ways');
    expect(text(rules, 'pt-example')).toMatch(/on a line/);
  });
});

describe('a line game in the rules stays as it was', () => {
  it('states the paylines, not ways', () => {
    const items = glance(build(lineSlot()));
    expect(items).toContainEqual({ label: 'Paylines', value: '2, fixed' });
    expect(items.map((i) => i.label)).not.toContain('Ways');
  });

  it('keeps the line wording in the about text and the example', () => {
    const rules = build(lineSlot());
    expect(text(rules, 'r-about')).toBe(
      'Test is a 5×3 video slot with 2 fixed paylines. Line wins pay left to right on adjacent reels starting from the leftmost reel; only the highest win per line is paid.',
    );
    expect(text(rules, 'pt-example')).toBe('Example, at a bet of $1.00: 5 × Cat on a line pay 37.5× the bet: $37.50.');
  });

  it('reads a config with paylines as a line game even when it states ways', () => {
    const rules = build(lineSlot({ pays: { unit: 'totalBet', ways: 243, table: { H1: { 3: 5, 4: 10, 5: 37.5 } } } }));
    expect(glance(rules).map((i) => i.label)).not.toContain('Ways');
    expect(text(rules, 'pt-example')).toMatch(/on a line/);
    expect(rules.some((b) => b.id === 'pt-example-grid')).toBe(true);
  });
});
