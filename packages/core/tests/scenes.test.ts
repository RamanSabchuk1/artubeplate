import { describe, it, expect } from 'vitest';
import { fitDesign } from '../src/scenes/fit';
import { buildIntroSlides, type SlotConfig } from '../src/rules';
import type { GameModeInfo } from '../src/rgs/protocol';

describe('fitDesign', () => {
  it('contains a 1920×1080 frame in a 1280×800 screen, centred', () => {
    const f = fitDesign(1280, 800, { width: 1920, height: 1080 });
    expect(f.scale).toBeCloseTo(1280 / 1920, 6);
    expect(f.x).toBe(0);
    expect(f.y).toBeCloseTo((800 - 1080 * f.scale) / 2, 6);
    expect(f.toScreen(960, 540)).toEqual({ x: 640, y: 400 });
  });
  it('covers when asked', () => {
    const f = fitDesign(1000, 1000, { width: 1920, height: 1080 }, 'cover');
    expect(f.scale).toBeCloseTo(1000 / 1080, 6);
    expect(f.x).toBeLessThan(0);
  });
});

describe('buildIntroSlides', () => {
  const slot: SlotConfig = {
    board: { reels: 5, rows: 4 },
    symbols: [
      { id: 'W', name: 'Wild', kind: 'wild' },
      { id: 'S', name: 'Paw Scatter', kind: 'scatter' },
      { id: 'A', name: 'Ace', kind: 'low' },
    ],
    wild: { symbol: 'W', reels: [1, 2, 3, 4], multipliers: [2, 3], multipliersAdd: true },
    scatter: { symbol: 'S', freeSpins: { '3': 8, '4': 12, '5': 16 } },
    freeSpins: { retrigger: 2, sticky: true },
    maxWin: 5000,
  };
  const modes: GameModeInfo[] = [
    { id: 'base', rtp: 96.2, priceMultiplier: 1, type: 'None' },
    { id: 'buyfs', rtp: 96.2, priceMultiplier: 100, type: 'BuyFeature' },
    { id: 'luckybet', rtp: 96.2, priceMultiplier: 1.25, type: 'LuckyBet' },
  ];

  it('derives the wild, free spins and max-win cards from the config and the modes', () => {
    const cards = buildIntroSlides({ slot, modes, title: 'Paws', names: { buyfs: 'Free Spins', luckybet: 'Lucky Bet' } });
    expect(cards.map((c) => c.title)).toEqual(['Wild multipliers', 'Free spins', 'Win up to 5,000×']);
    expect(cards[0]!.text).toContain('reels 2, 3, 4 and 5');
    expect(cards[0]!.text).toContain('×2 or ×3');
    expect(cards[1]!.text).toContain('3, 4 or 5 Paw Scatters award 8, 12 or 16 free spins');
    expect(cards[1]!.text).toContain('Wilds stick');
    expect(cards[2]!.text).toContain('Buy Free Spins for 100× the bet');
    expect(cards[2]!.text).toContain('Lucky Bet plays every round at 1.25× the bet');
    expect(cards[2]!.badge).toBe('5,000×');
    expect(cards[0]!.image).toMatch(/^data:image\/svg\+xml/);
  });

  it('uses the math’s own slides when it has them (a symbol id becomes its tile)', () => {
    const cards = buildIntroSlides({ slot: { ...slot, intro: { slides: [{ title: 'Big {{title}}', text: 'Hi', symbol: 'W' }, { title: 'B', text: 'x', badge: '10×' }] } }, modes, title: 'Paws' });
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ title: 'Big Paws', text: 'Hi' });
    expect(cards[0]!.image).toMatch(/^data:image\/svg\+xml/);
    expect(cards[1]).toEqual({ title: 'B', text: 'x', badge: '10×' });
  });

  it('gives nothing to show for a bare config', () => {
    expect(buildIntroSlides({ slot: { board: { reels: 5, rows: 3 }, symbols: [] }, modes: [modes[0]!], title: 'x' })).toEqual([]);
  });
});

describe('typography', () => {
  it('gives every role white, outlined type in the configured family', async () => {
    const { textStyle, configureTypography, DEFAULT_TYPOGRAPHY, TEXT_ROLES } = await import('../src/ui/typography');
    for (const role of Object.keys(TEXT_ROLES) as Array<keyof typeof TEXT_ROLES>) {
      const s = textStyle(role);
      expect(s.fontFamily).toBe(DEFAULT_TYPOGRAPHY.fontFamily);
      expect((s.stroke as { width: number }).width).toBeGreaterThanOrEqual(2);
      expect([DEFAULT_TYPOGRAPHY.fill, DEFAULT_TYPOGRAPHY.muted, DEFAULT_TYPOGRAPHY.win]).toContain(s.fill);
    }
    configureTypography({ fontFamily: 'Rubik', win: 0x7cf2b5 });
    expect(textStyle('winAmount').fontFamily).toBe('Rubik');
    expect(textStyle('winAmount').fill).toBe(0x7cf2b5);
    expect(textStyle('lineWin', { fontSize: 50 }).fontSize).toBe(50);
    // The outline scales with the size asked for (the role's fraction of it).
    expect((textStyle('lineWin', { fontSize: 50 }).stroke as { width: number }).width).toBe(Math.round(50 * TEXT_ROLES.lineWin.outline));
    configureTypography({ ...DEFAULT_TYPOGRAPHY });
  });
});
