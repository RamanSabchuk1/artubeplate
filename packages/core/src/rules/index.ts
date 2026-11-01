// @artubeplate/core/rules — the slot CLIENT CONTRACT (`settings.config` in the manifest, schema
// `artubeplate/slot@1`) and a rules builder that turns it into the INFO window, in the order a
// player (and a TRC reviewer) reads for: the game at a glance (RTP, max win, lines or ways), how to play,
// the paytable with a worked example in money, the specials, the paylines with a winning example,
// the game's features, one section per mode (with its price), the RTP/max-win grid per mode, the
// controls and the legal text — the same data the math pays with, so the rules cannot drift from
// the math, and the open-slot-ui rules audit passes out of the box.

import type { BlockSpec, MenuSpec } from '@open-slot-ui/core';
import type { GameModeInfo } from '../rgs/protocol';

export type SymbolKind = 'high' | 'mid' | 'low' | 'wild' | 'scatter' | 'special';

export interface SlotSymbol {
  id: string;
  name?: string;
  kind?: SymbolKind;
  /** Placeholder glyph (emoji / letters) for the generated tile. */
  label?: string;
  /** Tile colour (`#rrggbb`). */
  color?: string;
  /** Real art (URL) — used by the paytable and, in the template, by the reels. */
  image?: string;
}

/** `settings.config` for a slot built on artubeplate. Every field but `board`+`symbols` is optional. */
export interface SlotConfig {
  schema?: string;
  title?: string;
  board: { reels: number; rows: number };
  symbols: SlotSymbol[];
  pays?: {
    /** What a paytable number multiplies: a LINE bet (total ÷ lines) or the TOTAL bet. */
    unit?: 'lineBet' | 'totalBet';
    lines?: number;
    /** A ways game (no `paylines`): the number of ways, e.g. 243 or 3125. A paytable number is
     *  the pay of one way; the rules state the ways and word the worked example as a ways win. */
    ways?: number;
    /** A game where symbols pay ANYWHERE on the board (no `paylines`, no `ways`): the count tiers,
     *  lowest first, as [from, to] (`to` at or past the board's cells means "or more"). The
     *  paytable's keys are the tiers' `from` counts; the rules head its columns "10-11", "12-13",
     *  "14+", say so in the about text and word the example as a count anywhere. */
    anywhere?: { tiers: Array<[number, number]> };
    /** A cluster game (no `paylines`, no `ways`): symbols pay in groups of TOUCHING cells
     *  (horizontally or vertically), anywhere on the board, in any shape; the tiers as for
     *  `anywhere`. The rules head the columns the same way and word the game as clusters. */
    cluster?: { tiers: Array<[number, number]> };
    /** symbol id → count → pay. */
    table: Record<string, Record<string, number>>;
  };
  /** `[line][reel] = row` (0-based). */
  paylines?: number[][];
  wild?: { symbol: string; reels?: number[]; multipliers?: number[]; multipliersAdd?: boolean };
  scatter?: { symbol: string; pays?: Record<string, number>; freeSpins?: Record<string, number> };
  freeSpins?: { retrigger?: number; sticky?: boolean };
  /** Round cap, × total bet. */
  maxWin?: number;
  /** Per-mode card copy (name, description, image). */
  modes?: Record<string, { name?: string; description?: string; image?: string }>;
  /** Free-form copy keyed by topic: about, wild, scatter, freeSpins, respin, … (`{{title}}` interpolates). */
  texts?: Record<string, string>;
  /** The bonus screens: the rules before free spins play, the total after. */
  bonus?: {
    /** The bonus's name, big on its rules screen. Default "Free spins". */
    name?: string;
    /** What the bonus does, a paragraph each. Default: `texts.freeSpins`, else derived from the config. */
    rules?: string[];
  };
  /** The intro screen. Without `slides`, cards are derived from the wild, the free spins and the modes. */
  intro?: {
    /** `false` = no intro screen. */
    show?: boolean;
    subtitle?: string;
    slides?: Array<{ title: string; text: string; image?: string; symbol?: string; badge?: string }>;
  };
}

export interface SlotConfigResult {
  config: SlotConfig | null;
  issues: string[];
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validate a raw `gameSettings.config` against the slot schema. Never throws. */
export function parseSlotConfig(raw: unknown): SlotConfigResult {
  const issues: string[] = [];
  if (!isRec(raw)) return { config: null, issues: ['settings.config is missing or not an object'] };
  const board = raw.board;
  if (!isRec(board) || !Number.isInteger(board.reels) || !Number.isInteger(board.rows) || (board.reels as number) < 1 || (board.rows as number) < 1)
    issues.push('config.board must be { reels, rows } positive integers');
  if (!Array.isArray(raw.symbols) || !raw.symbols.length) issues.push('config.symbols must list the symbols (id + name)');
  else if (!(raw.symbols as unknown[]).every((s) => isRec(s) && typeof s.id === 'string')) issues.push('every config.symbols entry needs a string id');
  if (raw.paylines !== undefined && !(Array.isArray(raw.paylines) && raw.paylines.every((l) => Array.isArray(l))))
    issues.push('config.paylines must be an array of [row per reel] arrays');
  if (issues.length) return { config: null, issues };
  return { config: raw as unknown as SlotConfig, issues };
}

/** Default tile colours by kind (used when a symbol has none). */
export const KIND_COLORS: Record<SymbolKind, string> = {
  high: '#b23a48',
  mid: '#2b6cb0',
  low: '#3a404c',
  wild: '#f2f4f7',
  scatter: '#161b26',
  special: '#7b4bd6',
};

/** A self-contained placeholder tile (SVG data URI) for a symbol: colour + glyph. */
export function symbolTile(sym: SlotSymbol, size = 160): string {
  if (sym.image) return sym.image;
  const bg = sym.color ?? KIND_COLORS[sym.kind ?? 'low'];
  const dark = luminance(bg) > 0.6;
  const label = (sym.label ?? sym.id).slice(0, 6);
  const fs = label.length > 3 ? 34 : label.length > 1 ? 52 : 72;
  const esc = label.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);
  return `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 160 160"><rect x="4" y="4" width="152" height="152" rx="22" fill="${bg}"/><rect x="4" y="4" width="152" height="152" rx="22" fill="none" stroke="rgba(0,0,0,.25)" stroke-width="4"/><text x="80" y="${80 + fs * 0.35}" font-family="Montserrat,system-ui,sans-serif" font-size="${fs}" font-weight="900" text-anchor="middle" fill="${dark ? '#12151b' : '#ffffff'}" stroke="${dark ? 'none' : 'rgba(0,0,0,0.45)'}" stroke-width="6" paint-order="stroke">${esc}</text></svg>`,
  )}`;
}

function luminance(hex: string): number {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (!m) return 0.3;
  const n = parseInt(m[1]!, 16);
  return (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
}

/** The standard platform disclaimer (a `legal` block). Replace with the operator's if required. */
export const ARTUBE_DISCLAIMER =
  'Malfunction voids all pays and plays. The expected return to player (RTP) is the theoretical long-term average over a very large number of rounds. ' +
  'Every round outcome is determined by the game server when the round is played; the animations only show that result. ' +
  'If the connection drops during a round, the round is completed on the server and its result is shown when you return.';

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1).replace(/[_-]+/g, ' ');
const times = (x: number): string => `${(+x.toFixed(2)).toLocaleString('en-US')}×`;

/** One intro card (the shape `IntroScene` in `@artubeplate/core/scenes` takes). */
export interface IntroSlideSpec {
  title: string;
  text: string;
  image?: string;
  badge?: string;
}

/** "Paw Scatter" → "Paw Scatters" (a name that already ends in s is left alone). */
const plural = (name: string): string => (/s$/i.test(name) ? name : `${name}s`);

const listOf = (xs: string[]): string => (xs.length < 2 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`);

/**
 * The intro cards for a slot: `config.intro.slides` when the math provides them (a `symbol` id
 * becomes that symbol's tile), else up to three derived from the config and the session's modes:
 * the wild, the free spins, and the max win with the buy/boost prices.
 */
export function buildIntroSlides({ slot, modes, names, title }: { slot: SlotConfig | null; modes: GameModeInfo[]; names?: Record<string, string>; title: string }): IntroSlideSpec[] {
  const sym = new Map((slot?.symbols ?? []).map((s) => [s.id, s]));
  const custom = slot?.intro?.slides;
  if (custom?.length) {
    return custom.slice(0, 3).map((s) => {
      const tile = s.symbol ? sym.get(s.symbol) : undefined;
      const image = s.image ?? (tile ? symbolTile(tile, 320) : undefined);
      return { title: s.title.replaceAll('{{title}}', title), text: s.text.replaceAll('{{title}}', title), ...(image ? { image } : {}), ...(s.badge ? { badge: s.badge } : {}) };
    });
  }
  const nameOf = (id: string): string => names?.[id] ?? slot?.modes?.[id]?.name ?? cap(id);
  const slides: IntroSlideSpec[] = [];
  const wild = slot?.wild ? sym.get(slot.wild.symbol) : undefined;
  if (slot?.wild && wild) {
    const mults = slot.wild.multipliers ?? [];
    const reels = slot.wild.reels?.length && slot.wild.reels.length < slot.board.reels ? ` on reels ${listOf(slot.wild.reels.map((r) => String(r + 1))).replace(' or ', ' and ')}` : '';
    slides.push({
      title: mults.length ? `${wild.name ?? 'Wild'} multipliers` : (wild.name ?? 'Wild'),
      text: `${wild.name ?? 'The Wild'} lands${reels} and stands in for every paying symbol.${mults.length ? ` Each one carries ${listOf(mults.map((m) => `×${m}`))}${slot.wild.multipliersAdd ? ', and they add up on a line' : ''}.` : ''}`,
      image: symbolTile(wild, 320),
    });
  }
  const scatter = slot?.scatter ? sym.get(slot.scatter.symbol) : undefined;
  const awards = Object.entries(slot?.scatter?.freeSpins ?? {});
  if (scatter && awards.length) {
    const counts = awards.map(([c]) => c);
    const spins = awards.map(([, n]) => String(n));
    slides.push({
      title: 'Free spins',
      text: `${listOf(counts)} ${plural(scatter.name ?? 'Scatter')} award ${listOf(spins)} free spins.${slot?.freeSpins?.sticky ? ' Wilds stick until the feature ends.' : ''}${slot?.freeSpins?.retrigger ? ` Retriggers add ${slot.freeSpins.retrigger} more.` : ''}`,
      image: symbolTile(scatter, 320),
    });
  }
  const buy = modes.find((m) => m.type === 'BuyFeature');
  const boost = modes.find((m) => m.type === 'LuckyBet');
  if (slot?.maxWin || buy || boost) {
    const parts = [
      buy ? `Buy ${nameOf(buy.id)} for ${times(buy.priceMultiplier)} the bet.` : '',
      boost ? `${nameOf(boost.id)} plays every round at ${times(boost.priceMultiplier)} the bet${slot?.modes?.[boost.id]?.description ? '' : ' for better feature odds'}.` : '',
    ].filter(Boolean);
    slides.push({
      title: slot?.maxWin ? `Win up to ${slot.maxWin.toLocaleString('en-US')}×` : 'Features',
      text: parts.join(' ') || `Wins up to ${(slot?.maxWin ?? 0).toLocaleString('en-US')}× the bet in a single round.`,
      badge: slot?.maxWin ? `${slot.maxWin.toLocaleString('en-US')}×` : '★',
    });
  }
  return slides.slice(0, 3);
}

/** The bonus's name for its rules screen (`bonus.name`, default "Free spins"). */
export function bonusName(slot: SlotConfig | null): string {
  return slot?.bonus?.name ?? 'Free spins';
}

/**
 * What the bonus does, a paragraph each, for its rules screen: `bonus.rules`, else the
 * `texts.freeSpins` copy, else lines derived from sticky wilds, wild multipliers and retriggers.
 */
export function bonusRules(slot: SlotConfig | null, title = ''): string[] {
  if (slot?.bonus?.rules?.length) return slot.bonus.rules.map((r) => r.replaceAll('{{title}}', title));
  const text = slot?.texts?.freeSpins;
  if (text) return [text.replaceAll('{{title}}', title)];
  const sym = new Map((slot?.symbols ?? []).map((s) => [s.id, s]));
  const wild = slot?.wild ? sym.get(slot.wild.symbol) : undefined;
  const scatter = slot?.scatter ? sym.get(slot.scatter.symbol) : undefined;
  const lines: string[] = [];
  if (slot?.freeSpins?.sticky) lines.push(`Every ${wild?.name ?? 'Wild'} that lands stays in place until the last free spin.`);
  const mults = slot?.wild?.multipliers ?? [];
  if (mults.length) lines.push(`${wild?.name ?? 'Wilds'} carry ${listOf(mults.map((m) => `×${m}`))}${slot?.wild?.multipliersAdd ? ', and several on one line add up' : ''}.`);
  const least = Math.min(...Object.keys(slot?.scatter?.freeSpins ?? {}).map(Number).filter(Number.isFinite));
  if (slot?.freeSpins?.retrigger) lines.push(`${Number.isFinite(least) ? `${least} or more` : 'More'} ${plural(scatter?.name ?? 'Scatter')} add ${slot.freeSpins.retrigger} more free spins.`);
  return lines.length ? lines : ['The free spins play at the bet that won them.'];
}

export interface BuildRulesInput {
  slot: SlotConfig | null;
  /** The session's modes (RTP, price, type) — the platform's truth. */
  modes: GameModeInfo[];
  /** Display names per mode id (default: slot.modes[id].name, then the capitalized id). */
  names?: Record<string, string>;
  title: string;
  /** The game's own feature sections (its mechanic: a hold & win, a bonus wheel…), shown right
   *  after how to play, where a player looks for the mechanic. */
  featureRules?: BlockSpec[];
  /** Extra blocks appended after the controls (a studio's own closing sections). */
  extraRules?: BlockSpec[];
  /** `x` times the default bet in the session's currency (`RulesKit.money`): with it the
   *  paytable gets a worked example in money, as TRC reviewers look for. */
  money?: (x: number) => string;
}

/** Build the INFO window as an open-slot-ui MenuSpec: one rules document, paytable included. */
export function buildSlotRules({ slot, modes, names, title, featureRules, extraRules, money }: BuildRulesInput): MenuSpec {
  const nameOf = (id: string): string => names?.[id] ?? slot?.modes?.[id]?.name ?? cap(id);
  const t = (key: string, fallback = ''): string => (slot?.texts?.[key] ?? fallback).replaceAll('{{title}}', title);
  const rules: BlockSpec[] = [];
  // One document, in this order: the library would title a separate paytable array "Paytable"
  // and its audit reads only the rules, so the paytable blocks go into the rules too.
  const paytable = rules;
  const base = modes.find((m) => m.type === 'None') ?? modes[0];
  // A ways game: `pays.ways` with no paylines (a game with paylines reads as a line game).
  const declared = slot?.paylines?.length ? undefined : slot?.pays?.ways;
  const ways = typeof declared === 'number' && Number.isInteger(declared) && declared > 0 ? declared : 0;
  // A pay-anywhere game: `pays.anywhere.tiers` with no paylines and no ways; a cluster game the
  // same with `pays.cluster.tiers` (the symbols must touch).
  const tierSource = slot?.pays?.anywhere?.tiers ?? slot?.pays?.cluster?.tiers ?? [];
  const tiers = !slot?.paylines?.length && !ways ? tierSource.filter((x) => Array.isArray(x) && x.length === 2) : [];
  const anywhere = tiers.length > 0;
  const cluster = anywhere && !slot?.pays?.anywhere?.tiers?.length;
  const cells = slot ? slot.board.reels * slot.board.rows : 0;
  /** "10-11", "14+": the tier a paytable count (its `from`) names. */
  const tierLabel = (count: number): string => {
    const tier = tiers.find(([from]) => from === count);
    if (!tier) return `${count}+`;
    const [from, to] = tier;
    // "5" for a tier of one size, "8-9" for a range, "20+" for one that reaches the board's end.
    return to === from ? `${from}` : to >= cells || to < from ? `${from}+` : `${from}-${to}`;
  };

  // ── at a glance: the numbers a player (and a reviewer) looks for first ─────────
  const glance: Array<{ label: string; value: string }> = [];
  if (base) glance.push({ label: 'RTP', value: `${(base.rtp <= 1 ? base.rtp * 100 : base.rtp).toFixed(2)}%` });
  if (slot?.maxWin) glance.push({ label: 'Max win', value: `${slot.maxWin.toLocaleString('en-US')}× the bet` });
  if (base?.volatility) glance.push({ label: 'Volatility', value: cap(base.volatility) });
  if (slot) glance.push({ label: 'Board', value: `${slot.board.reels} reels × ${slot.board.rows} rows` });
  if (slot?.paylines?.length) glance.push({ label: 'Paylines', value: `${slot.paylines.length}, fixed` });
  if (ways) glance.push({ label: 'Ways', value: ways.toLocaleString('en-US') });
  if (anywhere) glance.push({ label: 'Pays', value: cluster ? `In clusters, ${tiers[0]![0]}+ touching` : `Anywhere, ${tiers[0]![0]}+ of a kind` });
  if (glance.length) paytable.push({ kind: 'stat-grid', id: 'glance', items: glance });

  // ── how to play ────────────────────────────────────────────────────────────────
  paytable.push({ kind: 'heading', id: 'r-about-h', text: 'How to play' });
  const board = slot ? `${slot.board.reels}×${slot.board.rows} ` : '';
  paytable.push({
    kind: 'text',
    id: 'r-about',
    ...(base ? { explains: base.id } : {}),
    text:
      t('about') ||
      (cluster
        ? `${title} is a ${board}video slot where symbols pay in clusters: ${tiers[0]![0]} or more of one symbol touching horizontally or vertically pay, anywhere on the board and in any shape; the more of them, the more they pay.`
        : anywhere
        ? `${title} is a ${board}video slot where symbols pay anywhere on the board: ${tiers[0]![0]} or more of one symbol pay, wherever they land; the more of them, the more they pay.`
        : ways
          ? `${title} is a ${board}video slot with ${ways.toLocaleString('en-US')} ways. Wins pay left to right on adjacent reels, starting from the leftmost reel, in any position; a win pays once per way.`
          : `${title} is a ${board}video slot${slot?.paylines?.length ? ` with ${slot.paylines.length} fixed paylines` : ''}. Line wins pay left to right on adjacent reels starting from the leftmost reel; only the highest win per line is paid.`),
  });
  paytable.push({
    kind: 'steps',
    id: 'r-how',
    ordered: true,
    items: ['Choose your bet with the bet buttons: ▲ / ▼ next to the bet on a computer, − / + beside the round button on a phone.', 'Press the round button (or the spacebar on a computer) to play a round.', 'Winning combinations are highlighted and paid automatically.'],
  });

  if (slot) {
    const sym = new Map(slot.symbols.map((s) => [s.id, s]));
    const lines = slot.pays?.lines ?? slot.paylines?.length ?? 1;
    const perTotal = (pay: number): number => (slot.pays?.unit === 'lineBet' ? pay / lines : pay);
    const table = slot.pays?.table ?? {};
    const counts = [...new Set(Object.values(table).flatMap((byCount) => Object.keys(byCount)))].sort((a, b) => Number(b) - Number(a));
    const paying = slot.symbols.filter((s) => table[s.id] && Object.keys(table[s.id]!).length);
    if (paying.length) {
      paytable.push({ kind: 'heading', id: 'pt-h', text: 'Paytable' });
      paytable.push({
        kind: 'text',
        id: 'pt-note',
        text: `Wins are shown as multiples of the TOTAL bet${slot.pays?.unit === 'lineBet' ? ` (the paytable pays per line; a line bet is 1/${lines} of the total bet)` : ''}.`,
      });
      paytable.push({
        kind: 'symbols',
        id: 'pt-symbols',
        counts: counts.map((c) => (anywhere ? tierLabel(Number(c)) : `${c}×`)),
        rows: paying.map((s) => ({
          icon: symbolTile(s),
          name: s.name ?? s.id,
          pays: counts.map((c) => {
            const p = table[s.id]?.[c];
            return p === undefined ? '—' : times(perTotal(p));
          }),
        })),
      });
      // A worked example in money: the best symbol's longest win, at the default bet. In a ways
      // game the win is one symbol per reel (one way), and a second one on the first reel doubles it.
      const best = paying
        .flatMap((s) => Object.entries(table[s.id] ?? {}).map(([c, p]) => ({ s, c: Number(c), x: perTotal(p) })))
        .sort((a, b) => b.c - a.c || b.x - a.x)[0];
      if (money && best) {
        const name = best.s.name ?? best.s.id;
        paytable.push({
          kind: 'text',
          id: 'pt-example',
          text: anywhere
            ? `Example, at a bet of ${money(1)}: ${tierLabel(best.c).replace(/\+$/, ' or more')} ${name}${cluster ? ' touching horizontally or vertically' : ' anywhere on the board'} pay ${times(best.x)} the bet: ${money(best.x)}.`
            : ways
              ? `Example, at a bet of ${money(1)}: ${best.c} × ${name}, ${best.c >= slot.board.reels ? 'one on each reel' : `one on each of the first ${best.c} reels`}, make one way and pay ${times(best.x)} the bet: ${money(best.x)}.` +
                (slot.board.rows > 1 ? ` Two of them on the first reel make two ways and pay ${times(best.x * 2)} the bet: ${money(best.x * 2)}.` : '')
              : `Example, at a bet of ${money(1)}: ${best.c} × ${name} on a line pay ${times(best.x)} the bet: ${money(best.x)}.`,
        });
      }
    }
    if (slot.wild && sym.get(slot.wild.symbol)) {
      const w = sym.get(slot.wild.symbol)!;
      paytable.push({ kind: 'heading', id: 'pt-wild-h', text: w.name ?? 'Wild' });
      paytable.push({
        kind: 'media',
        id: 'pt-wild',
        src: symbolTile(w),
        width: 96,
        height: 96,
        side: 'left',
        text:
          t('wild') ||
          `The ${w.name ?? 'Wild'} substitutes for every paying symbol${slot.scatter ? ` except the ${sym.get(slot.scatter.symbol)?.name ?? 'Scatter'}` : ''}.${slot.wild.multipliers?.length ? ` It carries a ${slot.wild.multipliers.map((m) => `${m}×`).join(' or ')} multiplier${slot.wild.multipliersAdd ? '; several on one line add up' : ''}.` : ''}`,
      });
    }
    if (slot.scatter && sym.get(slot.scatter.symbol)) {
      const s = sym.get(slot.scatter.symbol)!;
      const fs = Object.entries(slot.scatter.freeSpins ?? {});
      paytable.push({ kind: 'heading', id: 'pt-scatter-h', text: s.name ?? 'Scatter' });
      paytable.push({
        kind: 'media',
        id: 'pt-scatter',
        src: symbolTile(s),
        width: 96,
        height: 96,
        side: 'left',
        text:
          t('scatter') ||
          `${Object.keys(slot.scatter.pays ?? {}).join(', ') || '3'} ${s.name ?? 'Scatters'} anywhere pay${fs.length ? ` and award ${fs.map(([c, n]) => `${n} free spins for ${c}`).join(', ')}` : ''}.`,
      });
    }
    if (slot.paylines?.length) {
      paytable.push({ kind: 'heading', id: 'pt-lines-h', text: `Paylines (${slot.paylines.length})` });
      paytable.push({ kind: 'text', id: 'pt-lines-note', text: `A line pays when the same symbol lands on it on ${Math.min(3, slot.board.reels)} or more adjacent reels from the left. Every line is played on every round.` });
      paytable.push({ kind: 'paylines', id: 'pt-lines', reels: slot.board.reels, rows: slot.board.rows, lines: slot.paylines });
      // A winning example a reviewer looks for: the best symbol along the first line.
      const best = paying
        .flatMap((s) => Object.entries(table[s.id] ?? {}).map(([c, p]) => ({ s, c: Number(c), x: perTotal(p) })))
        .sort((a, b) => b.c - a.c || b.x - a.x)[0];
      const line = slot.paylines[0];
      if (best && line) {
        const short = (best.s.label ?? best.s.name ?? best.s.id).replace(/[^\p{L}\p{N}]/gu, '').slice(0, 3).toUpperCase() || best.s.id.slice(0, 3).toUpperCase();
        paytable.push({
          kind: 'grid',
          id: 'pt-example-grid',
          reels: slot.board.reels,
          rows: slot.board.rows,
          cells: line.slice(0, best.c).map((row, reel) => [reel, row] as [number, number]),
          // The symbol's art in every lit cell (the paytable's icon); the short name is its alt text.
          icon: symbolTile(best.s),
          symbol: short,
          label: `Example: ${best.c} × ${best.s.name ?? best.s.id} on line 1 pays ${times(best.x)} the bet${money ? ` — ${money(best.x)} at a bet of ${money(1)}` : ''}.`,
        });
      }
    }
  }

  // ── rules: the game's features first, where a player looks for the mechanic ───────
  if (featureRules?.length) rules.push(...featureRules);
  if (slot?.texts?.respin) {
    rules.push({ kind: 'heading', id: 'r-respin-h', text: 'Respin' });
    rules.push({ kind: 'text', id: 'r-respin', text: t('respin') });
  }
  if (slot?.scatter?.freeSpins && Object.keys(slot.scatter.freeSpins).length) {
    rules.push({ kind: 'heading', id: 'r-fs-h', text: 'Free Spins' });
    const awards = Object.entries(slot.scatter.freeSpins).map(([c, n]) => `${c} scatters award ${n} free spins`);
    rules.push({
      kind: 'text',
      id: 'r-fs',
      covers: ['freespins', 'freespins:count'],
      text: `${t('freeSpins') || ''} ${awards.join('; ')}. Free spins ${slot.freeSpins?.retrigger ? `can be retriggered (+${slot.freeSpins.retrigger} spins each time)` : 'cannot be retriggered'}.`.trim(),
    });
  }

  // Prices are `{{price.<id>}}`: the HUD fills them from the live facts, so the copy can never
  // state a price other than the one a round is charged at.
  // ── one section per extra mode (buy features, lucky bets), each stating its price, after the
  //    feature descriptions (the mechanic a player reads for first) ──
  for (const m of modes) {
    if (m.id === base?.id) continue;
    const name = nameOf(m.id);
    const desc = slot?.modes?.[m.id]?.description;
    // A buy mode named "Buy …" already (the game's own name) is not "Buy Buy …".
    rules.push({ kind: 'heading', id: `r-mode-${m.id}-h`, text: m.type === 'BuyFeature' && !/^buy\b/i.test(name) ? `Buy ${name}` : name });
    rules.push({
      kind: 'text',
      id: `r-mode-${m.id}`,
      explains: m.id,
      covers: [`cost:${m.id}`],
      text:
        m.type === 'BuyFeature'
          ? `${desc ? `${desc} ` : ''}${name} is bought directly for {{price.${m.id}}} the bet (a confirmation is always asked first). It is not available during free rounds.`
          : `${desc ? `${desc} ` : ''}${name} raises the price of every round to {{price.${m.id}}} the bet while it is active. Switch it on and off from the buy menu.`,
    });
  }

  // ── the numbers, one block per mode (RTP, max win, volatility, price) ───────────
  const pct = (rtp: number): string => `${(rtp <= 1 ? rtp * 100 : rtp).toFixed(2)}%`;
  rules.push({ kind: 'heading', id: 'r-stats-h', text: 'RTP & max win' });
  rules.push({
    kind: 'text',
    id: 'r-stats-note',
    text: `Each game mode has its own theoretical return to player (RTP), the long-term average over a very large number of rounds.${slot?.maxWin ? ` The maximum win is ${times(slot.maxWin)} the bet in a single round; a round ends as soon as it is reached.` : ''} Operators may also cap the amount paid out in a single round.`,
  });
  for (const m of modes) {
    const isBase = m.id === base?.id;
    rules.push({ kind: 'subheading', id: `r-stats-${m.id}-h`, text: isBase ? 'Base game' : nameOf(m.id) });
    rules.push({
      kind: 'stat-grid',
      id: `r-stats-${m.id}`,
      covers: [`rtp:${m.id}`, `maxwin:${m.id}`],
      items: [
        { label: 'RTP', value: pct(m.rtp) },
        ...(slot?.maxWin ? [{ label: 'Max win', value: `${slot.maxWin.toLocaleString('en-US')}× the bet` }] : []),
        ...(m.volatility ? [{ label: 'Volatility', value: cap(m.volatility) }] : []),
        { label: m.type === 'BuyFeature' ? 'Price' : 'Cost of a round', value: `${times(m.priceMultiplier)} the bet` },
      ],
    });
  }

  // ── the controls as this HUD has them ──────────────────────────────────────────
  const buys = modes.filter((m) => m.type === 'BuyFeature');
  const boosts = modes.filter((m) => m.type === 'LuckyBet');
  const buyMenu = [...buys.map((b) => `${nameOf(b.id)} is bought for ${times(b.priceMultiplier)} the bet`), ...boosts.map((b) => `${nameOf(b.id)} is switched on and plays every round at ${times(b.priceMultiplier)} the bet`)];
  rules.push({ kind: 'heading', id: 'r-controls-h', text: 'Controls' });
  rules.push({
    kind: 'kv',
    id: 'r-controls',
    covers: ['controls'],
    items: [
      { term: 'SPIN', text: 'The round button plays a round at the current bet. While the reels spin it reads STOP: press it to land them at once. The outcome does not change.' },
      { term: 'BET', text: 'Raise or lower the bet with the arrows beside the bet on a computer, or with the minus and plus beside the round button on a phone. The bet is locked while a round plays.' },
      {
        term: 'AUTOPLAY',
        text: 'The autoplay button opens the autoplay panel: choose the number of rounds and start. ADVANCED adds the stops: when the balance falls by a chosen amount, when a single win passes a chosen amount, when any win lands, or when a feature is won. The rounds left show on the round button, and pressing it ends autoplay.',
      },
      ...(buyMenu.length ? [{ term: 'BUY BONUS', text: `The coin opens the buy menu: ${buyMenu.join('; ')}. A confirmation is asked before a purchase.` }] : []),
      { term: 'MENU', text: 'SOUND and MUSIC switches; TURBO and SUPER TURBO, each with its own switch for the base game and for the bonus; SPACEBAR TO SPIN on a computer; INFO, these rules.' },
      { term: 'TURBO', text: 'TURBO shortens the spins and the win shows; SUPER TURBO shortens them further. A change applies from the next round. The outcome never changes.' },
      { term: 'SPACEBAR', text: 'On a computer, with SPACEBAR TO SPIN on, the spacebar plays a round and stops the reels, like the round button.' },
      { term: 'BALANCE, WIN', text: 'BALANCE is the money you play with. WIN is what the round in play has paid.' },
    ],
  });
  if (extraRules?.length) rules.push(...extraRules);
  rules.push({ kind: 'heading', id: 'r-legal-h', text: 'General' });
  rules.push({ kind: 'legal', id: 'r-legal', text: ARTUBE_DISCLAIMER });

  return { rules };
}
