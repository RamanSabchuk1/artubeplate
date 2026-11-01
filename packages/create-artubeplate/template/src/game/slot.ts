// The slot's description comes FROM THE MATH: the manifest's `settings.config` (schema
// `artubeplate/slot@1`) reaches the client as `session.gameSettings.config`. Board size, symbols,
// paytable and paylines all come from there, so dropping a new math folder into `math/`
// reconfigures the reels, the paytable and the rules with no code change.
//
// If a math drop carries no (or a broken) config, the client falls back to a 5×3 board of
// placeholder tiles and warns in the console. `npm run math:config` writes a starter config into
// math/index.json, inferred from the books (board size + symbol set); add the paytable and
// paylines by hand to get real pays and rules.

import { parseSlotConfig, type SlotConfig, type SlotSymbol } from '@artubeplate/core/rules';

const FALLBACK: SlotConfig = {
  schema: 'artubeplate/slot@1',
  title: '{{name}}',
  board: { reels: 5, rows: 3 },
  symbols: [],
};

/** The slot config for this session, or the fallback (with the reasons logged). */
export function slotFromSession(gameConfig: unknown): SlotConfig {
  const { config, issues } = parseSlotConfig(gameConfig);
  if (config) return config;
  console.warn(`[{{name}}] settings.config is not an artubeplate slot config — using placeholders.\n  ${issues.join('\n  ')}`);
  return FALLBACK;
}

/** Look a symbol up, inventing a placeholder for ids the config does not list. */
export function symbolOf(slot: SlotConfig, id: string): SlotSymbol {
  return slot.symbols.find((s) => s.id === id) ?? { id, name: id, label: id.slice(0, 4) };
}
