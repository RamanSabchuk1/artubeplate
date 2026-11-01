// The README's headless example, verbatim (so the docs cannot drift from the API).
import { it, expect } from 'vitest';
import { MockRgs } from '../src/testing';
import { loadArtifactDir } from '../src/node';
import { TEMPLATE_MATH } from './helpers';

it('README: a headless mock round from a math folder on disk', async () => {
  const rgs = new MockRgs({ math: await loadArtifactDir(TEMPLATE_MATH), seed: 1, latency: 0 });
  await rgs.connect();
  const session = await rgs.session();
  rgs.forceRow('base', 12); // the next base round lands on book row 12
  const round = await rgs.spin({ gameMode: 'base', betIndex: session.sessionSettings.defaultBetIndex });
  rgs.failNext(503); // the spin after that is refused with errorId 503
  expect(round.spinResult.payload).toMatchObject({ id: 12 });
  await expect(rgs.spin({ gameMode: 'base', betIndex: 0 })).rejects.toMatchObject({ errorId: 503 });
});
