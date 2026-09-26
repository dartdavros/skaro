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
  defaultEffort?: string;
  /** How new tasks start: ask, auto within the task, full access. */
  permissionMode: 'ask' | 'auto' | 'full';
  baseBranch: string;
  branchTemplate: string;
  isolation: 'worktree' | 'in-place';
  merge: { strategy: 'squash' | 'merge' | 'rebase'; deleteBranch: boolean };
  chat: { autoAcceptDocs: boolean };
  /** Skaro keeps its block in AGENTS.md and CLAUDE.md (architecture.md 3). */
  agentFiles: boolean;
  agentInstructions?: string;
  /** App-wide instructions ("Настройки"): the agent gets them before the project's own. */
  globalInstructions?: string;
}

/**
 * App-wide defaults ("Настройки"): a project takes them for whatever its config.yaml does not
 * set; the project's own values win.
 */
export interface ConfigDefaults {
  baseBranch?: string;
  branchTemplate?: string;
  isolation?: 'worktree' | 'in-place';
  mergeStrategy?: 'squash' | 'merge' | 'rebase';
  deleteBranch?: boolean;
  autoAcceptDocs?: boolean;
  agentFiles?: boolean;
  agentInstructions?: string;
}

/** Settings a project may leave to the app-wide defaults. */
export type InheritableSetting = Exclude<keyof ConfigDefaults, 'agentInstructions'>;

export const DEFAULT_CONFIG: ProjectConfig = {
  defaultAgent: 'claude-code',
  permissionMode: 'auto',
  baseBranch: 'main',
  branchTemplate: 'skaro/{id}-{slug}',
  isolation: 'worktree',
  merge: { strategy: 'squash', deleteBranch: true },
  chat: { autoAcceptDocs: true },
  agentFiles: false,
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
