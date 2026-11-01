# Scenes, transitions and the intro screen

`@artubeplate/core/scenes` gives a game the path a player expects from a well-made slot:

1. The loader fades away.
2. An info screen shows the basics: what the wild does, how free spins start, how big a win can be.
3. A click takes the player into the game, where the background and the logo stay put and the
   board scales in.
4. The common HUD fades in with it.

The same module switches the game's own screens: into and out of a bonus, a theme, an arena.

Everything is pixi v8 + GSAP 3. Scenes are pixi Containers, and their choreography is written as
GSAP timelines.

## The director

```ts
import { SceneDirector } from '@artubeplate/core/scenes';

const director = new SceneDirector(app, { speed: () => turbo.speed });
director.backdrop.addChild(background);   // persistent, below every scene
director.foreground.addChild(logo);       // persistent, above every scene
director.add(intro).add(game);
await director.go('intro');
```

| Layer | What goes there |
|---|---|
| `backdrop` | The shared background. Never touched by a scene change. |
| `scenes` | The current scene's view. |
| `foreground` | Things that stay across scenes: the logo, a jackpot meter. |
| `overlay` | Where transitions draw: the dim veil, the shader quad. |

- `go(id, { transition, data })` switches scenes. Inside the swap it calls the old scene's
  `detached()` and the new one's `attached()`, for anything that must change in step with it
  (behind the veil, between the two snapshots).
- `play(transition, change)` runs a transition around an in-scene change, such as a theme switch
  when a feature starts.
- Calls are queued, so a switch requested during a transition waits for it.
- `speed` scales every transition: `turbo.speed` makes them shorter in turbo, and a slam-stop can
  make them near-instant.

## Scenes are pixi Containers

Extend `SceneContainer`, add your Sprites and Texts, and lay them out in a design frame. The
default frame is 1920×1080, the frame most slot art is drawn in. The hooks are plain methods;
add only the ones you need.

```ts
import { Assets, Sprite, Text } from 'pixi.js';
import { gsap } from 'gsap';
import { SceneContainer, place, popIn, dropIn, fadeIn, fadeOut, type Fit } from '@artubeplate/core/scenes';

export class InfoScreen extends SceneContainer {
  readonly done: Promise<void>;
  private cards: Sprite[] = [];
  private strip: Sprite | null = null;
  private readonly prompt = new Text({ text: 'CLICK TO CONTINUE', style: { fill: 0xffffff, fontSize: 44, fontWeight: '800' } });
  private ready = false;

  constructor() {
    super('info');
    this.prompt.anchor.set(0.5);
    this.eventMode = 'static';
    this.done = new Promise((resolve) => this.on('pointertap', () => this.ready && resolve()));
  }

  async enter(): Promise<void> {
    await Assets.load(['splash/a.png', 'splash/b.png', 'splash/volatility.png']);
    this.cards = [Sprite.from('splash/a.png'), Sprite.from('splash/b.png')];
    this.strip = Sprite.from('splash/volatility.png');
    for (const s of [...this.cards, this.strip]) s.anchor.set(0.5);
    this.addChild(...this.cards, this.strip, this.prompt);
    this.layout(this.fit);
  }

  override layout(fit: Fit): void {
    if (!this.strip) return; // before enter()
    place(this.cards[0]!, fit, 752, 618, 0.54);
    place(this.cards[1]!, fit, 1168, 618, 0.54);
    place(this.strip, fit, 960, 307, 0.8);
    place(this.prompt, fit, 960, 1005);
  }

  entered(): void {
    const tl = gsap.timeline();
    popIn(tl, this.cards, { at: 0.15, stagger: 0.12 }); // spin in: scale from 0, unwind a turn
    dropIn(tl, this.strip!, { at: 0.85, distance: 260 * this.fit.scale });
    fadeIn(tl, this.prompt, { at: 1.5 });
    tl.call(() => void (this.ready = true));
  }

  outro(tl: gsap.core.Timeline): void {
    fadeOut(tl, [...this.cards, this.strip!, this.prompt]); // what morph() plays on the way out
  }
}
```

| Hook | When |
|---|---|
| `layout(fit)` | Every resize, and before each entry. `fit.toScreen(x, y)` maps design units to the screen; `place(obj, fit, x, y, scale)` does it for you. |
| `enter(data)` | Before the transition starts. Load textures here: a shader transition snapshots the result. |
| `entered()` | The scene is fully on screen. Start its own timeline here. |
| `leave()` / `left()` | Before and after it goes away. |
| `update(ms)` | Every frame while it is current. |
| `intro(tl)` / `outro(tl)` | Its part of a `morph()`: animate your objects in or out on the given timeline. |

The timeline helpers are the moves intro screens are made of. Each adds tweens to a timeline at a
position:

| Helper | Move |
|---|---|
| `popIn(tl, targets, { at, stagger, turn })` | Scale up from nothing with a back-out while unwinding a turn, staggered. |
| `dropIn(tl, targets, { at, distance })` | Fall in from above with a back-out. |
| `fadeIn` / `fadeOut` | Fade in or out (the fade out is the 0.34 s exit of an intro). |
| `scaleIn(tl, target)` | Scale in from nothing around the target's pivot: a board revealing itself. |

A scene does not have to extend `SceneContainer`: any object with `id` and `view` (a Container)
is a Scene.

## Transitions

A transition decides when the swap happens.

| Transition | What the player sees |
|---|---|
| `cut()` | An instant switch. |
| `dim({ alpha, color, duration, hold })` | A veil fades in, the swap happens behind it, the veil fades out. `alpha: 1` is a fade to black; less is a dim. |
| `shader(preset, { duration, ease })` | The old screen blends into the new one on the GPU. Presets: `fade`, `dissolve` (burns through with a glowing edge), `wipe`, `iris`, `burst` (a comic starburst opening, white rim, ink outline), `halftone` (dots of the new screen sweep across), `peel` (the old screen peels off like a sticker, corner first), `pixelate`. |
| `morph({ out, in })` | The background (and the foreground layer) stays. Objects animate away, the swap happens, new objects animate in. |

`morph` without options plays the outgoing scene's `outro` and the incoming scene's `intro`. That
is the studio intro handoff: the info cards fade out and the board scales in, while the background
and the logo never move. For an in-scene change, name the objects instead:

```ts
await director.play(
  morph({ out: [titlePlaque], in: (tl) => tl.from(bonusPlaque.scale, { x: 0, y: 0, ease: 'back.out(2)' }) }),
  () => setTheme('bonus'),
);
```

`shader` also takes your own GLSL. Write `vec4 transition(vec2 uv)` using `getFromColor(uv)`,
`getToColor(uv)`, `progress` (0 → 1) and `ratio` (width ÷ height). This is the convention of the
gl-transitions collection, so its effects drop in.

```ts
shader({
  glsl: `vec4 transition(vec2 uv) {
    float band = step(uv.y, progress);
    return mix(getFromColor(uv), getToColor(uv), band);
  }`,
});
```

Both screens are snapshots, so animation underneath pauses for the duration. Shader transitions
need WebGL; on another renderer they fall back to `dim()`.

## The intro screen

`IntroScene` is a ready info screen built on the same pieces:
- cards spin in, then extras and the logo drop in, then "CLICK TO CONTINUE" fades up;
- clicks only count once the prompt is up;
- an optional "Don't show this again" is remembered per game;
- landscape shows the cards in a row, portrait shows one card at a time and rotates them.

```ts
import { IntroScene } from '@artubeplate/core/scenes';

const intro = new IntroScene({
  cards: [
    { title: 'Wild multipliers', text: 'Wilds carry ×2 or ×3…', image: 'intro/wild.png' },
    myOwnCard,                                  // or your Container: atlas art + Text, centred on its origin
    { title: 'Win up to 5,000×', text: 'Buy Free Spins for 100× the bet.', badge: '5,000×' },
  ],
  extras: [volatilityStrip],                    // dropped in after the cards, faded out with the intro
  logo,                                         // persistent (director.foreground): dropped in, then kept
  dontShowAgain: { key: 'my-game.intro.hidden' },
});
director.add(intro);
await director.go('intro');
await intro.done;
await director.go('game', { transition: morph() });
```

In a game built from the template, the intro comes from the math: `settings.config.intro.slides`,
or cards derived from the wild, the free spins, the max win and the session's buy and boost modes
(`buildIntroSlides` in `@artubeplate/core/rules`). The template adds a volatility strip for the
base mode.
- `?intro=0` skips the intro.
- `?intro=1` shows it even after "Don't show again".

### How the core waits for it

The view returned from `mountView` may implement `whenPlayable()`. The core keeps the HUD
transparent, inert and click-through, and holds the first idle (and the free-rounds offer) until
it resolves. The template resolves it once the intro has handed over to the board.

## Bonus screens

The path into and out of a bonus, as studios build it: an announcer over the base game, the
bonus's rules on their own screen, a click, a transition into the bonus, the bonus plays by
itself, then a TOTAL WIN screen and a click back to the base game.

```ts
import { BonusIntroScene, TotalWinScene, dim, shader } from '@artubeplate/core/scenes';

const rules = new BonusIntroScene({
  director,                                   // its screen becomes the grey freeze-frame behind
  title: 'Paw Parade',
  headline: 'You won 12 free spins!',
  body: bonusRules(slot, title),              // from `@artubeplate/core/rules`
  left: scatterArt, right: wildArt,           // optional, centred on their origin
  autoContinueMs: autoplay ? 2500 : undefined,
});
director.add(rules);
await director.go(rules.id, { transition: shader('fade', { duration: 0.6 }) });
await rules.done;                             // the player clicked, tapped or pressed Space/Enter
await director.go('game', { transition: shader('dissolve') });

const total = new TotalWinScene({ director, amount, format: hud.format, note: '12 free spins played' });
director.add(total);
await director.go(total.id, { transition: shader('fade', { duration: 0.6 }) });
await total.done;
await director.go('game', { transition: dim() });
```

| Scene | What it shows |
|---|---|
| `BonusIntroScene` | The bonus's name, big (or `titleArt`: word art in its place); a dark card with the award (`headline`) and what the bonus does (`body`, a paragraph each); optional art either side (under the card in portrait); "click to continue". |
| `TotalWinScene` | "TOTAL WIN" (or `titleArt`), the amount counting up, a line under it (`note`), optional `art` behind the amount or, with `artAt: 'side'`, beside the type (under it in portrait); "click to continue". |

Both sit over a grey, softened freeze-frame of what the director showed when they arrived
(`backdrop: { saturation, brightness, blur }` tunes it), hide the director's foreground (the logo)
while they are up, and lay out in a SmartContainer canvas (1920×1080 / 1080×1920). The first
click during the entrance finishes it (the count of a total); the next one continues.
`autoContinueMs` continues by itself, for autoplay and replays. `PromptScene` is the base class,
for screens of your own.

`bonusName(slot)` and `bonusRules(slot, title)` (in `@artubeplate/core/rules`) give the copy: the
`bonus` section of the math's config, else `texts.freeSpins`, else lines derived from sticky
wilds, wild multipliers and retriggers.

While a bonus plays, the HUD shows the feature bar (TOTAL WIN | FREE SPINS, no round button) and
the core ignores skips (Space, STOP, a tap) unless the game config sets `bonusSkip: true`. Set the
HUD state to `hidden` while a bonus screen is up: the bar steps out of the way.

## SmartContainer: one layout per orientation, in design units

Anything that must read the same on a phone and on a desktop (announcements, the win box, the
logo, the board) goes in a `SmartContainer`. It fits a design viewport into a real one
(`contain`, or `cover` with `fitCover`) and keeps doing it on every resize and orientation change.
The layout is data, per orientation, so moving or resizing a thing means editing numbers:

```ts
import { SmartContainer, SmartViewport } from '@artubeplate/core/scenes';

// An anchor: the origin sits on a point of the screen, scaled from 1080×1920 / 1920×1080.
const banner = new SmartContainer({
  portraitData: { valign: 'center', correctionOffsetY: -120 },
  landscapeData: { valign: 'center', correctionOffsetY: -60 },
});
banner.addChild(new BigWinBanner());

// A design canvas, fitted into the screen above the HUD bar: children are pinned in its units.
const playArea = new SmartViewport(() => ({ x: 0, y: 0, width: innerWidth, height: barTop }));
const area = SmartContainer.canvas({ portrait: [1080, 1830], landscape: [1920, 1000] }, { viewport: playArea });
area.pinChildAt(logo, { valign: 'top', portrait: { offsetY: 230 }, landscape: { offsetY: 80 } });
area.pinChildAt(board, { portrait: { offsetY: 15, scale: 1.36 }, landscape: { offsetY: 100, scale: 1.34 } });
window.addEventListener('resize', () => playArea.refresh());
```

| `LayoutData` field | Meaning (design units) |
|---|---|
| `viewportWidth` / `viewportHeight` | The design viewport fitted into the real one. Default 1080×1920 portrait, 1920×1080 landscape. |
| `width` / `height` | The content box. 0 × 0 (default) makes the container's origin an anchor point. |
| `align` / `valign` | Where the box sits: `left` / `center` / `right`, `top` / `center` / `bottom`. |
| `correctionOffsetX` / `correctionOffsetY` | A nudge that scales with the container. |
| `correctionScaleX` / `correctionScaleY` | Extra scale on top of the fit. |
| `stretchWidth` / `stretchHeight` | Scale the box to the viewport's full width or height instead of fitting it. |
| `fitCover` | Fill the viewport instead of fitting inside it. |

`data` sets one layout for both orientations; `portraitData` / `landscapeData` set one each (a
screen taller than wide is portrait). `pinChildAt(child, { align, valign, offsetX, offsetY, scale,
portrait, landscape })` places a child at a point of the design viewport and re-places it on every
layout, so a pinned child follows the portrait/landscape switch. A `SmartViewport` is the area the
containers lay out in: `windowViewport()` (the default) follows the window; make your own for any
other area and call `refresh()` when it changes. The math (`smartLayout`, `pinPosition`) is pure
and exported; it gives the same results as the classic SmartContainer, so existing layout data
carries over.

`WinBox` and `BigWinBanner` animate an inner body and leave their own scale alone, so a pin (or a
`SceneContainer` `place`) can size them.

## Type and win UI (`@artubeplate/core/ui`)

In-canvas text and win presentation that looks finished before a line of styling is written:
white type with a dark outline and a soft shadow, readable over any art, on dark panels with a
crisp light border.

**One typography configuration** covers everything: `IntroScene`, the win helpers and your own
labels.

```ts
import '@fontsource/montserrat/800.css';            // bundle the font; no font CDN at runtime
import '@fontsource/montserrat/900.css';
import { configureTypography, ensureFonts, label } from '@artubeplate/core/ui';

configureTypography({ fontFamily: 'Montserrat, system-ui, sans-serif' }); // the default already
await ensureFonts(['800 1em Montserrat', '900 1em Montserrat']);          // before any Text is made
const title = label('title', 'Free spins');           // a centred Text in the `title` role
```

| Role | For |
|---|---|
| `display` | The game's name, a logo stand-in. |
| `title` / `heading` / `body` / `caption` | Screen titles, card titles, card text, small labels. |
| `prompt` | "Click to continue". |
| `badge` / `plaque` / `counter` | A big number on a card, a name plate, a spins or multiplier counter. |
| `lineWin` | The amount over a winning line. |
| `winLabel` / `winAmount` | The caption and amount in a win box. |
| `bigWin` / `bigWinAmount` | "BIG WIN" or "FREE SPINS" announcements and the line under them. |

`configureTypography({ fontFamily, fill, muted, win, outline, shadow })` changes every role at
once. `textStyle(role, overrides)` gives the plain style object for your own `Text`.

**Win helpers**

| Helper | What it is |
|---|---|
| `new WinBox({ format })` | A big outlined amount that counts up: `show(amount)` pops it in, `countTo(amount)` keeps counting, `hide()` fades it. `caption: 'Total win'` adds a line over it, `panel: true` a dark box behind it. |
| `lineWinLabel('€1.25')` | The amount as outlined type, to float over a winning line (`{ pill: true }` puts it on a dark pill). |
| `new BigWinBanner()` | `show('Big win', '€52.85')` pops in a big outlined title and amount over a soft dark oval (`{ shade: false }` drops it); `hide()`. |

**Surfaces**

| Helper | What it is |
|---|---|
| `drawPanel(g, x, y, w, h, 'card' \| 'box' \| 'inset' \| 'pill' \| style)` | Near-black panels with a light border, a sheen and a drop shadow. |
| `drawBackdrop(g, w, h, 'graphite' \| 'midnight' \| 'violet' \| 'emerald' \| 'crimson' \| style)` | A full-screen background: base colour, radial glow, vignette. |

## In the showcase

| Moment | Transition |
|---|---|
| Loader → intro | The intro starts when the loader has faded, so its choreography is seen. |
| Intro → game | `morph()`: the cards fade, the board scales in; the background and the logo stay. |
| Base win → bonus rules | The FREE SPINS announcer over the board, then `shader('fade')`: the colour drains into a grey freeze-frame and the rules screen (`BonusIntroScene`) slams in. It waits for a click. |
| Bonus rules → bonus | `shader('dissolve')`: the rules screen burns into the board in the feature look (violet backdrop, frame, plaque). The free spins play by themselves. |
| Bonus → total | `shader('fade')`: the last free spin drains to grey and `TotalWinScene` counts the total up. It waits for a click. |
| Total → base | `dim()`: a dark dip, and the base look returns behind it. |

A base-game win counts up as a `WinBox` amount while the winning cells pulse (under the board on a
phone, over it elsewhere); free-spins wins float as `lineWinLabel`s; announcements use `BigWinBanner`.
The logo, the board, the win box and the banner are SmartContainer pins in design canvases fitted
into the screen above the HUD bar; every position and size is in the template's `src/layout.ts`.
The placeholder symbols are `TileSymbol` (template): rounded tiles with the label in the game's
font. A win pops the label over a soft additive glow; the tile itself stays still. See
`packages/create-artubeplate/template/src/scene/Scene.ts` and `src/ui/overlay.ts`.

## The win announcer (`@artubeplate/core/ui`)

BIG WIN → MEGA WIN → EPIC WIN, counted up: the amount climbs through every tier the win reaches,
each new tier slams its title in and calls `onTier` (confetti, a sound, a cheer). `skip()` (a tap,
a slam-stop) lands on the final tier and amount at once: the final tier slams in and calls
`onTier` (tiers it jumps over stay silent), `onCounted` fires, and the amount holds for
`skipHoldSeconds` (default 0.8) × speed before it fades. A skip after the count ends it.

```ts
import { WinAnnouncer } from '@artubeplate/core/ui';

const announcer = new WinAnnouncer({
  format: hud.format,
  tiers: [                                    // default: BIG 15x · MEGA 50x · EPIC 200x, as text
    { at: 15, title: 'Big win', art: () => sprite('word-big-win') },
    { at: 50, title: 'Mega win', art: () => sprite('word-mega-win') },
    { at: 200, title: 'Epic win', art: () => sprite('word-epic-win') },
  ],
  amountStyle: { fontSize: 120 },
  onTier: (tier, i) => fx.burst('confetti', top, 50 + i * 30),
});
area.pinChildAt(announcer, PINS.banner);      // it animates an inner body: pins size it
if (announcer.tierFor(x) >= 0) await announcer.play(totalWin, x, { speed: turbo.speed });
```

## Effects (`@artubeplate/core/fx`)

Two pieces, both in a STATIC layer's units (a SmartContainer canvas works: effects scale with the
board).

**`Blitter`**: a handful of sprites burst out of a point, hang for a beat, then streak into a
target and call back on every arrival: coins into a total, sparks into a jackpot meter, paint into
a collector. CPU sprites, so arrivals are exact; `flush()` lands everything at once (a slam-stop).

```ts
const blitter = new Blitter(flyersLayer, app.ticker);
await blitter.blast({
  from: cap.getGlobalPosition(),
  to: () => meter.getGlobalPosition(),        // a function follows a moving target
  textures: [sparkCyan, sparkYellow],
  count: 8,
  speedScale: turbo.speed,
  onArrive: (i, n) => meter.countTo(start + (gain * (i + 1)) / n),
});
```

**`CartoonFx`**: GPU particle bursts on [pylinka](https://pylinka.schmooky.dev): `sparkle`,
`shard`, `puff`, `confetti`, `glow`. Every kind keeps a few emitters, so several bursts in one
frame each start where they were asked for. The presets are plain data (`BURST_PRESETS`);
`presets` overrides fields, `textures` swaps the art (one image or several, each particle picks
one). Without WebGL2/WebGPU it resolves anyway and every burst is a no-op.

```ts
const fx = await CartoonFx.create(app, { layer: particlesLayer, textures: { sparkle: [starCyan, starYellow] } });
fx.burst('sparkle', cap.getGlobalPosition());
fx.shower('confetti', leftTop, rightTop, 3);
```

## The sticker slap (`@artubeplate/core/scenes`)

A piece of the scene arrives like a sticker pressed onto the wall. `stickerSlap(target, { renderer,
speed })` snapshots `target` (the board with its frame, a card, a plaque), hides it, and plays the
snapshot on a `StickerQuad` in its place: a textured sheet with four free corners, mapped
bilinearly over a grid, plus a `bow` that bulges the middle toward the viewer. It comes in large
and tilted (`scale` 1.3, `tilt` 0.22, `bow` 0.28), hits the surface in 13 frames (`power2.in`),
presses flat with a short dent (5 frames) and settles with a wobble (34 frames,
`elastic.out(1, 0.4)`): the studio's wow, wait, decrease. Only the approach follows the turbo
speed. `onImpact` is the frame of the hit, for a sound. The target shows again when it has settled.

```ts
await director.play(shader('dissolve', { duration: 0.9 }), swapToNight);
await stickerSlap(scene.board, { renderer: app.renderer, speed: turbo.speed, onImpact: () => sfx('cap-land') });
```

`StickerQuad` on its own (`new StickerQuad({ texture, segments })`, `setCorners`, `bow`) is a sheet
for anything that peels, flaps or bulges. A rigid, exactly projective plane is pixi's own
`PerspectiveMesh`; the sheet bends, which is what a sticker does.

## Baked stickers (`@artubeplate/core/fx`)

Flat art (no contour line, no die-cut border) gets both at load, so every piece and anything
drawn in code (a letter, a value) share one line weight measured against the piece's size:

```ts
const bakery = new StickerBakery(app.renderer);          // ink 3%, border 5% of the longest side
sprite.texture = bakery.bake(Texture.from('sym-H1'));     // cached per texture and setting
const cyan = bakery.bake(Texture.from('cap-blank'), { tint: 0x2ec4ff });   // the art tinted, the border still white
```

`ink: 0` drops the line: the white border meets the art directly, with no dark lip over its edge.
`wobble` lets the border swell and thin along the outline in a few slow waves (0.3 is up to 30 %
either way), the way a sticker cut by hand does; `seed` picks the waves, so the same seed gives the
same cut. `shadow` bakes a soft halo under the whole sticker (its blur as a share of the longest
side; `shadowAlpha`, `shadowOffset` and `shadowColor` tune it), with no blur filter per sprite at
run time:

```ts
const handCut = new StickerBakery(app.renderer, { ink: 0, border: 0.05, wobble: 0.45 });
const lifted = handCut.bake(Texture.from('sym-H1'), { shadow: 0.025 });
```

The distance to the shape is an exact Euclidean distance transform on the CPU (a few milliseconds
for a 512 px piece), so the border is round and smooth. The result is `2 × pad` larger than the
source: fit it into its cell as you would the art. An atlas frame or an image is read straight from
its pixels (a trimmed frame goes back to its original size, so the piece keeps its centre); only a
render texture (a drawn letter, a snapshot) is read back through the GPU, which stalls the frame, so
keep those few. Bake every piece while the loader is up (the game knows its symbol ids) and yield a
frame now and then: a bake in the middle of a spin is a hitch, and a run of them delays the
platform's loader fade. For the HUD's own images (the rules window, the buy cards), which leave the
canvas, bake with the same numbers offline; Luck City's `tools/art/compose.py` does that with PIL.
