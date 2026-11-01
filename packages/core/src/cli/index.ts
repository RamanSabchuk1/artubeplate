#!/usr/bin/env node
// artubeplate — the math tooling CLI.
//
//   artubeplate math validate <dir>            the Hub's checks, locally (exit 1 on failure)
//   artubeplate math stats <dir>               the same report without failing
//   artubeplate math from-stake <dir> --out <dir> [options]
//   artubeplate math pack <dir> --out <dir>    compress/normalize a hand-made set
//
// Zero dependencies beyond Node ≥ 22.15 (node:zlib zstd).

import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { validateDir, convertStake, packDir, ensureConfig } from '../node';
import { oddsText } from '../math/validate';
import { MANIFEST_MODE_TYPES, VOLATILITIES, type ManifestModeType, type ValidationReport, type Volatility } from '../math/types';

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string | number): string => (useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s));
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const green = paint('32');
const yellow = paint('33');
const cyan = paint('36');

const HELP = `
${bold('artubeplate')} — Artube RGS math tooling

${bold('Usage')}
  artubeplate math validate ${cyan('<dir>')} [--json] [--no-books-check]
  artubeplate math stats ${cyan('<dir>')}
  artubeplate math from-stake ${cyan('<stake publish_files>')} --out ${cyan('<dir>')} [options]
  artubeplate math pack ${cyan('<dir>')} --out ${cyan('<dir>')}
  artubeplate math config ${cyan('<dir>')} [--force] [--title <name>]

${bold('validate')}   runs every check Artube Hub runs on upload: the file set (index.json + a
             weights/books pair per mode, nothing extra), one zstd stream per file, the
             weights rules (integers, no header, no zero weights, one weight per multiplier,
             ≤ 10,000 multipliers), the books envelope (one JSON object/array per line,
             ≤ 96 KiB, depth ≤ 64), positional line counts, and RTP recomputed exactly
             from the weights (±0.50 pp). Exit code 1 if the Hub would reject the set.

${bold('config')}     writes a starter settings.config (board + symbols, inferred from the base
             mode's books) into index.json when the set has none — the client needs it.

${bold('from-stake')} options
  --bet-credit <n>          credits per base bet (default 100 — Stake payouts are ×100)
  --type <mode>=<type>      None | LuckyBet | Purchase (repeatable; default by price)
  --volatility <v|mode=v>   ${VOLATILITIES.join(' | ')}
  --config <file.json>      settings.config for the client (board, symbols, paytable…);
                            omitted → a starter config is inferred from the books
  --equalize <how>          flatten (default) | replicate — rows sharing a payout must share a weight
  --max-copies <n>          replicate budget per row (default 32)
`;

function printReport(r: ValidationReport, strict: boolean): void {
  if (r.manifest) {
    const s = r.manifest.settings;
    console.log(`${dim('index.json')}  ${r.manifest.modes.length} mode(s), betCredit ${s.betCredit}${s.config === undefined ? yellow('  (no settings.config)') : ''}`);
  }
  if (r.modes.length) {
    const head = ['mode', 'type', 'price', 'RTP decl', 'RTP calc', 'rows', 'mults', 'hit', 'max win', 'max odds'];
    const rows = r.modes.map((m) => [
      m.name,
      m.type,
      `${+m.priceMultiplier.toFixed(4)}×`,
      m.declaredRtp.toFixed(2),
      `${m.actualRtpExact.toFixed(3)} ${m.passed ? '✔' : '✖'}`,
      String(m.rows),
      String(m.distinctMultipliers),
      `${(m.hitRate * 100).toFixed(1)}%`,
      `${+m.maxWinX.toFixed(2)}×`,
      oddsText(m.maxWinProbability),
    ]);
    const widths = head.map((h, i) => Math.max(h.length, ...rows.map((row) => row[i]!.length)));
    const line = (cells: string[]): string => cells.map((c, i) => c.padEnd(widths[i]!)).join('  ');
    console.log(`\n${bold(line(head))}`);
    for (const [i, row] of rows.entries()) {
      const text = line(row);
      console.log(r.modes[i]!.passed ? text : red(text));
    }
    console.log(dim(`\n  tail (P of a win ≥ k× base bet): ${r.modes.map((m) => `${m.name}: ${m.tail.map((t) => `≥${t.x}× ${oddsText(t.probability)}`).join(', ')}`).join(' · ')}`));
  }
  const errors = r.issues.filter((i) => i.level === 'error');
  const warns = r.issues.filter((i) => i.level === 'warn');
  if (r.issues.length) console.log('');
  for (const i of [...errors, ...warns]) {
    const where = [i.mode && `mode ${i.mode}`, i.file, i.line && `line ${i.line}`].filter(Boolean).join(' · ');
    const tag = i.level === 'error' ? red('✖ error') : yellow('! warn ');
    console.log(`${tag} ${dim(`[${i.code}]`)} ${i.message}${where ? dim(`  (${where})`) : ''}`);
  }
  console.log('');
  if (r.ok) console.log(green(bold('✔ READY')) + dim(` — the set passes every rule the Hub checks${warns.length ? ` (${warns.length} warning(s))` : ''}.`));
  else console.log((strict ? red : yellow)(bold('✖ FAILED')) + dim(` — ${errors.length} error(s); the Hub would reject this set.`));
}

function kv(list: string[] | undefined, name: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const item of list ?? []) {
    const eq = item.indexOf('=');
    if (eq < 1) throw new Error(`--${name} expects <mode>=<value>, got "${item}"`);
    out[item.slice(0, eq)] = item.slice(eq + 1);
  }
  return out;
}

async function main(): Promise<void> {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: {
      json: { type: 'boolean' },
      'no-books-check': { type: 'boolean' },
      out: { type: 'string', short: 'o' },
      'bet-credit': { type: 'string' },
      type: { type: 'string', multiple: true },
      volatility: { type: 'string', multiple: true },
      config: { type: 'string' },
      equalize: { type: 'string' },
      'max-copies': { type: 'string' },
      force: { type: 'boolean' },
      title: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  const [group, cmd, dir] = positionals;
  if (values.help || !group || group === 'help') return void console.log(HELP);
  if (group !== 'math' || !cmd) throw new Error(`unknown command "${positionals.join(' ')}" — see \`artubeplate help\``);

  if (cmd === 'validate' || cmd === 'stats') {
    if (!dir) throw new Error(`usage: artubeplate math ${cmd} <dir>`);
    const report = await validateDir(resolve(dir), {
      crossCheckBooks: !values['no-books-check'],
      onProgress: values.json ? undefined : (m) => process.stderr.write(dim(`  ${m}\n`)),
    });
    if (values.json) console.log(JSON.stringify(report, (_k, v) => (typeof v === 'bigint' ? v.toString() : v), 2));
    else printReport(report, cmd === 'validate');
    if (cmd === 'validate' && !report.ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'from-stake') {
    if (!dir || !values.out) throw new Error('usage: artubeplate math from-stake <stake publish_files> --out <dir>');
    const types = kv(values.type, 'type');
    for (const [m, t] of Object.entries(types))
      if (!(MANIFEST_MODE_TYPES as readonly string[]).includes(t)) throw new Error(`--type ${m}=${t}: must be ${MANIFEST_MODE_TYPES.join(' | ')}`);
    const vols = values.volatility ?? [];
    let volatility: Volatility | Record<string, Volatility> | undefined;
    if (vols.length === 1 && !vols[0]!.includes('=')) volatility = vols[0] as Volatility;
    else if (vols.length) volatility = kv(vols, 'volatility') as Record<string, Volatility>;
    for (const v of typeof volatility === 'string' ? [volatility] : Object.values(volatility ?? {}))
      if (!(VOLATILITIES as readonly string[]).includes(v)) throw new Error(`--volatility "${v}": must be one of ${VOLATILITIES.join(', ')}`);
    const equalize = (values.equalize ?? 'flatten') as 'flatten' | 'replicate';
    if (equalize !== 'flatten' && equalize !== 'replicate') throw new Error('--equalize must be flatten or replicate');
    const out = resolve(values.out);
    console.log(dim(`Converting ${dir} → ${out}`));
    await convertStake({
      input: resolve(dir),
      out,
      betCredit: values['bet-credit'] ? Number(values['bet-credit']) : 100,
      types: types as Record<string, ManifestModeType>,
      ...(volatility ? { volatility } : {}),
      ...(values.config ? { config: JSON.parse(await readFile(resolve(values.config), 'utf8')) } : {}),
      equalize,
      ...(values['max-copies'] ? { maxCopies: Number(values['max-copies']) } : {}),
      log: (m) => console.log(m),
    });
    console.log(dim('\nValidating the result…'));
    const report = await validateDir(out);
    printReport(report, true);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'pack') {
    if (!dir || !values.out) throw new Error('usage: artubeplate math pack <dir> --out <dir>');
    await packDir(resolve(dir), resolve(values.out), (m) => console.log(m));
    const report = await validateDir(resolve(values.out));
    printReport(report, true);
    if (!report.ok) process.exitCode = 1;
    return;
  }

  if (cmd === 'config') {
    if (!dir) throw new Error('usage: artubeplate math config <dir> [--force] [--title <name>]');
    const r = await ensureConfig(resolve(dir), { ...(values.force ? { force: true } : {}), ...(values.title ? { title: values.title } : {}) });
    for (const n of r.notes) console.log(`${r.status === 'written' ? green('✔') : yellow('·')} ${n}`);
    return;
  }

  throw new Error(`unknown math command "${cmd}" — see \`artubeplate help\``);
}

main().catch((err: unknown) => {
  console.error(red(`\n✖ ${err instanceof Error ? err.message : String(err)}\n`));
  process.exit(2);
});
