// A name plate on the top edge of the reel frame ("FREE SPINS" during the feature): a dark pill
// with a coloured rim and white outlined type. Swap in real art when you have it.

import { Container, Graphics } from 'pixi.js';
import { drawPanel, label } from '@artubeplate/core/ui';

export const PLAQUE_HEIGHT = 64;

export function plaque(text: string, rim = 0xffffff): Container {
  const c = new Container({ label: `plaque:${text}` });
  const t = label('plaque', text);
  const w = Math.max(280, t.width + 90);
  c.addChild(drawPanel(new Graphics(), -w / 2, -PLAQUE_HEIGHT / 2, w, PLAQUE_HEIGHT, { fill: 0x08090c, fillAlpha: 0.92, border: rim, borderAlpha: 0.9, borderWidth: 3, radius: PLAQUE_HEIGHT / 2, sheen: 0.08, shadowAlpha: 0.4, shadowOffset: 5 }), t);
  return c;
}
