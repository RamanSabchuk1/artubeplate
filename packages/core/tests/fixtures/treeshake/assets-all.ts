// Everything in @artubeplate/core/assets, the runtime side (the positive control for its marker).
import * as assets from '../../../src/assets/index';

(globalThis as Record<string, unknown>).__fixture = assets;
