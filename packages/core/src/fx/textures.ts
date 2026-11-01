// Default particle textures, drawn once on a canvas: a four-point sparkle, a soft dot, a cartoon
// puff and confetti strips. They work out of the box; a game hands its own art to CartoonFx and
// Blitter instead (a sparkle sprite, a coin) when it has some.

import { Texture } from 'pixi.js';

type Draw = (g: CanvasRenderingContext2D, s: number) => void;

function canvas(size: number, draw: Draw): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  draw(g, size);
  return c;
}

/** A four-point sparkle: white, a dark outline, a soft glow (sticker style). */
export const sparkleCanvas = (size = 96, fill = '#ffffff'): HTMLCanvasElement =>
  canvas(size, (g, s) => {
    const c = s / 2;
    const r = s * 0.44;
    const w = s * 0.11;
    const star = (): void => {
      g.beginPath();
      g.moveTo(c, c - r);
      g.quadraticCurveTo(c + w * 0.4, c - w * 0.4, c + r, c);
      g.quadraticCurveTo(c + w * 0.4, c + w * 0.4, c, c + r);
      g.quadraticCurveTo(c - w * 0.4, c + w * 0.4, c - r, c);
      g.quadraticCurveTo(c - w * 0.4, c - w * 0.4, c, c - r);
      g.closePath();
    };
    g.lineJoin = 'round';
    star();
    g.lineWidth = s * 0.07;
    g.strokeStyle = '#111317';
    g.stroke();
    g.fillStyle = fill;
    g.fill();
  });

/** A soft round dot (glows, dust). */
export const dotCanvas = (size = 64): HTMLCanvasElement =>
  canvas(size, (g, s) => {
    const grad = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.65)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, s, s);
  });

/** A cartoon dust puff: overlapping circles, white with a dark outline. */
export const puffCanvas = (size = 128): HTMLCanvasElement =>
  canvas(size, (g, s) => {
    const blobs: Array<[number, number, number]> = [
      [0.5, 0.56, 0.26],
      [0.3, 0.6, 0.18],
      [0.7, 0.6, 0.19],
      [0.42, 0.38, 0.2],
      [0.62, 0.4, 0.17],
    ];
    const path = (grow: number): void => {
      g.beginPath();
      for (const [x, y, r] of blobs) {
        g.moveTo(x * s + r * s + grow, y * s);
        g.arc(x * s, y * s, r * s + grow, 0, Math.PI * 2);
      }
    };
    path(s * 0.035);
    g.fillStyle = '#111317';
    g.fill();
    path(0);
    g.fillStyle = '#f4f6fa';
    g.fill();
  });

/** Confetti bits in the given colours, one per ROW (particles pick a random row). */
export const confettiCanvas = (colors: string[] = ['#ff4fa3', '#2ec4ff', '#ffd23f', '#7cf04a'], cell = 32): HTMLCanvasElement => {
  const c = document.createElement('canvas');
  c.width = cell;
  c.height = cell * colors.length;
  const g = c.getContext('2d')!;
  colors.forEach((col, i) => {
    g.fillStyle = '#111317';
    g.fillRect(cell * 0.14, i * cell + cell * 0.28, cell * 0.72, cell * 0.44);
    g.fillStyle = col;
    g.fillRect(cell * 0.2, i * cell + cell * 0.34, cell * 0.6, cell * 0.32);
  });
  return c;
};

/** A canvas as a pixi texture (for Blitter and sprites). */
export const textureOf = (c: HTMLCanvasElement): Texture => Texture.from(c);

/** Centre any image on a square canvas (particles draw on square quads). */
export function squareCanvas(src: CanvasImageSource & { width: number; height: number }, pad = 0): HTMLCanvasElement {
  const s = Math.ceil(Math.max(src.width, src.height) * (1 + pad));
  return canvas(s, (g) => g.drawImage(src, (s - src.width) / 2, (s - src.height) / 2));
}
