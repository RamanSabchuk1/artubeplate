import { describe, it, expect, vi } from 'vitest';

// Only the pure maths is under test here: the grid a sticker sheet bends on, and the distance
// transform the baked border is measured with. Pixi's classes are stubbed away.
vi.mock('pixi.js', () => ({ Container: class {}, Mesh: class {}, MeshGeometry: class {}, Rectangle: class {}, Sprite: class {}, Texture: class {} }));
vi.mock('gsap', () => ({ gsap: {} }));

// The bake's layers are ImageData: a plain stand-in under Node.
class FakeImageData {
  readonly data: Uint8ClampedArray;
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.data = new Uint8ClampedArray(width * height * 4);
  }
}
(globalThis as { ImageData?: unknown }).ImageData ??= FakeImageData;

const { stickerGrid, rectCorners, lerpCorners } = await import('../src/scenes/sticker');
const { distanceTransform, stickerLayers, wobbleField } = await import('../src/fx/sticker-bake');

describe('stickerGrid', () => {
  it('is the flat rectangle when the corners are a rectangle and the bow is 0', () => {
    const out = stickerGrid(rectCorners(10, 20, 100, 50), 3, 3, 0, new Float32Array(18));
    expect(Array.from(out)).toEqual([10, 20, 60, 20, 110, 20, 10, 45, 60, 45, 110, 45, 10, 70, 60, 70, 110, 70]);
  });
  it('keeps the corners and the centre put, and pushes the middle of each edge out with a bow', () => {
    const flat = stickerGrid(rectCorners(0, 0, 100, 100), 3, 3, 0, new Float32Array(18));
    const bowed = stickerGrid(rectCorners(0, 0, 100, 100), 3, 3, 0.3, new Float32Array(18));
    for (const i of [0, 2, 6, 8]) {
      expect(bowed[i * 2]).toBeCloseTo(flat[i * 2]!, 6);
      expect(bowed[i * 2 + 1]).toBeCloseTo(flat[i * 2 + 1]!, 6);
    }
    expect(bowed[4 * 2]).toBeCloseTo(50, 6); // the centre
    expect(bowed[1 * 2 + 1]).toBeCloseTo(50 - 50 * 1.15, 6); // the top edge's middle, half the bow further out
    expect(bowed[3 * 2]).toBeCloseTo(50 - 50 * 1.15, 6); // the left edge's middle
  });
  it('lerps corners', () => {
    const a = rectCorners(0, 0, 10, 10);
    const b = rectCorners(10, 10, 10, 10);
    expect(lerpCorners(a, b, 0.5)).toEqual(rectCorners(5, 5, 10, 10));
  });
});

describe('distanceTransform', () => {
  it('gives the squared Euclidean distance to the nearest inside cell', () => {
    const w = 5;
    const h = 5;
    const inside = new Uint8Array(w * h);
    inside[2 * w + 2] = 1; // one cell in the middle
    const d = distanceTransform(inside, w, h);
    expect(d[2 * w + 2]).toBe(0);
    expect(d[2 * w + 3]).toBe(1);
    expect(d[0]).toBe(8); // (2, 2) away
    expect(d[1 * w + 1]).toBe(2);
  });
  it('is 0 everywhere inside a filled block and grows outside it', () => {
    const w = 6;
    const h = 4;
    const inside = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < 3; x++) inside[y * w + x] = 1;
    const d = distanceTransform(inside, w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < 3; x++) expect(d[y * w + x]).toBe(0);
    expect(d[0 * w + 3]).toBe(1);
    expect(d[0 * w + 5]).toBe(9);
  });
});

/** A filled disc of radius `r` in a `size` square, as an alpha field. */
function disc(size: number, r: number): Float32Array {
  const a = new Float32Array(size * size);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) a[y * size + x] = Math.hypot(x - c, y - c) <= r ? 1 : 0;
  return a;
}

/** How far the border reaches from the centre along a direction (the last pixel with alpha > half). */
function reachAlong(img: { data: Uint8ClampedArray; width: number }, cx: number, cy: number, angle: number): number {
  let last = 0;
  for (let t = 0; t < img.width; t += 0.25) {
    const x = Math.round(cx + Math.cos(angle) * t);
    const y = Math.round(cy + Math.sin(angle) * t);
    if (x < 0 || y < 0 || x >= img.width || y >= img.width) break;
    if (img.data[(y * img.width + x) * 4 + 3]! > 127) last = t;
  }
  return last;
}

describe('stickerLayers', () => {
  const size = 40;
  const pad = 12;
  it('without ink: no dark lip over the art, the shape filled with the border colour', () => {
    const { under, over } = stickerLayers(disc(size, 12), size, size, pad, 0, 6, 0, 0.5, 0x0b0c10, 0xffffff);
    for (let i = 3; i < over.data.length; i += 4) expect(over.data[i]).toBe(0);
    const W = size + 2 * pad;
    const centre = ((pad + size / 2) * W + pad + size / 2) * 4;
    expect([under.data[centre], under.data[centre + 1], under.data[centre + 2], under.data[centre + 3]]).toEqual([255, 255, 255, 255]);
  });
  it('with ink: the line and its lip are there, as before', () => {
    const { over } = stickerLayers(disc(size, 12), size, size, pad, 2, 6, 0, 0.5, 0x0b0c10, 0xffffff);
    let dark = 0;
    for (let i = 3; i < over.data.length; i += 4) if (over.data[i]! > 0) dark++;
    expect(dark).toBeGreaterThan(0);
  });
  it('a wobbling border swells and thins around the piece, within its share', () => {
    const r = 12;
    const border = 6;
    const wobble = 0.5;
    const plain = stickerLayers(disc(size, r), size, size, pad, 0, border, 0, 0.5, 0, 0xffffff).under;
    const wavy = stickerLayers(disc(size, r), size, size, pad, 0, border, 0, 0.5, 0, 0xffffff, wobble, 7).under;
    const c = pad + (size - 1) / 2;
    const reaches = Array.from({ length: 24 }, (_, k) => reachAlong(wavy, c, c, (k / 24) * Math.PI * 2) - r);
    const flat = Array.from({ length: 24 }, (_, k) => reachAlong(plain, c, c, (k / 24) * Math.PI * 2) - r);
    // The plain border is the same all round (to a pixel); the wavy one is not.
    expect(Math.max(...flat) - Math.min(...flat)).toBeLessThanOrEqual(1.5);
    expect(Math.max(...reaches) - Math.min(...reaches)).toBeGreaterThan(1.5);
    for (const d of reaches) {
      expect(d).toBeGreaterThanOrEqual(border * (1 - wobble) - 1.5);
      expect(d).toBeLessThanOrEqual(border * (1 + wobble) + 1.5);
    }
  });
});

describe('stickerLayers shadow', () => {
  it('puts a soft shadow around the border, offset, and never over the border itself', () => {
    const size = 40;
    const pad = 20;
    const W = size + 2 * pad;
    const plain = stickerLayers(disc(size, 12), size, size, pad, 0, 5, 0, 0.5, 0, 0xffffff).under;
    const shaded = stickerLayers(disc(size, 12), size, size, pad, 0, 5, 0, 0.5, 0, 0xffffff, 0, 0, { blur: 3, dx: 0, dy: 6, alpha: 0.6, color: 0x000000 }).under;
    const c = pad + (size - 1) / 2;
    // Below the border (the shadow falls down): dark, and more opaque than without a shadow.
    const below = (Math.round(c + 12 + 5 + 4) * W + Math.round(c)) * 4;
    expect(plain.data[below + 3]).toBe(0);
    expect(shaded.data[below + 3]).toBeGreaterThan(30);
    expect(shaded.data[below]).toBeLessThan(80);
    // On the border: still the border's white.
    const onBorder = (Math.round(c - 12 - 2) * W + Math.round(c)) * 4;
    expect(shaded.data[onBorder]).toBe(255);
    expect(shaded.data[onBorder + 3]).toBe(255);
  });
});

describe('wobbleField', () => {
  it('is deterministic, within -1..1 and smooth', () => {
    const a = wobbleField(64, 48, 3.2, 11);
    const b = wobbleField(64, 48, 3.2, 11);
    expect(Array.from(a)).toEqual(Array.from(b));
    let jump = 0;
    for (let y = 0; y < 48; y++)
      for (let x = 0; x < 64; x++) {
        const v = a[y * 64 + x]!;
        expect(v).toBeGreaterThanOrEqual(-1);
        expect(v).toBeLessThanOrEqual(1);
        if (x > 0) jump = Math.max(jump, Math.abs(v - a[y * 64 + x - 1]!));
      }
    expect(jump).toBeLessThan(0.2);
    expect(Array.from(wobbleField(64, 48, 3.2, 12))).not.toEqual(Array.from(a));
  });
});
