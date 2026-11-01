// The open-slot-ui DOM HUD, seen through the engine's HudPort.

import { formatAmount, type BlockSpec, type CurrencySpec, type NoticeAction } from '@open-slot-ui/core';
import type { DomHud } from '@open-slot-ui/dom';
import type { HudPort, HudStateName, NoticeRequest } from '../engine/hud-port';

export function domHudPort(hud: DomHud, currency: () => CurrencySpec): HudPort {
  const ui = hud.ui;
  /** The notice currently awaited — a newer notice replacing it settles it as dismissed. */
  let pending: ((i: number) => void) | null = null;

  const notice = (req: NoticeRequest): Promise<number> =>
    new Promise<number>((resolve) => {
      pending?.(-1);
      let done = false;
      const finish = (i: number): void => {
        if (done) return;
        done = true;
        off();
        if (pending === finish) pending = null;
        resolve(i);
      };
      pending = finish;
      const blocks: BlockSpec[] = [
        ...(req.title ? [{ kind: 'heading' as const, id: 'notice-title', text: req.title }] : []),
        { kind: 'text', id: 'notice-body', text: req.message },
      ];
      const labels = req.actions ?? [{ label: 'OK', primary: true }];
      const actions: NoticeAction[] = labels.map((a, i) => ({
        label: a.label,
        variant: a.primary || (i === 0 && labels.length === 1) ? 'primary' : 'secondary',
        onSelect: () => finish(i),
      }));
      // The binding closes the dialog BEFORE it runs the button's handler, so the "dismissed"
      // event fires first — defer it a microtask so a pressed button wins over a plain dismiss.
      const off = ui.bus.on('noticeDismissed', () => queueMicrotask(() => finish(-1)));
      ui.showNotice(blocks, actions, { blocking: !!req.blocking });
    });

  return {
    setBalance: (n) => hud.setBalance(n),
    setWin: (n) => hud.setWin(n),
    setTotalWin: (n) => hud.setTotalWin(n),
    setFreeSpins: (n) => hud.setFreeSpins(n),
    setFreeRounds: (n) => hud.setFreeRounds(n),
    setHudState: (s: HudStateName) => hud.setHudState(s),
    spinBusy: () => ui.spin.busy(),
    spinStoppable: () => ui.spin.stopState(),
    spinIdle: () => ui.spin.idle(),
    reportRound: (win, stake) => hud.reportRound(win, stake),
    autoplay: { active: () => ui.autoplay.isActive, stopOnFeature: () => ui.stopOnFeature.isOn, stopOnAnyWin: () => ui.stopOnAnyWin.isOn, stop: () => ui.autoplay.stop() },
    showRgsError: (code, opts) => hud.showRgsError(code, opts ?? {}),
    notice,
    hideNotice: () => {
      pending?.(-1);
      ui.hideNotice();
    },
    format: (n) => formatAmount(n, currency()),
    lock: () => ui.lock(),
    unlock: () => ui.unlock(),
  };
}

/**
 * Lives instead of a number in the feature counter: `max` pips, the first `n` lit, where `n` is
 * what `setFreeSpins(n)` last set (a Hold & Win's respins left). Returns the undo.
 */
export function livesPips(hud: DomHud, max: number): () => void {
  const item = hud.root.querySelector<HTMLElement>('#FeatureCounterItem');
  if (!item || max < 1) return () => {};
  item.classList.add('has-lives');
  const pips = document.createElement('span');
  pips.className = 'LivesPips';
  pips.setAttribute('aria-hidden', 'true');
  for (let i = 0; i < max; i++) pips.appendChild(document.createElement('i'));
  item.appendChild(pips);
  const paint = (n: number): void => {
    pips.querySelectorAll('i').forEach((el, i) => el.classList.toggle('is-spent', i >= n));
    item.setAttribute('aria-label', `${n} of ${max}`);
  };
  paint(hud.ui.spin.freeSpins.get());
  const off = hud.ui.spin.freeSpins.subscribe(paint);
  return () => {
    off();
    pips.remove();
    item.classList.remove('has-lives');
  };
}
