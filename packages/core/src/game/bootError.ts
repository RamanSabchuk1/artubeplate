// The screen that can appear before the HUD exists: a boot that failed (the session is over, no
// connection, no session, the math could not be read). It wears the HUD's own dialog: the same
// markup and the same skin as every notice in play, so a failed boot looks like the game
// ("SESSION ENDED", a RELOAD bar), never like a separate error page. Blocking, and it always says
// what to do. While the first connection is tried again, the loader alone is on screen.

import { artubeplateSkinCss } from '../skin';

export interface BootErrorOptions {
  title: string;
  message: string;
  /**
   * Technical detail, in small print under the message. For developer cases (the mock's math, a
   * launch URL with no session); an RGS failure goes to the console instead.
   */
  detail?: string;
  /** Show RELOAD (default true). */
  reload?: boolean;
}

export interface BootScreen {
  /** The boot failed: the dialog, with RELOAD unless `reload: false`. */
  error(opts: BootErrorOptions): HTMLElement;
  /** Take the screen away (the boot goes on). */
  remove(): void;
}

const STYLE_ID = 'artubeplate-boot-skin';

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * The boot's own screen, drawn only when the boot fails. `font` is the game's HUD font family when
 * its theme sets one.
 */
export function bootScreen(host: HTMLElement = document.body, opts: { font?: string } = {}): BootScreen {
  let root: HTMLElement | null = null;
  let style: HTMLStyleElement | null = null;
  const shell = (): HTMLElement => {
    if (!style && !document.getElementById(STYLE_ID)) {
      style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = artubeplateSkinCss;
      document.head.appendChild(style);
    }
    if (!root) {
      root = document.createElement('div');
      // The HUD's root class: the skin dresses everything under it. Over the Artube loader (9999).
      root.className = 'OpenSlotUiContainer artubeplate-boot';
      root.style.zIndex = '100000';
      if (opts.font) root.style.setProperty('--ohm-font', opts.font);
      host.appendChild(root);
    }
    return root;
  };
  const paint = (html: string): HTMLElement => {
    const r = shell();
    r.innerHTML = `<div id="DialogWindow" class="DialogWindow is-visible"><div class="Overlay"></div>${html}</div>`;
    return r;
  };
  return {
    error(o) {
      const r = paint(
        `<div class="Dialog Dialog--info-msg" role="alertdialog" aria-modal="true" aria-labelledby="BootDialogTitle"><div class="Dialog__wrapper">
          <div class="Dialog__title" id="BootDialogTitle">${esc(o.title)}</div>
          <div class="Dialog__body"><div class="Dialog__body-inner"><p>${esc(o.message)}</p>${o.detail ? `<p class="Dialog__detail">${esc(o.detail)}</p>` : ''}</div></div>
          <div class="Dialog__footer"><div class="Dialog__button-group">${o.reload !== false ? '<button type="button" class="Button Button--primary Dialog__action" data-action="reload">Reload</button>' : ''}</div></div>
        </div></div>`,
      );
      r.querySelector('[data-action="reload"]')?.addEventListener('click', () => location.reload());
      return r;
    },
    remove() {
      root?.remove();
      style?.remove();
      root = null;
      style = null;
    },
  };
}

/** The boot failed: show it in the HUD's dialog (see {@link bootScreen}). */
export function showBootError(opts: BootErrorOptions, host: HTMLElement = document.body): HTMLElement {
  return bootScreen(host).error(opts);
}
