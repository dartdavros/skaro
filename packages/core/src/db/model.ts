export interface ProjectRecord {
  id: string;
  name: string;
  path: string;
  createdAt: number;
  lastOpenedAt?: number;
  /** The project's logo as a data: URL (SVG, PNG or JPG). */
  logo?: string;
}

export type RunOutcome = 'done' | 'interrupted' | 'failed';

export interface RunRecord {
  id: string;
  projectId: string;
  taskId: string;
  agent: string;
  model?: string;
  worktree?: string;
  branch?: string;
  logPath: string;
  adapterVersion: string;
  nativeSessionId?: string;
  startedAt: number;
  endedAt?: number;
  outcome?: RunOutcome;
}

export interface ChatRecord {
  id: string;
  projectId: string;
  /** Set for a task chat, empty for a project chat. */
  taskId?: string;
  agent: string;
  title: string;
  nativeSessionId?: string;
  logPath: string;
  archived: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface MergeRecord {
  id: string;
  projectId: string;
  taskId: string;
  branch: string;
  commit: string;
  strategy: 'squash' | 'merge' | 'rebase';
  mergedAt: number;
  revertCommit?: string;
}

/** Something that happened in a project: a merge, a finished run, an accepted proposal. */
export interface EventRecord {
  id: number;
  projectId: string;
  kind: string;
  data: Record<string, unknown>;
  at: number;
}

export interface InteractionRecord {
  id: string;
  projectId: string;
  runId?: string;
  chatId?: string;
  kind: string;
  /** Canonical interaction (agent-output.md, section 3). */
  payload: unknown;
  openedAt: number;
  closedAt?: number;
  resolution?: string;
}
