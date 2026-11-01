// Scenes and transitions: the vocabulary of `@artubeplate/core/scenes`.
//
// A SCENE is one screen of the game (an intro, the base game, a bonus arena). A TRANSITION drives
// the switch from what is on screen to what comes next, and decides WHEN the swap happens: a dim
// swaps behind a dark veil, a shader swaps between two snapshots, a morph keeps the background and
// swaps only the objects it animates away and back in.

import type { Application, Container, Texture } from 'pixi.js';

export interface Scene {
  /** How the director finds it (`director.go(id)`). */
  readonly id: string;
  /** What the director shows while this scene is current. */
  readonly view: Container;
  /** Build or refresh before the scene becomes visible. Awaited BEFORE the transition starts,
   *  so a shader transition snapshots the finished scene. */
  enter?(data?: unknown): void | Promise<void>;
  /** The transition finished; the scene is fully on screen. */
  entered?(): void;
  /** The scene is about to be replaced (awaited before the transition starts). */
  leave?(): void | Promise<void>;
  /** The scene is off screen (after the transition). */
  left?(): void;
  /** The view was just put on stage (inside the transition's swap: behind a veil, between two
   *  snapshots). The place to hide or show something in step with the switch. */
  attached?(): void;
  /** The view was just taken off stage (inside the swap). */
  detached?(): void;
  /** The screen size changed (CSS pixels). Also called before every entry. */
  resize?(width: number, height: number): void;
  /** Every frame while this scene is current (ms since the last frame). */
  update?(deltaMs: number): void;
  /** For `morph`: animate this scene's foreground away on `tl` (the background stays). */
  outro?(tl: gsap.core.Timeline): void;
  /** For `morph`: animate this scene's foreground in on `tl`. */
  intro?(tl: gsap.core.Timeline): void;
}

export interface TransitionContext {
  readonly app: Application;
  /** Backdrop + scenes: what a snapshot captures. */
  readonly content: Container;
  /** Above the scenes: where a transition draws (a veil, a shader quad). */
  readonly overlay: Container;
  /** Screen size in CSS pixels. */
  readonly width: number;
  readonly height: number;
  /** Duration multiplier: 1 at normal speed, smaller in turbo, near 0 after a slam-stop. */
  readonly speed: number;
  /** The outgoing scene (null on the very first entry). Equal to `to` for an in-scene change. */
  readonly from: Scene | null;
  /** The incoming scene. */
  readonly to: Scene | null;
  /** The screen as it looks now, the director's underlay included, in a new texture (destroy it
   *  when done). What a transition that blends two pictures should capture. */
  snapshot(opts?: { foreground?: boolean }): Texture;
  /** Make the change: detach `from`, attach `to` (or run the in-scene change). Runs once;
   *  the director calls it after the transition if the transition did not. */
  swap(): Promise<void>;
}

/** A transition: animate whatever it likes around one call to `ctx.swap()`. */
export type Transition = (ctx: TransitionContext) => Promise<void>;
