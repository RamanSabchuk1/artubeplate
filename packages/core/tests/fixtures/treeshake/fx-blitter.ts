// Only the particle blitter: no pylinka.
import { Blitter } from '../../../src/fx/index';

(globalThis as Record<string, unknown>).__fixture = Blitter;
