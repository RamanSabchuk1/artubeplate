// The Artube loading screen — MANDATORY for every game on the platform. `@artube/loader`'s Vite
// plugin (`artubePartnerLoader()`) injects the markup into index.html at build time; this drives
// it: progress across the boot milestones, then the fade-out. If the plugin is not installed the
// controller's constructor throws — the boot then runs without it and says so in the console.

import type { LoaderPort } from '../engine/fsm';

export interface ArtubeLoaderController {
  showLoader(): void;
  updateProgress(value: number): void;
  hideLoader(): void;
}

export class GameLoader implements LoaderPort {
  private last = 0;
  private finished = false;
  constructor(private readonly ctl: ArtubeLoaderController | null) {
    this.ctl?.showLoader();
  }
  /** 0..1 — monotonic (a milestone never moves the bar backwards). */
  setProgress(p: number): void {
    const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
    if (pct <= this.last) return;
    this.last = pct;
    this.ctl?.updateProgress(pct);
  }
  async done(): Promise<void> {
    if (this.finished) return;
    this.finished = true;
    this.setProgress(1);
    await new Promise((r) => setTimeout(r, 250)); // let 100% register before the fade
    this.ctl?.hideLoader();
  }
  /** Remove it immediately (a boot error takes the screen). */
  remove(): void {
    this.finished = true;
    this.ctl?.hideLoader();
  }
}

/** Build the loader against `@artube/loader` (lazy import — the package is an optional peer). */
export async function createArtubeLoader(): Promise<GameLoader> {
  try {
    const mod = (await import('@artube/loader')) as { LoaderViewController: new () => ArtubeLoaderController };
    return new GameLoader(new mod.LoaderViewController());
  } catch (err) {
    console.warn(
      '[artubeplate] the Artube loader is not on the page — add `artubePartnerLoader()` from @artube/loader to vite.config (it is mandatory on Artube).',
      err instanceof Error ? err.message : err,
    );
    return new GameLoader(null);
  }
}
