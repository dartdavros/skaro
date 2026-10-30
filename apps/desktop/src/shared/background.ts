/**
 * What Skaro does by itself, outside the agent feeds: removing environments and finished merge
 * copies, cleaning Docker, indexing code. The title bar shows it while it runs and for a while after.
 */
export interface BackgroundJob {
  id: string;
  /** Message key under `background.job.` with its parameters. */
  what: string;
  params?: Record<string, string>;
  state: 'running' | 'done' | 'failed';
  /** 0–100 when the work knows its share. */
  progress?: number;
  /** Message key under `background.result.` when the work reports what it achieved. */
  result?: { what: string; params?: Record<string, string> };
  error?: string;
  /** Finished runs of the same work this row stands for: repeats do not get rows of their own. */
  runs?: number;
  startedAt: number;
  endedAt?: number;
}

export interface BackgroundState {
  /** Running jobs first, then the recently finished ones, newest first. */
  jobs: BackgroundJob[];
}
