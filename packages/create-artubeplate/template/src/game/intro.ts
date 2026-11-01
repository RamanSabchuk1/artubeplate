// The intro screen for this session: up to three feature cards built from the math's
// `settings.config` (its `intro.slides`, or cards derived from the wild, the free spins and the
// session's buy/boost modes), plus a volatility strip from the base mode. `?intro=0` skips it,
// `?intro=1` shows it even after the player ticked "Don't show again".
//
// Cards can also be your own pixi Containers (atlas frames + Text): pass them in `cards`.

import { Assets, Container, Graphics } from 'pixi.js';
import type { ViewContext } from '@artubeplate/core';
import { buildIntroSlides, type SlotConfig } from '@artubeplate/core/rules';
import { IntroScene, type IntroSceneOptions } from '@artubeplate/core/scenes';
import { label } from '@artubeplate/core/ui';

const LEVELS = ['Very Low', 'Low', 'Medium', 'High', 'Very High'];

/** "VOLATILITY" and five pips, lit up to the mode's level. */
export function volatilityStrip(volatility: string | undefined): Container | null {
  const level = LEVELS.findIndex((l) => l.toLowerCase() === (volatility ?? '').toLowerCase()) + 1;
  if (level <= 0) return null;
  const strip = new Container({ label: 'volatility' });
  const caption = label('caption', 'Volatility', { fontSize: 26, fill: 0xffffff });
  caption.anchor.set(0, 0.5);
  const pips = new Graphics();
  for (let i = 0; i < 5; i++) {
    pips.roundRect(i * 44, -15, 32, 30, 8).fill({ color: i < level ? 0xffffff : 0x2c313b });
    if (i >= level) pips.roundRect(i * 44, -15, 32, 30, 8).stroke({ color: 0xffffff, alpha: 0.18, width: 2 });
  }
  const w = caption.width + 36 + 5 * 44 - 12;
  caption.position.set(-w / 2, 0);
  pips.position.set(-w / 2 + caption.width + 36, 0);
  strip.addChild(caption, pips);
  return strip;
}

export function introFor(slot: SlotConfig, ctx: ViewContext): Omit<IntroSceneOptions, 'logo'> | null {
  const param = new URLSearchParams(window.location.search).get('intro');
  if (param === '0' || slot.intro?.show === false) return null;
  const key = `artubeplate.intro.hidden.${ctx.config.title}`;
  if (param !== '1' && IntroScene.dismissed(key)) return null;
  const modes = ctx.session.gameSettings.gameModes;
  const names = Object.fromEntries(Object.entries(ctx.config.modes ?? {}).flatMap(([id, m]) => (m?.name ? [[id, m.name]] : [])));
  // A card shows a symbol's art: its `sym-<id>` frame from the raw-assets spritesheet when loaded
  // (Assets resolves the alias), else the config's image or the code-drawn tile.
  const art = { ...slot, symbols: slot.symbols.map((s) => (Assets.cache.has(`sym-${s.id}`) ? { ...s, image: `sym-${s.id}` } : s)) };
  const cards = buildIntroSlides({ slot: art, modes, title: ctx.config.title, names });
  if (!cards.length) return null;
  const strip = volatilityStrip((modes.find((m) => m.type === 'None') ?? modes[0])?.volatility);
  return {
    cards,
    ...(strip ? { extras: [strip] } : {}),
    ...(slot.intro?.subtitle ? { subtitle: slot.intro.subtitle } : {}),
    dontShowAgain: { key },
  };
}
