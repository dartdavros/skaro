// Project artifacts stored in .skaro/ (docs/architecture.md, section 3).

/** Stored task status. "Blocked" and "needs answer" are computed, not stored. */
export type TaskStatus = 'todo' | 'in_progress' | 'review' | 'done' | 'failed' | 'cancelled';

export const TASK_STATUSES: readonly TaskStatus[] = [
  'todo',
  'in_progress',
  'review',
  'done',
  'failed',
  'cancelled',
];

export interface Task {
  id: string;
  title: string;
  milestone?: string;
  status: TaskStatus;
  dependsOn: string[];
  /** The user let the task start before its dependencies are done ("Разблокировать"). */
  unblocked: boolean;
  /** Hidden from the board, history kept ("Архивировать"). */
  archived: boolean;
  /** Position inside its milestone. */
  order?: number;
  agent?: string;
  model?: string;
  branch?: string;
  created?: string;
  body: string;
  /** Path relative to the project root. */
  path: string;
}

export interface Milestone {
  id: string;
  title: string;
  order: number;
  body: string;
  path: string;
}

export type AdrStatus = 'proposed' | 'accepted' | 'superseded';

export interface Adr {
  /** Four digits, e.g. "0003". */
  id: string;
  title: string;
  status: AdrStatus;
  /** ADR this one replaces / is replaced by. */
  replaces?: string;
  replacedBy?: string;
  date?: string;
  body: string;
  path: string;
}

/** Brief, architecture and free documents. */
export interface Doc {
  kind: 'brief' | 'architecture' | 'doc';
  title: string;
  body: string;
  path: string;
}

export interface ProjectConfig {
  defaultAgent: string;
  defaultModel?: string;
  baseBranch: string;
  branchTemplate: string;
  isolation: 'worktree' | 'in-place';
  merge: { strategy: 'squash' | 'merge'; deleteBranch: boolean };
  chat: { autoAcceptDocs: boolean };
  agentInstructions?: string;
}

export const DEFAULT_CONFIG: ProjectConfig = {
  defaultAgent: 'claude-code',
  baseBranch: 'main',
  branchTemplate: 'skaro/{id}-{slug}',
  isolation: 'worktree',
  merge: { strategy: 'squash', deleteBranch: true },
  chat: { autoAcceptDocs: true },
};

/** A file in .skaro/ that could not be read; shown to the user instead of crashing. */
export interface ArtifactProblem {
  path: string;
  message: string;
}

export interface ProjectArtifacts {
  config: ProjectConfig;
  brief?: Doc;
  architecture?: Doc;
  docs: Doc[];
  adrs: Adr[];
  milestones: Milestone[];
  tasks: Task[];
  problems: ArtifactProblem[];
}
