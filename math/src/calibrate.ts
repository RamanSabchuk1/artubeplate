// Sweep the free-spins RTP knobs (fsWild × stickyCap) for the BOUGHT feature (buyfs, cost 100×)
// — a buy always triggers, so it can't be diluted by the pin; the feature itself must land near
// 96.2%. Pick the (fsWild, stickyCap) whose natural buyfs RTP is just ABOVE ~96% (the generator
// then trims the small remainder). Run: pnpm --filter slot-math calibrate
import { mulberry32 } from './game';
import { resolveRound } from './resolve';

const N = Number(process.env.ROUNDS ?? 40000);
const BUY_COST = 100;
console.log(`buyfs RTP sweep (N=${N}/cell):`);
for (const fsWild of [1, 2, 3, 4]) {
  const row: string[] = [];
  for (const stickyCap of [2, 3, 4]) {
    const rng = mulberry32(0xc0ffee);
    let sum = 0, max = 0;
    for (let i = 0; i < N; i++) { const r = resolveRound('buyfs', rng, { fsWild, stickyCap }); sum += r.win; if (r.win > max) max = r.win; }
    const rtp = sum / N / BUY_COST;
    row.push(`cap${stickyCap} ${(rtp * 100).toFixed(0)}% (max ${max.toFixed(0)}×)`);
  }
  console.log(`  fsWild=${fsWild}  ` + row.join('   '));
}
