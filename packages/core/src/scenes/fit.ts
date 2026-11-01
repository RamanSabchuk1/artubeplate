// Design-frame fitting (pure: no pixi import, so it runs anywhere).

export interface DesignFrame {
  width: number;
  height: number;
}

/** How a design frame sits on the screen. */
export interface Fit {
  /** Design units → CSS pixels. */
  readonly scale: number;
  /** Where the frame's top-left lands (CSS pixels). */
  readonly x: number;
  readonly y: number;
  /** The screen (CSS pixels). */
  readonly width: number;
  readonly height: number;
  readonly design: DesignFrame;
  /** A design-frame point on the screen. */
  toScreen(x: number, y: number): { x: number; y: number };
}

/** Fit `design` into the screen: `contain` shows all of it, `cover` fills the screen. */
export function fitDesign(width: number, height: number, design: DesignFrame, mode: 'contain' | 'cover' = 'contain'): Fit {
  const sx = width / design.width;
  const sy = height / design.height;
  const scale = mode === 'contain' ? Math.min(sx, sy) : Math.max(sx, sy);
  const x = (width - design.width * scale) / 2;
  const y = (height - design.height * scale) / 2;
  return { scale, x, y, width, height, design, toScreen: (dx, dy) => ({ x: x + dx * scale, y: y + dy * scale }) };
}

