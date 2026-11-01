import { describe, it, expect } from 'vitest';
import { bonusName, bonusRules, type SlotConfig } from '../src/rules';

const slot = (extra: Partial<SlotConfig> = {}): SlotConfig => ({
  board: { reels: 5, rows: 4 },
  symbols: [
    { id: 'W', kind: 'wild', name: 'Wild' },
    { id: 'S', kind: 'scatter', name: 'Paw Scatter' },
  ],
  wild: { symbol: 'W', multipliers: [2, 3], multipliersAdd: true },
  scatter: { symbol: 'S', freeSpins: { 3: 8, 4: 12, 5: 16 } },
  freeSpins: { retrigger: 2, sticky: true },
  ...extra,
});

describe('bonus screen copy', () => {
  it('names the bonus from the config, else "Free spins"', () => {
    expect(bonusName(slot({ bonus: { name: 'Paw Parade' } }))).toBe('Paw Parade');
    expect(bonusName(slot())).toBe('Free spins');
    expect(bonusName(null)).toBe('Free spins');
  });

  it('takes the rules from bonus.rules, then texts.freeSpins, then the config', () => {
    expect(bonusRules(slot({ bonus: { rules: ['One.', '{{title}} two.'] } }), 'Paws')).toEqual(['One.', 'Paws two.']);
    expect(bonusRules(slot({ texts: { freeSpins: 'Sticky wilds in {{title}}.' } }), 'Paws')).toEqual(['Sticky wilds in Paws.']);
    const derived = bonusRules(slot());
    expect(derived).toHaveLength(3);
    expect(derived[0]).toMatch(/Wild that lands stays in place/);
    expect(derived[1]).toMatch(/×2 or ×3, and several on one line add up/);
    expect(derived[2]).toMatch(/3 or more Paw Scatters add 2 more free spins/);
  });

  it('says something even for a bare config', () => {
    expect(bonusRules({ board: { reels: 5, rows: 3 }, symbols: [] })).toEqual(['The free spins play at the bet that won them.']);
  });
});

describe('SceneDirector swap hooks', () => {
  it('detaches the old scene and attaches the new one inside the swap', async () => {
    const { Container } = await import('pixi.js');
    const { SceneDirector } = await import('../src/scenes/director');
    const app = { stage: new Container(), ticker: { add() {}, remove() {} }, renderer: { on() {}, off() {} }, screen: { width: 800, height: 600 } };
    const director = new SceneDirector(app as never);
    const log: string[] = [];
    const scene = (id: string) => ({
      id,
      view: new Container(),
      enter: () => void log.push(`${id}.enter`),
      entered: () => void log.push(`${id}.entered`),
      leave: () => void log.push(`${id}.leave`),
      left: () => void log.push(`${id}.left`),
      attached: () => void log.push(`${id}.attached (on stage: ${director.scenes.children.length === 1})`),
      detached: () => void log.push(`${id}.detached`),
    });
    director.add(scene('a')).add(scene('b'));
    await director.go('a');
    await director.go('b');
    expect(log).toEqual(['a.enter', 'a.attached (on stage: true)', 'a.entered', 'a.leave', 'b.enter', 'a.detached', 'b.attached (on stage: true)', 'a.left', 'b.entered']);
  });
});
