// A symbol's win on the studio's motion rig (`@artubeplate/core/motion`), shared by the art and
// the placeholder symbols: the piece (a glyph, a label) wows with the L variant, a lean back, the
// pop with a tilt, a held beat and a slow wobble down, while a white additive copy of it shines
// over it and a blick, a second copy shown only through a bar, sweeps across it. One wow at a
// time: a win asked for while one plays joins it, so a presenter cycling the wins never twitches
// a symbol. The frame around the piece is not part of the rig and stays still.

import { Container, Graphics, type ContainerChild } from 'pixi.js';
import { gsap } from 'gsap';
import { motion, type Rig } from '@artubeplate/core/motion';

/** The shine's peak alpha. */
const SHINE = 0.75;
/** The blick's bar: its width and height as fractions of the piece's size, its tilt, how far it sweeps either side (in sizes), how long the sweep takes, and the copy's alpha behind it. */
const BLICK = { width: 0.26, height: 1.9, tilt: -0.55, sweep: 0.9, seconds: 0.5, alpha: 0.85 };

export class WinRig {
  /** The rig around the piece: `rig.root` is layout's, pin it where the piece sits. */
  readonly rig: Rig;
  private readonly flash: ContainerChild;
  private readonly blick = new Container({ label: 'blick-clip' });
  private readonly bar = new Graphics({ label: 'blick' });
  private size = 1;
  /** The win in flight: a call while it plays joins it instead of restarting the wow. */
  private winning: Promise<void> | null = null;

  /**
   * `art` is the piece, centred on its origin; `flash` and `copy` are white additive copies of it
   * at the same size (the shine and the blick); `size` is the piece's longest side in its own
   * units, which the bar is drawn and swept by (`setSize` when it changes).
   */
  constructor(art: ContainerChild, flash: ContainerChild, copy: ContainerChild, size: number) {
    // The flash rides in the rig's body with the piece, but it is not the rig's own `flash`: the
    // rig writes that one's alpha from its pose on every change, which would hold the shine at
    // zero for as long as the wow moves.
    this.rig = motion.rig(art, { size: [size, size] });
    flash.alpha = 0;
    this.rig.body.addChild(flash);
    this.flash = flash;
    copy.alpha = BLICK.alpha;
    this.blick.addChild(copy, this.bar);
    this.blick.mask = this.bar;
    this.blick.visible = false;
    this.rig.body.addChild(this.blick);
    this.setSize(size);
  }

  get root(): Container {
    return this.rig.root;
  }

  /** The piece's longest side changed (a label re-measured): the bar follows. */
  setSize(size: number): void {
    this.size = size;
    this.bar
      .clear()
      .rect((-size * BLICK.width) / 2, (-size * BLICK.height) / 2, size * BLICK.width, size * BLICK.height)
      .fill(0xffffff);
    this.bar.rotation = BLICK.tilt;
  }

  /** The win: the wow, the shine and the blick. Resolves as the wow settles. */
  play(): Promise<void> {
    if (this.winning) return this.winning;
    gsap.killTweensOf([this.flash, this.bar]);
    gsap.fromTo(this.flash, { alpha: 0 }, { alpha: SHINE, duration: motion.seconds('quick'), yoyo: true, repeat: 1, ease: 'sine.inOut' });
    this.blick.visible = true;
    this.bar.x = -this.size * BLICK.sweep;
    gsap.to(this.bar, { x: this.size * BLICK.sweep, duration: BLICK.seconds, ease: 'power1.inOut', delay: 0.05, onComplete: () => void (this.blick.visible = false) });
    // settled(): a wow cut short (the next spin stops the rig) settles too, so whoever awaits the
    // win (the win presenter) is not left waiting for good.
    const run: Promise<void> = motion
      .settled(motion.play(this.rig, 'wow', { variant: 'L' }))
      .finally(() => {
        if (this.winning === run) this.winning = null;
      });
    this.winning = run;
    return run;
  }

  /** Everything at rest, now: the pose, the shine, the blick. */
  stop(): void {
    gsap.killTweensOf([this.flash, this.bar]);
    this.flash.alpha = 0;
    this.blick.visible = false;
    this.winning = null;
    motion.stop(this.rig);
  }

  destroy(): void {
    this.stop();
    // `context` frees the blick bar's own GraphicsContext with it; the glyph's texture is shared.
    this.rig.root.destroy({ children: true, context: true });
  }
}
