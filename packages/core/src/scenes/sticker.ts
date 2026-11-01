// The sticker slap: a piece of the scene (the board with its frame, a card, a plaque) arrives
// like a sticker pressed onto the wall. Its picture is a flexible sheet: four corners that move
// freely, mapped bilinearly over a grid, plus a `bow` that bulges the middle toward the viewer.
// It comes in large and tilted, hits the surface, presses flat with a short overshoot and settles
// with a wobble (our wow, wait, decrease).
//
//   await stickerSlap(scene.board, { renderer: app.renderer, speed: turbo.speed });
//
// `stickerSlap` snapshots the target into a texture, hides it, plays the slap on a StickerQuad in
// its place and shows the real thing again. StickerQuad is also usable on its own, for a sticker
// that peels or flaps. No library: a MeshGeometry grid is enough for a sheet that bends; pixi's
// own PerspectiveMesh would give a rigid (projective) plane instead.

import { Container, Mesh, MeshGeometry, Rectangle, type Renderer, type Texture } from 'pixi.js';
import { gsap } from 'gsap';

/** Four corners, clockwise from the top-left, in the quad's local space. */
export interface QuadCorners {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  x3: number;
  y3: number;
}

/** The corners of a flat rectangle. */
export function rectCorners(x: number, y: number, width: number, height: number): QuadCorners {
  return { x0: x, y0: y, x1: x + width, y1: y, x2: x + width, y2: y + height, x3: x, y3: y + height };
}

/** `a` moved `t` of the way to `b`, corner by corner. */
export function lerpCorners(a: QuadCorners, b: QuadCorners, t: number, out: QuadCorners = { ...a }): QuadCorners {
  for (const k of Object.keys(a) as Array<keyof QuadCorners>) out[k] = a[k] + (b[k] - a[k]) * t;
  return out;
}

/**
 * The grid's vertex positions: every point interpolated bilinearly between the corners, then
 * pushed away from the quad's centre by `bow × w`, where w is 1 at the centre, 0.5 in the middle
 * of an edge and 0 at the corners. So the sheet bulges like a convex pillow (bow > 0) or dents
 * (bow < 0) while the corners stay put. `out` holds nx × ny points as x, y pairs.
 */
export function stickerGrid(q: QuadCorners, nx: number, ny: number, bow: number, out: Float32Array): Float32Array {
  const cx = (q.x0 + q.x1 + q.x2 + q.x3) / 4;
  const cy = (q.y0 + q.y1 + q.y2 + q.y3) / 4;
  let i = 0;
  for (let row = 0; row < ny; row++) {
    const v = ny > 1 ? row / (ny - 1) : 0;
    const dv = (2 * v - 1) * (2 * v - 1);
    for (let col = 0; col < nx; col++) {
      const u = nx > 1 ? col / (nx - 1) : 0;
      const du = (2 * u - 1) * (2 * u - 1);
      const top = { x: q.x0 + (q.x1 - q.x0) * u, y: q.y0 + (q.y1 - q.y0) * u };
      const bottom = { x: q.x3 + (q.x2 - q.x3) * u, y: q.y3 + (q.y2 - q.y3) * u };
      const px = top.x + (bottom.x - top.x) * v;
      const py = top.y + (bottom.y - top.y) * v;
      const k = 1 + bow * Math.max(0, 1 - (du + dv) / 2);
      out[i++] = cx + (px - cx) * k;
      out[i++] = cy + (py - cy) * k;
    }
  }
  return out;
}

export interface StickerQuadOptions {
  texture: Texture;
  /** Grid density per side. Default 14. */
  segments?: number;
  /** Where the sticker lies when flat. Default: the texture's rectangle at the origin. */
  flat?: QuadCorners;
}

/** A textured sheet with movable corners and a bulge. */
export class StickerQuad extends Mesh {
  private readonly nx: number;
  private readonly ny: number;
  private readonly corners: QuadCorners;
  private bowValue = 0;

  constructor(opts: StickerQuadOptions) {
    const n = Math.max(2, Math.round(opts.segments ?? 14));
    const flat = opts.flat ?? rectCorners(0, 0, opts.texture.width, opts.texture.height);
    const positions = stickerGrid(flat, n, n, 0, new Float32Array(n * n * 2));
    const uvs = new Float32Array(n * n * 2);
    const indices = new Uint32Array((n - 1) * (n - 1) * 6);
    let u = 0;
    for (let row = 0; row < n; row++) for (let col = 0; col < n; col++) (uvs[u++] = col / (n - 1)), (uvs[u++] = row / (n - 1));
    let t = 0;
    for (let row = 0; row < n - 1; row++) {
      for (let col = 0; col < n - 1; col++) {
        const a = row * n + col;
        const b = a + 1;
        const c = a + n;
        const d = c + 1;
        indices[t++] = a;
        indices[t++] = b;
        indices[t++] = c;
        indices[t++] = b;
        indices[t++] = d;
        indices[t++] = c;
      }
    }
    super({ geometry: new MeshGeometry({ positions, uvs, indices }), texture: opts.texture });
    this.label = 'sticker-quad';
    this.nx = n;
    this.ny = n;
    this.corners = { ...flat };
  }

  /** The middle's bulge: 0 flat, 0.3 a pillow, negative a dent. */
  get bow(): number {
    return this.bowValue;
  }
  set bow(value: number) {
    this.bowValue = value;
    this.refresh();
  }

  /** Move the corners (and keep the bow). */
  setCorners(corners: QuadCorners): void {
    Object.assign(this.corners, corners);
    this.refresh();
  }

  private refresh(): void {
    stickerGrid(this.corners, this.nx, this.ny, this.bowValue, this.geometry.positions);
    this.geometry.getBuffer('aPosition').update();
  }
}

export interface StickerSlapOptions {
  /** Renders the snapshot of the target. */
  renderer: Renderer;
  /** Where the sheet draws. Default: the target's parent, at the target's index. */
  layer?: Container;
  /** The turbo speed: the approach shortens with it; the impact and the settle keep their time. */
  speed?: number;
  /** How large it starts, as a multiple of its flat size. Default 1.3. */
  scale?: number;
  /** How far the top edge leans toward the viewer at the start (0..1). Default 0.22. */
  tilt?: number;
  /** The bulge while it flies in. Default 0.28. */
  bow?: number;
  /** Grid density per side. Default 14. */
  segments?: number;
  /** The frame of the hit, for a sound or a camera nudge. */
  onImpact?: () => void;
}

const FPS = 60;
const frames = (n: number, speed = 1): number => (n / FPS) * speed;
/** The previous slap's snapshot, freed when the next one starts. */
let lastSnapshot: Texture | null = null;
/** The last sheet's geometry, freed with its snapshot (see below). */
let lastGeometry: MeshGeometry | null = null;

/**
 * Press `target` onto the scene like a sticker. Resolves when it has settled flat and the real
 * target is showing again. The target must be in the scene graph and have a size.
 */
export async function stickerSlap(target: Container, opts: StickerSlapOptions): Promise<void> {
  const parent = target.parent;
  if (!parent) return;
  const bounds = target.getLocalBounds();
  if (!(bounds.width > 0 && bounds.height > 0)) return;
  const rect = new Rectangle(bounds.minX, bounds.minY, bounds.width, bounds.height);
  lastSnapshot?.destroy(true);
  lastSnapshot = null;
  lastGeometry?.destroy();
  lastGeometry = null;
  const texture = opts.renderer.generateTexture({ target, frame: rect, resolution: opts.renderer.resolution, antialias: true });
  target.visible = false;

  const flat = rectCorners(rect.x, rect.y, rect.width, rect.height);
  const sheet = new StickerQuad({ texture, segments: opts.segments, flat });
  const layer = opts.layer ?? parent;
  sheet.position.copyFrom(target.position);
  sheet.scale.copyFrom(target.scale);
  sheet.pivot.copyFrom(target.pivot);
  sheet.rotation = target.rotation;
  sheet.alpha = 0;
  if (layer === parent) layer.addChildAt(sheet, parent.getChildIndex(target));
  else layer.addChild(sheet);

  // The start pose: larger, the top edge leaning out (hinged near the bottom), bulging.
  const s = opts.scale ?? 1.3;
  const tilt = opts.tilt ?? 0.22;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const grow = (x: number, y: number, k: number): [number, number] => [cx + (x - cx) * k, cy + (y - cy) * k];
  const [ax, ay] = grow(flat.x0, flat.y0, s * (1 + tilt));
  const [bx, by] = grow(flat.x1, flat.y1, s * (1 + tilt));
  const [dx, dy] = grow(flat.x2, flat.y2, s * (1 - tilt * 0.35));
  const [ex, ey] = grow(flat.x3, flat.y3, s * (1 - tilt * 0.35));
  const lift = rect.height * tilt * 0.6;
  const start: QuadCorners = { x0: ax, y0: ay - lift, x1: bx, y1: by - lift, x2: dx, y2: dy, x3: ex, y3: ey };
  const pose = { t: 0, press: 0 };
  const startBow = opts.bow ?? 0.28;
  const current: QuadCorners = { ...start };
  const apply = (): void => {
    lerpCorners(start, flat, pose.t, current);
    // The press: a short dent and a squeeze as it hits, released by the wobble.
    const k = 1 - 0.03 * pose.press;
    const pressed: QuadCorners = { ...current };
    for (const key of ['x0', 'x1', 'x2', 'x3'] as const) pressed[key] = cx + (current[key] - cx) * k;
    for (const key of ['y0', 'y1', 'y2', 'y3'] as const) pressed[key] = cy + (current[key] - cy) * k;
    sheet.bow = startBow * (1 - pose.t) - 0.12 * pose.press;
    sheet.setCorners(pressed);
  };
  apply();

  const speed = opts.speed ?? 1;
  await new Promise<void>((resolve) => {
    gsap
      .timeline({ onComplete: resolve })
      .to(sheet, { alpha: 1, duration: frames(5, speed), ease: 'power2.out' }, 0)
      .to(pose, { t: 1, duration: frames(13, speed), ease: 'power2.in', onUpdate: apply }, 0)
      .call(() => opts.onImpact?.())
      .to(pose, { press: 1, duration: frames(5), ease: 'power2.out', onUpdate: apply })
      .to(pose, { press: 0, duration: frames(34), ease: 'elastic.out(1, 0.4)', onUpdate: apply });
  });

  target.visible = true;
  const geometry = sheet.geometry;
  sheet.destroy();
  // The snapshot (and the sheet's geometry) stay bound in the batch that drew them until the batch
  // is rebuilt, so they are freed at the next slap, long after, instead of now.
  lastSnapshot = texture;
  lastGeometry = geometry;
}
