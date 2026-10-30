import { randomUUID } from 'node:crypto';
import type { BackgroundJob, BackgroundState } from '../shared/background';

/** Finished work stays visible this long so that the owner can see what happened. */
const RECENT_MS = 30 * 60_000;
const RECENT_LIMIT = 30;

type Result = BackgroundJob['result'];

export interface BackgroundHandle {
  progress(percent: number): void;
}

/** One list of Skaro's own work for the title bar; producers report, the UI only reads. */
export class BackgroundWork {
  private jobs: BackgroundJob[] = [];
  private emit?: (state: BackgroundState) => void;

  attach(emit: (state: BackgroundState) => void): void {
    this.emit = emit;
  }

  snapshot(): BackgroundState {
    const now = Date.now();
    this.jobs = this.jobs.filter(
      (job) => job.state === 'running' || now - (job.endedAt ?? now) < RECENT_MS,
    );
    const running = this.jobs.filter((job) => job.state === 'running');
    const recent = this.jobs
      .filter((job) => job.state !== 'running')
      .sort((a, b) => (b.endedAt ?? 0) - (a.endedAt ?? 0))
      .slice(0, RECENT_LIMIT);
    return { jobs: [...running, ...recent].map((job) => ({ ...job })) };
  }

  start(what: string, params?: Record<string, string>): BackgroundJob {
    const job: BackgroundJob = {
      id: randomUUID(),
      what,
      ...(params ? { params } : {}),
      state: 'running',
      startedAt: Date.now(),
    };
    this.jobs.push(job);
    this.changed();
    return job;
  }

  progress(job: BackgroundJob, percent: number): void {
    const rounded = Math.max(0, Math.min(100, Math.round(percent)));
    if (job.progress === rounded) return;
    job.progress = rounded;
    this.changed();
  }

  finish(job: BackgroundJob, result?: Result): void {
    job.state = 'done';
    job.endedAt = Date.now();
    if (result) job.result = result;
    // Work that repeats (indexing after each change) stays one row with its count.
    const same = this.jobs.find(
      (other) =>
        other !== job &&
        other.state === 'done' &&
        other.what === job.what &&
        JSON.stringify(other.params) === JSON.stringify(job.params),
    );
    if (same) {
      job.runs = (same.runs ?? 1) + 1;
      this.jobs = this.jobs.filter((other) => other !== same);
    }
    this.changed();
  }

  fail(job: BackgroundJob, error: unknown): void {
    job.state = 'failed';
    job.endedAt = Date.now();
    job.error = error instanceof Error ? error.message : String(error);
    this.changed();
  }

  /** Reports an action from its start to its outcome; the action's own result is returned. */
  async run<T>(
    what: string,
    params: Record<string, string> | undefined,
    action: (handle: BackgroundHandle) => Promise<T>,
    result?: (value: T) => Result,
  ): Promise<T> {
    const job = this.start(what, params);
    try {
      const value = await action({ progress: (percent) => this.progress(job, percent) });
      this.finish(job, result?.(value));
      return value;
    } catch (error) {
      this.fail(job, error);
      throw error;
    }
  }

  private changed(): void {
    this.emit?.(this.snapshot());
  }
}

export const backgroundWork = new BackgroundWork();

/** "Удаляет окружение задачи T-168 · Chatballs" or the environment of a merge candidate. */
export function environmentJob(
  db: { getProject(id: string): { name: string } | undefined },
  key: { projectId: string; taskId: string },
): [string, Record<string, string>] {
  const project = db.getProject(key.projectId)?.name ?? '';
  return key.taskId.startsWith('integration-')
    ? ['environment.merge', { project, merge: key.taskId.slice(12, 20) }]
    : ['environment.task', { project, task: key.taskId }];
}

/** What a cleanup gave back, in the owner's units. */
export function freedResult(bytes: number): BackgroundJob['result'] {
  if (bytes < 1e6) return { what: 'nothing' };
  return { what: 'freed', params: { size: (bytes / 1e9).toFixed(bytes >= 1e10 ? 0 : 1) } };
}
