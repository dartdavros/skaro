import type { AgentLimits, TimelineState } from '@skaro/timeline';

export function sessionLimit(
  snapshot: AgentLimits | undefined,
  now: number,
): TimelineState['limits'] {
  // The provider read times out after 30s; a sleeping renderer may have missed many polls.
  if (!snapshot || !(now - Date.parse(snapshot.checkedAt) <= 210_000)) return undefined;
  const windows = snapshot.windows
    .filter((w) => w.remainingPercent !== null)
    .sort((a, b) => a.remainingPercent! - b.remainingPercent!);
  const current = (w: (typeof windows)[number]) => !w.resetsAt || Date.parse(w.resetsAt) > now;
  const worst = windows.find(current);
  const reached = snapshot.reached && (!windows[0] || current(windows[0]));
  if (!reached && (!worst || worst.remainingPercent! > 10)) return undefined;
  return {
    state: reached || worst?.remainingPercent === 0 ? 'exhausted' : 'warning',
    ...(worst?.resetsAt && { resetsAt: worst.resetsAt }),
  };
}
