import type { PermissionMode, TimelineState } from '@skaro/timeline';
import type { AgentId, AgentSettings, TaskRef, TaskSummary } from './ipc-entities';

/** Parallel run slots (architecture.md 7.1). */
export interface RunSlots {
  total: number;
  free: number;
}

export interface TaskDetail extends TaskSummary {
  dependsOn: TaskRef[];
  /** Tasks that wait for this one. */
  blocks: TaskRef[];
  branch?: string;
  goal?: string;
  criteria: { text: string; done: boolean }[];
  notes?: string;
  /** "Итог", filled by Skaro after the merge. */
  summary?: string;
  /** Requirements R-n of the task's specification, for criteria that name them. */
  requirements?: { id: string; text: string }[];
}

export interface RunInfo {
  id: string;
  agent: AgentId;
  startedAt: number;
  worktree?: string;
  branch?: string;
  /** An agent process is attached now. */
  live: boolean;
}

/** Everything the task screen needs to open. */
export interface TaskView {
  projectId: string;
  task: TaskDetail;
  settings: AgentSettings;
  run?: RunInfo;
  timeline?: TimelineState;
  /** Number of events in the timeline; live batches continue from here. */
  seq: number;
  /** Waiting for a free slot (architecture.md 7.1). */
  queued: boolean;
  /** A new run would start now rather than wait in the queue. */
  slotsFree: boolean;
  /** Command status line under the composer: sandbox note (D-28). */
  sandboxHolds?: boolean;
}

export interface MessageInput {
  text: string;
  /** Absolute paths of attached images. */
  images?: string[];
}

export type MergeAction =
  | { action: 'confirm'; message: string }
  | { action: 'cancel' }
  | { action: 'update_branch' }
  | { action: 'resolve_with_agent' };

/** How the agent of a chat works: the agent is fixed once the chat starts (D-24). */
export interface ChatSettings {
  agent: AgentId;
  model?: string;
  effort?: string;
  /** "Спрашивать" by default; "Полный доступ" runs everything without asking (owner, 2026-09-29). */
  permissionMode?: ChatPermissionMode;
}

/** A chat works in the project's main working copy: no "auto within the task" there. */
export type ChatPermissionMode = Extract<PermissionMode, 'ask' | 'full'>;

/** A project chat in the list ("Чат" section). */
export interface ChatSummary {
  id: string;
  title: string;
  agent: AgentId;
  archived: boolean;
  /** "Импорт документации" (architecture.md 12): the chat stages the import. */
  kind?: 'import';
  /** The agent is answering now. */
  live: boolean;
  updatedAt: number;
}

/** Everything the chat screen needs to open a chat. */
export interface ChatView {
  projectId: string;
  chat: ChatSummary;
  settings: ChatSettings;
  timeline: TimelineState;
  /** Number of events in the timeline; live batches continue from here. */
  seq: number;
}

/** The user's decision on a proposal card (agent-output.md 5.4). */
export type ProposalAction =
  | {
      action: 'apply';
      /** Plan: refs of the tasks to create. */
      tasks?: string[];
      /** ADR: the text after "Изменить". */
      adr?: { title: string; body: string };
      /** Import: keys of the staged artifacts to write. */
      import?: string[];
    }
  | { action: 'reject' }
  /** An applied document goes back to its previous text. */
  | { action: 'revert' };

export interface PathSuggestion {
  path: string;
  kind: 'file' | 'folder';
}

export interface PickedFile {
  path: string;
  kind: 'image' | 'file' | 'folder';
}

export interface ProjectInfo {
  id: string;
  name: string;
  path: string;
  /** The folder is gone (moved or deleted). */
  missing: boolean;
  /** The logo picked in "Параметры проекта", a data: URL; without it — initials. */
  logo?: string;
}

/** A project card on "Проекты" (Projects mockup): status, current milestone, running tasks. */
export interface ProjectCard {
  id: string;
  name: string;
  path: string;
  /** The folder is gone (moved or deleted). */
  missing: boolean;
  logo?: string;
  branch?: string;
  /** The first milestone not done yet (or the last one when all are done). */
  milestone?: { id: string; title: string; done: number; total: number };
  counts: { working: number; needs: number; review: number; failed: number; blocked: number };
  /** Tasks an agent works on now. */
  running: { id: string; title: string; agent: AgentId; model?: string }[];
  /** Default agent of the project. */
  agent: AgentId;
  model?: string;
  /** Last activity: runs, chats, opening the project. */
  activeAt: number;
}

/** "Параметры проекта" (ProjectSettings mockup): the project's .skaro/config.yaml. */
export interface ProjectSettings {
  defaultAgent: AgentId;
  defaultModel?: string;
  defaultEffort?: string;
  permissionMode: PermissionMode;
  baseBranch: string;
  branchTemplate: string;
  isolation: 'worktree' | 'in-place';
  mergeStrategy: 'squash' | 'merge' | 'rebase';
  deleteBranch: boolean;
  autoAcceptDocs: boolean;
  agentFiles: boolean;
  agentInstructions: string;
}

/**
 * App-wide defaults of project settings ("Настройки"): a project uses them for what it does not
 * set itself. App setting `defaults.project`; instructions are added to the project's own.
 */
export interface ProjectDefaults {
  baseBranch: string;
  branchTemplate: string;
  isolation: 'worktree' | 'in-place';
  mergeStrategy: 'squash' | 'merge' | 'rebase';
  deleteBranch: boolean;
  autoAcceptDocs: boolean;
  agentFiles: boolean;
  agentInstructions: string;
}

/** A logo is a small picture: larger files are refused ("Параметры проекта"). */
export const LOGO_MAX_BYTES = 1024 * 1024;

export const PROJECT_DEFAULTS_KEY = 'defaults.project';

/** Built-in values while nothing is set in "Настройки". */
export const BUILT_IN_DEFAULTS: ProjectDefaults = {
  baseBranch: 'main',
  branchTemplate: 'skaro/{id}-{slug}',
  isolation: 'worktree',
  mergeStrategy: 'squash',
  deleteBranch: true,
  autoAcceptDocs: true,
  agentFiles: false,
  agentInstructions: '',
};

/** A folder picked in the "Новый проект" modal. */
export interface FolderInfo {
  path: string;
  name: string;
  exists: boolean;
  git: boolean;
  branch?: string;
}

/** An app to open projects in ("Настройки" → "Проекты"), settings "apps.editor" and "apps.terminal". */
export type ExternalApp =
  | { kind: 'vscode' | 'cursor' | 'jetbrains' | 'system' | 'iterm2' | 'warp' }
  | { kind: 'custom'; path: string };

export interface TabsState {
  /** Open project tabs in order. */
  projects: string[];
  /** Active project, or undefined for the home screen. */
  active?: string;
}
