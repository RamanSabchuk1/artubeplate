// @artubeplate/core/ui — in-canvas UI that looks finished out of the box (pixi v8 + GSAP):
// one typography configuration with text ROLES (white, outlined, readable), panels, a backdrop,
// the win box, the line-win label, the big-win banner, the tiered win announcer (BIG → MEGA →
// EPIC, counted up), and web-font loading.
//
//   configureTypography({ fontFamily: 'Montserrat' });
//   await ensureFonts(['800 1em Montserrat', '900 1em Montserrat']);
//   const box = new WinBox({ caption: 'Win', format: hud.format });
//   await box.show(12.5);
export * from './typography';
export * from './fonts';
export * from './components';
export * from './announcer';
