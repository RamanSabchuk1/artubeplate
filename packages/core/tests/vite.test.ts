import { it, expect } from 'vitest';
import { artubeplate, rgsProxy } from '../src/vite';

it('proxies /api-rgs (HTTP + WebSocket) to the Artube host from a launch URL', () => {
  const p = rgsProxy('https://dev.example.com/games/123/index.html?sessionId=abc')['/api-rgs']!;
  expect(p).toMatchObject({ target: 'https://dev.example.com', ws: true, changeOrigin: true, rewriteWsOrigin: true, headers: { origin: 'https://dev.example.com' } });
  expect(rgsProxy('stage.example.com')['/api-rgs']!.target).toBe('https://stage.example.com');
});

type Env = { command: 'serve' | 'build'; mode: string };
const configOf = (p: ReturnType<typeof artubeplate>, env: Env = { command: 'serve', mode: 'development' }): Record<string, unknown> =>
  (typeof p.config === 'function' ? (p.config as (c: unknown, e: Env) => Record<string, unknown>)({}, env) : {}) ?? {};

it('adds the proxy only when a host is given', () => {
  expect(configOf(artubeplate({ rgsHost: 'https://dev.example.com' }))).toMatchObject({ server: { proxy: { '/api-rgs': { target: 'https://dev.example.com' } } } });
  if (!process.env.ARTUBE_HOST) expect(configOf(artubeplate({}))).not.toHaveProperty('server');
});

it('lets the mock RGS run in dev and in a demo build, never in the build for Artube', () => {
  const mock = (p: ReturnType<typeof artubeplate>, env?: Env): unknown => (configOf(p, env).define as Record<string, string>).__ARTUBEPLATE_MOCK__;
  expect(mock(artubeplate({}))).toBe('true');
  expect(mock(artubeplate({}), { command: 'build', mode: 'production' })).toBe('false');
  expect(mock(artubeplate({ demoBuild: true }), { command: 'build', mode: 'demo' })).toBe('true');
});

