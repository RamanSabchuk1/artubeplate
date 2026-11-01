// Baked stickers: the art is drawn flat, without its contour line or die-cut border, and the
// game adds both at load, so every piece (and anything drawn in code) gets the same line weight:
// an ink line hugging the shape, a white border around it, measured against the piece's size.
//
//   const bakery = new StickerBakery(app.renderer);
//   sprite.texture = bakery.bake(Texture.from('sym-H1'));        // ink 3%, border 5% of the piece
//
// The distance to the shape is exact (a Euclidean distance transform on the CPU, a few
// milliseconds for a 512 px piece), so the border is round and smooth. The shape itself is the
// art's alpha softened first (a small blur, then a threshold), so a jagged or aliased edge in the
// art does not print through into the line and the border; and the ink line straddles the edge,
// its inner lip drawn OVER the art, so the art's own stair-steps vanish under it. The result is a
// texture `2 × pad` larger than the source; fit it into its cell as you would the art.
//
// With `ink: 0` there is no line at all: the white border hugs the art directly, nothing dark
// between them. `wobble` lets the border swell and thin in a few slow waves along the outline, the
// way a sticker cut by hand does, instead of a rigid offset of the shape. `shadow` adds a soft dark
// halo under the whole sticker, baked in (no blur filter per sprite at run time).

import { Sprite, Texture, type Renderer } from 'pixi.js';

export interface StickerBakeOptions {
  /** The ink line's width, as a fraction of the piece's longest side. Default 0.03. 0 for none: the
   *  border then meets the art directly (no line, no dark lip over the art's edge). */
  ink?: number;
  /** The white border beyond the ink, as a fraction of the longest side. Default 0.05. 0 for none. */
  border?: number;
  /** Default 0x0b0c10. */
  inkColor?: number;
  /** Default 0xffffff. */
  borderColor?: number;
  /** Alpha (0..1) from which a pixel counts as part of the shape. Default 0.5. */
  threshold?: number;
  /** Multiply the art by this colour before baking (a tinted cap): the border stays white. */
  tint?: number;
  /**
   * How far the shape's edge is softened before the line and the border are measured, in
   * pixels (a blur of the alpha, then the threshold). Default 0.6 % of the longest side (3 px
   * on a 512 px piece): enough to take the stair-steps out of an aliased edge, not enough to
   * round a corner that was drawn. 0 keeps the alpha as it is.
   */
  smooth?: number;
  /**
   * How much the border's width wanders along the outline, as a share of it: 0.3 swells and thins
   * it by up to 30 % in a few slow waves around the piece, like a sticker cut by hand. Default 0
   * (a constant width).
   */
  wobble?: number;
  /** The seed of the wobble's waves (the same seed, the same cut). Default: from the art's size. */
  seed?: number;
  /**
   * A soft shadow under the whole sticker (art and border): its blur as a fraction of the longest
   * side. 0.025 is a soft halo that lifts a piece off a dark board. Default 0 (none).
   */
  shadow?: number;
  /** The shadow's opacity, 0..1. Default 0.6. */
  shadowAlpha?: number;
  /** Where the shadow falls, as fractions of the longest side. Default [0.01, 0.02] (down a little). */
  shadowOffset?: [number, number];
  /** Default 0x000000. */
  shadowColor?: number;
}

/** A sticker's shadow, in pixels: see {@link stickerLayers}. */
export interface StickerShadow {
  blur: number;
  dx: number;
  dy: number;
  alpha: number;
  color: number;
}

const INF = 1e20;

/** Felzenszwalb & Huttenlocher's 1D squared distance transform of `f` into `d`. */
function edt1d(f: Float32Array, d: Float32Array, v: Int32Array, z: Float32Array, n: number): void {
  let k = 0;
  v[0] = 0;
  z[0] = -INF;
  z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    while (s <= z[k]!) {
      k--;
      s = (f[q]! + q * q - (f[v[k]!]! + v[k]! * v[k]!)) / (2 * q - 2 * v[k]!);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1]! < q) k++;
    d[q] = (q - v[k]!) * (q - v[k]!) + f[v[k]!]!;
  }
}

/** Squared distance from every cell to the nearest `inside` cell (0 where inside). */
export function distanceTransform(inside: Uint8Array, width: number, height: number): Float32Array {
  const grid = new Float32Array(width * height);
  for (let i = 0; i < grid.length; i++) grid[i] = inside[i] ? 0 : INF;
  const n = Math.max(width, height);
  const f = new Float32Array(n);
  const d = new Float32Array(n);
  const v = new Int32Array(n);
  const z = new Float32Array(n + 1);
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = grid[y * width + x]!;
    edt1d(f, d, v, z, height);
    for (let y = 0; y < height; y++) grid[y * width + x] = d[y]!;
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = grid[y * width + x]!;
    edt1d(f, d, v, z, width);
    for (let x = 0; x < width; x++) grid[y * width + x] = d[x]!;
  }
  return grid;
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/**
 * A box blur run three times (close to a Gaussian) over a field, radius `r` px, the edges
 * extended. Pure; returns `src` itself when `r` rounds to 0.
 */
export function blurField(src: Float32Array, width: number, height: number, r: number): Float32Array {
  const rad = Math.max(0, Math.round(r));
  if (rad === 0) return src;
  const n = width * height;
  const span = 2 * rad + 1;
  let cur: Float32Array = src;
  let out: Float32Array = new Float32Array(n);
  const spare: Float32Array = new Float32Array(n);
  const tmp = new Float32Array(n);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < height; y++) {
      const row = y * width;
      let sum = 0;
      for (let x = -rad; x <= rad; x++) sum += cur[row + Math.min(width - 1, Math.max(0, x))]!;
      for (let x = 0; x < width; x++) {
        tmp[row + x] = sum / span;
        sum += cur[row + Math.min(width - 1, x + rad + 1)]! - cur[row + Math.max(0, x - rad)]!;
      }
    }
    for (let x = 0; x < width; x++) {
      let sum = 0;
      for (let y = -rad; y <= rad; y++) sum += tmp[Math.min(height - 1, Math.max(0, y)) * width + x]!;
      for (let y = 0; y < height; y++) {
        out[y * width + x] = sum / span;
        sum += tmp[Math.min(height - 1, y + rad + 1) * width + x]! - tmp[Math.max(0, y - rad) * width + x]!;
      }
    }
    // The result is the next pass's input; the old input (never `src`) is the next output.
    const prev = cur;
    cur = out;
    out = prev === src ? spare : prev;
  }
  return cur;
}

/** A lattice value in -1..1 for (i, j) and a seed: a small integer hash. */
function lattice(i: number, j: number, seed: number): number {
  let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2246822519)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return ((h >>> 0) / 4294967295) * 2 - 1;
}

/**
 * Smooth value noise over a W × H grid, -1..1, about `waves` bumps across the longer side: the
 * lattice values eased between with a smoothstep (no creases). Pure.
 */
export function wobbleField(width: number, height: number, waves: number, seed: number): Float32Array {
  const out = new Float32Array(width * height);
  const cell = Math.max(1, Math.max(width, height) / Math.max(1, waves));
  for (let y = 0; y < height; y++) {
    const fy = y / cell;
    const j = Math.floor(fy);
    const ty = fy - j;
    const sy = ty * ty * (3 - 2 * ty);
    for (let x = 0; x < width; x++) {
      const fx = x / cell;
      const i = Math.floor(fx);
      const tx = fx - i;
      const sx = tx * tx * (3 - 2 * tx);
      const a = lattice(i, j, seed);
      const b = lattice(i + 1, j, seed);
      const c = lattice(i, j + 1, seed);
      const d = lattice(i + 1, j + 1, seed);
      out[y * width + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
    }
  }
  return out;
}

/** The two layers of a sticker around a piece: see {@link stickerLayers}. */
export interface StickerLayers {
  /** Under the art: the white border, and the ink filling the softened shape (so a gap in the art shows ink, not the backdrop). */
  under: ImageData;
  /** Over the art: the ink line straddling the softened edge, its inner lip covering the art's own edge. */
  over: ImageData;
}

/**
 * The sticker's layers for a piece whose alpha is `alpha` (0..1, width × height, row-major),
 * drawn `pad` larger on every side: the shape is the alpha softened by `smooth` px and cut at
 * `threshold`; the border is `borderRadius` out from it with a soft edge, the ink `inkRadius`
 * out from it plus a lip of about two pixels inside it. With `inkRadius` 0 there is no ink at
 * all: no lip, and the shape is filled with the border colour. `wobble` (0..1) swells and thins
 * the border's width (beyond the ink) by up to that share in slow waves, seeded by `seed`; `pad`
 * must take the widest of it. `shadow` puts a blurred, offset copy of the whole sticker's shape
 * under the border (`pad` must take its blur and offset too). Pure: compose `under`, the art, `over`.
 */
export function stickerLayers(alpha: Float32Array, width: number, height: number, pad: number, inkRadius: number, borderRadius: number, smooth: number, threshold: number, inkColor: number, borderColor: number, wobble = 0, seed = 0, shadow: StickerShadow | null = null): StickerLayers {
  const W = width + pad * 2;
  const H = height + pad * 2;
  const field = new Float32Array(W * H);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) field[(y + pad) * W + x + pad] = alpha[y * width + x]!;
  const soft = blurField(field, W, H, smooth);
  const inside = new Uint8Array(W * H);
  for (let i = 0; i < inside.length; i++) inside[i] = soft[i]! >= threshold ? 1 : 0;
  const dist2 = distanceTransform(inside, W, H);
  const under = new ImageData(W, H);
  const over = new ImageData(W, H);
  const u = under.data;
  const o = over.data;
  const ir = (inkColor >> 16) & 255;
  const ig = (inkColor >> 8) & 255;
  const ib = inkColor & 255;
  const br = (borderColor >> 16) & 255;
  const bg = (borderColor >> 8) & 255;
  const bb = borderColor & 255;
  // The lip: full ink at the softened edge (the field at the threshold), gone a couple of pixels in.
  const lipFrom = threshold;
  const lipTo = Math.min(1, threshold + 0.22);
  const inked = inkRadius > 0;
  // The border's own width (beyond the ink), and its waves when it wobbles.
  const band = Math.max(0, borderRadius - inkRadius);
  const waves = wobble > 0 ? wobbleField(W, H, 3.2, seed) : null;
  for (let i = 0; i < W * H; i++) {
    const k = i * 4;
    if (inside[i]) {
      // A gap in the art shows the ink (or the border, when there is no ink), never the backdrop.
      u[k] = inked ? ir : br;
      u[k + 1] = inked ? ig : bg;
      u[k + 2] = inked ? ib : bb;
      u[k + 3] = 255;
      const lip = inked ? clamp01((lipTo - soft[i]!) / (lipTo - lipFrom)) : 0;
      if (lip > 0) {
        o[k] = ir;
        o[k + 1] = ig;
        o[k + 2] = ib;
        o[k + 3] = Math.round(lip * 255);
      }
      continue;
    }
    const d = Math.sqrt(dist2[i]!) - 0.5;
    const reach = waves ? inkRadius + band * (1 + wobble * waves[i]!) : borderRadius;
    const border = clamp01((reach - d) / 1.5 + 0.5);
    if (border > 0) {
      u[k] = br;
      u[k + 1] = bg;
      u[k + 2] = bb;
      u[k + 3] = Math.round(border * 255);
    }
    const ink = inked ? clamp01(inkRadius - d) : 0;
    if (ink > 0) {
      o[k] = ir;
      o[k + 1] = ig;
      o[k + 2] = ib;
      o[k + 3] = Math.round(ink * 255);
    }
  }
  if (shadow && shadow.alpha > 0) {
    // The whole sticker's shape (the art's and the border's coverage), moved and blurred, then put
    // under what is drawn: the border stays on top, the shadow shows only around it.
    const shape = new Float32Array(W * H);
    const dx = Math.round(shadow.dx);
    const dy = Math.round(shadow.dy);
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const sx = x - dx;
        const sy = y - dy;
        if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
        shape[y * W + x] = u[(sy * W + sx) * 4 + 3]! / 255;
      }
    const soft = blurField(shape, W, H, shadow.blur);
    const sr = (shadow.color >> 16) & 255;
    const sg = (shadow.color >> 8) & 255;
    const sb = shadow.color & 255;
    for (let i = 0; i < W * H; i++) {
      const sa = clamp01(soft[i]!) * shadow.alpha;
      if (sa <= 0) continue;
      const k = i * 4;
      const ba = u[k + 3]! / 255;
      if (ba >= 1) continue;
      const a = ba + sa * (1 - ba);
      u[k] = Math.round((u[k]! * ba + sr * sa * (1 - ba)) / a);
      u[k + 1] = Math.round((u[k + 1]! * ba + sg * sa * (1 - ba)) / a);
      u[k + 2] = Math.round((u[k + 2]! * ba + sb * sa * (1 - ba)) / a);
      u[k + 3] = Math.round(a * 255);
    }
  }
  return { under, over };
}

/**
 * The ink and border underlay for a piece whose alpha is `alpha` (width × height, row-major),
 * drawn into a canvas `pad` larger on every side. Pure: the drawing of the art on top is the
 * caller's. The older, one-layer bake; {@link stickerLayers} is what `bakeSticker` draws with.
 */
export function stickerUnderlay(alpha: Uint8ClampedArray, width: number, height: number, pad: number, inkRadius: number, borderRadius: number, threshold: number, inkColor: number, borderColor: number): ImageData {
  const W = width + pad * 2;
  const H = height + pad * 2;
  const inside = new Uint8Array(W * H);
  const cut = Math.round(threshold * 255);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) inside[(y + pad) * W + x + pad] = alpha[y * width + x]! >= cut ? 1 : 0;
  const dist2 = distanceTransform(inside, W, H);
  const out = new ImageData(W, H);
  const px = out.data;
  const ir = (inkColor >> 16) & 255;
  const ig = (inkColor >> 8) & 255;
  const ib = inkColor & 255;
  const br = (borderColor >> 16) & 255;
  const bg = (borderColor >> 8) & 255;
  const bb = borderColor & 255;
  for (let i = 0; i < W * H; i++) {
    const d = Math.sqrt(dist2[i]!) - 0.5;
    const border = Math.min(1, Math.max(0, borderRadius - d));
    const ink = Math.min(1, Math.max(0, inkRadius - d));
    if (border <= 0 && ink <= 0) continue;
    // Ink over the border: straight alpha compositing of two flat colours.
    const a = ink + border * (1 - ink);
    const o = i * 4;
    px[o] = Math.round((ir * ink + br * border * (1 - ink)) / a);
    px[o + 1] = Math.round((ig * ink + bg * border * (1 - ink)) / a);
    px[o + 2] = Math.round((ib * ink + bb * border * (1 - ink)) / a);
    px[o + 3] = Math.round(a * 255);
  }
  return out;
}

/** Bakes stickers and remembers them, so the same art is only ever baked once per setting. */
export class StickerBakery {
  private readonly cache = new Map<string, Texture>();

  constructor(
    private readonly renderer: Renderer,
    private readonly defaults: StickerBakeOptions = {},
  ) {}

  /** The sticker for `source`: the art with its ink line and border. */
  bake(source: Texture, opts: StickerBakeOptions = {}): Texture {
    const o = { ...this.defaults, ...opts };
    const key = `${source.uid}:${o.ink ?? 0.03}:${o.border ?? 0.05}:${o.inkColor ?? 0x0b0c10}:${o.borderColor ?? 0xffffff}:${o.threshold ?? 0.5}:${o.tint ?? ''}:${o.smooth ?? ''}:${o.wobble ?? 0}:${o.seed ?? ''}:${o.shadow ?? 0}:${o.shadowAlpha ?? ''}:${o.shadowOffset?.join(',') ?? ''}:${o.shadowColor ?? ''}`;
    const hit = this.cache.get(key);
    if (hit && !hit.destroyed) return hit;
    const baked = bakeSticker(this.renderer, source, o);
    this.cache.set(key, baked);
    return baked;
  }

  /** Forget and free every baked texture (a theme change, a teardown). */
  clear(): void {
    for (const t of this.cache.values()) t.destroy(true);
    this.cache.clear();
  }
}

type Drawable = CanvasImageSource & { width: number; height: number };
const css = (rgb: number): string => `#${rgb.toString(16).padStart(6, '0')}`;

/**
 * The art's pixels at its own size, as a 2D canvas. An atlas frame or an image is drawn straight
 * from its source (no GPU readback); a render texture (a tinted copy, a snapshot) is read back
 * through the renderer. `tint` multiplies the colour, keeping the alpha.
 */
function artCanvas(renderer: Renderer, source: Texture, tint?: number): HTMLCanvasElement {
  const res = source.source.resource as Drawable | undefined;
  const rotate = source.rotate; // groupD8: 0 as drawn, 2 the packer's quarter turn, 6 the other way
  const direct = !!res && (rotate === 0 || rotate === 2 || rotate === 6) && (res instanceof HTMLCanvasElement || res instanceof HTMLImageElement || (typeof ImageBitmap !== 'undefined' && res instanceof ImageBitmap) || (typeof OffscreenCanvas !== 'undefined' && res instanceof OffscreenCanvas));
  let art: HTMLCanvasElement;
  if (direct) {
    // The frame's pixels at the piece's original size: a trimmed frame goes back where the
    // packer cut it from, a rotated one is turned back, so the piece keeps its centre.
    const f = source.frame;
    const k = source.source.resolution || 1;
    const trim = source.trim;
    const dx = trim ? trim.x : 0;
    const dy = trim ? trim.y : 0;
    art = document.createElement('canvas');
    art.width = Math.max(1, Math.round(source.orig.width));
    art.height = Math.max(1, Math.round(source.orig.height));
    // Read back on the CPU: the browser keeps the canvas in memory instead of on the GPU.
    const ctx = art.getContext('2d', { willReadFrequently: true })!;
    ctx.save();
    if (rotate === 2) {
      ctx.translate(dx, dy + f.width);
      ctx.rotate(-Math.PI / 2);
    } else if (rotate === 6) {
      ctx.translate(dx + f.height, dy);
      ctx.rotate(Math.PI / 2);
    } else {
      ctx.translate(dx, dy);
    }
    ctx.drawImage(res, f.x * k, f.y * k, f.width * k, f.height * k, 0, 0, f.width, f.height);
    ctx.restore();
  } else {
    const sprite = new Sprite(source);
    art = renderer.extract.canvas({ target: sprite, resolution: 1 }) as HTMLCanvasElement;
    sprite.destroy();
  }
  if (tint !== undefined) {
    const ctx = art.getContext('2d')!;
    const alpha = document.createElement('canvas');
    alpha.width = art.width;
    alpha.height = art.height;
    alpha.getContext('2d', { willReadFrequently: true })!.drawImage(art, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = css(tint);
    ctx.fillRect(0, 0, art.width, art.height);
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(alpha, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
  }
  return art;
}

/**
 * Bake one sticker: the art with an ink line and a white border around its softened shape, the
 * line's inner lip over the art's edge.
 */
export function bakeSticker(renderer: Renderer, source: Texture, opts: StickerBakeOptions = {}): Texture {
  const ink = opts.ink ?? 0.03;
  const border = opts.border ?? 0.05;
  const longest = Math.max(source.width, source.height);
  const inkRadius = ink * longest;
  const borderRadius = inkRadius + border * longest;
  const smooth = opts.smooth ?? Math.max(1, 0.006 * longest);
  const wobble = Math.max(0, Math.min(1, opts.wobble ?? 0));
  const blur = Math.max(0, (opts.shadow ?? 0) * longest);
  const [ox, oy] = opts.shadowOffset ?? [0.01, 0.02];
  const shadow: StickerShadow | null = blur > 0 ? { blur, dx: ox * longest, dy: oy * longest, alpha: opts.shadowAlpha ?? 0.6, color: opts.shadowColor ?? 0x000000 } : null;
  const pad = Math.ceil(inkRadius + border * longest * (1 + wobble) + (shadow ? blur * 2 + Math.max(Math.abs(shadow.dx), Math.abs(shadow.dy)) : 0)) + 2;
  const art = artCanvas(renderer, source, opts.tint);
  const width = art.width;
  const height = art.height;
  const artCtx = art.getContext('2d')!;
  const data = artCtx.getImageData(0, 0, width, height).data;
  const alpha = new Float32Array(width * height);
  for (let i = 0; i < alpha.length; i++) alpha[i] = data[i * 4 + 3]! / 255;
  const seed = opts.seed ?? (Math.imul(width, 73856093) ^ Math.imul(height, 19349663));
  const layers = stickerLayers(alpha, width, height, pad, inkRadius, borderRadius, smooth, opts.threshold ?? 0.5, opts.inkColor ?? 0x0b0c10, opts.borderColor ?? 0xffffff, wobble, seed, shadow);
  const out = document.createElement('canvas');
  out.width = layers.under.width;
  out.height = layers.under.height;
  const ctx = out.getContext('2d')!;
  ctx.putImageData(layers.under, 0, 0);
  ctx.drawImage(art, pad, pad);
  // putImageData replaces pixels, so the over layer goes through a canvas to composite.
  const over = document.createElement('canvas');
  over.width = layers.over.width;
  over.height = layers.over.height;
  over.getContext('2d')!.putImageData(layers.over, 0, 0);
  ctx.drawImage(over, 0, 0);
  const texture = Texture.from(out);
  texture.label = `${source.label ?? 'art'}@sticker`;
  return texture;
}
