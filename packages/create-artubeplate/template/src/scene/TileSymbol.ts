// A placeholder symbol that already looks finished: a rounded tile with a soft sheen, the label in
// the game's font (white and outlined, or dark on a light tile). The label does the win on the
// studio's motion rig (see ./win-rig: the L wow, a shine, a blick) while the tile stays still.
// Art replaces it (ArtSymbol).

import { Graphics, Text } from 'pixi.js';
import { ReelSymbol } from 'pixi-reels';
import { drawPanel, textStyle } from '@artubeplate/core/ui';
import { WinRig } from './win-rig';

export interface TileSymbolOptions {
  /** Tile colour. */
  color: number;
  /** A glyph, letters or an emoji. */
  label: string;
}

const luminance = (c: number): number => (0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255)) / 255;

/** The label in plain white, no outline and no shadow, drawn additively: the shine and the blick are copies like this. */
const whiteCopy = (label: string): Text => {
  const t = new Text({ text: label, style: textStyle('counter', { fill: 0xffffff, stroke: { color: 0xffffff, width: 0 }, dropShadow: false }) });
  t.anchor.set(0.5);
  t.blendMode = 'add';
  return t;
};

export class TileSymbol extends ReelSymbol {
  private readonly tile = new Graphics();
  private readonly text: Text;
  private readonly flash: Text;
  private readonly copy: Text;
  /** The label on its rig, made on the first `resize` (the font size, and so the label's size, is known then). */
  private win: WinRig | null = null;
  private readonly light: boolean;

  constructor(private readonly opts: TileSymbolOptions) {
    super();
    this.light = luminance(opts.color) > 0.62;
    this.text = new Text({
      text: opts.label,
      style: textStyle('counter', this.light ? { fill: 0x12151b, stroke: { color: 0xffffff, width: 0 }, dropShadow: false } : {}),
    });
    this.text.anchor.set(0.5);
    this.flash = whiteCopy(opts.label);
    this.copy = whiteCopy(opts.label);
    this.view.addChild(this.tile);
  }

  protected onActivate(): void {}
  protected onDeactivate(): void {}

  resize(width: number, height: number): void {
    const inset = 3;
    const r = Math.min(width, height) * 0.14;
    const w = width - inset * 2;
    const h = height - inset * 2;
    drawPanel(this.tile.clear(), inset, inset, w, h, { fill: this.opts.color, fillAlpha: 1, border: this.light ? 0x000000 : 0xffffff, borderAlpha: this.light ? 0.12 : 0.14, borderWidth: 2, radius: r, sheen: 0.16, shadowAlpha: 0, shadowOffset: 0 });
    const chars = Math.max(1, [...this.opts.label].length);
    const size = Math.max(8, Math.floor(Math.min(height * 0.4, (width * 0.74) / (chars * 0.64))));
    for (const t of [this.text, this.flash, this.copy]) t.style.fontSize = size;
    if (!this.light) this.text.style.stroke = { color: 0x07090c, width: Math.max(2, Math.round(size * 0.12)), join: 'round' };
    // The label's longest side sizes the blick's bar and its sweep.
    const span = Math.max(1, this.text.width, this.text.height);
    if (this.win) this.win.setSize(span);
    else {
      this.win = new WinRig(this.text, this.flash, this.copy, span);
      this.view.addChild(this.win.root);
    }
    this.win.root.position.set(width / 2, height / 2);
  }

  playWin(): Promise<void> {
    return this.win?.play() ?? Promise.resolve();
  }

  stopAnimation(): void {
    this.win?.stop();
  }
}
