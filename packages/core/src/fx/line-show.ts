// The win lines of a line slot, white and simple: the round's overview (every line at once as a
// bold line under the symbols) and the idle cycle's snake (a thick head tapering to a thin tail
// racing a line's zigzag from the first cell into the last, bending at every corner), with an
// optional thin trail left set along the path. gsap-driven, so a turbo speed scales it.
//
// Every fade is a group fade: a Container's alpha multiplies each stroke on its own, so while it is
// below 1 the places where strokes overlap (lines crossing, round joins, a trail meeting the next
// line) show brighter and the seams between lines show. The fades here render the lines flat
// through an AlphaFilter and fade that one image; the filter only lives while a fade runs.

import { AlphaFilter, Container, Graphics, type Filter } from 'pixi.js';
import { gsap } from 'gsap';

export interface LineCell {
  reel: number;
  row: number;
}

export interface LineStyle {
  /** The overview's line width, in the layer's units. */
  width: number;
  /** The snake's head width, its tail width, its length in cells, and its pace in units per second. */
  snake: { head: number; tail: number; length: number; speed: number };
  color: number;
}

export const LINE_STYLE: LineStyle = { width: 11, snake: { head: 16, tail: 7, length: 1.6, speed: 2400 }, color: 0xffffff };

export interface LineShowOptions {
  /** The layer the lines draw in (under the symbols). */
  layer: Container;
  /** A cell's centre, in the layer's units. */
  center: (cell: LineCell) => { x: number; y: number };
  /** The cell size in the layer's units (the snake's length is in cells). */
  cell: number;
  style?: Partial<LineStyle>;
  /** Called with a show's cells as it starts: cover them with a SilhouetteMask, play a sound. */
  onCells?: (cells: LineCell[]) => void;
}

interface Run {
  node: Container;
  tl: gsap.core.Timeline;
}

/** A filter that fades whatever it sits on as one flat image (see the note at the top). */
const flatAlpha = (alpha: number): AlphaFilter => new AlphaFilter({ alpha, resolution: 'inherit', antialias: 'inherit' });

/** Drop a fade's filter once the node is fully back (no cost while the lines just stand). */
const unfilter = (node: Container, f: AlphaFilter): void => {
  if (node.destroyed) return;
  node.filters = [];
  f.destroy();
};

/** Destroy runs' nodes with any fade filter still on them (a clear can land mid fade-in). */
const destroyRuns = (nodes: Container[]): void => {
  const filters: Filter[] = [];
  for (const n of nodes) for (const c of [n, ...n.children]) if (c.filters?.length) filters.push(...c.filters);
  // `context` frees each line's own GraphicsContext with it (pixi keeps it otherwise).
  for (const n of nodes) if (!n.destroyed) n.destroy({ children: true, context: true });
  for (const f of filters) f.destroy();
};

export class LineShow {
  private readonly runs: Run[] = [];
  private readonly style: LineStyle;

  constructor(private readonly o: LineShowOptions) {
    this.style = { ...LINE_STYLE, ...o.style, snake: { ...LINE_STYLE.snake, ...o.style?.snake } };
  }

  /**
   * Every line at once as a bold line, fading in over 120 ms × speed, and each unique cell woken
   * left to right 30 ms × speed apart through `onCell`. The lines stay until `clear`.
   */
  overview(lines: LineCell[][], opts: { speed?: number; onCell?: (cell: LineCell, i: number) => void } = {}): void {
    const speed = opts.speed ?? 1;
    const cells = lines.flat();
    this.o.onCells?.(cells);
    const node = new Container({ label: 'lines' });
    const g = new Graphics({ label: 'lines-static' });
    for (const line of lines) {
      const pts = line.map((c) => this.o.center(c));
      if (pts.length < 2) continue;
      g.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      g.stroke({ width: this.style.width, color: this.style.color, cap: 'round', join: 'round' });
    }
    node.addChild(g);
    const fade = flatAlpha(0);
    node.filters = [fade];
    this.o.layer.addChild(node);
    const tl = gsap.timeline();
    this.runs.push({ node, tl });
    tl.to(fade, { alpha: 1, duration: 0.12 * speed, ease: 'power1.out', onComplete: () => unfilter(node, fade) }, 0);
    const unique = [...new Map(cells.map((c) => [`${c.reel},${c.row}`, c])).values()].sort((a, b) => a.reel - b.reel || a.row - b.row);
    unique.forEach((c, i) => tl.call(() => opts.onCell?.(c, i), undefined, 0.04 + i * 0.03 * speed));
  }

  /**
   * The snake: from the first cell into the last at the style's pace, `onCell` as its head reaches
   * each cell. Resolves as the head reaches the last cell; the last symbol swallows the tail right
   * after. With `trail`, a thin line sets along the path as the head arrives and stays until
   * `clear` (the idle cycle: the line stays readable while its symbols wow).
   */
  run(cells: LineCell[], opts: { speed?: number; onCell?: (cell: LineCell, i: number) => void; trail?: boolean } = {}): Promise<void> {
    if (!cells.length) return Promise.resolve();
    const speed = opts.speed ?? 1;
    const { snake, width, color } = this.style;
    this.o.onCells?.(cells);
    const pts = cells.map((c) => this.o.center(c));
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y));
    const total = cum[cum.length - 1]!;
    const pointAt = (d: number): { x: number; y: number } => {
      let i = 0;
      while (i < pts.length - 2 && cum[i + 1]! < d) i++;
      const a = pts[i]!;
      const b = pts[i + 1] ?? a;
      const seg = cum[i + 1]! - cum[i]!;
      const f = seg > 0 ? Math.min(1, Math.max(0, (d - cum[i]!) / seg)) : 0;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    };
    // The path from distance `from` to `to`: its ends plus every corner between them.
    const slice = (from: number, to: number): Array<{ x: number; y: number }> => {
      const out = [pointAt(from)];
      for (let i = 1; i < pts.length - 1; i++) if (cum[i]! > from && cum[i]! < to) out.push(pts[i]!);
      out.push(pointAt(to));
      return out;
    };
    const node = new Container({ label: 'line' });
    const g = new Graphics({ label: 'snake' });
    const trail = opts.trail && pts.length > 1 ? new Graphics({ label: 'trail' }) : null;
    if (trail) {
      trail.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) trail.lineTo(p.x, p.y);
      trail.stroke({ width, color, cap: 'round', join: 'round' });
      trail.visible = false;
      node.addChild(trail);
    }
    node.addChild(g);
    this.o.layer.addChild(node);
    const length = this.o.cell * snake.length;
    const draw = (head: number, tail: number): void => {
      g.clear();
      if (head - tail < 1) {
        if (head < total) g.circle(pointAt(head).x, pointAt(head).y, snake.head / 2).fill(color);
        return;
      }
      // The taper: the span in chunks, each a touch thicker towards the head (round caps hide the seams).
      const chunks = Math.min(6, Math.max(1, Math.ceil((head - tail) / (this.o.cell * 0.35))));
      for (let k = 0; k < chunks; k++) {
        const from = tail + ((head - tail) * k) / chunks;
        const to = tail + ((head - tail) * (k + 1)) / chunks;
        const w = snake.tail + (snake.head - snake.tail) * ((k + 0.5) / chunks);
        const path = slice(from, to);
        g.moveTo(path[0]!.x, path[0]!.y);
        for (const p of path.slice(1)) g.lineTo(p.x, p.y);
        g.stroke({ width: w, color, cap: 'round', join: 'round' });
      }
    };
    draw(0, 0);
    const run = { p: 0 };
    const tl = gsap.timeline({
      onComplete: () => {
        if (trail) return; // the trail stays until clear()
        const k = this.runs.findIndex((r) => r.node === node);
        if (k >= 0) this.runs.splice(k, 1);
        node.destroy({ children: true, context: true });
      },
    });
    this.runs.push({ node, tl });
    const secs = (d: number): number => (d / snake.speed) * speed;
    tl.call(() => opts.onCell?.(cells[0]!, 0), undefined, 0.02);
    tl.to(run, { p: total + length, duration: secs(total + length), ease: 'none', onUpdate: () => draw(Math.min(run.p, total), Math.max(0, run.p - length)) }, 0);
    cells.slice(1).forEach((c, i) => tl.call(() => opts.onCell?.(c, i + 1), undefined, secs(cum[i + 1]!)));
    const arrive = secs(total);
    if (trail) {
      const fade = flatAlpha(0);
      tl.call(() => { trail.visible = true; trail.filters = [fade]; }, undefined, arrive);
      tl.to(fade, { alpha: 1, duration: 0.1 * speed, ease: 'power1.out', onComplete: () => unfilter(trail, fade) }, arrive);
    }
    return new Promise((resolve) => gsap.delayedCall(arrive, () => resolve()));
  }

  /**
   * Every line, trail and snake fades out over `fadeMs`, all together as one image: they move into
   * one group that fades through a single filter, so no crossing, join or line end shows on the
   * way out. Lines drawn after this call are not part of it.
   */
  clear(fadeMs = 200): void {
    const runs = this.runs.splice(0);
    if (!runs.length) return;
    for (const r of runs) r.tl.kill();
    const nodes = runs.map((r) => r.node);
    if (fadeMs <= 0) {
      destroyRuns(nodes);
      return;
    }
    const group = new Container({ label: 'lines-out' });
    this.o.layer.addChild(group);
    for (const n of nodes) group.addChild(n);
    const fade = flatAlpha(1);
    group.filters = [fade];
    gsap.to(fade, {
      alpha: 0,
      duration: fadeMs / 1000,
      ease: 'power1.in',
      onComplete: () => {
        destroyRuns(nodes);
        group.destroy();
        fade.destroy();
      },
    });
  }

  destroy(): void {
    const runs = this.runs.splice(0);
    for (const r of runs) r.tl.kill();
    destroyRuns(runs.map((r) => r.node));
  }
}
