// The smallest game on the core, for tests/treeshake.test.ts: the round loop and the HUD, no view.
import { createArtubeGame } from '../../../src/index';

void createArtubeGame({
  config: { title: 'Tree-shake fixture' },
  interpretBook: (book) => book,
  mountView: () => ({}),
}).start();
