export const SHUTDOWN_STAGES = ['agents', 'environments', 'history', 'background'] as const;
export type ShutdownStage = (typeof SHUTDOWN_STAGES)[number];

/** Presentation of actual shutdown milestones, never an estimate of remaining work. */
export interface ShutdownState {
  startedAt: number;
  revision: number;
  stage: ShutdownStage;
  completed: readonly ShutdownStage[];
}

export const SHUTDOWN_SLOW_SECONDS = 30;

export function shutdownSeconds(startedAt: number, now: number): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}

export function shutdownTime(seconds: number): string {
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}
