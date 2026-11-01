// The Present phases — the game's slot plumbing. The core has sent the request, the platform has
// settled the money, and `ctx.round.data` is the parsed book; these walk it to `settle`. Two
// linked phases so there is no giant switch: `present` plays the base spin, its respins and the
// scatter, then settles or hands off to `present-free`, the bonus:
//
//   the FREE SPINS announcer over the base game → the bonus's rules screen (click) → a dissolve
//   into the bonus look → the free spins play by themselves (no round button, no skipping unless
//   the config sets `bonusSkip`) → the TOTAL WIN screen (click) → a dip back to the base game.
//
// Autoplay and replays never wait for a click. Money is the platform's; this only animates.

import { blockingBeat, type Phase, type PhaseContext } from '@artubeplate/core';
import type { Scene } from '../scene/Scene';
import type { Overlay } from '../ui/overlay';
import type { SpinModel, Stage, WinLine } from '../game/model';

export interface PresentDeps {
  overlay?: Overlay;
  /** The bonus's name and rules for its rules screen (`bonusName` / `bonusRules` of the config). */
  bonus?: { name: string; rules: string[] };
  /** The wild symbol id (sticky wilds are pinned as it). */
  wildId?: string;
  /** Free-spins wilds stay put for the rest of the feature (`settings.config.freeSpins.sticky`). */
  stickyWilds?: boolean;
}

type Ctx = PhaseContext<SpinModel, Scene, unknown>;

export function makePresentPhases(deps: PresentDeps): Phase<SpinModel, Scene, unknown>[] {
  const cue = (ctx: Ctx): void => ctx.audio?.play('winline', { bus: 'wins' });
  /** A one-shot from config.ts's AUDIO (big-win, fs-start, retrigger, fs-end…). */
  const sting = (ctx: Ctx, name: string): void => ctx.audio?.play(name, { bus: 'wins' });
  const bet = (ctx: Ctx): number => ctx.round?.bet ?? 0;
  const money = (ctx: Ctx, x: number): string => ctx.hud.format(x * bet(ctx));

  /** Animation speed: < 1 is faster (turbo), tiny after a slam-stop. */
  const speedOf = (ctx: Ctx): number => (ctx.turbo.skipped ? 0.05 : ctx.turbo.speed);

  /**
   * The lines pay in two parts. First the overview: the losers dim, every line shows at once as
   * a bold white line under the symbols and every winning symbol wows; each line's amount pops
   * over its line (120 ms apart) and flies into the win box, which appears on the first hit,
   * counts the lines up and grows with every hit, then holds the round's total so far (where
   * the box sits is `PINS.winBox` in ../layout). Then, once the round is settled, the attract
   * cycle runs the lines one by one (the snake, the wows, the line's amount floating over it)
   * until the next spin.
   *
   * Whatever the pace, a paying spin is readable: the summed overview stays up until the amounts
   * are in and for a floor of real time (`WIN_HOLD`), longest when turbo or autoplay would
   * otherwise flick past it. Super turbo keeps its flick on a dry spin, but a win shows its lines
   * and its box like any other. The speeds are read as each step starts, so a skip mid-overview
   * hurries what is left.
   */
  const WIN_HOLD = { natural: 450, autoplay: 750, turbo: 750, superTurbo: 550 };
  const winHold = (ctx: Ctx): number => (ctx.turbo.level >= 2 ? WIN_HOLD.superTurbo : ctx.turbo.level === 1 ? WIN_HOLD.turbo : ctx.turbo.autoplay ? WIN_HOLD.autoplay : WIN_HOLD.natural);

  /**
   * The wins of one stage. In the base game `boxFrom` is the round's win before this stage (in
   * multiples of the bet): the box holds it and each line's amount adds to it as it lands, so a
   * respin keeps counting where the spin before left off. In free spins there is no win box
   * (`boxFrom` undefined): the lines show the same way and one label with the stage's total
   * floats over the winning cells, so the board stays clear.
   */
  const presentWins = async (ctx: Ctx, wins: WinLine[], holdMs: number, boxFrom?: number): Promise<void> => {
    if (!wins.length) {
      await ctx.turbo.delay(180);
      return;
    }
    const overlay = deps.overlay;
    const cells = wins.flatMap((w) => w.cells);
    const stageWin = wins.reduce((s, w) => s + w.win, 0);
    cue(ctx);
    ctx.view.showLines(
      wins.map((w) => w.cells),
      speedOf(ctx),
    );
    if (boxFrom === undefined || !overlay) {
      overlay?.winLabel(
        cells.map((c) => ctx.view.cellRect(c.reel, c.row)),
        money(ctx, stageWin),
      );
      await ctx.view.flashWins(cells, holdMs, (ms) => ctx.turbo.delay(ms));
      ctx.view.clearLines();
      return;
    }
    let running = boxFrom;
    const flights = wins.map(async (w, i) => {
      await ctx.turbo.delay(200 + i * 120);
      await overlay.flyWinLabel(
        w.cells.map((c) => ctx.view.cellRect(c.reel, c.row)),
        money(ctx, w.win),
        speedOf(ctx),
      );
      running += w.win;
      overlay.hitWin(running * bet(ctx), speedOf(ctx));
    });
    const summed = Promise.all(flights);
    // The overview (dim losers, every line, the box) stays up until the amounts are in and for
    // the pace's floor of real time: a skip jumps to the summed board, not past it, and turbo or
    // autoplay cannot flick a win away unseen.
    await ctx.view.flashWins(cells, holdMs + wins.length * 120 + 400, (ms) => Promise.all([ctx.turbo.beat(ms, winHold(ctx)), summed]).then(() => undefined));
    await overlay.settleWin(speedOf(ctx));
    ctx.view.clearLines();
  };

  /** After a base round: cycle its lines one by one while idle, each line's amount floating over it (never blocks). */
  const attract = (ctx: Ctx, wins: WinLine[]): void => {
    // The amounts are formatted up front: the round (and so the bet) may be gone by the time a line comes round.
    const labels = wins.map((w) => money(ctx, w.win));
    ctx.view.cycleWins(
      wins.map((w) => ({ cells: w.cells, value: w.win })),
      (cells, _value, i) => deps.overlay?.winLabel(cells.map((c) => ctx.view.cellRect(c.reel, c.row)), labels[i] ?? ''),
    );
  };

  const beat = (ctx: Ctx, title: string, sub: string, holdMs: number): Promise<void> =>
    blockingBeat(ctx, { holdMs, timing: 'turbo', show: () => deps.overlay?.show(title, sub), hide: () => deps.overlay?.hide() });

  /** A big-win beat sized off the round multiplier (the platform's), then settle. After a bonus
   *  the TOTAL WIN screen has had its moment: `beats: false`. */
  const finishAndSettle = async (ctx: Ctx, idleWins: WinLine[] = [], opts: { beats?: boolean } = {}): Promise<void> => {
    const r = ctx.round;
    const mult = r?.data?.multiplier ?? 0;
    // The amount fades before anything else takes the board (the line cycle floats labels there).
    await deps.overlay?.hideWin(speedOf(ctx));
    // A big win counts up through BIG → MEGA → EPIC (the overlay's WinAnnouncer; its `onTier`
    // plays the stinger). A slam-stop skips it to the final amount.
    if (r && r.totalWin > 0 && opts.beats !== false) await deps.overlay?.announce(r.totalWin, mult, speedOf(ctx));
    deps.overlay?.clear();
    if (idleWins.length && !ctx.round?.replay) attract(ctx, idleWins);
    await ctx.fsm.transition('settle');
  };

  const pinWilds = (scene: Scene, stage: Stage, pinned: Set<string>): void => {
    if (!deps.wildId || !deps.stickyWilds) return;
    for (const w of stage.wilds) {
      const k = `${w.reel},${w.row}`;
      if (!pinned.has(k)) {
        pinned.add(k);
        scene.stickyWild(w.reel, w.row, deps.wildId);
      }
    }
  };

  const present: Phase<SpinModel, Scene, unknown> = {
    name: 'present',
    async enter(ctx) {
      const scene = ctx.view;
      const model = ctx.round?.data;
      if (!model) {
        await ctx.fsm.transition('settle');
        return;
      }
      deps.overlay?.clear();
      // The core already STARTED the reels (onSpinStart); this lands them on the book's board.
      await scene.land(model.base.board);
      const stageWin = (wins: WinLine[]): number => wins.reduce((s, w) => s + w.win, 0);
      let soFar = 0;
      await presentWins(ctx, model.base.wins, 1100, soFar);
      soFar += stageWin(model.base.wins);

      // Respins hold the trigger reel, spin the rest; the win box keeps counting from where it was.
      for (const stage of model.respins) {
        await scene.spinTo(stage.board, [0]);
        await presentWins(ctx, stage.wins, 900, soFar);
        soFar += stageWin(stage.wins);
      }

      if (model.scatter) {
        deps.overlay?.winLabel(
          model.scatter.cells.map((c) => scene.cellRect(c.reel, c.row)),
          money(ctx, model.scatter.win),
        );
        cue(ctx);
        await ctx.turbo.delay(700);
      }

      if (model.free?.spins.length) {
        // The feature: autoplay ends here when the player asked it to stop on a feature, so the
        // bonus plays at its own pace and waits for them. From here the bonus takes the BONUS GAME
        // turbo switch, and a slam of this spin is cleared: the free spins never play at slam speed.
        if (ctx.hud.autoplay.active() && ctx.hud.autoplay.stopOnFeature()) ctx.hud.autoplay.stop();
        ctx.turbo.feature(true);
        await ctx.fsm.transition('present-free');
      } else await finishAndSettle(ctx, (model.respins.at(-1) ?? model.base).wins);
    },
  };

  const presentFree: Phase<SpinModel, Scene, unknown> = {
    name: 'present-free',
    async enter(ctx) {
      const scene = ctx.view;
      const free = ctx.round?.data.free;
      if (!free) {
        ctx.turbo.feature(false);
        await finishAndSettle(ctx);
        return;
      }
      ctx.turbo.feature(true);
      const bet = ctx.round?.bet ?? 0;
      let remaining = free.totalSpins;
      let total = ctx.round?.data.base.wins.reduce((s, w) => s + w.win, 0) ?? 0;
      total += ctx.round?.data.scatter?.win ?? 0;
      // Autoplay and replays never wait for a click.
      const auto = ctx.turbo.autoplay || !!ctx.round?.replay;

      scene.clearPins();
      await deps.overlay?.hideWin(speedOf(ctx));
      deps.overlay?.clear();
      // 1. The announcer, over the base game.
      // The scatters pay into the feature: coins burst from each one and fly into the plaque.
      const blit = scene.scattersToPlaque(ctx.round?.data.scatter?.cells ?? []);
      sting(ctx, 'fs-start');
      await beat(ctx, 'FREE SPINS', `${free.totalSpins} SPINS`, 1300);
      await blit;
      // 2. The bonus's rules; the bar steps aside while the screen is up.
      ctx.hud.setHudState('hidden');
      await scene.bonusIntro({
        title: deps.bonus?.name ?? 'Free spins',
        headline: `You won ${free.totalSpins} free spins!`,
        ...(deps.bonus?.rules.length ? { body: deps.bonus.rules } : {}),
        ...(auto ? { autoContinueMs: 2500 } : {}),
      });
      // 3. Into the bonus. It plays by itself: the bar has no round button in a feature state.
      ctx.hud.setTotalWin(total * bet);
      ctx.hud.setFreeSpins(remaining);
      ctx.hud.setHudState('featurePlay');
      ctx.audio?.music('bonus'); // the base track crossfades into the bonus track
      await scene.enterFeature();

      const pinned = new Set<string>();
      for (const spin of free.spins) {
        // A speed switched during the last spin counts from this one (the core holds it until here).
        ctx.turbo.spin();
        remaining = Math.max(0, remaining - 1);
        ctx.hud.setFreeSpins(remaining);
        pinWilds(scene, spin, pinned);
        await scene.spinTo(spin.board, [], true);
        await presentWins(ctx, spin.wins, 750);
        total += spin.wins.reduce((s, w) => s + w.win, 0);
        ctx.hud.setTotalWin(total * bet);
        if (spin.retrigger > 0) {
          remaining += spin.retrigger;
          ctx.hud.setFreeSpins(remaining);
          sting(ctx, 'retrigger');
          await beat(ctx, 'RETRIGGER', `+${spin.retrigger} SPINS`, 1000);
        }
      }

      // 4. The total, over a grey freeze-frame of the last free spin.
      ctx.hud.setHudState('hidden');
      sting(ctx, 'fs-end');
      await scene.totalWin({
        amount: ctx.round?.totalWin ?? total * bet,
        format: (n) => ctx.hud.format(n),
        note: `${free.spins.length} free spins played`,
        ...(auto ? { autoContinueMs: 3000 } : {}),
      });
      // 5. Back to the base game; the bar returns for the settle.
      scene.clearPins();
      ctx.hud.setFreeSpins(0);
      ctx.hud.setHudState('play');
      await scene.exitFeature();
      ctx.turbo.feature(false);
      ctx.audio?.music('base');
      await finishAndSettle(ctx, [], { beats: false });
    },
  };

  return [present, presentFree];
}
