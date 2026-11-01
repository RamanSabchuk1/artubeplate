// @artubeplate/core/scenes — screens and the moves between them, for pixi v8 + GSAP 3.
//
//   const director = new SceneDirector(app, { speed: () => turbo.speed });
//   director.foreground.addChild(logo);                       // persistent, above every scene
//   director.add(new IntroScene({ cards, extras, logo })).add(new GameScene());
//   await director.go('intro');
//   await intro.done;
//   await director.go('game', { transition: morph() });      // intro.outro, then game.intro
//   await director.play(shader('dissolve'), () => theme('bonus'));
//   await director.play(dim({ alpha: 0.85 }), () => theme('base'));
//
// Scenes are pixi Containers: extend `SceneContainer`, lay out in a design frame, and write the
// choreography in `intro(tl)` / `outro(tl)` with the helpers (`popIn`, `dropIn`, `fadeIn`,
// `fadeOut`, `scaleIn`). Objects that must read the same on every screen (announcers, the win
// box, the logo, the board) go in a `SmartContainer`: per-orientation layout data, design units.
export * from './types';
export * from './smart';
export * from './SmartContainer';
export * from './SceneContainer';
export * from './director';
export * from './transitions';
export * from './shaders';
export * from './intro';
export * from './screens';
export * from './sticker';
export * from './hud-area';
export * from './slam';
