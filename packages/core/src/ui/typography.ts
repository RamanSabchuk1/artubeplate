// Typography: one configuration for every piece of in-canvas text, and a small set of ROLES that
// look right out of the box — white type with a dark outline and a soft shadow, readable over any
// art. Configure the family (and colours) once at boot; every helper in `@artubeplate/core/ui`
// and `IntroScene` reads it.
//
//   configureTypography({ fontFamily: 'Montserrat' });
//   const t = label('winAmount', '€12.50');
//
// Pure (no pixi import at runtime), so it also runs in tests and tools.

import type { TextStyleOptions } from 'pixi.js';

export interface TypographyConfig {
  /** The font stack for every role. Load the web font first (`ensureFonts`). */
  fontFamily: string;
  /** Main text colour. */
  fill: number;
  /** Secondary text (card bodies, captions). */
  muted: number;
  /** Win amounts. */
  win: number;
  /** Outline colour; its width is `fontSize × role.outline`. */
  outline: number;
  /** Drop shadow for the roles that use one; `false` turns them all off. */
  shadow: { color: number; alpha: number; blur: number; distance: number } | false;
}

export const DEFAULT_FONT_STACK = 'Montserrat, "Segoe UI", Roboto, system-ui, -apple-system, sans-serif';

export const DEFAULT_TYPOGRAPHY: Readonly<TypographyConfig> = Object.freeze({
  fontFamily: DEFAULT_FONT_STACK,
  fill: 0xffffff,
  muted: 0xd5dae2,
  win: 0xffffff,
  outline: 0x07090c,
  shadow: { color: 0x000000, alpha: 0.55, blur: 10, distance: 3 },
});

let current: TypographyConfig = { ...DEFAULT_TYPOGRAPHY };

/** Change the typography for everything created afterwards. Returns the new configuration. */
export function configureTypography(patch: Partial<TypographyConfig>): Readonly<TypographyConfig> {
  current = { ...current, ...patch };
  return current;
}

export function typography(): Readonly<TypographyConfig> {
  return current;
}

export type TextRole =
  | 'display' // the game's name / logo stand-in
  | 'title' // a screen title
  | 'heading' // a card title
  | 'body' // card text
  | 'caption' // small uppercase labels
  | 'prompt' // "CLICK TO CONTINUE"
  | 'badge' // a big number on a card ("5,000×")
  | 'plaque' // a name plate ("FREE SPINS")
  | 'lineWin' // the amount floating over a winning line
  | 'winLabel' // the caption of a win box ("WIN", "TOTAL WIN")
  | 'winAmount' // the amount in a win box
  | 'bigWin' // "BIG WIN" / "FREE SPINS" announcements
  | 'bigWinAmount' // the amount under an announcement
  | 'counter'; // a spins-left / multiplier counter

interface RoleSpec {
  size: number;
  weight: TextStyleOptions['fontWeight'];
  color?: 'fill' | 'muted' | 'win';
  letterSpacing?: number;
  /** Outline width as a fraction of the font size. */
  outline: number;
  shadow?: boolean;
  /** Content is shown in capitals (`label()` applies it). */
  upper?: boolean;
  lineHeight?: number;
}

export const TEXT_ROLES: Readonly<Record<TextRole, RoleSpec>> = Object.freeze({
  display: { size: 84, weight: '900', letterSpacing: 4, outline: 0.14, shadow: true, upper: true },
  title: { size: 56, weight: '900', letterSpacing: 2, outline: 0.13, shadow: true, upper: true },
  heading: { size: 34, weight: '800', letterSpacing: 1.5, outline: 0.13, upper: true },
  body: { size: 24, weight: '600', color: 'muted', outline: 0.11, lineHeight: 1.38 },
  caption: { size: 18, weight: '700', color: 'muted', letterSpacing: 2, outline: 0.11, upper: true },
  prompt: { size: 40, weight: '800', letterSpacing: 3, outline: 0.14, shadow: true, upper: true },
  badge: { size: 96, weight: '900', outline: 0.12, shadow: true },
  plaque: { size: 30, weight: '900', letterSpacing: 3, outline: 0.1, upper: true },
  lineWin: { size: 36, weight: '800', color: 'win', letterSpacing: 1, outline: 0.14, shadow: true },
  winLabel: { size: 20, weight: '800', color: 'muted', letterSpacing: 3, outline: 0.12, upper: true },
  winAmount: { size: 66, weight: '800', color: 'win', letterSpacing: 1.5, outline: 0.1, shadow: true },
  bigWin: { size: 112, weight: '900', letterSpacing: 4, outline: 0.1, shadow: true, upper: true },
  bigWinAmount: { size: 76, weight: '800', color: 'win', letterSpacing: 1.5, outline: 0.1, shadow: true },
  counter: { size: 40, weight: '900', outline: 0.15, shadow: true },
});

/** The pixi text style for a role (sizes in design units; scale the Text, not the style). */
export function textStyle(role: TextRole, overrides: Partial<TextStyleOptions> = {}): TextStyleOptions {
  const r = TEXT_ROLES[role];
  const t = current;
  const size = typeof overrides.fontSize === 'number' ? overrides.fontSize : r.size;
  const strokeWidth = Math.max(2, Math.round(size * r.outline));
  const shadow = r.shadow && t.shadow ? t.shadow : null;
  const style: TextStyleOptions = {
    fontFamily: t.fontFamily,
    fontSize: size,
    fontWeight: r.weight,
    fill: r.color === 'muted' ? t.muted : r.color === 'win' ? t.win : t.fill,
    letterSpacing: r.letterSpacing ?? 0,
    stroke: { color: t.outline, width: strokeWidth, join: 'round' },
    // Room on the canvas for the outline and the shadow's blur: pixi sizes the canvas to the
    // glyphs, and a blur past its sides is cut flat.
    padding: Math.ceil(strokeWidth / 2 + (shadow ? shadow.blur + shadow.distance : 0)) + 1,
    align: 'center',
    ...(r.lineHeight ? { lineHeight: Math.round(size * r.lineHeight) } : {}),
    ...(shadow ? { dropShadow: { color: shadow.color, alpha: shadow.alpha, blur: shadow.blur, distance: shadow.distance, angle: Math.PI / 2 } } : {}),
  };
  return { ...style, ...overrides };
}

/** Whether a role shows its content in capitals. */
export function isUpper(role: TextRole): boolean {
  return !!TEXT_ROLES[role].upper;
}
