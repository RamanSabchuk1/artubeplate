// The HUD's one look: the classic slot bar, written from scratch for the @open-slot-ui/dom markup
// contract (the ids, `icon-*` classes, `is-*` state classes and `data-state` / `data-channel`
// attributes the binding maintains). The core always mounts it; there is no skin to choose.
//
// Desktop: an 840px plate along the bottom with the ☰ toggle, BALANCE / WIN, and a boxed action
// panel (BET with its ladder bar, ▲▼, the 112px round SPIN, autoplay); the 84px BUY BONUS
// coin sits off its left end. During free spins the action box gives way to TOTAL WIN | FREE
// SPINS. The BONUS BUY sheet lays 240px white cards over the dimmed game with full-width BUY
// BONUS / ACTIVATE bars; the ☰ menu and the autoplay panel are near-black. Touch: SPIN between −
// and + over a readout strip, ☰ and autoplay in the corners, the menu as a grid of tiles. A phone
// held sideways keeps the strip, thin, and stands SPIN with − and + as a column at the right edge
// so the game has the height and the middle of the screen.
//
// The colours are custom properties on the HUD root; the `--hg-*` aliases feed open-ui's
// rules-block stylesheet so the INFO window wears the same palette.

import { ICON_CSS, ICONS } from './icons';

const ROOT = '.OpenSlotUiContainer';
/* The rules blocks: open-slot-ui scopes their stylesheet as `div[data-channel] .GameInfoWindow`, so a
   restatement here needs the window's id to win. */
const RB = `${ROOT}[data-channel] #GameInfoWindow`;

export const artubeplateSkinCss = /* css */ `
${ROOT} {
  /* The palette and the type are open-slot-ui's theme: the variables its binding writes on this
     root when a game's theme changes them, and the library's own defaults (defaultTheme) when
     it does not. Nothing here departs from those defaults. */
  --hs-font: var(--ohm-font, system-ui, sans-serif);
  --hs-text: var(--ohm-text, #fafafa);
  --hs-muted: var(--ohm-text-dim, #adb5bd);
  --hs-plate: rgba(var(--hg-bg-user-panel-rgb, 0, 0, 0), 0.6);
  --hs-panel: var(--ohm-surface-alt, #0d0d0d);
  --hs-surface: var(--ohm-surface, #262626);
  --hs-edge: var(--ohm-rule, #000000);
  --hs-divider: rgba(173, 181, 189, 0.25);
  --hs-yellow: var(--ohm-accent, #ffc529);
  /* The buy colour (theme.color.featureBuy / featureBuyText): the coin, and the accents while a
     lucky bet or a bought feature is on. open-slot-ui's own default (orange, white type) unless
     the game's theme sets them. */
  --hs-buy: var(--ohm-feature-buy, var(--hs-orange));
  --hs-buy-ink: var(--ohm-feature-buy-text, #fff);
  --hs-yellow-2: var(--ohm-accent, #ffc529);
  --hs-green: #47b04b;
  --hs-orange: #ff5e00;
  --hs-pill: #595959;
  --hs-ink: var(--ohm-accent-text, #000000);
  --hs-card: #ffffff;
  --hs-card-ink: #000000;
  --hs-veil: rgba(45, 45, 45, 0.7);
  --hs-soft: rgba(33, 37, 41, 0.5);
  --hs-motion: var(--ohm-motion-base, 200ms);
  /* open-ui's rules blocks read these. */
  --hg-bg-accent: var(--hs-yellow);
  --hg-text-color-inverse: var(--hs-ink);
  --hg-bg-primary: var(--hs-panel);
  --hg-bg-secondary: var(--hs-surface);
  --hg-bg-tertiary: var(--hs-panel);
  --hg-text-color: var(--hs-text);
  --hg-text-color-secondary: var(--hs-muted);
  position: fixed;
  inset: 0;
  z-index: 20;
  pointer-events: none;
  font-family: var(--hs-font);
  color: var(--hs-text);
  -webkit-font-smoothing: antialiased;
  -webkit-tap-highlight-color: transparent;
  user-select: none;
  font-size: 16px;
  line-height: 1.25;
}
${ROOT} *, ${ROOT} *::before, ${ROOT} *::after { box-sizing: border-box; }
${ROOT} button { font: inherit; color: inherit; background: none; border: 0; padding: 0; margin: 0; cursor: pointer; appearance: none; -webkit-appearance: none; }
/* No focus rings: the bar is played with the pointer and a few keys, its controls stay out of the
   Tab order and never keep the focus (open-slot-ui's \`focus\` option, off by default). */
${ROOT} :focus, ${ROOT} :focus-visible { outline: none; }
${ROOT} ul { list-style: none; margin: 0; padding: 0; }
${ROOT} p, ${ROOT} h3 { margin: 0; }

/* ── icons (masks — they wear currentColor) ─────────────────────────────────── */
${ROOT} [class^="icon-"], ${ROOT} [class*=" icon-"] {
  display: inline-block;
  width: 1em;
  height: 1em;
  flex: none;
  background-color: currentColor;
  -webkit-mask: var(--ap-icon) center / contain no-repeat;
  mask: var(--ap-icon) center / contain no-repeat;
}
${ICON_CSS}

/* ── the things that only exist when the binding says so ───────────────────── */
${ROOT} .DataPanelItem,
${ROOT} .FeatureTotalWin,
${ROOT} .FeatureCounter,
${ROOT} #FeatureBuyToggle,
${ROOT} #FeatureBuyActiveModifierNotice,
${ROOT} #PlaceBetBtn, ${ROOT} #StopBtn, ${ROOT} #StartAutoplayBtn, ${ROOT} #StopAutoplayBtn,
${ROOT} #MainMenu, ${ROOT} #AutoplayNav, ${ROOT} #AdvancedAutoplaySections,
${ROOT} #FeedbackMsg,
${ROOT} .Modal, ${ROOT} #DialogWindow,
${ROOT} #CoreOverlay, ${ROOT} #RtpOverlay, ${ROOT} #MaxWinOverlayContainer, ${ROOT} #MaxWinOddsOverlay,
${ROOT} #SessionTimer, ${ROOT} #NetPosition,
${ROOT} #FeatureBuyBody, ${ROOT} #FeatureBuyConfirmBody { display: none; }
${ROOT} .DataPanelItem.is-visible,
${ROOT} .FeatureTotalWin.is-visible,
${ROOT} .FeatureCounter.is-visible { display: flex; }
${ROOT} #SpelpausItems, ${ROOT} .CoreOverlay--game-branding, ${ROOT} #FeatureBuyConfirmBoxFooter, ${ROOT} .ToggleButton__container--feature-promotion { display: none !important; }
${ROOT} button:disabled, ${ROOT} .is-disabled { opacity: 0.4; cursor: default; }

/* ── the plate ─────────────────────────────────────────────────────────────── */
${ROOT} .UiUserPanelWrapper {
  position: absolute;
  bottom: 20px;
  left: 0;
  z-index: 30;
  transform-origin: 0 100%;
  pointer-events: none;
  transition: opacity 0.3s, visibility 0s;
}
/* a bonus screen is up (the rules, the total): the bar steps out of the way */
${ROOT}[data-state="hidden"] .UiUserPanelWrapper { opacity: 0; visibility: hidden; transition: opacity 0.3s, visibility 0s linear 0.3s; }
${ROOT} .UiRibbonUserPanel__container {
  position: relative;
  width: 840px;
  height: 90px;
  padding: 10px 4.8px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--hs-plate);
  border-radius: 2px;
  box-shadow: 0 3px 5px 3px rgba(0, 0, 0, 0.3);
  pointer-events: auto;
}
${ROOT} .UiRibbonUserPanel, ${ROOT} .MainPanel { height: 100%; }
${ROOT} .MainPanel { width: 100%; }
${ROOT} .MainPanel__container { display: flex; align-items: center; justify-content: space-between; height: 100%; width: 100%; }
${ROOT} .divider--vertical { flex: none; width: 0.5px; min-width: 0.5px; align-self: stretch; margin: -10px 0; background: var(--hs-divider); }

/* readouts */
${ROOT} .DataPanel { position: relative; display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; height: 100%; }
${ROOT} .ToggleButton__container--main-menu { display: flex; align-items: center; justify-content: center; width: 56px; height: 56px; flex: none; }
${ROOT} #MainMenuToggle { width: 55px; height: 56px; margin-left: 1px; display: grid; place-items: center; font-size: 33px; color: #e6e6e6; transition: color var(--hs-motion); }
${ROOT} #MainMenuToggle:hover { color: #fff; }
${ROOT} .MainPanel.main-menu-active #MainMenuToggle .icon-menu { --ap-icon: ${ICONS['menu-close']}; }
${ROOT} .DataPanel__container { display: flex; align-items: center; gap: 16px; padding-left: 8px; min-width: 0; }
${ROOT} .DataPanelItem { flex-direction: column; justify-content: center; min-width: 0; }
${ROOT} .DataPanelItem .ItemWrapper__inner { display: flex; flex-direction: column; }
${ROOT} .DataPanelItem__label { font-size: 14px; font-weight: 400; line-height: 16px; text-transform: uppercase; color: #fff; white-space: nowrap; }
${ROOT} .DataPanelItem__value { font-size: 24px; font-weight: 700; line-height: 24px; color: #fff; white-space: nowrap; font-variant-numeric: tabular-nums; }
${ROOT} .DataPanelItem__value[data-charcount="9"], ${ROOT} .DataPanelItem__value[data-charcount="10"] { font-size: 20.6px; line-height: 21px; }
${ROOT} .DataPanelItem__value[data-charcount="11"], ${ROOT} .DataPanelItem__value[data-charcount="12"] { font-size: 18.5px; line-height: 19px; }
${ROOT} .DataPanelItem__value[data-charcount="13"], ${ROOT} .DataPanelItem__value[data-charcount="14"] { font-size: 16.5px; line-height: 17px; }
${ROOT} .DataPanelItem__value[data-charcount="15"], ${ROOT} .DataPanelItem__value[data-charcount="16"], ${ROOT} .DataPanelItem__value[data-charcount="17"] { font-size: 14px; line-height: 15px; }
${ROOT} .DataPanelItem__value[data-charcount="18"], ${ROOT} .DataPanelItem__value[data-charcount="19"], ${ROOT} .DataPanelItem__value[data-charcount="20"], ${ROOT} .DataPanelItem__value[data-charcount="21"] { font-size: 12px; line-height: 13px; }
/* the stake has its own box on desktop; the strip's BET readout is for touch */
${ROOT} #BetAmountStaticItem { display: none; }
${ROOT} .FreeRoundsCounter .DataPanelItem__value, ${ROOT} .FreeRoundsWin .DataPanelItem__value { color: var(--hs-yellow); }

/* free spins: the round button and the coin step aside, TOTAL WIN | FREE SPINS take a box of their own
   and the stake shows among the readouts */
${ROOT} .FeaturePanel { display: none; }
${ROOT}[data-state^="feature"] .FeaturePanel {
  display: flex; align-items: center; justify-content: space-between; align-self: stretch;
  overflow: hidden;
  background: var(--hs-surface); border: 3px solid var(--hs-edge); border-radius: 3px;
}
${ROOT} .FeaturePanel > .divider--vertical { margin: 0; }
/* The divider stands only between two visible halves. With one half hidden (the counter leaves
   before TOTAL WIN does) a lone divider would cut the other half's text in two. */
${ROOT} .FeaturePanel > .divider--vertical:first-child, ${ROOT} .FeaturePanel > .divider--vertical:last-child,
${ROOT} .FeaturePanel > :not(.is-visible) + .divider--vertical,
${ROOT} .FeaturePanel > .divider--vertical:has(+ :not(.is-visible)) { display: none; }
/* The free-rounds box wears .FeaturePanel too, so the feature-state rule above would show it empty
   (a bordered sliver around its divider, behind SPIN in the base game but bare in a bonus, where
   SPIN steps aside). It shows only while it is the library's visible free-rounds box. */
${ROOT}[data-state^="feature"] .FreeRoundsPanel:not(.is-visible) { display: none; }
${ROOT} .FeatureTotalWin, ${ROOT} .FeatureCounter { flex-direction: column; justify-content: center; min-width: 72px; padding: 0 10px; }
/* Hold & Win lives (featureCounter.lives): pips instead of the number */
${ROOT} .LivesPips { display: none; gap: 5px; align-items: center; justify-content: center; height: 20px; }
${ROOT} .FeatureCounter.has-lives #FeatureCounterValue { display: none; }
${ROOT} .FeatureCounter.has-lives .LivesPips { display: flex; }
${ROOT} .LivesPips i { width: 12px; height: 12px; border-radius: 50%; background: var(--hs-yellow); box-shadow: 0 0 0 2px rgba(0, 0, 0, 0.55); transition: transform 0.2s, background-color 0.2s; }
${ROOT} .LivesPips i.is-spent { background: #3b3b3b; transform: scale(0.78); }
${ROOT}[data-state^="feature"] .ActionPanel, ${ROOT}[data-state^="feature"] .ToggleButton__container--feature-buy { display: none; }
${ROOT}[data-state^="feature"] .UiRibbonUserPanel__container { height: 70px; padding: 4px; }
${ROOT}[data-state^="feature"] .DataPanel { gap: 4px; }
${ROOT}[data-state^="feature"] .DataPanel > .divider--vertical { margin: -4px 0; }
${ROOT}[data-state^="feature"] #BetAmountStaticItem.is-visible { display: flex; }
/* The takeover box wears .FeaturePanel, but this skin dresses .FeaturePanel only in a feature state:
   frame it like the free-spins box here. On a phone it sits where SPIN was (the bar is display:
   block there, so pin it), clear of the bottom strip's readout sizes. */
${ROOT}[data-openui-free-rounds="true"] .FreeRoundsPanel.is-visible {
  align-self: stretch; align-items: center; gap: 0; padding: 0; overflow: hidden;
  background: var(--hs-surface); border: 3px solid var(--hs-edge); border-radius: 3px;
}
${ROOT} .FreeRoundsPanel > .divider--vertical { margin: 0; }
${ROOT} .FreeRoundsPanel .DataPanelItem { align-items: center; min-width: 96px; padding: 0 14px; }
${ROOT}[data-channel="mobile"][data-openui-free-rounds="true"] .FreeRoundsPanel.is-visible {
  position: absolute; left: 50%; right: auto; top: 22px; transform: translateX(-50%);
  width: auto; height: 56px; min-height: 0; align-items: stretch;
  background: rgba(13, 13, 13, 0.75); border: 1px solid rgba(173, 181, 189, 0.15); border-radius: 4px;
}
${ROOT}[data-channel="mobile"] .FreeRoundsPanel .DataPanelItem { flex: none; justify-content: center; min-width: 0; padding: 6px 14px; }
${ROOT}[data-channel="mobile"] .FreeRoundsPanel .DataPanelItem__label { font-size: 10px; line-height: 12.5px; }
${ROOT}[data-channel="mobile"] .FreeRoundsPanel .DataPanelItem__value { font-size: 14px !important; line-height: 17px !important; }
${ROOT}[data-channel="mobile"] .FreeRoundsPanel #FreeRoundsCounterValue { font-size: 22px !important; line-height: 24px !important; }
${ROOT}[data-state^="feature"] #FeedbackMsg.is-visible { top: -50px; }
/* …and over the lucky-bet plaque on the plate's top edge (desktop; on a phone it drops from the top). */
${ROOT}:not([data-channel="mobile"]) .UiUserPanelWrapper.bet-modifier-active #FeedbackMsg.is-visible { top: -50px; }

/* the action box: BET, ▲▼, SPIN, autoplay */
${ROOT} .ActionPanel {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 70px;
  margin-left: auto;
  background: var(--hs-surface);
  border: 3px solid var(--hs-edge);
  border-radius: 3px;
}
${ROOT} .ActionPanel > .divider--vertical { display: none; }
${ROOT} .BetAmountWidget { display: none; }
${ROOT} .BetAmountWidget.is-visible { position: relative; display: block; width: 120px; height: 64px; padding: 0 15px; }
${ROOT} .BetAmountWidget__container { display: flex; flex-direction: column; justify-content: center; height: 100%; }
${ROOT} .BetAmountWidget__label { font-size: 14px; font-weight: 400; line-height: 16px; text-transform: uppercase; color: #fff; }
${ROOT} .BetAmountWidget__value { font-size: 24px; font-weight: 700; line-height: 24px; color: #fff; white-space: nowrap; font-variant-numeric: tabular-nums; }
/* The stake's box leaves 90px for its value, narrower than the strip's readouts: it gets its own
   steps by length (the widest real strings measured: €1,000.00, 100.00 DEMO, 10,000.00 USDT),
   so a long stake shrinks instead of running under ▲▼. Past 21 characters it clips (across only:
   its descenders keep showing). */
${ROOT} .BetAmountWidget__value[data-charcount] { max-width: 100%; overflow-x: clip; }
${ROOT} .BetAmountWidget__value[data-charcount="7"] { font-size: 21px; line-height: 22px; }
${ROOT} .BetAmountWidget__value[data-charcount="8"] { font-size: 18.5px; line-height: 19px; }
${ROOT} .BetAmountWidget__value[data-charcount="9"] { font-size: 16.5px; line-height: 17px; }
${ROOT} .BetAmountWidget__value[data-charcount="10"] { font-size: 14.5px; line-height: 16px; }
${ROOT} .BetAmountWidget__value[data-charcount="11"] { font-size: 13px; line-height: 15px; }
${ROOT} .BetAmountWidget__value[data-charcount="12"] { font-size: 12px; line-height: 14px; }
${ROOT} .BetAmountWidget__value[data-charcount="13"] { font-size: 11.5px; line-height: 13px; }
${ROOT} .BetAmountWidget__value[data-charcount="14"] { font-size: 10.5px; line-height: 12px; }
${ROOT} .BetAmountWidget__value[data-charcount="15"] { font-size: 10px; line-height: 12px; }
${ROOT} .BetAmountWidget__value[data-charcount="16"], ${ROOT} .BetAmountWidget__value[data-charcount="17"], ${ROOT} .BetAmountWidget__value[data-charcount="18"], ${ROOT} .BetAmountWidget__value[data-charcount="19"], ${ROOT} .BetAmountWidget__value[data-charcount="20"], ${ROOT} .BetAmountWidget__value[data-charcount="21"] { font-size: 9px; line-height: 11px; }
${ROOT} .BetAmountProgressbar { position: absolute; left: 0; right: 0; bottom: 0; display: block; height: 5px; background: rgba(0, 0, 0, 0.9); }
${ROOT} .BetAmountProgressbar__inner { display: block; height: 100%; background: #fff; transition: width var(--hs-motion) linear; }
${ROOT} .ActionPanel__container--game-actions { display: flex; align-items: center; height: 100%; }
${ROOT} .BetAmountChangersWidget { display: flex; flex-direction: column; justify-content: center; height: 100%; border-left: 1px solid rgba(0, 0, 0, 0.6); }
${ROOT} .BetAmountChangersWidget button { width: 49px; height: 32px; display: grid; place-items: center; font-size: 22px; border-radius: 4px; color: var(--hs-text); transition: background var(--hs-motion); }
${ROOT} .BetAmountChangersWidget button:hover:not(:disabled) { background: rgba(255, 255, 255, 0.07); }

/* the round button */
${ROOT} .CircleButton--place-bet, ${ROOT} .CircleButton--stop-round, ${ROOT} .CircleButton--start-autoplay, ${ROOT} .CircleButton--stop-autoplay {
  position: relative;
  width: 112px;
  height: 112px;
  margin: -21px 0;
  border-radius: 50%;
  place-items: center;
  color: var(--hs-text);
  background: var(--hs-surface);
  border: 3px solid #000;
  transition: transform var(--hs-motion), color var(--hs-motion);
}
${ROOT} #PlaceBetBtn.is-visible, ${ROOT} #StopBtn.is-visible, ${ROOT} #StartAutoplayBtn.is-visible, ${ROOT} #StopAutoplayBtn.is-visible { display: grid; }
${ROOT} .CircleButton--place-bet:hover:not(:disabled) { color: #fff; }
${ROOT} .CircleButton--place-bet:active:not(:disabled) { transform: scale(0.96); }
${ROOT} .ActionPanel.disabled-slam-stop .CircleButton--place-bet:disabled { opacity: 0.6; }
${ROOT}[data-state="play"] .CircleButton--place-bet .icon-spin,
${ROOT}[data-state="autoplay"] .CircleButton--place-bet .icon-spin { animation: hs-rotate 0.8s linear infinite; }
${ROOT} .CircleButton--place-bet .icon-spin { font-size: 93px; }
${ROOT} .CircleButton--start-autoplay { font-size: 106px; }
/* The slam-stop square and the autoplay counter are the library's own: the stop glyph is a full
   square at --hg-btn-font-size × --ohm-stop-scale (open-slot-ui sizes the button's font), and
   during autoplay the counter is its white box over the hidden stop glyph. */
${ROOT} { --hg-btn-font-size: 3.25rem; }
/* The library's own rule, restated at this skin's specificity: the button reset above
   (font: inherit) would otherwise win over it. Same variables, so --ohm-stop-scale still works. */
${ROOT} .CircleButton--stop-round { font-size: calc(var(--hg-btn-font-size, 3.25rem) * var(--ohm-stop-scale, 1.34)); }
/* The autoplay counter: the STOP square itself with the count in it, the size of the slam-stop
   glyph (--hg-btn-font-size × --ohm-stop-scale, about 70px in the 112px button), so autoplay's
   stop reads as the stop it is and not a squashed pill. The library's pill (1.5rem type, its own
   padding and min-width) is restated square; the type fits four digits. */
${ROOT} { --ohm-counter-size: 1.85rem; --ohm-counter-radius: 14px; }
${ROOT}[data-state="autoplay"] #StopAutoplayBtn .AutoplayCounter, ${ROOT}[data-state="gameRoundEnterAutoplay"] #StopAutoplayBtn .AutoplayCounter {
  width: calc(var(--hg-btn-font-size, 3.25rem) * var(--ohm-stop-scale, 1.34));
  height: calc(var(--hg-btn-font-size, 3.25rem) * var(--ohm-stop-scale, 1.34));
  min-width: 0; padding: 0; box-sizing: border-box; align-items: center;
}
${ROOT} .ActionPanel__container--autoplay { display: flex; align-items: center; height: 100%; }
${ROOT} #AutoplayBtn { width: 60px; height: 60px; display: grid; place-items: center; font-size: 34px; border-radius: 50%; color: var(--hs-text); transition: color var(--hs-motion); }
${ROOT} #AutoplayBtn:hover:not(:disabled) { color: var(--hs-yellow); }
${ROOT} .MainPanel.autoplay-menu-active #AutoplayBtn .icon-autoplay2 { --ap-icon: ${ICONS['menu-close']}; font-size: 20px; }

/* a lucky bet / ante is on (the binding marks the wrapper .bet-modifier-active), as in the
   reference: the round button and the autoplay start fill with the buy colour, so do the ladder
   bar and the stake among the readouts, and a plaque in that colour reads "<NAME> ACTIVATED"
   along the plate's top edge for five seconds (on a phone it drops in from the top of the screen
   and goes back up). The coin turns DISABLE in the same colour. */
${ROOT} .UiUserPanelWrapper.bet-modifier-active .BetAmountProgressbar__inner { background: var(--hs-buy); }
${ROOT} .UiUserPanelWrapper.bet-modifier-active #BetAmountStaticValue { color: var(--hs-buy); }
${ROOT} .UiUserPanelWrapper.bet-modifier-active .CircleButton--place-bet,
${ROOT} .UiUserPanelWrapper.bet-modifier-active .CircleButton--start-autoplay { background: var(--hs-buy); color: var(--hs-buy-ink); }
${ROOT} .UiUserPanelWrapper.bet-modifier-active .CircleButton--place-bet:hover:not(:disabled) { color: var(--hs-buy-ink); }
${ROOT} #FeatureBuyActiveModifierNotice.is-visible {
  display: flex; align-items: center; justify-content: center;
  position: absolute; left: 0; right: 0; bottom: 100%; height: 20px;
  padding: 0 10px; border-radius: 2px 2px 0 0;
  background: var(--hs-buy); color: var(--hs-buy-ink);
  font-size: 12px; font-weight: 700; line-height: 20px; text-transform: uppercase; white-space: nowrap;
  pointer-events: none;
  animation: hs-modifier-plaque 5s ease-in-out both;
}
@keyframes hs-modifier-plaque { 0% { opacity: 0; } 15%, 75% { opacity: 1; } 100% { opacity: 0; } }
@keyframes hs-modifier-plaque-drop {
  0% { transform: translateY(-60px); }
  20%, 80% { transform: translateY(0); }
  99% { opacity: 1; }
  100% { opacity: 0; transform: translateY(-60px); }
}

/* the BUY BONUS coin hangs off the left of the plate */
${ROOT} .ToggleButton__container--feature-buy { position: absolute; right: 100%; top: 45px; margin-right: 16.8px; transform: translateY(-50%); }
${ROOT} #FeatureBuyToggle.is-visible {
  display: grid; place-items: center;
  width: 84px; height: 84px;
  padding: 12px;
  border-radius: 50%;
  text-align: center;
  font-size: 13px; font-weight: 700; line-height: 1.1; text-transform: uppercase;
  color: var(--hs-buy-ink);
  background: var(--hs-buy);
  box-shadow: inset 0 0 0 3px var(--hs-buy), inset 0 0 0 5.5px var(--hs-buy-ink), 0 2px 6px rgba(0, 0, 0, 0.4);
  transform: rotate(-45deg);
  pointer-events: auto;
  transition: filter var(--hs-motion);
}
${ROOT} #FeatureBuyToggle.is-visible:hover:not(:disabled) { filter: brightness(1.06); }

/* the one-line message over the plate */
${ROOT} #FeedbackMsg.is-visible {
  display: block;
  position: absolute; left: 0; right: 0; top: -30px; height: 20px;
  text-align: center;
  font-size: 16px; font-weight: 700; line-height: 20px; text-transform: uppercase; white-space: nowrap;
  color: #fff;
  text-shadow: 0 1px 3px rgba(0, 0, 0, 0.8);
  pointer-events: none;
}

/* ── the ☰ menu ─────────────────────────────────────────────────────────────── */
${ROOT} #MainMenu.is-visible {
  display: block;
  position: absolute; left: -4.8px; bottom: 80px;
  width: 224px;
  background: var(--hs-panel);
  border-radius: 3px 3px 0 0;
  pointer-events: auto;
}
${ROOT} .MainMenuItem {
  display: flex; align-items: center; gap: 12px;
  padding: 21.6px 32px;
  font-size: 16px; font-weight: 700; line-height: 20px; text-transform: uppercase;
  cursor: pointer;
  transition: background var(--hs-motion);
}
${ROOT} .MainMenuItem:hover { background: rgba(255, 255, 255, 0.05); }
${ROOT} .MainMenuItem [class^="icon-"], ${ROOT} .Accordion__title [class^="icon-"] { font-size: 24px; }
${ROOT} .MainMenuItem.sound-off, ${ROOT} .MainMenuItem.music-off { color: var(--hs-muted); }
${ROOT} #SoundToggle.sound-off ~ #MusicToggle, ${ROOT} #SoundToggle.sound-off + #MusicToggle { opacity: 0.45; pointer-events: none; }
${ROOT} .MainMenuItem.Accordion { display: block; padding: 0; }
${ROOT} .Accordion__header { display: flex; justify-content: space-between; width: 100%; }
${ROOT} .Accordion__title { display: flex; align-items: center; gap: 12px; flex: 1; padding: 21.6px 32px; }
${ROOT} .Accordion__title[class*="-on"] [class^="icon-"] { color: var(--hs-yellow); }
/* the scope rows under TURBO / SUPER TURBO: BASE GAME / BONUS GAME on one line each, the switch at
   the row's right end. The rows start under the tile's icon (not its text), so in the 224px menu
   column the label keeps 120px: BONUS GAME at 12px bold fits whole. Should a label still be too
   long it ellipsises rather than wrap. */
${ROOT} .Accordion__panel { display: none; padding: 0 12px 14px 40px; }
${ROOT} .Accordion.is-open .Accordion__panel { display: block; }
${ROOT} .Accordion__container { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 34px; }
${ROOT} .Accordion__subtitle { flex: 1 1 auto; min-width: 0; font-size: 12px; font-weight: 700; letter-spacing: 0; color: var(--hs-muted); text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* With the menu open the plate keeps its readouts, the round button and the coin: BALANCE, BET
   and SPIN stay in reach while the menu column stands over the game (QA asked for exactly that).
   open-slot-ui's behaviour sheet, mounted after this one, hides them (visibility + pointer-events)
   under .main-menu-active at a lower weight, so they are restated here. The column ends at the
   plate's top edge (bottom: 80px above), so nothing of it covers them. On a phone the menu is a
   screen of tiles and the strip's readouts and SPIN stay stepped back under it (the touch rules). */
${ROOT}:not([data-channel="mobile"]) .MainPanel.main-menu-active .DataPanel__container,
${ROOT}:not([data-channel="mobile"]) .MainPanel.main-menu-active .FeaturePanel,
${ROOT}:not([data-channel="mobile"]) .MainPanel.main-menu-active .divider--vertical,
${ROOT}:not([data-channel="mobile"]) .MainPanel.main-menu-active .ActionPanel,
${ROOT}:not([data-channel="mobile"]) .MainPanel.main-menu-active .ToggleButton__container--feature-buy { visibility: visible; pointer-events: auto; }
${ROOT}:not([data-channel="mobile"]) .MainPanel.main-menu-active #FeedbackMsg { visibility: visible; }

/* switches: a fixed 44×24 pill, grey with a white knob; on, the pill goes yellow and the knob dark,
   to the right. The same size at every viewport: it is a control, not a share of the row. */
${ROOT} .Toggle, ${ROOT} .Toggle--md { position: relative; display: flex; align-items: center; flex: none; width: 44px; height: 24px; }
${ROOT} .Toggle--input { position: absolute; opacity: 0; width: 1px; height: 1px; pointer-events: none; }
${ROOT} .Toggle--label {
  position: relative; display: block; width: 44px; height: 24px; border-radius: 24px;
  background: var(--hs-pill); cursor: pointer; font-size: 0; color: transparent;
  transition: background var(--hs-motion);
}
${ROOT} .Toggle--label::before { content: ""; position: absolute; top: 3px; left: 3px; width: 18px; height: 18px; border-radius: 50%; background: #fff; transition: left var(--hs-motion), background var(--hs-motion); }
${ROOT} .Toggle--input:checked + .Toggle--label { background: var(--hs-yellow-2); }
${ROOT} .Toggle--input:checked + .Toggle--label::before { left: calc(100% - 21px); background: var(--hs-surface); }
/* open-slot-ui's behaviour sheet (mounted after this one) puts a floor under the switch for a skin
   that stacks the label over it: \`.MainMenuItem.Accordion .Toggle--md { flex: 0 0 auto; width: 100%;
   min-width: var(--ohm-switch-min) }\`, and the same width on the label. In this skin's row (label
   left, switch right) that 100% is the whole row: the switch grew with the tile, could not shrink,
   ran past the tile's edge and squeezed BASE GAME / BONUS GAME onto two lines. The sizes above,
   restated at that rule's specificity. */
${ROOT} .MainMenuItem.Accordion .Toggle, ${ROOT} .MainMenuItem.Accordion .Toggle--md { flex: 0 0 44px; width: 44px; min-width: 44px; }
${ROOT} .MainMenuItem.Accordion .Toggle--label { width: 44px; min-width: 44px; }

/* ── the autoplay panel ────────────────────────────────────────────────────── */
${ROOT} .AutoplayMenuPanel { position: static; }
${ROOT} #AutoplayNav.is-visible {
  display: flex; flex-direction: column; align-items: center;
  position: absolute; right: 0; bottom: 100%;
  width: 352px;
  padding: 0 0 32px;
  background: var(--hs-panel);
  pointer-events: auto;
  /* The ADVANCED sections make the panel taller than a short window: it scrolls instead of
     running off the top of the screen. */
  max-height: calc(100vh - 140px); max-height: calc(100dvh - 140px);
  overflow-y: auto; overscroll-behavior: contain;
}
${ROOT} .AutoplayMenu__inner, ${ROOT} .AutoplayMenu__body { display: flex; flex-direction: column; align-items: center; width: 100%; }
/* BASIC and ADVANCED stack the same way: full-width sections 16px in from the panel's edges */
${ROOT} .AutoplayMenu__container--basic, ${ROOT} #AdvancedAutoplaySections.is-visible { display: flex; flex-direction: column; align-items: stretch; width: 100%; padding: 0 16px; }
${ROOT} .AutoplayMenu__container--super-title { display: flex; justify-content: space-between; gap: 4px; width: 100%; height: 44px; padding: 0 16px; overflow: hidden; }
${ROOT} .AutoplayMenu__super-title { display: flex; align-items: center; max-width: 50%; height: 36px; margin-top: 8px; font-size: 16px; font-weight: 400; line-height: 16px; text-transform: uppercase; }
${ROOT} .ToggleButton--advanced-autoplay-menu {
  display: inline-flex; align-items: center; gap: 4px; flex: none;
  margin-right: -16px; padding: 10px 8px; border-radius: 0 0 0 20px;
  background: var(--hs-yellow); color: #000;
  font-size: 16px; font-weight: 500; line-height: 24px; text-transform: uppercase;
}
${ROOT} .ToggleButton--advanced-autoplay-menu [class^="icon-"] { font-size: 16px; }
${ROOT} .Fieldset { position: relative; display: flex; flex-direction: column; width: 100%; padding-top: 24px; }
${ROOT} .Fieldset::after { content: ""; position: absolute; top: 12px; left: 0; right: 0; height: 1px; background: var(--hs-divider); }
${ROOT} .Fieldset__legend { margin-bottom: 8px; font-size: 16px; line-height: 16px; text-transform: uppercase; color: var(--hs-yellow-2); }
${ROOT} .Fieldset__items-group { display: flex; flex-direction: column; }
${ROOT} .TabGroup__list { display: flex; flex-wrap: wrap; gap: 6px; }
${ROOT} .TabRoundedButton, ${ROOT} .TabComboInput {
  display: inline-flex; align-items: center; justify-content: center; gap: 6px;
  flex: 1 1 auto; min-width: calc(25% - 6px); height: 38px; padding: 10px 8px;
  border-radius: 100px;
  background: var(--hs-pill); color: var(--hs-text);
  font-size: 14px; font-weight: 700; line-height: 18px;
  cursor: pointer;
  transition: background var(--hs-motion), color var(--hs-motion);
}
${ROOT} .TabRoundedButton:hover { background: #6b6b6b; }
${ROOT} .TabRoundedButton.is-selected, ${ROOT} .TabComboInput.is-selected { background: var(--hs-yellow-2); color: var(--hs-ink); }
/* NO LIMIT and CUSTOM share the last row */
${ROOT} .Button--no-loss-limits, ${ROOT} .Button--no-win-limits, ${ROOT} .TabComboInput { flex: 1 1 calc(50% - 6px); }
/* CUSTOM reads as a pill; press it and it becomes the field (the value shows while no chip is picked) */
${ROOT} .TabComboInput { position: relative; overflow: hidden; }
${ROOT} .TabComboInput > span { text-transform: uppercase; }
${ROOT} .TabComboInput input {
  position: absolute; inset: 0; width: 100%; height: 100%;
  border: 0; border-radius: inherit; padding: 0 12px; margin: 0;
  background: transparent; color: var(--hs-ink); caret-color: var(--hs-ink);
  font: inherit; font-weight: 700; text-align: center;
  opacity: 0; cursor: pointer; outline: none;
}
${ROOT} .TabComboInput input::placeholder { color: rgba(13, 13, 13, 0.45); }
/* iOS Safari zooms the page into a focused field whose text is under 16px, and the page stays zoomed
   after the keyboard closes: the CUSTOM fields type at 16px on touch screens and on every iOS browser */
${ROOT}[data-channel="mobile"] .TabComboInput input { font-size: 16px; }
@supports (-webkit-touch-callout: none) { ${ROOT} .TabComboInput input { font-size: 16px; } }
${ROOT} .TabGroup__list:has(.TabComboInput:focus-within) .TabRoundedButton.is-selected { background: var(--hs-pill); color: var(--hs-text); }
${ROOT} .TabComboInput:focus-within,
${ROOT} .TabGroup__list:not(:has(.is-selected)) .TabComboInput:has(input:not(:placeholder-shown)) { background: var(--hs-yellow-2); color: var(--hs-ink); }
${ROOT} .TabComboInput:focus-within > span,
${ROOT} .TabGroup__list:not(:has(.is-selected)) .TabComboInput:has(input:not(:placeholder-shown)) > span { visibility: hidden; }
${ROOT} .TabComboInput:focus-within input,
${ROOT} .TabGroup__list:not(:has(.is-selected)) .TabComboInput:has(input:not(:placeholder-shown)) input { opacity: 1; cursor: text; }
${ROOT} .TabGroup__list__autoplaycost { width: 100%; margin-top: 8px; font-size: 16px; line-height: 20px; color: #fff; }

/* ── windows: BONUS BUY · GAME INFO · HISTORY ─────────────────────────────────── */
${ROOT} .Modal.is-visible { display: block; position: fixed; inset: 0; z-index: 40; pointer-events: auto; }
${ROOT} .Modal.is-visible::before { content: ""; position: absolute; inset: 0; background: var(--hs-veil); }
/* GAME INFO and HISTORY take the screen: the game behind goes grey and blurred under a neutral
   dark veil (no tint), and the bar, the coin and the notices step out while a window is open,
   so nothing but the window and its close button is on screen. */
${ROOT} #GameInfoWindow.is-visible, ${ROOT} #BetHistoryWindow.is-visible { z-index: 45; }
${ROOT} #GameInfoWindow.is-visible::before, ${ROOT} #BetHistoryWindow.is-visible::before { background: rgba(14, 14, 16, 0.8); backdrop-filter: blur(18px) grayscale(1) brightness(0.55); -webkit-backdrop-filter: blur(18px) grayscale(1) brightness(0.55); }
${ROOT} #FeatureBuyWindow.is-visible::before { backdrop-filter: blur(10px) grayscale(0.7); -webkit-backdrop-filter: blur(10px) grayscale(0.7); }
${ROOT}:has(#GameInfoWindow.is-visible) .UiRibbonUserPanel, ${ROOT}:has(#BetHistoryWindow.is-visible) .UiRibbonUserPanel,
${ROOT}:has(#GameInfoWindow.is-visible) .ToggleButton__container--feature-buy, ${ROOT}:has(#BetHistoryWindow.is-visible) .ToggleButton__container--feature-buy,
${ROOT}:has(#GameInfoWindow.is-visible) #FeedbackMsg, ${ROOT}:has(#BetHistoryWindow.is-visible) #FeedbackMsg,
${ROOT}:has(#GameInfoWindow.is-visible) #NotificationHolder, ${ROOT}:has(#BetHistoryWindow.is-visible) #NotificationHolder { visibility: hidden !important; pointer-events: none !important; }
${ROOT} .Modal__container {
  position: relative;
  height: 100%;
  display: flex; flex-direction: column;
  padding: 16px 0 32px;
  color: var(--hs-text);
  user-select: text;
}
${ROOT} .Modal__close-button { position: absolute; top: 0; right: 0; z-index: 3; width: 80px; height: 80px; cursor: pointer; color: var(--hs-muted); transition: color var(--hs-motion); }
${ROOT} .Modal__close-button::before { content: ""; position: absolute; inset: 20px; border: 2px solid currentColor; border-radius: 50%; }
${ROOT} .Modal__close-button span { position: absolute; left: 28px; top: 38.5px; width: 24px; height: 3px; border-radius: 5px; background: currentColor; transform: rotate(45deg); }
${ROOT} .Modal__close-button span::before { content: ""; position: absolute; inset: 0; border-radius: inherit; background: currentColor; transform: rotate(90deg); }
${ROOT} .Modal__close-button:hover { color: #fff; }
${ROOT} .GameInfo__inner, ${ROOT} .BetHistory__inner, ${ROOT} .FeatureBuy__inner { display: flex; flex-direction: column; min-height: 0; flex: 1; }
${ROOT} .Modal__title, ${ROOT} .BetHistory__title { text-align: center; font-size: 24px; font-weight: 700; line-height: 30px; text-transform: uppercase; }
${ROOT} .divider--horizontal { flex: none; height: 1.25px; background: var(--hs-divider); }
${ROOT} .Modal__title .divider--horizontal { margin: 16px 0; }

/* GAME INFO / HISTORY: a column over the dimmed game, the plate stays in front */
${ROOT} #GameInfoWindow .Modal__container, ${ROOT} #BetHistoryWindow .Modal__container { width: 100%; max-width: 840px; margin: 0 auto; padding: 32px 0 40px; }
${ROOT} #GameInfoWindow .Modal__title, ${ROOT} #BetHistoryWindow .Modal__title, ${ROOT} .BetHistory__title { font-size: 20px; line-height: 25px; }
${ROOT} .GameInfo__body { overflow-y: auto; padding: 0 18px 16px 26px; font-size: 16px; line-height: 20px; color: var(--hs-text); }
${ROOT} .GameInfo__body p { margin: 0 0 10px; }
/* ── the rules blocks (open-slot-ui's vocabulary) in this skin: solid and readable ──
   The library sets the type at 14.5px on a dimmed grey; here the body copy is 15.5px on an
   80 % white, the section titles a notch bigger with more air, pictures a fixed 96px beside their
   text (the library's 38 %-of-the-column picture, and full width on a phone, turned a symbol
   into a poster), symbol tiles 56px in the paytable, feature cards with 72px icons, and the
   winning-example grid wide enough to read its letters. */
${RB} .ohm-body { --text: var(--hs-text); --text-dim: color-mix(in srgb, var(--hs-text) 80%, transparent); --accent: var(--hs-yellow); --accent-text: var(--hs-ink); --ohm-gap-lg: 40px; }
${RB} .ohm-body p, ${RB} .ohm-steps { font-size: 15.5px; line-height: 1.65; }
${RB} .ohm-steps li { margin: 8px 0; }
${RB} .ohm-sec { font-size: 16px; letter-spacing: 1.4px; text-align: center; }
${RB} .ohm-subh { font-size: 14.5px; }
${RB} .ohm-media { align-items: center; flex-direction: row; gap: 20px; }
${RB} .ohm-media > img { width: 96px; max-width: 96px; height: 96px; object-fit: contain; }
${RB} .ohm-media-body p { font-size: 15.5px; }
${RB} .ohm-symbols .ohm-symimg { width: 56px; height: 56px; }
${RB} .ohm-symbols .ohm-symcell { padding: 6px 10px 6px 0; }
${RB} .ohm-symbols th[scope=row] { font-size: 15px; }
${RB} .ohm-table td, ${RB} .ohm-table th { font-size: 15px; }
${RB} .ohm-table th { font-size: 12.5px; }
${RB} .ohm-stats dt { font-size: 14.5px; }
${RB} .ohm-stats dd { font-size: 15px; }
${RB} .ohm-kv dt, ${RB} .ohm-kv dd { font-size: 14.5px; }
${RB} .ohm-cards { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
${RB} .ohm-fcard { padding: 18px 12px 16px; }
${RB} .ohm-fcard img { width: 72px; height: 72px; object-fit: contain; margin-bottom: 12px; }
${RB} .ohm-fcard h5 { font-size: 14px; letter-spacing: .5px; text-transform: uppercase; }
${RB} .ohm-fcard p { font-size: 13.5px; line-height: 1.5; }
${RB} .ohm-callout p { font-size: 15px; }
${RB} .ohm-legal { font-size: 13px; line-height: 1.6; opacity: .9; }
${RB} .ohm-rgrid .ohm-linegrid { width: min(240px, 100%); gap: 4px; }
${RB} .ohm-rgrid .ohm-linegrid i { font-size: 13px; }
${RB} .ohm-rgrid figcaption { font-size: 14px; color: var(--text); }
${RB} .ohm-lines { gap: 18px 12px; }
${ROOT}[data-channel="mobile"] #GameInfoWindow .ohm-media > img { width: 72px; max-width: 72px; height: 72px; }
${ROOT}[data-channel="mobile"] #GameInfoWindow .ohm-symbols .ohm-symimg { width: 46px; height: 46px; }
${ROOT}[data-channel="mobile"] #GameInfoWindow .ohm-cards { grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); }
/* ── small motion in the rules, and nowhere else ──────────────────────────────────
   Entrances run once as the window opens (its blocks render on is-visible): every block of the
   document rises in a few pixels, staggered down the page for the first dozen. Then a slow idle
   only the rules carry: the paytable's symbol tiles and the feature cards' icons bob gently, out
   of phase row by row; the paylines light up one after another in a wave across the grid; the
   winning example's lit cells pulse together; a special symbol's picture tilts a degree or two.
   Off under reduced motion. */
@keyframes hs-rules-rise { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
@keyframes hs-rules-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-3px); } }
@keyframes hs-rules-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.55; } }
@keyframes hs-rules-lit { 0%, 60%, 100% { background: #111; } 12% { background: var(--hs-yellow); } }
@keyframes hs-rules-tilt { 0%, 100% { transform: rotate(-2deg); } 50% { transform: rotate(2deg); } }
${RB} .ohm-body > * { animation: hs-rules-rise 360ms cubic-bezier(0.2, 0.7, 0.2, 1) both; }
${RB} .ohm-body > :nth-child(2) { animation-delay: 45ms; }
${RB} .ohm-body > :nth-child(3) { animation-delay: 90ms; }
${RB} .ohm-body > :nth-child(4) { animation-delay: 135ms; }
${RB} .ohm-body > :nth-child(5) { animation-delay: 180ms; }
${RB} .ohm-body > :nth-child(6) { animation-delay: 225ms; }
${RB} .ohm-body > :nth-child(7) { animation-delay: 270ms; }
${RB} .ohm-body > :nth-child(8) { animation-delay: 315ms; }
${RB} .ohm-body > :nth-child(9) { animation-delay: 360ms; }
${RB} .ohm-body > :nth-child(10) { animation-delay: 405ms; }
${RB} .ohm-body > :nth-child(11) { animation-delay: 450ms; }
${RB} .ohm-body > :nth-child(12) { animation-delay: 495ms; }
${RB} .ohm-symbols .ohm-symimg { animation: hs-rules-bob 3.2s ease-in-out infinite; }
${RB} .ohm-symbols tr:nth-child(2n) .ohm-symimg { animation-delay: -1.6s; }
${RB} .ohm-symbols tr:nth-child(3n) .ohm-symimg { animation-delay: -0.8s; }
${RB} .ohm-fcard img { animation: hs-rules-bob 3.6s ease-in-out infinite; }
${RB} .ohm-fcard:nth-child(2n) img { animation-delay: -1.8s; }
${RB} .ohm-fcard:nth-child(3n) img { animation-delay: -0.9s; }
${RB} .ohm-lines .ohm-line i.on { animation: hs-rules-lit 4.8s ease-in-out infinite; }
${RB} .ohm-lines .ohm-line:nth-child(2) i.on { animation-delay: 0.16s; }
${RB} .ohm-lines .ohm-line:nth-child(3) i.on { animation-delay: 0.32s; }
${RB} .ohm-lines .ohm-line:nth-child(4) i.on { animation-delay: 0.48s; }
${RB} .ohm-lines .ohm-line:nth-child(5) i.on { animation-delay: 0.64s; }
${RB} .ohm-lines .ohm-line:nth-child(6) i.on { animation-delay: 0.8s; }
${RB} .ohm-lines .ohm-line:nth-child(7) i.on { animation-delay: 0.96s; }
${RB} .ohm-lines .ohm-line:nth-child(8) i.on { animation-delay: 1.12s; }
${RB} .ohm-lines .ohm-line:nth-child(9) i.on { animation-delay: 1.28s; }
${RB} .ohm-lines .ohm-line:nth-child(10) i.on { animation-delay: 1.44s; }
${RB} .ohm-lines .ohm-line:nth-child(11) i.on { animation-delay: 1.6s; }
${RB} .ohm-lines .ohm-line:nth-child(12) i.on { animation-delay: 1.76s; }
${RB} .ohm-lines .ohm-line:nth-child(13) i.on { animation-delay: 1.92s; }
${RB} .ohm-lines .ohm-line:nth-child(14) i.on { animation-delay: 2.08s; }
${RB} .ohm-lines .ohm-line:nth-child(15) i.on { animation-delay: 2.24s; }
${RB} .ohm-lines .ohm-line:nth-child(16) i.on { animation-delay: 2.4s; }
${RB} .ohm-lines .ohm-line:nth-child(17) i.on { animation-delay: 2.56s; }
${RB} .ohm-lines .ohm-line:nth-child(18) i.on { animation-delay: 2.72s; }
${RB} .ohm-lines .ohm-line:nth-child(19) i.on { animation-delay: 2.88s; }
${RB} .ohm-lines .ohm-line:nth-child(20) i.on { animation-delay: 3.04s; }
${RB} .ohm-lines .ohm-line:nth-child(21) i.on { animation-delay: 3.2s; }
${RB} .ohm-lines .ohm-line:nth-child(22) i.on { animation-delay: 3.36s; }
${RB} .ohm-lines .ohm-line:nth-child(23) i.on { animation-delay: 3.52s; }
${RB} .ohm-lines .ohm-line:nth-child(24) i.on { animation-delay: 3.68s; }
${RB} .ohm-lines .ohm-line:nth-child(25) i.on { animation-delay: 3.84s; }
${RB} .ohm-lines .ohm-line:nth-child(26) i.on { animation-delay: 4.0s; }
${RB} .ohm-lines .ohm-line:nth-child(27) i.on { animation-delay: 4.16s; }
${RB} .ohm-lines .ohm-line:nth-child(28) i.on { animation-delay: 4.32s; }
${RB} .ohm-lines .ohm-line:nth-child(29) i.on { animation-delay: 4.48s; }
${RB} .ohm-lines .ohm-line:nth-child(30) i.on { animation-delay: 4.64s; }
${RB} .ohm-rgrid .ohm-linegrid i.on { animation: hs-rules-pulse 2.2s ease-in-out infinite; }
${RB} .ohm-media > img { animation: hs-rules-tilt 5s ease-in-out infinite; }
@media (prefers-reduced-motion: reduce) {
  ${RB} .ohm-body > *, ${RB} .ohm-symbols .ohm-symimg, ${RB} .ohm-fcard img, ${RB} .ohm-lines .ohm-line i.on, ${RB} .ohm-rgrid .ohm-linegrid i.on, ${RB} .ohm-media > img { animation: none; }
}
${ROOT}[data-motion="reduced"] #GameInfoWindow .ohm-body > *, ${ROOT}[data-motion="reduced"] #GameInfoWindow .ohm-symimg, ${ROOT}[data-motion="reduced"] #GameInfoWindow .ohm-fcard img, ${ROOT}[data-motion="reduced"] #GameInfoWindow .ohm-linegrid i.on, ${ROOT}[data-motion="reduced"] #GameInfoWindow .ohm-media > img { animation: none; }
${ROOT} .BetHistoryNavBar__navlist { display: flex; gap: 8px; padding: 14px 0; flex-wrap: wrap; justify-content: center; }
${ROOT} .BetHistoryNavBar__button { display: flex; flex-direction: column; align-items: center; padding: 8px 14px; border-radius: 100px; background: var(--hs-pill); font-size: 12px; font-weight: 700; text-transform: uppercase; }
${ROOT} .BetHistoryNavBar__subtitle { font-weight: 400; color: #ddd; }
${ROOT} .BetHistory__table-container { overflow-y: auto; padding: 0 18px 16px 26px; }
${ROOT} .BetHistory__table { width: 100%; border-collapse: collapse; font-size: 15px; font-variant-numeric: tabular-nums; }
${ROOT} .BetHistory__table th { text-align: left; padding: 8px 6px; font-size: 12px; text-transform: uppercase; color: var(--hs-yellow); border-bottom: 1px solid var(--hs-divider); }
${ROOT} .BetHistory__table td { padding: 10px 6px; border-bottom: 1px solid rgba(255, 255, 255, 0.06); }
${ROOT} .BetHistory__table td.is-eligible { color: var(--hs-yellow); font-weight: 700; }

/* BONUS BUY: the title up top, a white BET box, white cards in a row */
${ROOT} .FeatureBuy__title { flex: none; }
/* The sheet is only as tall as the screen. When a step does not fit (a short browser pane, a
   landscape phone, a second row of cards) the column scrolls, so the BUY and OK buttons can
   always be reached; with room to spare the bodies' auto margins still centre them, because an
   auto margin only absorbs free space. The confirm body keeps its height instead of shrinking
   into its centred content, which would hide its top. */
${ROOT} .FeatureBuy__inner { overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; }
${ROOT} #FeatureBuyConfirmBody.is-visible { flex-shrink: 0; }
${ROOT} #FeatureBuyBody.is-visible, ${ROOT} #FeatureBuyConfirmBody.is-visible { display: flex; flex-direction: column; align-items: center; justify-content: center; margin: auto; width: 100%; max-width: 1150px; }
${ROOT} .FeatureBuyAmountHolder {
  flex: none;
  width: 260px;
  min-height: 130px;
  margin-bottom: 30px;
  padding: 20px 10px;
  border-radius: 5px;
  background: rgba(255, 255, 255, 0.95);
  box-shadow: 0 14px 28px rgba(0, 0, 0, 0.55), 0 10px 10px rgba(0, 0, 0, 0.5);
  color: #2d2d2d;
}
${ROOT} .FeatureBuyAmountValueContainer { display: flex; flex-direction: column; align-items: center; gap: 10.8px; }
${ROOT} .FeatureBuyAmountValueContainer__info { display: flex; flex-direction: column; align-items: center; }
${ROOT} .FeatureBuyAmount__label { font-size: 16px; font-weight: 700; line-height: 16px; text-transform: uppercase; }
${ROOT} .FeatureBuyAmount__value { font-size: 24px; font-weight: 700; line-height: 24px; font-variant-numeric: tabular-nums; }
${ROOT} .FeatureBuyAmountChangers { display: flex; flex-direction: row-reverse; gap: 8px; }
${ROOT} .FeatureBuyAmountChanger { width: 52px; height: 38px; display: grid; place-items: center; border-radius: 5px; background: #2d2d2d; color: var(--hs-text); font-size: 18px; }
${ROOT} .FeatureBuyAmountChanger:hover:not(:disabled) { background: #444; }
${ROOT} .FeatureBuy__items-container { display: flex; justify-content: center; flex: none; width: 100%; }
${ROOT} .FeatureBuyItemList { display: flex; flex-wrap: wrap; justify-content: center; gap: 19.2px; }
${ROOT} .FeatureBuyItem { display: flex; width: 240px; }
${ROOT} .FeatureBuyGridCard { position: relative; display: flex; flex: 1; margin-bottom: 12px; border-radius: 5px; overflow: hidden; box-shadow: 0 14px 15px rgba(0, 0, 0, 0.35), 0 10px 10px rgba(0, 0, 0, 0.52); }
${ROOT} .FeatureBuyGridCard__inner { position: relative; display: flex; flex-direction: column; justify-content: space-between; flex: 1; padding: 16px 0 59.2px; border-radius: 5px; background: var(--hs-card); color: var(--hs-card-ink); text-align: center; }
${ROOT} .FeatureBuyGridCard__content { display: flex; flex-direction: column; align-items: center; justify-content: space-between; gap: 8px; flex: 1; padding: 0 12px 2px; }
${ROOT} .FeatureBuyGridCard__cta-container { position: absolute; left: 0; right: 0; bottom: 0; }
${ROOT} .FeatureBuyGridCard__title { order: 1; font-size: 16px; font-weight: 700; line-height: 16px; }
${ROOT} .FeatureBuyGridCard__description { order: 2; font-size: 14px; line-height: 17.5px; color: rgba(0, 0, 0, 0.85); }
${ROOT} .FeatureBuyGridCard__img-container { order: 3; }
${ROOT} .FeatureBuyGridCard__img-wrapper { display: grid; place-items: center; height: 80px; }
${ROOT} .FeatureBuyGridCard__image { display: block; height: 80px; width: auto; max-width: 200px; border-radius: 6px; object-fit: cover; }
${ROOT} .FeatureBuyGridCard__description--volatility { order: 4; font-size: 11px; font-style: italic; line-height: 14px; color: #000; }
${ROOT} .FeatureBuyGridCard__description--value { order: 5; font-size: 22px; font-weight: 700; line-height: 27px; color: #000; font-variant-numeric: tabular-nums; }
${ROOT} .FeatureBuyGridCard__button {
  display: flex; align-items: center; justify-content: center;
  width: 100%; height: 55px; flex: none;
  border-radius: 0 0 5px 5px;
  background: var(--hs-green); color: #fff;
  font-size: 24px; font-weight: 700; line-height: 24px; text-transform: uppercase;
  transition: filter var(--hs-motion);
}
${ROOT} .FeatureBuyGridCard[data-grid-card-type="grid-card-feature-spins"] .FeatureBuyGridCard__button { background: var(--hs-orange); }
${ROOT} .FeatureBuyGridCard__button:hover:not(:disabled) { filter: brightness(1.08); }

/* the confirm step: a white box, BACK | OK along the bottom */
${ROOT} .FeatureBuyConfirmBox { width: 320px; max-width: calc(100% - 24px); margin-top: 24px; border-radius: 5px; box-shadow: 0 14px 28px rgba(0, 0, 0, 0.55), 0 10px 10px rgba(0, 0, 0, 0.52); }
${ROOT} .FeatureBuyConfirmBox__inner { display: flex; flex-direction: column; align-items: stretch; padding: 16px 16px 0; border-radius: 5px; background: #f8f9fa; color: #000; text-align: center; overflow: hidden; }
${ROOT} .FeatureBuyConfirmBox__title { margin-bottom: 16.5px; font-size: 16px; font-weight: 700; line-height: 16px; }
${ROOT} .FeatureBuyConfirmBox__img-container, ${ROOT} .FeatureBuyConfirmBox__img-wrapper { width: 100%; }
${ROOT} .FeatureBuyConfirmBox__image { display: block; width: auto; max-width: 100%; height: 150px; margin: 0 auto; object-fit: contain; border-radius: 6px; }
${ROOT} .FeatureBuyConfirmBox__content-wrapper { display: flex; flex-direction: column; align-items: center; gap: 4px; margin-top: 15.5px; padding: 0 4px 8px 0; }
${ROOT} .FeatureBuyConfirmAmount__value { font-size: 22px; font-weight: 700; line-height: 28px; font-variant-numeric: tabular-nums; }
${ROOT} .FeatureBuyConfirmAmount__value:empty { display: none; }
${ROOT} .FeatureBuyConfirmAmount__label { font-size: 14px; font-weight: 700; line-height: 17.5px; }
${ROOT} .FeatureBuyConfirmBox__cta-container { display: flex; flex: none; margin: 24px -16px 0; height: 50px; }
${ROOT} .FeatureBuyConfirmBox__button--dismiss, ${ROOT} .FeatureBuyConfirmBox__button--accept {
  flex: 1; display: flex; align-items: center; justify-content: center;
  color: #fff; font-size: 22px; font-weight: 700; line-height: 22px; text-transform: uppercase;
  transition: filter var(--hs-motion);
}
${ROOT} .FeatureBuyConfirmBox__button--dismiss { background: var(--hs-yellow-2); }
${ROOT} .FeatureBuyConfirmBox__button--accept { background: var(--hs-green); }
${ROOT} .FeatureBuyConfirmBox__button--dismiss:hover, ${ROOT} .FeatureBuyConfirmBox__button--accept:hover { filter: brightness(1.08); }

/* ── notices: the same white box, full-width buttons along the bottom ──────── */
${ROOT} #DialogWindow.is-visible { display: flex; align-items: center; justify-content: center; position: fixed; inset: 0; z-index: 60; padding: 16px; pointer-events: auto; }
${ROOT} #DialogWindow .Overlay { position: absolute; inset: 0; background: var(--hs-veil); }
${ROOT} .Dialog { position: relative; width: min(360px, 100%); border-radius: 5px; box-shadow: 0 14px 28px rgba(0, 0, 0, 0.55), 0 10px 10px rgba(0, 0, 0, 0.52); }
${ROOT} .Dialog__wrapper { display: flex; flex-direction: column; gap: 12px; padding: 20px 16px 0; border-radius: 5px; background: #f8f9fa; color: #000; text-align: center; overflow: hidden; }
${ROOT} .Dialog__title { font-size: 18px; font-weight: 700; line-height: 22px; text-transform: uppercase; }
${ROOT} .Dialog__body-inner p { margin: 0; font-size: 15px; line-height: 20px; user-select: text; }
${ROOT} .Dialog__button-group { display: flex; margin: 8px -16px 0; }
${ROOT} .Dialog__button-group:empty { display: none; }
${ROOT} .Dialog__wrapper:has(.Dialog__button-group:empty) { padding-bottom: 20px; }
${ROOT} .Dialog .Button { flex: 1; height: 50px; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 20px; font-weight: 700; text-transform: uppercase; background: var(--hs-pill); transition: filter var(--hs-motion); }
${ROOT} .Dialog .Button--primary { background: var(--hs-green); }
${ROOT} .Dialog .Button--secondary { background: var(--hs-yellow-2); }
${ROOT} .Dialog .Button:hover { filter: brightness(1.08); }

/* toasts */
${ROOT} .NotificationHolder { position: fixed; top: 44px; left: 50%; transform: translateX(-50%); display: flex; flex-direction: column; gap: 8px; z-index: 70; }
${ROOT} .Notification { padding: 10px 16px; border-radius: 3px; background: var(--hs-panel); font-size: 14px; font-weight: 700; text-transform: uppercase; box-shadow: 0 3px 5px rgba(0, 0, 0, 0.35); }

/* ── the compliance line at the top ────────────────────────────────────────── */
${ROOT} #CoreOverlay.is-visible { display: block; position: absolute; top: 0; left: 0; right: 0; pointer-events: none; }
${ROOT} .CoreOverlay__inner { display: flex; flex-direction: column; gap: 3px; padding: 4px; }
${ROOT} .CoreOverlay__container, ${ROOT} .SessionBarContentWrapper { display: flex; flex-wrap: wrap; align-items: center; font-size: 12px; font-weight: 400; line-height: 12px; text-transform: uppercase; color: var(--hs-text); text-shadow: 0 1px 2px rgba(0, 0, 0, 0.7); }
${ROOT} .inline-padding { padding: 0 6px 0 0; }
${ROOT} .divider-vertical { border-left: 1px solid rgba(255, 255, 255, 0.6); padding-left: 6px; }
${ROOT} #RtpOverlay.is-visible, ${ROOT} #MaxWinOverlayContainer.is-visible, ${ROOT} #MaxWinOddsOverlay.is-visible,
${ROOT} #SessionTimer.is-visible, ${ROOT} #NetPosition.is-visible { display: inline-flex; }

/* ── the boot spinner (only when asked for) ────────────────────────────────── */
${ROOT} .ProgressIndicator { display: none; }
${ROOT} .ProgressIndicator.is-visible { display: block; position: fixed; left: 50%; top: 50%; width: 44px; height: 44px; margin: -22px; border-radius: 50%; border: 3px solid var(--hs-pill); border-top-color: var(--hs-yellow); animation: hs-rotate 0.8s linear infinite; }
${ROOT} .ProgressIndicator .si-circle { display: none; }

/* ── touch: SPIN between − and +, a readout strip along the bottom edge ────── */
${ROOT}[data-channel="mobile"] .UiUserPanelWrapper { left: 0; right: 0; bottom: 0; transform: none; }
${ROOT}[data-channel="mobile"] .UiRibbonUserPanel__container {
  width: 100%;
  height: calc(144px + env(safe-area-inset-bottom));
  padding: 0;
  background: linear-gradient(rgba(13, 13, 13, 0), rgba(13, 13, 13, 0.3));
  box-shadow: none;
  border-radius: 0;
}
${ROOT}[data-channel="mobile"] .MainPanel__container { display: block; }
${ROOT}[data-channel="mobile"] .UiRibbonUserPanel { pointer-events: none; }
/* the readouts: BALANCE · BET · WIN in three equal columns */
${ROOT}[data-channel="mobile"] .DataPanel {
  position: absolute; left: 0; right: 0; bottom: 0;
  height: calc(36px + env(safe-area-inset-bottom));
  gap: 0;
}
${ROOT}[data-channel="mobile"] .DataPanel > .divider--vertical { display: none; }
${ROOT}[data-channel="mobile"] .DataPanel__container {
  flex: 1; align-self: stretch; justify-content: space-between; gap: 4px;
  padding: 4px 8px calc(18.4px + env(safe-area-inset-bottom));
  background: linear-gradient(rgba(43, 41, 41, 0.05) 3%, rgba(43, 41, 41, 0.2) 15%, rgba(17, 20, 24, 0.45) 90%);
}
${ROOT}[data-channel="mobile"] .DataPanelItem { flex: 1 1 0; align-items: center; justify-content: space-between; }
/* BET wraps its label and value once more (.ItemWrapper__inner): centre them there too, or BET
   sits left over its wider value while BALANCE and WIN are centred */
${ROOT}[data-channel="mobile"] .DataPanelItem .ItemWrapper__inner { align-items: center; }
${ROOT}[data-channel="mobile"] #BalanceItem { padding-left: 8px; }
${ROOT}[data-channel="mobile"] #BetAmountStaticItem.is-visible { display: flex; }
${ROOT}[data-channel="mobile"] .DataPanelItem__label { font-size: 10px; line-height: 12.5px; }
${ROOT}[data-channel="mobile"] .DataPanelItem__value { font-size: 10px !important; line-height: 12.5px !important; }
${ROOT}[data-channel="mobile"][data-state^="feature"] .UiRibbonUserPanel__container { height: calc(144px + env(safe-area-inset-bottom)); padding: 0; }
${ROOT}[data-channel="mobile"][data-state^="feature"] .FeaturePanel {
  position: absolute; left: 50%; top: 52px; transform: translateX(-50%);
  height: 48px; align-items: stretch;
  background: rgba(13, 13, 13, 0.75); border: 1px solid rgba(173, 181, 189, 0.15); border-radius: 4px;
}
${ROOT}[data-channel="mobile"] .FeatureTotalWin, ${ROOT}[data-channel="mobile"] .FeatureCounter { padding: 8px; align-items: center; }
${ROOT}[data-channel="mobile"] .FeaturePanel .DataPanelItem__label { font-size: 10px; line-height: 12.5px; }
${ROOT}[data-channel="mobile"] .FeaturePanel .DataPanelItem__value { font-size: 12px !important; line-height: 15px !important; }
${ROOT}[data-channel="mobile"] .FeatureCounter .DataPanelItem__value { color: #ffeab4; }
${ROOT}[data-channel="mobile"] .LivesPips { height: 15px; gap: 4px; }
${ROOT}[data-channel="mobile"] .LivesPips i { width: 9px; height: 9px; }
/* the round buttons: ☰ and autoplay in the corners over the strip */
${ROOT}[data-channel="mobile"] .ToggleButton__container--main-menu { position: absolute; left: 8px; top: -52px; width: 44px; height: 44px; z-index: 2; }
${ROOT}[data-channel="mobile"] #MainMenuToggle, ${ROOT}[data-channel="mobile"] #AutoplayBtn {
  width: 44px; height: 44px; margin: 0;
  border-radius: 50%;
  background: var(--hs-soft);
  border: 1px solid rgba(173, 181, 189, 0.15);
  color: var(--hs-text);
  pointer-events: auto;
}
${ROOT}[data-channel="mobile"] #MainMenuToggle { font-size: 21px; }
${ROOT}[data-channel="mobile"] .MainPanel.main-menu-active #MainMenuToggle .icon-menu { font-size: 18px; }
${ROOT}[data-channel="mobile"] #AutoplayBtn { font-size: 34px; }
${ROOT}[data-channel="mobile"] #AutoplayBtn:hover:not(:disabled) { color: var(--hs-text); }
${ROOT}[data-channel="mobile"] .ActionPanel__container--autoplay { position: absolute; right: 8px; top: 52px; height: auto; }
/* SPIN (107px) centred in the top 96px, − and + either side of it, clear of it by
   --ohm-changer-gap (open-slot-ui ≥ 0.16.1 offsets them by it; they need a position for that) */
${ROOT}[data-channel="mobile"] .ActionPanel {
  position: absolute; left: 0; right: 0; top: 0;
  height: 96px; margin: 0;
  justify-content: center;
  background: none; border: 0; border-radius: 0;
  pointer-events: none;
}
${ROOT}[data-channel="mobile"] .ActionPanel button { pointer-events: auto; }
${ROOT}[data-channel="mobile"] .BetAmountWidget.is-visible { display: none; }
${ROOT}[data-channel="mobile"] .BetAmountChangersWidget { display: contents; }
${ROOT}[data-channel="mobile"] .BetAmountChangersWidget button { width: 44px; height: 44px; font-size: 20px; border-radius: 0; background: var(--hs-soft); }
${ROOT}[data-channel="mobile"] #BetAmountDecrease { order: 1; position: relative; }
${ROOT}[data-channel="mobile"] #BetAmountIncrease { order: 3; position: relative; }
${ROOT}[data-channel="mobile"] #BetAmountIncrease .icon-arrow-up { --ap-icon: ${ICONS.plus}; }
${ROOT}[data-channel="mobile"] #BetAmountDecrease .icon-arrow-down { --ap-icon: ${ICONS.minus}; }
${ROOT}[data-channel="mobile"] .CircleButton--place-bet, ${ROOT}[data-channel="mobile"] .CircleButton--stop-round,
${ROOT}[data-channel="mobile"] .CircleButton--start-autoplay, ${ROOT}[data-channel="mobile"] .CircleButton--stop-autoplay {
  order: 2; width: 107px; height: 107px; margin: 0; background: var(--hs-soft); border: 0;
}
${ROOT}[data-channel="mobile"] .CircleButton--place-bet .icon-spin { font-size: 93px; }
${ROOT}[data-channel="mobile"] { --hg-btn-font-size: 3.1rem; }
${ROOT}[data-channel="mobile"] .CircleButton--start-autoplay { font-size: 107px; }
/* An upright screen narrower than a phone (a folding phone's cover screen, a narrow split view):
   SPIN gives up the width − and + need beside it to stay clear of the coin and ☰ on the left and of
   the autoplay button on the right (the row is − SPIN + with their 6px clearances, 100px more than
   SPIN). From 329px of width up it is the 107px it always was; its glyphs follow its size. */
${ROOT}[data-channel="mobile"][data-orientation="portrait"] { --hs-spin: clamp(64px, calc(100vw - 222px), 107px); --hg-btn-font-size: min(3.1rem, calc(var(--hs-spin) * 0.4636)); }
${ROOT}[data-channel="mobile"][data-orientation="portrait"] .CircleButton--place-bet, ${ROOT}[data-channel="mobile"][data-orientation="portrait"] .CircleButton--stop-round,
${ROOT}[data-channel="mobile"][data-orientation="portrait"] .CircleButton--start-autoplay, ${ROOT}[data-channel="mobile"][data-orientation="portrait"] .CircleButton--stop-autoplay { width: var(--hs-spin); height: var(--hs-spin); }
${ROOT}[data-channel="mobile"][data-orientation="portrait"] .CircleButton--place-bet .icon-spin { font-size: min(93px, calc(var(--hs-spin) * 0.87)); }
${ROOT}[data-channel="mobile"][data-orientation="portrait"] .CircleButton--start-autoplay { font-size: var(--hs-spin); }
/* the coin over the ☰ */
${ROOT}[data-channel="mobile"] .ToggleButton__container--feature-buy { right: auto; left: 8px; top: auto; bottom: 92px; margin: 0; transform: translateY(-8px); }
${ROOT}[data-channel="mobile"] #FeatureBuyToggle.is-visible {
  width: 52px; height: 52px; padding: 4px;
  /* the label's floor is open-slot-ui's (≥ 0.16.1): readable, and --ohm-buy-label tunes it */
  font-size: var(--ohm-buy-label, 10px); line-height: 1.1;
  box-shadow: inset 0 0 0 2px var(--hs-buy), inset 0 0 0 3.5px var(--hs-buy-ink), 0 2px 5px rgba(0, 0, 0, 0.4);
}
${ROOT}[data-channel="mobile"] #FeedbackMsg.is-visible { top: -26px; font-size: 14px; }
${ROOT}[data-channel="mobile"] #FeatureBuyActiveModifierNotice.is-visible {
  position: fixed; top: 0; bottom: auto; height: 60px;
  align-items: flex-end; padding-bottom: 8px; border-radius: 0;
  animation-name: hs-modifier-plaque-drop;
}
/* the ☰ menu: two columns of tiles, filled from the bottom, over the dimmed game */
${ROOT}[data-channel="mobile"] #MainMenu.is-visible {
  position: fixed; left: 0; right: 0; top: 112px; bottom: 0; width: auto;
  display: flex; align-items: flex-end;
  padding: 0 0 calc(100px + env(safe-area-inset-bottom));
  background: rgba(0, 0, 0, 0.8);
  border-radius: 0;
  z-index: 1;
}
${ROOT}[data-channel="mobile"] #MainMenu ul { display: flex; flex-wrap: wrap-reverse; width: 100%; padding: 30px 10px 0; }
${ROOT}[data-channel="mobile"] .MainMenuItem { width: calc(50% - 4px); min-height: 64px; margin: 2px; padding: 0 10px; background: var(--hs-surface); font-size: 12px; line-height: 15px; text-align: left; }
${ROOT}[data-channel="mobile"] .MainMenuItem [class^="icon-"] { width: 30px; }
/* A row the tiles do not fill (an odd count: SOUND, MUSIC, TURBO, SUPER TURBO, INFO) shares its
   room, so no row is left half empty; a full row has no room to share and stays as it is */
${ROOT}[data-channel="mobile"] .MainMenuItem { flex-grow: 1; }
/* a tile's column stretches its header and its panel to the tile (.MainMenuItem centres its items,
   which let the panel size itself to its content and poke out of the tile); the scope rows run the
   tile's width, under the icon, since a 166px tile has no room for the desktop indent */
${ROOT}[data-channel="mobile"] .MainMenuItem.Accordion { display: flex; flex-direction: column; align-items: stretch; padding: 0; }
${ROOT}[data-channel="mobile"] .Accordion__header { flex: 1; }
${ROOT}[data-channel="mobile"] .Accordion__title { padding: 8px 10px; }
${ROOT}[data-channel="mobile"] .Accordion__panel { padding: 0 10px 10px; }
/* A 320px phone gives a menu tile 126px: BONUS GAME (83px at 12px) beside its 44px switch needs the
   tile's side padding back. */
@media (max-width: 359px) { ${ROOT}[data-channel="mobile"] .Accordion__panel { padding: 0 4px 10px; } }
${ROOT}[data-channel="mobile"] .MainPanel.main-menu-active .ActionPanel,
${ROOT}[data-channel="mobile"] .MainPanel.main-menu-active .DataPanel__container { visibility: hidden; }
/* autoplay: a full-screen sheet; the round buttons stay on top of it */
${ROOT}[data-channel="mobile"] .AutoplayMenuPanel { position: fixed; inset: 0; z-index: 1; pointer-events: none; }
${ROOT}[data-channel="mobile"] #AutoplayNav.is-visible {
  position: absolute; inset: 0; width: auto; max-height: none; overflow: visible;
  justify-content: flex-start;
  padding: 32px 0;
  background: rgba(0, 0, 0, 0.8);
}
/* The sheet's content scrolls in the room above the HUD (its 180px: the bar and the buy coin
   standing on it, plus the safe area), so the ADVANCED sections stay reachable on any phone, held
   either way, and never slide under the round buttons. */
${ROOT}[data-channel="mobile"] #AutoplayNav.is-visible .AutoplayMenu__inner {
  flex: 0 1 auto; min-height: 0;
  max-height: calc(100% - 148px - env(safe-area-inset-bottom, 0px));
  overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-y;
}
${ROOT}[data-channel="mobile"] .AutoplayMenu__container--super-title { height: 36px; padding: 0 12px; overflow: visible; }
${ROOT}[data-channel="mobile"] .AutoplayMenu__super-title { height: 28px; }
${ROOT}[data-channel="mobile"] .ToggleButton--advanced-autoplay-menu { margin-right: 0; padding: 6px 8px; border-radius: 12px; font-size: 15px; line-height: 22.5px; }
${ROOT}[data-channel="mobile"] .AutoplayMenu__container--basic, ${ROOT}[data-channel="mobile"] #AdvancedAutoplaySections.is-visible { padding: 0 12px; }
${ROOT}[data-channel="mobile"] .ToggleButton--advanced-autoplay-menu [class^="icon-"] { transform: rotate(180deg); }
${ROOT}[data-channel="mobile"] .ActionPanel, ${ROOT}[data-channel="mobile"] .DataPanel { z-index: 2; }
${ROOT}[data-channel="mobile"] .ToggleButton__container--feature-buy { z-index: 2; }
/* windows: full screen */
${ROOT}[data-channel="mobile"] .Modal__container { padding: 32px 0 40px; }
${ROOT}[data-channel="mobile"] .Modal__close-button { top: 16px; right: 8px; width: 48px; height: 48px; }
${ROOT}[data-channel="mobile"] .Modal__close-button::before { inset: 8px; }
${ROOT}[data-channel="mobile"] .Modal__close-button span { left: 14.4px; top: 22.5px; width: 19.2px; }
${ROOT}[data-channel="mobile"] #FeatureBuyWindow .Modal__title { font-size: 16.6px; line-height: 20.7px; }
${ROOT}[data-channel="mobile"] #FeatureBuyBody.is-visible { flex: 1; justify-content: center; gap: 8px; min-height: 0; margin: 0; max-width: none; overflow: hidden; }
${ROOT}[data-channel="mobile"] .FeatureBuyAmountHolder { width: 90%; min-height: 0; margin: 0; padding: 10px; }
${ROOT}[data-channel="mobile"] .FeatureBuyAmountValueContainer { flex-direction: row; justify-content: space-evenly; gap: 0; min-height: 60px; }
${ROOT}[data-channel="mobile"] .FeatureBuyAmountChangers { gap: 0; }
${ROOT}[data-channel="mobile"] .FeatureBuyAmountChanger { margin: 0 4px; font-size: 16px; }
${ROOT}[data-channel="mobile"] .FeatureBuy__items-container { flex: 1; align-items: flex-start; min-height: 0; overflow: hidden auto; }
${ROOT}[data-channel="mobile"] .FeatureBuyItemList { gap: 8px; }
${ROOT}[data-channel="mobile"] .FeatureBuyItem { width: 80%; }
${ROOT}[data-channel="mobile"] .FeatureBuyGridCard__img-wrapper { width: 128px; height: 128px; margin: 8px auto; }
${ROOT}[data-channel="mobile"] .FeatureBuyGridCard__image { width: 128px; height: 128px; max-width: none; object-fit: contain; }
${ROOT}[data-channel="mobile"] #GameInfoWindow .Modal__container, ${ROOT}[data-channel="mobile"] #BetHistoryWindow .Modal__container { padding: 32px 0 calc(40px + env(safe-area-inset-bottom)); }
${ROOT}[data-channel="mobile"] .GameInfo__body { padding: 0 14px 16px; }
${ROOT}[data-channel="mobile"] .Modal__title { padding: 0 56px; }
${ROOT}[data-channel="mobile"] .FeatureBuyConfirmAmount__label { font-size: 16px; line-height: 20px; }
${ROOT}[data-channel="mobile"] #GameInfoWindow.is-visible, ${ROOT}[data-channel="mobile"] #BetHistoryWindow.is-visible { z-index: 45; }
/* the buy sheet keeps the readout strip bright along the bottom; the buttons step out of its way */
${ROOT}[data-channel="mobile"]:has(#FeatureBuyWindow.is-visible) .UiUserPanelWrapper { z-index: 1330; } /* over open-slot-ui 0.16's touch windows (1320) */
/* …but only to be SEEN: the panel's (transparent) button area would otherwise swallow taps meant
   for the sheet's lowest card. Nothing in it is usable while the sheet is open. */
${ROOT}[data-channel="mobile"]:has(#FeatureBuyWindow.is-visible) .UiUserPanelWrapper,
${ROOT}[data-channel="mobile"]:has(#FeatureBuyWindow.is-visible) .UiUserPanelWrapper * { pointer-events: none; }
${ROOT}[data-channel="mobile"]:has(#FeatureBuyWindow.is-visible) .ActionPanel,
${ROOT}[data-channel="mobile"]:has(#FeatureBuyWindow.is-visible) .ToggleButton__container--main-menu,
${ROOT}[data-channel="mobile"]:has(#FeatureBuyWindow.is-visible) .ToggleButton__container--feature-buy { visibility: hidden; }
${ROOT}[data-channel="mobile"]:has(#FeatureBuyWindow.is-visible) .DataPanel__container { background: rgba(0, 0, 0, 0.9); }

/* The buy sheet on a short screen (a landscape phone, a small browser pane): the paddings close
   up, the pictures shrink with the height, the buttons lose a few pixels, so the confirm box fits
   above the readout strip at 343px and the card list keeps as much of a card in view as it can.
   The strip's safe-area inset is added to the bottom padding so the lowest button clears it on a
   phone with a home indicator. A short screen is always the touch channel (open-slot-ui picks it
   when either side is 600px or less), so these ride on the touch rules above; a taller screen
   keeps the look exactly as it is, and whatever still does not fit scrolls (.FeatureBuy__inner). */
@media (max-height: 559px) {
  ${ROOT}[data-channel="mobile"] #FeatureBuyWindow .Modal__container { padding: 12px 0 calc(40px + env(safe-area-inset-bottom)); }
  ${ROOT}[data-channel="mobile"] #FeatureBuyWindow .Modal__close-button { top: 4px; }
  /* the confirm step */
  ${ROOT}[data-channel="mobile"] .FeatureBuyConfirmBox { margin-top: 8px; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyConfirmBox__inner { padding: 12px 16px 0; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyConfirmBox__title { margin-bottom: 10px; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyConfirmBox__image { height: clamp(64px, 20vh, 150px); }
  ${ROOT}[data-channel="mobile"] .FeatureBuyConfirmBox__content-wrapper { margin-top: 8px; padding-bottom: 4px; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyConfirmAmount__value { font-size: 20px; line-height: 24px; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyConfirmAmount__label { font-size: 14px; line-height: 17.5px; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyConfirmBox__cta-container { margin-top: 12px; height: 44px; }
  /* the buy menu: a slimmer BET box, smaller card pictures, a shorter BUY bar */
  ${ROOT}[data-channel="mobile"] .FeatureBuyAmountHolder { padding: 6px 10px; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyAmountValueContainer { min-height: 48px; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyAmountChanger { height: 34px; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyGridCard { margin-bottom: 8px; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyGridCard__inner { padding: 12px 0 50px; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyGridCard__content { gap: 6px; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyGridCard__img-wrapper, ${ROOT}[data-channel="mobile"] .FeatureBuyGridCard__image { width: clamp(72px, 24vh, 128px); height: clamp(72px, 24vh, 128px); }
  ${ROOT}[data-channel="mobile"] .FeatureBuyGridCard__img-wrapper { margin: 4px auto; }
  ${ROOT}[data-channel="mobile"] .FeatureBuyGridCard__button { height: 46px; font-size: 22px; }
}

/* ── touch, the phone held sideways: a thin strip, the controls hug the edges ─────────────────
   The rules above lay the touch bar out for an upright phone: SPIN between − and + in the middle,
   the strip under them, 144px of HUD. Sideways that left the game a band across the top (QA: the
   board was 176px tall on a 640×295 screen). Here the bar IS the 40px readout strip — the game
   measures its play area from the bar's top edge — and everything else is pinned to the screen
   outside it: SPIN with − above and + below as a column at the right edge, centred in the height
   above the strip, the autoplay button on SPIN's inner side; ☰ above the strip at the bottom-left,
   the coin above it. The middle of the screen is the game's. The safe-area insets keep the edge
   controls off a notch and the home indicator. These come after the upright rules, at the same
   weight plus the orientation, so they win where they overlap. */
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .UiRibbonUserPanel__container { height: calc(40px + env(safe-area-inset-bottom)); }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .DataPanel { height: calc(40px + env(safe-area-inset-bottom)); }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .DataPanel__container {
  padding: 6px calc(8px + env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) calc(8px + env(safe-area-inset-left));
  background: linear-gradient(rgba(43, 41, 41, 0.1), rgba(17, 20, 24, 0.5));
}
/* the SPIN column: the panel is a full-height lane at the right edge (it takes no taps itself),
   its − / SPIN / + stack centred in it; the library's ± clearance is sideways (left: ±gap) and
   the column has its own gap, so it is taken off */
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .ActionPanel {
  position: fixed; left: auto; right: calc(8px + env(safe-area-inset-right)); top: 0; bottom: calc(40px + env(safe-area-inset-bottom));
  width: 107px; height: auto;
  flex-direction: column;
}
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .ActionPanel__container--game-actions { flex-direction: column; justify-content: center; gap: 8px; height: auto; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] #BetAmountDecrease, ${ROOT}[data-channel="mobile"][data-orientation="landscape"] #BetAmountIncrease { left: auto; }
/* autoplay beside SPIN, on its inner side, on SPIN's centre line */
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .ActionPanel__container--autoplay { right: 100%; top: 50%; margin: -22px 8px 0 0; }
/* ☰ above the strip at the bottom-left; the coin 8px above the ☰ (not lapping it, as upright) */
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .ToggleButton__container--main-menu { left: calc(8px + env(safe-area-inset-left)); }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .ToggleButton__container--feature-buy { left: calc(8px + env(safe-area-inset-left)); bottom: calc(100px + env(safe-area-inset-bottom)); transform: none; }
/* free spins (TOTAL WIN | FREE SPINS) and a free-rounds campaign take SPIN's place: the box at
   the right edge, centred the same way, the two readouts stacked with a rule between them */
${ROOT}[data-channel="mobile"][data-orientation="landscape"][data-state^="feature"] .FeaturePanel,
${ROOT}[data-channel="mobile"][data-orientation="landscape"][data-openui-free-rounds="true"] .FreeRoundsPanel.is-visible {
  position: fixed; left: auto; right: calc(8px + env(safe-area-inset-right)); bottom: auto;
  top: calc(50% - (40px + env(safe-area-inset-bottom)) / 2); transform: translateY(-50%);
  width: max-content; min-width: 96px; height: auto; min-height: 0;
  flex-direction: column; align-items: stretch;
}
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeaturePanel > .divider--vertical { width: auto; min-width: 0; height: 1px; margin: 0 8px; align-self: stretch; background: var(--hs-divider); }
/* the compliance line keeps off a notch */
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .CoreOverlay__inner { padding: 4px calc(4px + env(safe-area-inset-right)) 4px calc(4px + env(safe-area-inset-left)); }
/* the ☰ menu: the sheet from the top of the screen, three tiles to a row, the ✕ zone along the
   bottom kept clear; a sheet taller than the screen (a scope row open) scrolls, which the auto
   margin allows where the upright flex-end would put its top out of reach */
${ROOT}[data-channel="mobile"][data-orientation="landscape"] #MainMenu.is-visible { top: 0; max-height: none; align-items: flex-start; padding: 8px 0 calc(100px + env(safe-area-inset-bottom)); }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] #MainMenu ul { margin-top: auto; padding: 0 calc(10px + env(safe-area-inset-right)) 0 calc(10px + env(safe-area-inset-left)); }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .MainMenuItem { width: calc(33.333% - 4px); min-height: 56px; }
/* the autoplay sheet: its column runs between the coin and ☰ on the left (60px of control plus a
   gap) and the SPIN lane with its ✕ on the right (8 + 107 + 8 + 44 and a gap), and scrolls when
   ADVANCED does not fit the height */
${ROOT}[data-channel="mobile"][data-orientation="landscape"] #AutoplayNav.is-visible {
  padding: 8px calc(175px + env(safe-area-inset-right)) calc(48px + env(safe-area-inset-bottom)) calc(68px + env(safe-area-inset-left));
  overflow-y: auto; overscroll-behavior: contain; -webkit-overflow-scrolling: touch;
}
/* …and the sheet is what scrolls there: the upright rule caps its content to the room above the
   144px bar, which on a phone held sideways left a 190px window that cut the round counts in half
   and hid the title once a second row of counts came (QA, an iPhone held sideways). */
${ROOT}[data-channel="mobile"][data-orientation="landscape"] #AutoplayNav.is-visible .AutoplayMenu__inner { flex: none; max-height: none; overflow: visible; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .AutoplayMenu__container--super-title { flex: none; }
/* BONUS BUY on a phone held sideways (QA: the cards ran under the BET box, the price and the button
   under the strip): the BET box stands as a column on the left and the cards make one row that
   scrolls sideways, each card short enough to show its name, its words, its picture, its price
   and its button at once. The confirm step keeps the short-screen rules above. */
${ROOT}[data-channel="mobile"][data-orientation="landscape"] #FeatureBuyBody.is-visible {
  flex-direction: row; align-items: stretch; justify-content: flex-start; gap: 10px;
  padding: 0 calc(10px + env(safe-area-inset-right)) 0 calc(10px + env(safe-area-inset-left));
}
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyAmountHolder { flex: none; align-self: center; width: 128px; padding: 10px 8px; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyAmountValueContainer { flex-direction: column; justify-content: center; gap: 10px; min-height: 0; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyAmountChangers { gap: 6px; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyAmountChanger { margin: 0; width: 50px; height: 36px; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuy__items-container {
  flex: 1; min-width: 0; align-items: stretch; justify-content: flex-start;
  overflow: auto hidden; overscroll-behavior: contain; -webkit-overflow-scrolling: touch; touch-action: pan-x;
}
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyItemList { flex-wrap: nowrap; align-items: stretch; justify-content: flex-start; gap: 8px; margin: 0 auto; padding: 2px 0 8px; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyItem { flex: none; width: clamp(164px, 24vw, 210px); }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard { margin: 0; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__inner { padding: 8px 0 42px; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__content { gap: 4px; padding: 0 8px 2px; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__title { font-size: 15px; line-height: 17px; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__description { font-size: 12px; line-height: 15px; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 3; overflow: hidden; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__img-wrapper,
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__image { width: clamp(40px, 16vh, 72px); height: clamp(40px, 16vh, 72px); }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__img-wrapper { margin: 2px auto; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__description--value { font-size: 18px; line-height: 22px; }
${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__button { height: 40px; font-size: 18px; }
/* GAME INFO / HISTORY sit over the whole HUD on a phone (the library lifts them), so their column
   needs only the strip's height under it, not the upright bar's */
${ROOT}[data-channel="mobile"][data-orientation="landscape"] #GameInfoWindow .Modal__container, ${ROOT}[data-channel="mobile"][data-orientation="landscape"] #BetHistoryWindow .Modal__container { padding-bottom: calc(48px + env(safe-area-inset-bottom)); }
/* under 360px of height (a 640×295 phone) the round button gives up 11px so the column clears
   the strip with room; its glyphs follow */
@media (max-height: 359px) {
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] { --hg-btn-font-size: 2.8rem; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .ActionPanel { width: 96px; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .ActionPanel__container--game-actions { gap: 6px; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] #AutoplayNav.is-visible { padding-right: calc(164px + env(safe-area-inset-right)); }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .CircleButton--place-bet, ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .CircleButton--stop-round,
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .CircleButton--start-autoplay, ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .CircleButton--stop-autoplay { width: 96px; height: 96px; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .CircleButton--place-bet .icon-spin { font-size: 83px; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .CircleButton--start-autoplay { font-size: 96px; }
}
/* Under 260px of height (a phone held sideways in a browser whose bars take a third of it, a short
   window) the − SPIN + column (196px) does not fit above the strip. − and + stand beside SPIN
   instead, one over the other on its inner side, with the autoplay button beside them on SPIN's
   centre line; the coin moves next to ☰ in the bottom-left corner, out of the middle of the left
   edge, where a game keeps its logo. The autoplay sheet keeps clear of the wider lane, and the coin
   steps out while the sheet is open: beside ☰ it would sit on the sheet's rows. The ☰ menu's two
   rows of tiles scroll above its ✕. */
@media (max-height: 259px) {
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .ActionPanel { width: 148px; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .ActionPanel__container--game-actions { display: grid; grid-template-columns: 44px 96px; grid-template-rows: 44px 44px; gap: 8px; align-items: center; justify-items: center; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] #BetAmountDecrease { grid-area: 1 / 1; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] #BetAmountIncrease { grid-area: 2 / 1; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .CircleButton--place-bet, ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .CircleButton--stop-round,
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .CircleButton--start-autoplay, ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .CircleButton--stop-autoplay { grid-area: 1 / 2 / 3 / 3; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .ToggleButton__container--feature-buy { left: calc(60px + env(safe-area-inset-left)); bottom: calc(44px + env(safe-area-inset-bottom)); }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] #AutoplayNav.is-visible { padding-right: calc(216px + env(safe-area-inset-right)); }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"]:has(#AutoplayNav.is-visible) .ToggleButton__container--feature-buy { visibility: hidden; }
  /* the ☰ menu's tiles scroll in the room above its ✕ instead of running down under it */
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] #MainMenu ul { max-height: 100%; overflow-y: auto; overscroll-behavior: contain; }
}
/* BONUS BUY on a short screen held sideways: the cards fit the room above the strip, so the first
   card's price and its button are always in view (at 292px and up they keep the look above). The
   row is as tall as the sheet's room and no taller; the picture is the part that gives way, taking
   what the words, the volatility and the price leave (up to 56px), and the button is 36px. Under
   260px the picture goes, under 230px the words keep one line, under 210px the volatility goes,
   and under 193px the words. */
@media (max-height: 291px) {
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyItemList { height: 100%; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyItem, ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard, ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__inner, ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__content { min-height: 0; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__inner { padding-bottom: 38px; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__description { flex: none; -webkit-line-clamp: 2; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__img-container { display: flex; flex: 1 1 0; min-height: 0; align-items: center; justify-content: center; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__img-wrapper,
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__image { width: auto; height: 100%; max-height: 56px; object-fit: contain; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__img-wrapper { margin: 0 auto; }
  ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__button { height: 36px; font-size: 16px; }
}
@media (max-height: 259px) { ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__img-container { display: none; } }
@media (max-height: 229px) { ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__description { -webkit-line-clamp: 1; } }
@media (max-height: 209px) { ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__description--volatility { display: none; } }
@media (max-height: 192px) { ${ROOT}[data-channel="mobile"][data-orientation="landscape"] .FeatureBuyGridCard__description { display: none; } }

/* ── a round, autoplay or free rounds in play: the HUD disables the buy coin and the autoplay
   button (and refuses their presses); they dim as the library dims the coin. ─────────────── */
${ROOT} #AutoplayBtn.is-disabled { opacity: 0.6; }

/* ── the floor: a window too small for the HUD and a board (under 280px wide, under 160px tall, or
   under 460×260) asks to be turned or made bigger, with no words to translate, instead of showing
   controls on top of each other. The veil takes the taps meant for what is under it and goes as
   soon as the window grows. ─────────────────────────────────────────────────────────────────── */
@media (max-width: 279px), (max-height: 159px), (max-width: 459px) and (max-height: 259px) {
  ${ROOT}::before { content: ""; position: fixed; inset: 0; z-index: 2147483000; background: rgba(0, 0, 0, 0.92); pointer-events: auto; }
  ${ROOT}::after {
    content: ""; position: fixed; left: 50%; top: 50%; z-index: 2147483001;
    width: 112px; height: 48px; margin: -24px 0 0 -56px;
    background: var(--hs-text);
    -webkit-mask: ${ICONS.floor} center / contain no-repeat; mask: ${ICONS.floor} center / contain no-repeat;
    pointer-events: none;
  }
}

@keyframes hs-rotate { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) {
  ${ROOT} *, ${ROOT} *::before, ${ROOT} *::after { animation-duration: 0.001ms !important; animation-iteration-count: 1 !important; transition-duration: 0.001ms !important; }
}
`;
