import { limitWindow, obj, type AgentLimits, type AgentLimitWindow } from '@skaro/timeline';
import type { AppServer } from './rpc.ts';

export async function readCodexLimits(server: AppServer): Promise<AgentLimits> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return codexLimits(
      await Promise.race([
        server.request('account/rateLimits/read', {}),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Codex usage request timed out')), 30_000);
        }),
      ]),
    );
  } finally {
    clearTimeout(timer);
  }
}

export function codexLimits(value: unknown): AgentLimits {
  const data = obj(value);
  const buckets = obj(data?.['rateLimitsByLimitId']);
  const limits = obj(buckets?.['codex']) ?? obj(data?.['rateLimits']);
  const windows: AgentLimitWindow[] = [];
  for (const key of ['primary', 'secondary']) {
    const window = obj(limits?.[key]);
    const duration = window?.['windowDurationMins'];
    const kind = duration === 300 ? 'five_hour' : duration === 10080 ? 'seven_day' : undefined;
    if (window && kind) windows.push(limitWindow(kind, window['usedPercent'], window['resetsAt']));
  }
  return {
    checkedAt: new Date().toISOString(),
    windows,
    ...(limits?.['rateLimitReachedType'] ? { reached: true } : {}),
  };
}
