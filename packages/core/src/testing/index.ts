// @artubeplate/core/testing — run whole rounds headless: the mock RGS (re-exported), an instant
// ticker, and a recording HudPort that notices can be answered on.

import type { HudPort, HudStateName, NoticeRequest } from '../engine/hud-port';

export { InstantTicker } from '../engine/ticker';
export { MockRgs, type MockRgsOptions } from '../rgs/MockRgs';

export interface RecordingHud extends HudPort {
  readonly calls: Array<{ m: string; args: unknown[] }>;
  readonly notices: NoticeRequest[];
  /** What the next notice(s) answer (action index). Default: 0 (the first/primary button). */
  answers: number[];
  states(): HudStateName[];
  reportedRounds(): Array<{ win: number; stake: number }>;
}

export function mockHud(): RecordingHud {
  const calls: Array<{ m: string; args: unknown[] }> = [];
  const notices: NoticeRequest[] = [];
  const rec =
    (m: string) =>
    (...args: unknown[]): void => {
      calls.push({ m, args });
    };
  const hud: RecordingHud = {
    calls,
    notices,
    answers: [],
    setBalance: rec('setBalance'),
    setWin: rec('setWin'),
    setTotalWin: rec('setTotalWin'),
    setFreeSpins: rec('setFreeSpins'),
    setFreeRounds: rec('setFreeRounds'),
    setHudState: rec('setHudState') as (s: HudStateName) => void,
    spinBusy: rec('spinBusy'),
    spinStoppable: rec('spinStoppable'),
    spinIdle: rec('spinIdle'),
    reportRound: rec('reportRound'),
    autoplay: { active: () => false, stopOnFeature: () => false, stopOnAnyWin: () => false, stop: () => {} },
    showRgsError: rec('showRgsError'),
    notice: async (req) => {
      notices.push(req);
      calls.push({ m: 'notice', args: [req] });
      return hud.answers.shift() ?? 0;
    },
    hideNotice: rec('hideNotice'),
    format: (n) => n.toFixed(2),
    lock: rec('lock'),
    unlock: rec('unlock'),
    states: () => calls.filter((c) => c.m === 'setHudState').map((c) => c.args[0] as HudStateName),
    reportedRounds: () => calls.filter((c) => c.m === 'reportRound').map((c) => ({ win: c.args[0] as number, stake: c.args[1] as number })),
  };
  return hud;
}
