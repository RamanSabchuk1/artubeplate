// The mixer ↔ HUD binding, with NO @schmooky/zvuk dependency — so `createArtubeGame` can
// auto-wire audio without pulling zvuk into every bundle. It talks to the mixer through a
// minimal structural port (`MixerLike`), which @artubeplate/core/audio's `GameAudio` satisfies.
//
// The DOM HUD's ☰ menu has two rows, SOUND and MUSIC. Each drives a 0..1 slider signal in the
// core (`ui.sfxSlider`, `ui.musicSlider`): pressing SOUND takes effects to 0 and back, MUSIC does
// the same for music — and SOUND is the master (with it off, music is silent and its row dims).

import type { DomHud } from '@open-slot-ui/dom';
import type { AudioPort } from '../engine/fsm';

/** The two volume groups the HUD drives. */
export type MixerGroup = 'music' | 'effects';

export interface MixerLike {
  setGroupLevel(group: MixerGroup, level: number): void;
  getGroupLevel(group: MixerGroup): number;
  setMuted(muted: boolean): void;
  unlock?(): Promise<void> | void;
}

/**
 * Bind SOUND/MUSIC (+ master mute) to the mixer: the HUD is the source of truth, the mixer
 * follows it from the start. Remembering them across visits is the HUD's job (open-slot-ui's
 * `mountDomHud(spec, { persist })`, which `createArtubeGame` turns on). Returns a disposer.
 */
export function bindMixerToHud(mixer: MixerLike, hud: DomHud): () => void {
  const ui = hud.ui;
  const apply = (): void => {
    const fx = ui.sfxSlider.value.get();
    mixer.setGroupLevel('effects', fx);
    mixer.setGroupLevel('music', fx > 0 ? ui.musicSlider.value.get() : 0); // SOUND is the master
  };
  apply();
  mixer.setMuted(ui.muted.get());
  const disposers = [ui.sfxSlider.value.subscribe(apply), ui.musicSlider.value.subscribe(apply), ui.muted.subscribe((m) => mixer.setMuted(m))];
  return () => {
    for (const d of disposers.splice(0)) d();
  };
}

/**
 * Start the music, and the beds under it, on the FIRST user interaction (browsers block audio
 * until a gesture), unlocking the AudioContext on the way. One-shot. Returns a disposer.
 */
export function startMusicOnFirstGesture(
  audio: AudioPort,
  mixer: MixerLike,
  hud: DomHud,
  opts: { bgm?: string; fadeIn?: number; ambience?: readonly string[]; ambienceFadeIn?: number; loaded?: Promise<unknown> },
): () => void {
  const disposers: Array<() => void> = [];
  let started = false;
  const start = (): void => {
    if (started) return;
    started = true;
    // Unlock inside the gesture (browsers require it); the music itself may still be loading —
    // the first gesture can be a tap on an intro screen a moment after boot.
    void mixer.unlock?.();
    void Promise.resolve(opts.loaded)
      .then(() => {
        if (opts.bgm) audio.music(opts.bgm, { fadeIn: opts.fadeIn ?? 0.8 });
        for (const bed of opts.ambience ?? []) audio.ambience?.(bed, { fadeIn: opts.ambienceFadeIn ?? 2 });
      })
      .catch((e: unknown) => console.warn('[artubeplate] the music could not start', e));
    for (const d of disposers.splice(0)) d();
  };
  if (typeof window !== 'undefined') {
    for (const e of ['pointerdown', 'keydown', 'touchstart'] as const) {
      window.addEventListener(e, start, { capture: true });
      disposers.push(() => window.removeEventListener(e, start, { capture: true }));
    }
  }
  disposers.push(hud.on('spinRequested', start));
  return () => {
    for (const d of disposers.splice(0)) d();
  };
}
