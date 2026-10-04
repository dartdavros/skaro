import type { PermissionMode } from '@skaro/timeline';

export type Locale = 'ru' | 'en';

export type AgentId = 'claude-code' | 'codex';

export interface AgentInfo {
  id: AgentId;
  installed: boolean;
  /** Pinned version (set when installed). */
  version?: string;
  authenticated?: boolean;
  /** E-mail or plan, as the agent reports it. */
  account?: string;
  /** Approximate download size, bytes. */
  sizeBytes: number;
  /** Download in progress. */
  download?: { received: number; total?: number };
  /** Status not known yet (first check at startup). */
  checking?: boolean;
  error?: string;
}

/** Downloaded and not signed out: the agent can take work. Without one Skaro does nothing. */
export function agentReady(agent: AgentInfo): boolean {
  return agent.installed && agent.authenticated !== false;
}

/** Default model and effort of an agent ("Настройки" → "Агенты"), app setting key. */
/** App setting: merge a task on its own once every criterion is ticked (else the card asks). */
export const AUTO_MERGE_KEY = 'merge.auto';

export function agentDefaultsKey(agent: AgentId): string {
  return `agents.${agent}.defaults`;
}

/** How the agent of a task works (agent modal, "Применится к следующему запросу"). */
export interface AgentSettings {
  agent: AgentId;
  model?: string;
  effort?: string;
  permissionMode: PermissionMode;
  planFirst: boolean;
  isolation: 'worktree' | 'in-place';
}

/** Task status as the UI shows it (core DisplayStatus). */
export type TaskStatus =
  | 'todo'
  | 'in_progress'
  | 'review'
  | 'done'
  | 'failed'
  | 'cancelled'
  | 'blocked'
  | 'queued'
  | 'needs_answer';

export interface TaskRef {
  id: string;
  title: string;
  status: TaskStatus;
}

/** Where the task is in its lifecycle (the task file); `status` adds what happens right now. */
export type TaskStage = 'todo' | 'in_progress' | 'review' | 'done' | 'failed' | 'cancelled';

export interface TaskSummary extends TaskRef {
  stage: TaskStage;
  milestone?: { id: string; title: string };
  archived: boolean;
  /** Assigned agent, else the agent of the last run; undefined — not assigned. */
  agent?: AgentId;
  model?: string;
  deps: string[];
  /**
   * Dependencies not done yet (a blocked task waits for them). Inside a stage the tasks run in
   * order anyway: a dependency in the same stage is not listed and does not block.
   */
  waitsFor: string[];
  /** Works in the branch of its milestone and is merged with it (stage execution). */
  staged?: boolean;
  /** Told to start and waiting its turn in the stage: the task that goes before it. */
  after?: string;
  /** Last change: the task file or its latest run. */
  updatedAt: number;
  /** Position inside its milestone. */
  order?: number;
  /** Specification the task implements (architecture.md 3.7). */
  spec?: { id: string; title: string; path: string };
}

/** A milestone of the plan ("План", Plan mockup). */
export interface MilestoneInfo {
  id: string;
  title: string;
  order: number;
  /** "Цель" and "Критерий готовности" sections of the milestone file. */
  goal?: string;
  criteria?: string;
}

/**
 * Where a stage stands: a milestone is the unit of execution, its tasks run one after another
 * in its branch, then comes its acceptance and its merge. Nothing of it is stored.
 */
export type StageState =
  | 'idle'
  | 'queued'
  | 'running'
  | 'needs_answer'
  | 'stopped'
  | 'error'
  | 'acceptance'
  | 'acceptance_needs_answer'
  | 'awaiting_merge'
  | 'done';

export interface StageInfo {
  /** The milestone. */
  id: string;
  state: StageState;
  /** The task the state is about: it runs, waits for an answer, failed or waits in line. */
  task?: string;
  /** Tasks in review or merged, of all that count (not cancelled, not archived). */
  finished: number;
  total: number;
  /** Finished and not merged yet: «Влить готовое» takes them. */
  mergeable: number;
  branch?: string;
  /** Not started and cannot be: its first task waits for a task of another stage. */
  waitsFor?: { task: string; stage?: string };
}

/** A source of an import as the import modal shows it (architecture.md 12.1). */
export interface ImportSource {
  path: string;
  /** "~/Docs/shop" */
  display: string;
  kind: 'folder' | 'file' | 'archive';
  files: number;
  readable: number;
  unsupported: number;
  /** Extensions Skaro does not read: ".vsdx". */
  formats: string[];
  missing?: boolean;
}

export type ImportItemType =
  'brief' | 'architecture' | 'adr' | 'spec' | 'doc' | 'milestone' | 'task';

/** An artifact on the import review screen (ImportReview mockup). */
export interface ImportReviewItem {
  key: string;
  type: ImportItemType;
  title: string;
  /** Changes an existing artifact ("обновит"). */
  update: boolean;
  sources: string[];
  /** Text in the Skaro format; for a task its body (goal, criteria, notes). */
  body: string;
  /** Text now, for an update. */
  before?: string;
  /** Task: milestone (staged key or id), dependencies and specification. */
  milestone?: string;
  dependsOn: string[];
  spec?: string;
  /** Keys of other staged artifacts it links to. */
  refs: string[];
  /** Milestone: goal and done criterion; task: goal and criteria. */
  fields?: { goal?: string; doneWhen?: string; criteria?: string[] };
}

export interface ImportReview {
  items: ImportReviewItem[];
  /** Numbers new milestones get, by key: "M04". */
  milestones: Record<string, string>;
  skipped: { path: string; reason: string }[];
  notes: string[];
}

/** A document of "Документы" (Documents mockup). */
export interface DocEntry {
  kind: 'brief' | 'architecture' | 'adr' | 'spec' | 'doc';
  /** Relative to the project root: ".skaro/adr/0001-database.md". */
  path: string;
  /** ADR or specification title, or the file name of a free document. */
  title: string;
  /** Last change of the file on disk. */
  editedAt: number;
  adr?: DocRecord;
  /** A specification (architecture.md 3.7): numbered and with a status, like an ADR. */
  spec?: DocRecord;
}

/** Number, status, date and links of an ADR or a specification. */
export interface DocRecord {
  id: string;
  status: 'proposed' | 'accepted' | 'superseded';
  date?: string;
  replaces?: string;
  replacedBy?: string;
}

export interface MilestoneInput {
  title: string;
  goal: string;
  criteria: string;
}

/** "Назначить агента" on the task board. */
export interface TaskAssignment {
  agent: AgentId;
  model?: string;
  effort?: string;
}
