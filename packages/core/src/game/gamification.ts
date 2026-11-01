// The platform's gamification widget (tournaments, prize drops). Optional on the operator side:
// it is initialised ONLY when the session carries a `gamificationToken`, and a failure to load or
// initialise it must never block the game.
// @see https://docs.artube-888.live/en/features/gamification-integration/frontend-integration/
//
// What Artube asks of the client, and where it happens here:
//   - the token from the session, no widget without one          createArtubeGame (session)
//   - the launcher script loaded async into <head>               loadScript
//   - `MyWidgetLauncher.init({ token, sessionId, lang, position, env })`; the launcher mounts the
//     widget into `<div id="wagercraft">` and refuses to start without one (its own console
//     error; the docs do not say so), so the core adds that element when the page has none
//   - `env` matching the deployment: `demo` on Artube Dev, `prod` on Artube Prod  gamificationEnv
//   - a position clear of the spin button, the menu and the bet panel             DEFAULT_WIDGET_POSITION
//   - a new position sent on every orientation change, through the event bus
//     (`wagercraft:update-position`, payload `{ position }`)                      placement + resize

export interface WidgetPosition {
  top?: string;
  right?: string;
  bottom?: string;
  left?: string;
}

/** The screen a position is chosen for (handed to a position function on every change). */
export interface GamificationView {
  orientation: 'portrait' | 'landscape';
  /** The HUD's touch layout (phones, tablets) rather than the desktop bar. */
  touch: boolean;
  width: number;
  height: number;
}

export interface GamificationOptions {
  /**
   * Where the widget sits: CSS offsets from the screen's edges (px, rem, vh, vw, %), at most two
   * sides. A function is asked again on every resize and orientation change, and the widget moves
   * when its answer changes. Keep it off the spin button, the menu and the bet panel, and off your
   * own scene's pieces. Default {@link DEFAULT_WIDGET_POSITION}.
   */
  position?: WidgetPosition | ((view: GamificationView) => WidgetPosition);
  /** Force the environment (`demo`, `prod`, `rc`, `stable`). Default: from the host, see {@link gamificationEnv}. */
  env?: string;
  /** Script URL (default: the platform's launcher). */
  src?: string;
}

const DEFAULT_SRC = 'https://assets.gamification-platform.com/widget-launcher.js';
/** The element the launcher mounts the widget into. */
export const WIDGET_CONTAINER_ID = 'wagercraft';

/**
 * The top-right corner: clear of the HUD's controls in every layout. The desktop bar and the phone
 * portrait bar sit at the bottom; on a phone in landscape the spin column runs down the right edge
 * but starts below this corner, and the menu and the buy button sit at the left.
 */
export const DEFAULT_WIDGET_POSITION: WidgetPosition = { top: '8px', right: '8px' };

interface Launcher {
  init(opts: Record<string, unknown>): unknown;
  destroy?(): void;
}

interface EventBus {
  publish(event: { type: string; payload?: unknown }): void;
}

/**
 * The widget's environment for this deployment. Artube's rule is `demo` on Artube Dev and `prod`
 * on Artube Prod (a wrong one fails authorisation); its host table names `rc` and `stable` hosts
 * and a `cdn` host for prod. Hosts are matched by their labels (`dev.artube-888.live` is Dev, a
 * host with a `cdn…` label is Prod), so a name that merely contains the letters, like `arcade`,
 * is not taken for `rc`. Everything else is Artube Dev: `demo`. (The table's own fallback, `dev`,
 * is the widget's sandbox, which does not know Artube Dev's tokens.)
 */
export function gamificationEnv(host: string = typeof location !== 'undefined' ? location.host : ''): string {
  const labels = host.toLowerCase().split(/[.:-]/);
  if (labels.some((l) => /^rc\d*$/.test(l))) return 'rc';
  if (labels.includes('stable')) return 'stable';
  if (labels.some((l) => l.startsWith('cdn'))) return 'prod';
  return 'demo';
}

/** The screen right now, as a position function sees it. */
export function gamificationView(): GamificationView {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
  return { orientation: height > width ? 'portrait' : 'landscape', touch, width, height };
}

/** The position for `view`: the option itself, its function's answer, or the default. */
export function widgetPosition(option: GamificationOptions['position'], view: GamificationView): WidgetPosition {
  if (!option) return DEFAULT_WIDGET_POSITION;
  return typeof option === 'function' ? option(view) : option;
}

/** The launcher's mount point: the page's own `#wagercraft`, or a new one at the end of <body>. */
function ensureContainer(): { el: HTMLElement; created: boolean } {
  const found = document.getElementById(WIDGET_CONTAINER_ID);
  if (found) return { el: found, created: false };
  const el = document.createElement('div');
  el.id = WIDGET_CONTAINER_ID;
  document.body.appendChild(el);
  return { el, created: true };
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

/**
 * Load + init the widget. Resolves to a disposer; never throws. `view` tells a position function
 * what the screen is (default {@link gamificationView}; the game passes the HUD's own channel).
 */
export async function startGamification(args: { token: string; sessionId: string; lang: string; options?: GamificationOptions; view?: () => GamificationView }): Promise<() => void> {
  const noop = (): void => {};
  let container: { el: HTMLElement; created: boolean } | null = null;
  try {
    const w = window as unknown as { MyWidgetLauncher?: Launcher; __WAGERCRAFT_EVENT_BUS__?: EventBus };
    const view = args.view ?? gamificationView;
    if (!w.MyWidgetLauncher) await loadScript(args.options?.src ?? DEFAULT_SRC);
    if (!w.MyWidgetLauncher) throw new Error('MyWidgetLauncher missing after load');
    const mount = (container = ensureContainer());
    let position = widgetPosition(args.options?.position, view());
    w.MyWidgetLauncher.init({
      token: args.token,
      sessionId: args.sessionId,
      lang: args.lang.toUpperCase(),
      position,
      env: args.options?.env ?? gamificationEnv(),
    });
    // A resize or an orientation change asks for the position again and moves the widget when it
    // changed (Artube requires a new position on every orientation change), once per frame.
    let frame = 0;
    const place = (): void => {
      frame = 0;
      const next = widgetPosition(args.options?.position, view());
      if (JSON.stringify(next) === JSON.stringify(position)) return;
      position = next;
      try {
        w.__WAGERCRAFT_EVENT_BUS__?.publish({ type: 'wagercraft:update-position', payload: { position } });
      } catch (err) {
        console.warn('[artubeplate] gamification widget: position update failed', err);
      }
    };
    const onResize = (): void => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('orientationchange', onResize);
      if (frame) cancelAnimationFrame(frame);
      try {
        // The launcher documents destroy(); builds without it unmount on the bus's hide event.
        if (w.MyWidgetLauncher?.destroy) w.MyWidgetLauncher.destroy();
        else w.__WAGERCRAFT_EVENT_BUS__?.publish({ type: 'wagercraft:hide-widget' });
      } catch {
        /* the game is leaving anyway */
      }
      if (mount.created) mount.el.remove();
    };
  } catch (err) {
    if (container?.created) container.el.remove();
    console.warn('[artubeplate] gamification widget unavailable (the game continues without it):', err);
    return noop;
  }
}
