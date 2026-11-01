// SceneContainer: a Scene that IS a pixi Container. Subclass it, add your Sprites and Texts, lay
// them out in a design frame (1920×1080 by default, like most slot art) and override the hooks
// you need — `intro`/`outro` get a GSAP timeline, so the choreography of a screen lives with it.
//
//   class InfoScreen extends SceneContainer {
//     constructor() { super('info'); this.addChild(this.cardA, this.cardB, this.prompt); }
//     layout(fit: Fit) { place(this.cardA, fit, 700, 618); place(this.cardB, fit, 1220, 618); }
//     intro(tl: gsap.core.Timeline) { popIn(tl, [this.cardA, this.cardB]); tl.add(fadeIn(this.prompt), '+=0.3'); }
//     outro(tl: gsap.core.Timeline) { tl.to([this.cardA, this.cardB, this.prompt], { alpha: 0, duration: 0.34 }); }
//   }

import { Container } from 'pixi.js';
import { gsap } from 'gsap';
import type { Scene } from './types';
import { fitDesign, type DesignFrame, type Fit } from './fit';

export { fitDesign, type DesignFrame, type Fit };

/** Put `obj` at a design-frame point, scaled with the frame (times `scale`). */
export function place(obj: Container, fit: Fit, x: number, y: number, scale = 1): void {
  const p = fit.toScreen(x, y);
  obj.position.set(p.x, p.y);
  obj.scale.set(fit.scale * scale);
}

export class SceneContainer extends Container implements Scene {
  readonly view: Container = this;
  /** The frame `layout` works in. Set it in the subclass constructor (e.g. a portrait frame). */
  design: DesignFrame = { width: 1920, height: 1080 };
  /** Fit mode for the design frame. */
  fitMode: 'contain' | 'cover' = 'contain';
  /** The current fit (updated before every `layout`). */
  fit: Fit;

  constructor(readonly id: string) {
    super({ label: `scene:${id}` });
    this.fit = fitDesign(this.design.width, this.design.height, this.design);
  }

  resize(width: number, height: number): void {
    this.fit = fitDesign(width, height, this.design, this.fitMode);
    this.layout(this.fit);
  }

  /** Place the children for this fit. Called on every resize and before each entry. */
  layout(_fit: Fit): void {}

  // Add any Scene hook you need — enter, entered, leave, left, update, intro(tl), outro(tl) —
  // as a plain method; the director calls whichever exist.
}

// ── timeline helpers: the moves intro screens are made of ─────────────────────
// Each adds tweens to `tl` at `at` (seconds, or a GSAP position like '<' or '+=0.2') and returns it.

/** Cards spinning in: scale up from nothing with a back-out, unwinding `turn` radians, staggered. */
export function popIn(tl: gsap.core.Timeline, targets: Container[], opts: { at?: number | string; stagger?: number; duration?: number; turn?: number } = {}): gsap.core.Timeline {
  const at = opts.at ?? 0;
  const d = opts.duration ?? 0.55;
  targets.forEach((t, i) => {
    const pos = typeof at === 'number' ? at + i * (opts.stagger ?? 0.12) : i === 0 ? at : `<${opts.stagger ?? 0.12}`;
    const sx = t.scale.x;
    const sy = t.scale.y;
    tl.fromTo(t.scale, { x: 0, y: 0 }, { x: sx, y: sy, duration: d, ease: 'back.out(1.7)' }, pos);
    tl.fromTo(t, { rotation: opts.turn ?? -0.55, alpha: 0 }, { rotation: 0, alpha: 1, duration: d, ease: 'back.out(1.7)', immediateRender: true }, '<');
  });
  return tl;
}

/** Drop in from above (`distance` in the target's parent units) with a back-out. */
export function dropIn(tl: gsap.core.Timeline, targets: Container | Container[], opts: { at?: number | string; distance?: number; duration?: number } = {}): gsap.core.Timeline {
  return tl.from(targets, { y: `-=${opts.distance ?? 260}`, alpha: 0, duration: opts.duration ?? 0.6, ease: 'back.out(1.4)' }, opts.at ?? 0);
}

/** Fade in. */
export function fadeIn(tl: gsap.core.Timeline, targets: Container | Container[], opts: { at?: number | string; duration?: number } = {}): gsap.core.Timeline {
  return tl.fromTo(targets, { alpha: 0 }, { alpha: 1, duration: opts.duration ?? 0.5, ease: 'none' }, opts.at ?? 0);
}

/** Fade out (the default exit of an intro screen). */
export function fadeOut(tl: gsap.core.Timeline, targets: Container | Container[], opts: { at?: number | string; duration?: number } = {}): gsap.core.Timeline {
  return tl.to(targets, { alpha: 0, duration: opts.duration ?? 0.34, ease: 'power3.out' }, opts.at ?? 0);
}

/** Scale in from nothing around the target's pivot (a board revealing itself). */
export function scaleIn(tl: gsap.core.Timeline, target: Container, opts: { at?: number | string; duration?: number } = {}): gsap.core.Timeline {
  const sx = target.scale.x;
  const sy = target.scale.y;
  tl.fromTo(target.scale, { x: 0, y: 0 }, { x: sx, y: sy, duration: opts.duration ?? 0.5, ease: 'back.out(1.7)' }, opts.at ?? 0);
  return tl.fromTo(target, { alpha: 0 }, { alpha: 1, duration: (opts.duration ?? 0.5) * 0.5, ease: 'none' }, '<');
}

export { gsap };
