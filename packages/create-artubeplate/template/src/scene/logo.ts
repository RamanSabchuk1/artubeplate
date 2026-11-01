// The game's logo. It lives in the director's foreground: the intro drops it in, and it stays put
// while the intro fades out and the board scales in underneath. A placeholder in the `display`
// type role (white, outlined); swap in your logo art (a Sprite or a Spine) when you have it.

import type { Container } from 'pixi.js';
import { label } from '@artubeplate/core/ui';

/** Logo height in design units, for layout. */
export const LOGO_HEIGHT = 110;

export function makeLogo(title: string): Container {
  const logo = label('display', title);
  logo.label = 'logo';
  return logo;
}
