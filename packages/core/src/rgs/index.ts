// @artubeplate/core/rgs — the Artube RGS contract (types + tolerant normalizers), the error
// codes, launch-param runtime, the transport seam, and its two adapters: the real SignalR client
// and the artifact-backed mock.
import { ArtubeRgsClient, type ArtubeRgsOptions } from './ArtubeRgsClient';
import { MockRgs, type MockRgsOptions } from './MockRgs';
import { hubUrl, type RuntimeConfig } from './runtime';
import type { RgsTransport } from './network';

export * from './protocol';
export * from './errors';
export * from './runtime';
export * from './network';
export * from './ArtubeRgsClient';
export * from './MockRgs';

export interface CreateNetworkOptions {
  /** Defaults for the mock (the URL's knobs override them). */
  mock?: MockRgsOptions;
  /** Options for the real client (url is derived from the runtime). */
  artube?: Omit<ArtubeRgsOptions, 'url'>;
}

/** The URL's mock knobs as MockRgs options. */
export function mockOptionsFromRuntime(runtime: RuntimeConfig): MockRgsOptions {
  const l = runtime.mockLaunch;
  return {
    ...(l.balance !== undefined ? { balance: l.balance } : {}),
    ...(l.currency !== undefined ? { currency: l.currency } : {}),
    ...(l.frcRounds ? { frc: { rounds: l.frcRounds, ...(l.frcBet ? { bet: l.frcBet } : {}) } } : {}),
    ...(l.maxWin ? { platformMaxWin: l.maxWin } : {}),
    ...(l.seed !== undefined ? { seed: l.seed } : {}),
    ...(l.latency !== undefined ? { latency: l.latency } : {}),
    ...(l.errors?.length ? { errors: l.errors } : {}),
    ...(l.force?.length ? { force: l.force } : {}),
    ...(l.gamification ? { gamificationToken: 'mock-gamification-token' } : {}),
  };
}

/**
 * Pick the transport for this launch: a session in the URL → the real RGS; else the mock.
 * Synchronous, so it holds a static reference to MockRgs: a game that calls it ships the mock in
 * every build. `createArtubeGame` uses {@link loadNetwork} instead.
 */
export function createNetwork(runtime: RuntimeConfig, opts: CreateNetworkOptions = {}): RgsTransport {
  // The game's mock defaults first, then whatever the URL asked for (QA links win).
  if (runtime.mock) return new MockRgs({ ...opts.mock, ...mockOptionsFromRuntime(runtime) });
  return new ArtubeRgsClient({ ...opts.artube, url: hubUrl(runtime) });
}

declare const __ARTUBEPLATE_MOCK__: boolean | undefined;

/**
 * Pick the transport for this launch, as {@link createNetwork} does, but load the mock RGS (with
 * its math loader and fzstd) only into a build that may run it. The artubeplate Vite plugin
 * defines `__ARTUBEPLATE_MOCK__`: true for `vite dev` and demo builds, false for a build for
 * Artube. Where it is false the branch below is dead code, so the bundler drops the dynamic
 * import and, with it, the mock. Without the plugin (tests, another bundler) the mock stays
 * available.
 */
export async function loadNetwork(runtime: RuntimeConfig, opts: CreateNetworkOptions = {}): Promise<RgsTransport> {
  if ((typeof __ARTUBEPLATE_MOCK__ !== 'boolean' || __ARTUBEPLATE_MOCK__) && runtime.mock) {
    const { MockRgs: Mock } = await import('./MockRgs');
    // The game's mock defaults first, then whatever the URL asked for (QA links win).
    return new Mock({ ...opts.mock, ...mockOptionsFromRuntime(runtime) });
  }
  return new ArtubeRgsClient({ ...opts.artube, url: hubUrl(runtime) });
}
