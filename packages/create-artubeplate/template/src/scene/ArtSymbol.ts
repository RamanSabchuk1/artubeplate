// A symbol from art: the tile (its frame and background) stays still; the glyph on it does the
// win on the studio's motion rig (see ./win-rig: the L wow, a shine, a blick), so a winning line
// reads clearly without symbols growing over their neighbours. Both textures share one canvas
// (the raw-assets `tile-<id>` and `glyph-<id>` frames), so they line up as drawn. With no tile,
// the glyph is the whole art.

import { Sprite, type Texture } from 'pixi.js';
import { ReelSymbol } from 'pixi-reels';
import { WinRig } from './win-rig';

export interface ArtSymbolOptions {
  /** The still part: the symbol's frame and background. Optional. */
  tile?: Texture | null;
  /** The part that animates: the icon, the letter. */
  glyph: Texture;
}

/** A white additive copy of a texture, centred (the shine, the blick). */
const additive = (texture: Texture): Sprite => {
  const s = new Sprite(texture);
  s.anchor.set(0.5);
  s.blendMode = 'add';
  return s;
};

export class ArtSymbol extends ReelSymbol {
  private readonly tile: Sprite | null;
  private readonly glyph: Sprite;
  /** The glyph on its rig: the wow, the shine and the blick. */
  private readonly win: WinRig;

  constructor(opts: ArtSymbolOptions) {
    super();
    this.tile = opts.tile ? new Sprite(opts.tile) : null;
    this.tile?.anchor.set(0.5);
    this.glyph = new Sprite(opts.glyph);
    this.glyph.anchor.set(0.5);
    this.win = new WinRig(this.glyph, additive(opts.glyph), additive(opts.glyph), Math.max(opts.glyph.width, opts.glyph.height));
    if (this.tile) this.view.addChild(this.tile);
    this.view.addChild(this.win.root);
  }

  protected onActivate(): void {}
  protected onDeactivate(): void {}

  /** The sprite the win lines hide under: the tile when there is one (the glyph wows over it), else the glyph. */
  get artSprite(): Sprite {
    return this.tile ?? this.glyph;
  }

  resize(width: number, height: number): void {
    // Fit the shared canvas into the cell, centred. The rig's root is layout's: it takes the fit,
    // and the wow scales the glyph inside it.
    const tex = this.glyph.texture;
    const k = Math.min(width / tex.width, height / tex.height);
    this.tile?.scale.set(k);
    this.tile?.position.set(width / 2, height / 2);
    this.win.root.scale.set(k);
    this.win.root.position.set(width / 2, height / 2);
  }

  playWin(): Promise<void> {
    return this.win.play();
  }

  stopAnimation(): void {
    this.win.stop();
  }
}
