// Where everything sits — the one file to edit to move or resize the logo, the board, the win
// box and the announcements, separately for a phone held upright and for everything else.
//
// The game draws in the PLAY AREA: the screen above the HUD bar and its message line. Each
// orientation has a design CANVAS that is fitted into the play area (contain, centred), and every
// object is a SmartContainer pin in that canvas's units (`@artubeplate/core/scenes`):
//   align / valign   the point of the canvas it hangs from (default: the centre)
//   offsetX/offsetY  design units from that point
//   scale            its size in design units
//   portrait / landscape   overrides for one orientation
// So a number here means the same on every screen of that orientation: 100 units is 36 px on a
// 390 px-wide phone and 65 px on a 1280×800 desktop.
//
// On a phone held sideways the HUD's controls stand over the play area (the SPIN lane at the right
// edge, ☰ and the coin at the left). There the scene (`Scene.pins()`) slides the board into the
// free middle beside the lane and moves the win box and the banner with it; everywhere else these
// numbers are the layout.

import type { PinChildArgs } from '@artubeplate/core/scenes';

/** The design canvases [width, height]: portrait ≈ a phone's play area, landscape ≈ a desktop's. */
export const CANVAS: { portrait: [number, number]; landscape: [number, number] } = {
  portrait: [1080, 1830],
  landscape: [1920, 1000],
};

export const PINS = {
  /** The game's name (the logo), hanging from the top edge. */
  logo: { valign: 'top', portrait: { offsetY: 230, scale: 1 }, landscape: { offsetY: 80, scale: 1 } },
  /** The board (frame + reels + the FREE SPINS plaque), by the centre of the reel grid. */
  board: { portrait: { offsetY: 15, scale: 1.36 }, landscape: { offsetY: 100, scale: 1.34 } },
  /** The win box: under the board on a phone, over the middle of the board elsewhere. */
  winBox: { portrait: { offsetY: 585, scale: 1.4 }, landscape: { offsetY: 100, scale: 1.3 } },
  /** FREE SPINS / BIG WIN / TOTAL WIN over the board. */
  banner: { portrait: { offsetY: 15, scale: 1 }, landscape: { offsetY: 60, scale: 1 } },
} satisfies Record<string, PinChildArgs>;

/** The widest the logo may be, in design units (a long title shrinks to fit). */
export const LOGO_MAX_WIDTH = 980;

/** Line-win amounts floating over the cells: their size per orientation, and how far they rise (canvas units). */
export const LINE_WIN = { scale: { portrait: 1.7, landscape: 1.3 }, rise: 40 };
