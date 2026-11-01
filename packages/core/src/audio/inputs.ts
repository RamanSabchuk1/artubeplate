// Input sounds — HUD control events → one-shot cues, so every press makes a sound with zero
// per-game wiring. Purely the HUD event surface (no zvuk here); the cues must be loaded.

import type { DomHud } from '@open-slot-ui/dom';
import type { AudioPort } from '../engine/fsm';

/** Cue name per HUD input. Any omitted → that input stays silent. */
export interface InputSoundMap {
  /** The round button (and each autoplay re-spin). */
  spin?: string;
  /** Bet ▲ / ▼ (the fallback for a direction without its own cue). */
  bet?: string;
  /** Bet raised. Falls back to `bet`. */
  betUp?: string;
  /** Bet lowered. Falls back to `bet`. */
  betDown?: string;
  /** Autoplay started. */
  autoplay?: string;
  /** Any switch toggled (speed, stop-on-feature…). */
  toggle?: string;
  /** A slam-stop. */
  skip?: string;
  /** A menu row / button the HUD reports (`buttonActivated`). */
  button?: string;
}

export interface InputSoundOptions {
  /** Bus for the cues (default `'ui'`). */
  bus?: string;
}

export function bindInputSounds(audio: AudioPort, hud: DomHud, map: InputSoundMap, opts: InputSoundOptions = {}): () => void {
  const bus = opts.bus ?? 'ui';
  const play = (name?: string): void => {
    if (name) audio.play(name, { bus });
  };
  const d: Array<() => void> = [];
  if (map.spin) d.push(hud.on('spinRequested', () => play(map.spin)));
  if (map.autoplay) d.push(hud.on('autoplayStarted', () => play(map.autoplay)));
  if (map.skip) d.push(hud.on('skipRequested', () => play(map.skip)));
  if (map.bet || map.betUp || map.betDown) {
    // The direction is the stepper's own: the value it held before this change.
    let last = hud.ui.betStepper.value;
    d.push(
      hud.on('valueChanged', (v) => {
        if (v.id !== 'bet-stepper') return;
        const up = v.value > last;
        const down = v.value < last;
        last = v.value;
        if (up) play(map.betUp ?? map.bet);
        else if (down) play(map.betDown ?? map.bet);
      }),
    );
  }
  if (map.toggle) d.push(hud.on('toggled', () => play(map.toggle)));
  if (map.button) d.push(hud.on('buttonActivated', () => play(map.button)));
  return () => {
    for (const dispose of d.splice(0)) dispose();
  };
}
