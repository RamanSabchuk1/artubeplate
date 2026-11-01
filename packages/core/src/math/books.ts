// The books — one JSON payload per line, positionally aligned with the weights. The platform
// only checks the ENVELOPE (one object/array per line, ≤ 96 KiB, depth ≤ 64); the content is the
// studio's contract with its own client. artubeplate adds one cross-check on top: a book that
// states its own `payoutMultiplier` must agree with the weights row that pays it.

import { LIMITS, type Issue } from './types';

const MAX_PER_CODE = 20;
const utf8 = new TextEncoder();

/** Nesting depth of a parsed JSON value (a scalar is depth 0, `{}` is 1). Iterative. */
export function jsonDepth(value: unknown): number {
  let max = 0;
  const stack: Array<[unknown, number]> = [[value, 0]];
  while (stack.length) {
    const [v, d] = stack.pop()!;
    if (v && typeof v === 'object') {
      const depth = d + 1;
      if (depth > max) max = depth;
      if (depth > LIMITS.jsonDepth + 1) return depth; // no need to walk further
      for (const child of Array.isArray(v) ? v : Object.values(v as Record<string, unknown>)) {
        if (child && typeof child === 'object') stack.push([child, depth]);
      }
    }
  }
  return max;
}

export class BooksAccumulator {
  readonly issues: Issue[] = [];
  private readonly perCode = new Map<string, number>();
  rows = 0;
  bytes = 0;
  maxLineBytes = 0;
  /** Lines whose own `payoutMultiplier` disagrees with the weights row. */
  mismatches = 0;

  constructor(
    private readonly mode: string,
    private readonly file: string,
    /** The weights' multipliers in row order, to cross-check books that carry their own. */
    private readonly multipliers?: readonly number[],
  ) {}

  private issue(level: Issue['level'], code: string, message: string, line?: number): void {
    const n = (this.perCode.get(code) ?? 0) + 1;
    this.perCode.set(code, n);
    if (n <= MAX_PER_CODE) this.issues.push({ level, code, message, mode: this.mode, file: this.file, ...(line ? { line } : {}) });
    else if (n === MAX_PER_CODE + 1) this.issues.push({ level, code, message: `…more "${code}" findings suppressed.`, mode: this.mode, file: this.file });
  }

  push(line: string, lineNo: number): void {
    this.rows++;
    const size = utf8.encode(line).length;
    this.bytes += size + 1;
    if (size > this.maxLineBytes) this.maxLineBytes = size;
    if (line.length === 0) {
      this.issue('error', 'books-blank-line', 'Blank line — every line must be one JSON object or array.', lineNo);
      return;
    }
    if (size > LIMITS.bookLineBytes) {
      this.issue('error', 'books-line-length', `Line is ${size} bytes; the limit is ${LIMITS.bookLineBytes} (96 KiB).`, lineNo);
      return;
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch (e) {
      this.issue('error', 'books-json', `Not valid JSON (${(e as Error).message}). Each line must be ONE complete JSON value — no multi-line JSON.`, lineNo);
      return;
    }
    if (value === null || typeof value !== 'object') {
      this.issue('error', 'books-not-object', `Line must be a JSON object or array, not ${value === null ? 'null' : typeof value}.`, lineNo);
      return;
    }
    const depth = jsonDepth(value);
    if (depth > LIMITS.jsonDepth) this.issue('error', 'books-depth', `JSON nesting depth ${depth} exceeds ${LIMITS.jsonDepth}.`, lineNo);

    // Not a Hub rule — the contract between the table and the payload. The platform pays the
    // WEIGHTS multiplier; a book that says otherwise would show the player a different win.
    const own = (value as { payoutMultiplier?: unknown }).payoutMultiplier;
    const expected = this.multipliers?.[lineNo - 1];
    if (typeof own === 'number' && expected !== undefined && own !== expected) {
      this.mismatches++;
      this.issue(
        'warn',
        'books-payout-mismatch',
        `Book says payoutMultiplier ${own} but its weights row pays ${expected} credits — the player is paid the weights value.`,
        lineNo,
      );
    }
  }

  finish(expectedRows?: number): void {
    if (this.rows === 0) this.issue('error', 'books-empty', 'The books file has no lines.');
    if (expectedRows !== undefined && expectedRows !== this.rows)
      this.issue('error', 'books-count', `Books have ${this.rows} lines but the weights have ${expectedRows} rows — they must match one to one, by position.`);
  }
}
