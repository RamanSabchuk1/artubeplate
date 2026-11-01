// Session currency → an open-slot-ui CurrencySpec. The RGS sends a code and its minimal unit
// (`currencyMinimalUnit`, e.g. 0.01); the unit decides the decimals, the code the symbol. A
// `null` currency is a DEMO session: play money, and "DEMO" stands where the currency would
// (1.00 DEMO), never a real symbol.

import { resolveCurrency, type CurrencySpec } from '@open-slot-ui/core';

/** Decimals implied by a minimal unit (0.01 → 2, 1 → 0, 0.00000001 → 8). */
export function decimalsFromUnit(unit: number | undefined, fallback = 2): number {
  if (!unit || !(unit > 0)) return fallback;
  return Math.max(0, Math.min(8, Math.round(-Math.log10(unit))));
}

/** What a demo balance is labelled with. */
export const DEMO_CURRENCY_LABEL = 'DEMO';

/**
 * Currencies open-slot-ui's table does not know. They show their ISO code after the amount
 * ("1,500,000 IRR"), with these decimals unless the session's minimal unit says otherwise.
 */
const EXTRA_DECIMALS: Record<string, number> = {
  IRR: 0, // rial
  IRT: 0, // toman
  VND: 0,
  UZS: 0,
};

/**
 * The session's currency as a CurrencySpec. The code is read in upper case whatever the RGS
 * sent, so an unknown currency prints as "IRR", never "irr". The minimal unit decides the
 * decimals when it is given; else the currency's own.
 */
export function currencyFor(code: string | null, minimalUnit?: number): CurrencySpec {
  const decimals = decimalsFromUnit(minimalUnit);
  if (code === null) return { code: DEMO_CURRENCY_LABEL, decimals, position: 'suffix', separator: ',', decimalChar: '.' };
  const upper = code.trim().toUpperCase();
  const extra = EXTRA_DECIMALS[upper];
  return resolveCurrency(upper, minimalUnit ? { decimals } : extra !== undefined ? { decimals: extra } : {});
}
