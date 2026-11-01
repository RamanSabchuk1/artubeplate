// The showcase's math → an Artube upload set. Per mode: Monte-Carlo simulate → bucket rounds by
// payout (one representative book per bucket, weight = how often the bucket came up) → pin the
// weighted RTP to TARGET_RTP → write index.json + lookUpTable_<mode>_0.csv.zst + books_<mode>.jsonl.zst
// into the template's math/ folder, then validate it with the same checks the Hub runs.
//
// Bucketing by payout is what makes the set Artube-legal by construction: every row has its
// OWN multiplier, so "rows sharing a multiplier share a weight" can never be broken, and the
// distinct-multiplier count stays far below 10,000.
//
//   pnpm math:generate                           # N=200k per mode, RTP 96.20
//   ROUNDS=500000 TARGET_RTP=0.962 pnpm math:generate

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeArtifact, validateDir, type ModeToWrite } from '@artubeplate/core/node';
import { mulberry32, WIN_CAP } from './game';
import { resolveRound, type Mode } from './resolve';
import { CLIENT_CONFIG } from './clientConfig';

const BET_CREDIT = 100; // credits per base bet → multiplier = win × 100 (0.01× steps)
const N = Number(process.env.ROUNDS ?? 200_000);
const TARGET_RTP = Number(process.env.TARGET_RTP ?? 0.962);

const here = dirname(fileURLToPath(import.meta.url));
const outDir = resolve(here, '../../packages/create-artubeplate/template/math');

const MODES: Array<{ name: Mode; costX: number; type: 'None' | 'LuckyBet' | 'Purchase'; volatility: 'High' | 'Very High' }> = [
  { name: 'base', costX: 1, type: 'None', volatility: 'High' },
  { name: 'buyfs', costX: 100, type: 'Purchase', volatility: 'Very High' },
  { name: 'luckybet', costX: 1.25, type: 'LuckyBet', volatility: 'High' },
];

// Snap a payout to ~2 significant figures so nearby-value rounds share ONE representative book
// (keeps files small; the book's own exact payout + events stay consistent; the pin re-nails RTP).
const snap = (p: number): number => {
  if (p <= 0) return 0;
  const mag = 10 ** Math.max(0, Math.floor(Math.log10(p)) - 1);
  return Math.round(p / mag) * mag;
};

const modes: ModeToWrite[] = [];
for (const { name, costX, type, volatility } of MODES) {
  const cost = Math.round(costX * BET_CREDIT);
  const rng = mulberry32(0x9e3779b9 ^ name.length ^ (name.charCodeAt(0) << 8));
  const buckets = new Map<number, { payout: number; count: number; book: { payoutMultiplier: number; events: unknown[] } }>();
  for (let i = 0; i < N; i++) {
    const r = resolveRound(name, rng);
    const p = r.payoutMultiplier; // credits at betCredit 100, capped at WIN_CAP × 100
    const k = snap(p);
    const b = buckets.get(k);
    if (b) b.count++;
    else buckets.set(k, { payout: p, count: 1, book: { payoutMultiplier: p, events: r.events } });
  }
  const rows = [...buckets.values()].sort((a, b) => a.payout - b.payout);

  // PIN the weighted RTP by scaling the weight of below-target books (dilute) or above-target
  // books (boost), proportionally across each group (keeps variety). A bought feature has no
  // losing rounds, so it trims via its low-pay books instead.
  const targetMean = TARGET_RTP * cost; // credits per weighted row
  let tW = 0, tWP = 0, loW = 0, loWP = 0, hiW = 0, hiWP = 0;
  for (const r of rows) {
    tW += r.count;
    tWP += r.count * r.payout;
    if (r.payout < targetMean) { loW += r.count; loWP += r.count * r.payout; }
    else if (r.payout > targetMean) { hiW += r.count; hiWP += r.count * r.payout; }
  }
  const mean = tWP / tW;
  let loScale = 1, hiScale = 1;
  if (mean > targetMean && loW > 0) loScale = 1 + (tWP - targetMean * tW) / (targetMean - loWP / loW) / loW;
  else if (mean < targetMean && hiW > 0) hiScale = 1 + (targetMean * tW - tWP) / (hiWP / hiW - targetMean) / hiW;
  // Weights are integers: scale everything up first so the pin survives the rounding.
  const RES = 1000;
  const weightOf = (r: (typeof rows)[number]): number =>
    Math.max(1, Math.round(r.count * RES * (r.payout < targetMean ? loScale : r.payout > targetMean ? hiScale : 1)));

  modes.push({
    name,
    cost,
    type,
    volatility,
    rows: rows.map((r, id) => ({ id, weight: weightOf(r), multiplier: r.payout })),
    books: rows.map((r, id) => ({ id, ...r.book })),
  });
  console.log(`[math] ${name}: ${N.toLocaleString()} rounds → ${rows.length} books (max ${(rows[rows.length - 1]!.payout / BET_CREDIT).toFixed(0)}× of ${WIN_CAP}×)`);
}

const { modes: written } = await writeArtifact(outDir, { betCredit: BET_CREDIT, config: CLIENT_CONFIG, modes });
for (const m of written) console.log(`[math] wrote ${m.name}: ${m.rows} rows, declared RTP ${m.rtp}`);

const report = await validateDir(outDir);
for (const m of report.modes)
  console.log(`[math] ${m.name}: RTP ${m.actualRtpExact.toFixed(3)} (declared ${m.declaredRtp}) hit ${(m.hitRate * 100).toFixed(1)}% max ${m.maxWinX}× ${m.passed ? 'PASS' : 'FAIL'}`);
for (const i of report.issues) console.log(`[math] ${i.level}: ${i.message}`);
if (!report.ok) {
  console.error('[math] the generated set FAILS validation');
  process.exit(1);
}
console.log(`[math] ${outDir} is a valid Artube upload set.`);
