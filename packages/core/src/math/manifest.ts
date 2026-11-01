// `index.json` — parse + check against the Hub's rules. Pure: text in, manifest + issues out.

import {
  LIMITS,
  MANIFEST_MODE_TYPES,
  VOLATILITIES,
  type ArtubeManifest,
  type Issue,
  type ManifestGameMode,
  type ManifestMode,
  type ManifestModeType,
} from './types';

export const MODE_NAME_RE = /^[A-Za-z0-9_]{1,32}$/;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

export interface ManifestResult {
  manifest?: ArtubeManifest;
  issues: Issue[];
}

/**
 * Parse and validate a manifest. `byteLength` (if known) checks the 4 MiB cap. Never throws:
 * a broken manifest comes back as `manifest: undefined` plus the reasons.
 */
export function parseManifest(text: string, byteLength?: number): ManifestResult {
  const issues: Issue[] = [];
  const err = (code: string, message: string, extra: Partial<Issue> = {}): void => {
    issues.push({ level: 'error', code, message, file: 'index.json', ...extra });
  };
  const warn = (code: string, message: string, extra: Partial<Issue> = {}): void => {
    issues.push({ level: 'warn', code, message, file: 'index.json', ...extra });
  };

  const size = byteLength ?? new TextEncoder().encode(text).length;
  if (size > LIMITS.manifestBytes) err('manifest-too-large', `index.json is ${size} bytes; the limit is ${LIMITS.manifestBytes} (4 MiB).`);

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    err('manifest-json', `index.json is not valid JSON: ${(e as Error).message}`);
    return { issues };
  }
  if (!isObj(raw)) {
    err('manifest-shape', 'index.json must be a JSON object with `settings` and `modes`.');
    return { issues };
  }

  const settings = raw.settings;
  if (!isObj(settings)) {
    err('settings-missing', '`settings` is required (betCredit, gameModes, config).');
    return { issues };
  }

  const betCredit = settings.betCredit;
  if (!isInt(betCredit) || betCredit < 1) err('bet-credit', '`settings.betCredit` must be an integer ≥ 1 (credits per base bet, e.g. 100).');

  const gameModesRaw = settings.gameModes;
  const gameModes: ManifestGameMode[] = [];
  if (!Array.isArray(gameModesRaw)) {
    err('game-modes-missing', '`settings.gameModes` must be an array.');
  } else {
    if (gameModesRaw.length < LIMITS.modesMin || gameModesRaw.length > LIMITS.modesMax)
      err('mode-count', `A game has ${LIMITS.modesMin}…${LIMITS.modesMax} modes; found ${gameModesRaw.length}.`);
    const seen = new Set<string>();
    gameModesRaw.forEach((m, i) => {
      const at = `settings.gameModes[${i}]`;
      if (!isObj(m)) {
        err('game-mode-shape', `${at} must be an object.`);
        return;
      }
      const name = m.name;
      if (typeof name !== 'string' || !MODE_NAME_RE.test(name)) {
        err('mode-name', `${at}.name must match [A-Za-z0-9_]{1,32}; got ${JSON.stringify(name)}.`);
        return;
      }
      if (seen.has(name)) err('mode-name-duplicate', `Mode name "${name}" is declared twice.`, { mode: name });
      seen.add(name);
      if (!isInt(m.cost) || m.cost < 1) err('mode-cost', `${at}.cost must be an integer ≥ 1 (credits); got ${JSON.stringify(m.cost)}.`, { mode: name });
      let type: ManifestModeType = 'None';
      if (m.type !== undefined) {
        if (typeof m.type === 'string' && (MANIFEST_MODE_TYPES as readonly string[]).includes(m.type)) type = m.type as ManifestModeType;
        else err('mode-type', `${at}.type must be one of ${MANIFEST_MODE_TYPES.join(' / ')} (case-sensitive); got ${JSON.stringify(m.type)}.`, { mode: name });
      }
      const rtp = m.rtp;
      if (typeof rtp !== 'number' || !Number.isFinite(rtp) || rtp <= 0 || rtp >= 100)
        err('mode-rtp', `${at}.rtp must be a number strictly between 0 and 100 (96.0 = 96%); got ${JSON.stringify(rtp)}.`, { mode: name });
      if (m.volatility !== undefined && !(VOLATILITIES as readonly unknown[]).includes(m.volatility))
        err('mode-volatility', `${at}.volatility must be one of ${VOLATILITIES.map((v) => `"${v}"`).join(', ')}; got ${JSON.stringify(m.volatility)}.`, { mode: name });
      gameModes.push({
        name,
        cost: m.cost as number,
        type,
        rtp: rtp as number,
        ...(m.volatility !== undefined ? { volatility: m.volatility as ManifestGameMode['volatility'] } : {}),
      });
    });
  }

  if (settings.config === undefined) warn('config-missing', '`settings.config` is absent — the client gets no game configuration (a placeholder 5×3 board). `artubeplate math config <dir>` infers a starter one from the books.');

  const modesRaw = raw.modes;
  const modes: ManifestMode[] = [];
  if (!Array.isArray(modesRaw)) {
    err('modes-missing', '`modes` must be an array mapping each mode to its files.');
  } else {
    const seen = new Set<string>();
    const files = new Set<string>();
    modesRaw.forEach((m, i) => {
      const at = `modes[${i}]`;
      if (!isObj(m) || typeof m.name !== 'string' || typeof m.events !== 'string' || typeof m.weights !== 'string') {
        err('mode-files-shape', `${at} must be { name, events, weights } strings.`);
        return;
      }
      const { name, events, weights } = m as unknown as ManifestMode;
      if (seen.has(name)) err('mode-files-duplicate', `modes: "${name}" is listed twice.`, { mode: name });
      seen.add(name);
      for (const [field, file] of [['events', events], ['weights', weights]] as const) {
        if (file.length < 1 || file.length > LIMITS.fileNameMax) err('file-name-length', `${at}.${field} file name must be 1…${LIMITS.fileNameMax} characters.`, { mode: name });
        if (file.includes('/') || file.includes('\\')) err('file-name-path', `${at}.${field} must be a bare file name in the same folder (the set is flat); got "${file}".`, { mode: name });
        if (files.has(file)) err('file-shared', `"${file}" is referenced twice — every mode needs its OWN weights and books files.`, { mode: name });
        files.add(file);
      }
      if (!weights.endsWith('.csv.zst')) warn('weights-ext', `${at}.weights "${weights}" does not end in .csv.zst (the weights must be zstd-compressed CSV).`, { mode: name });
      if (!events.endsWith('.jsonl.zst')) warn('events-ext', `${at}.events "${events}" does not end in .jsonl.zst (the books must be zstd-compressed JSONL).`, { mode: name });
      modes.push({ name, events, weights });
    });
    // gameModes ↔ modes, one to one by name.
    const declared = new Set(gameModes.map((g) => g.name));
    const mapped = new Set(modes.map((m) => m.name));
    for (const n of declared) if (!mapped.has(n)) err('mode-unmapped', `gameModes declares "${n}" but modes has no files for it.`, { mode: n });
    for (const n of mapped) if (!declared.has(n)) err('mode-undeclared', `modes lists files for "${n}" but gameModes does not declare it.`, { mode: n });
  }

  if (issues.some((i) => i.level === 'error')) return { issues };
  return {
    manifest: { settings: { betCredit: betCredit as number, gameModes, ...(settings.config !== undefined ? { config: settings.config } : {}) }, modes },
    issues,
  };
}

/** The file names a manifest requires in the folder (index.json + a pair per mode). */
export function requiredFiles(manifest: ArtubeManifest): string[] {
  return ['index.json', ...manifest.modes.flatMap((m) => [m.weights, m.events])];
}

/** The client-side view of a mode: what `gameSettings.gameModes[i]` carries on the wire. */
export interface ClientGameMode {
  id: string;
  rtp: number;
  volatility?: string;
  priceMultiplier: number;
  /** `None` | `LuckyBet` | `BuyFeature` (manifest `Purchase` is renamed on the wire). */
  type: 'None' | 'LuckyBet' | 'BuyFeature';
}

/** Map a manifest's modes to what the RGS sends the client in `gameSettings.gameModes`. */
export function clientGameModes(manifest: ArtubeManifest): ClientGameMode[] {
  const bc = manifest.settings.betCredit;
  return manifest.settings.gameModes.map((g) => ({
    id: g.name,
    rtp: g.rtp,
    ...(g.volatility ? { volatility: g.volatility } : {}),
    priceMultiplier: g.cost / bc,
    type: g.type === 'Purchase' ? 'BuyFeature' : (g.type ?? 'None'),
  }));
}
