// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_WIDGET_POSITION, WIDGET_CONTAINER_ID, gamificationEnv, startGamification, widgetPosition, type GamificationView } from '../src/game/gamification';
import { readRuntime } from '../src/rgs/runtime';

type Win = Window & { MyWidgetLauncher?: unknown; __WAGERCRAFT_EVENT_BUS__?: unknown };

/** A stand-in for the platform's launcher: init records its options and puts up the event bus. */
function fakeLauncher(opts: { destroy?: boolean } = {}) {
  const published: Array<{ type: string; payload?: unknown }> = [];
  const init = vi.fn(() => {
    (window as Win).__WAGERCRAFT_EVENT_BUS__ = { publish: (e: { type: string; payload?: unknown }) => published.push(e) };
  });
  const destroy = vi.fn();
  (window as Win).MyWidgetLauncher = { init, ...(opts.destroy ? { destroy } : {}) };
  return { init, destroy, published };
}

const portrait: GamificationView = { orientation: 'portrait', touch: true, width: 390, height: 844 };
const landscape: GamificationView = { orientation: 'landscape', touch: true, width: 844, height: 390 };

afterEach(() => {
  delete (window as Win).MyWidgetLauncher;
  delete (window as Win).__WAGERCRAFT_EVENT_BUS__;
  document.getElementById(WIDGET_CONTAINER_ID)?.remove();
  vi.restoreAllMocks();
});

describe('gamificationEnv: demo on Artube Dev, prod on Artube Prod', () => {
  it('reads the host by its labels', () => {
    expect(gamificationEnv('dev.artube-888.live')).toBe('demo');
    expect(gamificationEnv('localhost:5173')).toBe('demo');
    expect(gamificationEnv('cdn.artube-888.live')).toBe('prod');
    expect(gamificationEnv('games-cdn2.example.com')).toBe('prod');
    expect(gamificationEnv('rc.artube-888.live')).toBe('rc');
    expect(gamificationEnv('artube-rc2.example.com')).toBe('rc');
    expect(gamificationEnv('stable.artube-888.live')).toBe('stable');
  });

  it('does not take a name that merely holds the letters for a stage', () => {
    expect(gamificationEnv('arcade.example.com')).toBe('demo');
    expect(gamificationEnv('source-games.example.com')).toBe('demo');
  });

  it('can be forced from the launch URL', () => {
    const params: Record<string, string> = { sessionId: 's1', gamificationEnv: 'PROD' };
    expect(readRuntime({ param: (n) => params[n], allowMock: false }).gamificationEnv).toBe('prod');
    expect(readRuntime({ param: () => undefined, allowMock: false }).gamificationEnv).toBeUndefined();
  });
});

describe('widgetPosition', () => {
  it('takes a fixed position, a function of the screen, or the default corner', () => {
    expect(widgetPosition(undefined, portrait)).toEqual(DEFAULT_WIDGET_POSITION);
    expect(widgetPosition({ bottom: '120px', left: '10px' }, portrait)).toEqual({ bottom: '120px', left: '10px' });
    const pick = (v: GamificationView) => (v.orientation === 'portrait' ? { top: '8px', right: '8px' } : { top: '8px', left: '8px' });
    expect(widgetPosition(pick, portrait)).toEqual({ top: '8px', right: '8px' });
    expect(widgetPosition(pick, landscape)).toEqual({ top: '8px', left: '8px' });
  });

  it('keeps the default to two sides, top and right', () => {
    expect(Object.keys(DEFAULT_WIDGET_POSITION).sort()).toEqual(['right', 'top']);
  });
});

describe('startGamification', () => {
  it('mounts #wagercraft and calls init with the token, session, language, position and env', async () => {
    const { init } = fakeLauncher();
    const dispose = await startGamification({ token: 'tok', sessionId: 'sess', lang: 'ru', view: () => portrait, options: { env: 'demo' } });
    expect(document.getElementById(WIDGET_CONTAINER_ID)).not.toBeNull();
    expect(init).toHaveBeenCalledWith({ token: 'tok', sessionId: 'sess', lang: 'RU', position: DEFAULT_WIDGET_POSITION, env: 'demo' });
    dispose();
    expect(document.getElementById(WIDGET_CONTAINER_ID)).toBeNull();
  });

  it("uses the page's own #wagercraft and leaves it there", async () => {
    fakeLauncher();
    const own = document.createElement('div');
    own.id = WIDGET_CONTAINER_ID;
    document.body.appendChild(own);
    const dispose = await startGamification({ token: 't', sessionId: 's', lang: 'en', view: () => portrait });
    expect(document.querySelectorAll('#' + WIDGET_CONTAINER_ID)).toHaveLength(1);
    dispose();
    expect(document.getElementById(WIDGET_CONTAINER_ID)).toBe(own);
  });

  it('sends a new position when the orientation changes, and only then', async () => {
    const { published } = fakeLauncher();
    // Frames run when the test says so, as a browser runs them after the event.
    const frames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => frames.push(cb));
    const flush = (): void => {
      for (const cb of frames.splice(0)) cb(0);
    };
    let screen = portrait;
    const position = (v: GamificationView) => (v.orientation === 'portrait' ? { top: '8px', right: '8px' } : { top: '8px', left: '8px' });
    const dispose = await startGamification({ token: 't', sessionId: 's', lang: 'en', view: () => screen, options: { position } });
    window.dispatchEvent(new Event('resize'));
    flush();
    expect(published).toHaveLength(0);
    screen = landscape;
    window.dispatchEvent(new Event('orientationchange'));
    window.dispatchEvent(new Event('resize'));
    flush();
    expect(published).toEqual([{ type: 'wagercraft:update-position', payload: { position: { top: '8px', left: '8px' } } }]);
    window.dispatchEvent(new Event('resize'));
    flush();
    expect(published).toHaveLength(1);
    dispose();
    screen = portrait;
    window.dispatchEvent(new Event('resize'));
    flush();
    expect(published.filter((e) => e.type === 'wagercraft:update-position')).toHaveLength(1);
  });

  it('unmounts through destroy() when the launcher has it, else through the bus', async () => {
    const a = fakeLauncher({ destroy: true });
    (await startGamification({ token: 't', sessionId: 's', lang: 'en', view: () => portrait }))();
    expect(a.destroy).toHaveBeenCalledOnce();
    expect(a.published).toHaveLength(0);
    const b = fakeLauncher();
    (await startGamification({ token: 't', sessionId: 's', lang: 'en', view: () => portrait }))();
    expect(b.published).toEqual([{ type: 'wagercraft:hide-widget' }]);
  });

  it('never throws: a launcher that fails leaves the game a no-op disposer', async () => {
    (window as Win).MyWidgetLauncher = {
      init: () => {
        throw new Error('bad token');
      },
    };
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const dispose = await startGamification({ token: 't', sessionId: 's', lang: 'en', view: () => portrait });
    expect(typeof dispose).toBe('function');
    expect(() => dispose()).not.toThrow();
    expect(warn).toHaveBeenCalled();
    expect(document.getElementById(WIDGET_CONTAINER_ID)).toBeNull();
  });
});
