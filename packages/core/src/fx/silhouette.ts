// A piece's silhouette with its holes filled, and an inverse mask built from silhouettes: the
// win lines of a slot draw under the symbols, and a line must pass BEHIND a symbol without
// showing through a letter's counter (a Q, an A). The mask follows each symbol's transform every
// frame, so a wowing, tilting symbol keeps covering the line.
//
// Two pixi 8 facts shaped this (seen in 8.22): `renderer.extract.pixels({ target: texture })` on a
// canvas-backed texture reads an unrendered target and returns noise, so a canvas is read straight
// and anything else is drawn as a sprite first; and a Container used as an alpha mask goes through
// a render-to-texture path that drew these sprites as solid boxes, so the mask is ONE sprite over a
// render texture this class draws itself.

import { CanvasSource, Container, Matrix, RenderTexture, Sprite, Texture, type Renderer, type Ticker } from 'pixi.js';

export interface TexturePixels {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
}

/** A texture's pixels (its frame, at its resolution). */
export function texturePixels(renderer: Renderer, texture: Texture): TexturePixels {
  const res = texture.source.resource as unknown;
  const sr = texture.source.resolution;
  if (typeof HTMLCanvasElement !== 'undefined' && res instanceof HTMLCanvasElement) {
    const ctx = res.getContext('2d');
    if (ctx) {
      const f = texture.frame;
      const img = ctx.getImageData(Math.round(f.x * sr), Math.round(f.y * sr), Math.max(1, Math.round(f.width * sr)), Math.max(1, Math.round(f.height * sr)));
      return { pixels: img.data, width: img.width, height: img.height };
    }
  }
  const sprite = new Sprite(texture);
  const out = renderer.extract.pixels({ target: sprite, resolution: sr });
  sprite.destroy();
  return { pixels: out.pixels, width: out.width, height: out.height };
}

const silhouettes = new WeakMap<Texture, Texture>();

/**
 * The silhouette of a piece with its holes filled: white where the art is opaque and inside any
 * enclosed gap, the art's own soft edge outside. One per texture, made on first use.
 */
export function silhouetteOf(renderer: Renderer, texture: Texture): Texture {
  const had = silhouettes.get(texture);
  if (had && !had.destroyed) return had;
  const { pixels, width, height } = texturePixels(renderer, texture);
  // Flood the outside from the edges through the clear pixels; what the flood never reaches is
  // the art or a hole.
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];
  const push = (i: number): void => {
    if (!outside[i] && pixels[i * 4 + 3]! < 24) {
      outside[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < width; x++) {
    push(x);
    push((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    push(y * width);
    push(y * width + width - 1);
  }
  while (stack.length) {
    const i = stack.pop()!;
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) push(i - 1);
    if (x < width - 1) push(i + 1);
    if (y > 0) push(i - width);
    if (y < height - 1) push(i + width);
  }
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(width, height);
  for (let i = 0; i < width * height; i++) {
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = outside[i] ? pixels[i * 4 + 3]! : 255;
  }
  ctx.putImageData(img, 0, 0);
  const t = new Texture({ source: new CanvasSource({ resource: canvas, resolution: width / texture.width }) });
  silhouettes.set(texture, t);
  return t;
}

export interface SilhouetteMaskOptions {
  renderer: Renderer;
  ticker: Ticker;
  /** The container the mask cuts: the layer the lines draw in. */
  layer: Container;
  /** The container whose local space the mask lives in (the board); the mask sprite becomes its child. */
  space: Container;
  /** The area to cover, in `space` units: the grid plus room for a wowing symbol's overshoot. */
  area: { x: number; y: number; width: number; height: number };
  /** The mask texture's density. Default: the space's on-screen scale × the renderer's, capped at 3. */
  resolution?: number;
}

/**
 * An inverse alpha mask over a layer, made of the silhouettes of the sprites it covers: each
 * silhouette is re-posed from its sprite's global transform every frame and drawn into one
 * render texture that masks the layer through one sprite. `cover` a cell's art as a line shows,
 * `clear` once the lines are gone.
 */
export class SilhouetteMask {
  private readonly holder = new Container({ label: 'silhouettes' });
  private readonly covered = new Map<string, { sprite: Sprite; art: Sprite }>();
  private texture: RenderTexture | null = null;
  private maskSprite: Sprite | null = null;
  private dropTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly o: SilhouetteMaskOptions) {}

  /** How many sprites are covered. */
  get size(): number {
    return this.covered.size;
  }

  /** Cover `art` (a sprite with its anchor): a line under it is hidden by its hole-filled silhouette. */
  cover(key: string, art: Sprite): void {
    if (this.dropTimer) {
      clearTimeout(this.dropTimer);
      this.dropTimer = null;
    }
    const had = this.covered.get(key);
    if (had && had.art === art) return;
    if (had) {
      had.sprite.destroy();
      this.covered.delete(key);
    }
    const sprite = new Sprite(silhouetteOf(this.o.renderer, art.texture));
    sprite.anchor.copyFrom(art.anchor);
    this.holder.addChild(sprite);
    this.covered.set(key, { sprite, art });
    if (!this.maskSprite) this.mount();
  }

  uncover(key: string): void {
    const had = this.covered.get(key);
    if (!had) return;
    had.sprite.destroy();
    this.covered.delete(key);
  }

  /** Drop the mask after `afterMs` (the lines' fade), unless something is covered again before. */
  clear(afterMs = 240): void {
    if (this.dropTimer) clearTimeout(this.dropTimer);
    this.dropTimer = setTimeout(() => this.drop(), afterMs);
  }

  /** Drop the mask now: the layer shows whole again, the texture is freed. */
  drop(): void {
    if (this.dropTimer) {
      clearTimeout(this.dropTimer);
      this.dropTimer = null;
    }
    if (!this.maskSprite) return;
    this.o.ticker.remove(this.sync);
    this.o.layer.mask = null;
    for (const { sprite } of this.covered.values()) sprite.destroy();
    this.covered.clear();
    this.maskSprite.destroy();
    this.maskSprite = null;
    this.texture?.destroy(true);
    this.texture = null;
  }

  destroy(): void {
    this.drop();
    this.holder.destroy({ children: true });
  }

  private mount(): void {
    const { area, space, layer, renderer } = this.o;
    const density = this.o.resolution ?? Math.min(3, Math.max(1, Math.hypot(space.worldTransform.a, space.worldTransform.b) * renderer.resolution));
    this.texture = RenderTexture.create({ width: area.width, height: area.height, resolution: density });
    const sprite = new Sprite(this.texture);
    sprite.position.set(area.x, area.y);
    space.addChild(sprite);
    this.maskSprite = sprite;
    this.sync();
    layer.setMask({ mask: sprite, inverse: true, channel: 'alpha' });
    this.o.ticker.add(this.sync);
  }

  private readonly sync = (): void => {
    if (!this.texture) return;
    const { space, renderer, area } = this.o;
    const inv = space.getGlobalTransform(new Matrix(), false).invert();
    for (const { sprite, art } of this.covered.values()) {
      if (art.destroyed) continue;
      sprite.setFromMatrix(inv.clone().append(art.getGlobalTransform(new Matrix(), false)));
    }
    renderer.render({ container: this.holder, target: this.texture, clear: true, transform: new Matrix().translate(-area.x, -area.y) });
  };
}
