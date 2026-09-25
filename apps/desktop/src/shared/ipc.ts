// Typed IPC between the renderer and the main process (architecture.md 10): the renderer has no
// Node access and can call only the methods listed here.

import type {
  AgentCommand,
  AgentModel,
  InteractionAnswer,
  PermissionMode,
  TimelineEvent,
  TimelineState,
} from '@skaro/timeline';

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

export interface TaskSummary extends TaskRef {
  milestone?: { id: string; title: string };
  archived: boolean;
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
}

/** A folder picked in the "Новый проект" modal. */
export interface FolderInfo {
  path: string;
  name: string;
  exists: boolean;
  git: boolean;
  branch?: string;
}

export interface TabsState {
  /** Open project tabs in order. */
  projects: string[];
  /** Active project, or undefined for the home screen. */
  active?: string;
}

/** Methods the renderer may call: name → signature. */
export interface Methods {
  'window.minimize': () => void;
  'window.toggleMaximize': () => void;
  'window.close': () => void;
  'window.isMaximized': () => boolean;
  'app.getLocale': () => Locale;
  'app.setLocale': (locale: Locale) => void;
  'app.getSetting': (key: string) => unknown;
  'app.setSetting': (key: string, value: unknown) => void;
  'projects.list': () => ProjectInfo[];
  /** Folder picker; undefined if cancelled. */
  'projects.pickFolder': (defaultPath?: string) => string | undefined;
  'projects.inspect': (path: string) => FolderInfo;
  /** Where new project folders go by default (the last used place). */
  'projects.defaultParent': () => string;
  /** Connects an existing folder. */
  'projects.add': (path: string) => ProjectInfo;
  /** Creates <parent>/<name> as an empty git repository and connects it. */
  'projects.create': (parent: string, name: string) => ProjectInfo;
  'projects.remove': (id: string) => void;
  'tabs.get': () => TabsState;
  'tabs.set': (state: TabsState) => void;
  'agents.list': () => AgentInfo[];
  'agents.refresh': () => AgentInfo[];
  'agents.install': (agent: AgentId) => void;
  'agents.login': (agent: AgentId) => void;
  'agents.models': (agent: AgentId, projectId: string) => AgentModel[];
  'agents.commands': (agent: AgentId, projectId: string) => AgentCommand[];
  'tasks.list': (projectId: string) => TaskSummary[];
  'task.open': (projectId: string, taskId: string) => TaskView;
  'task.send': (projectId: string, taskId: string, input: MessageInput) => void;
  'task.respond': (
    projectId: string,
    taskId: string,
    interactionId: string,
    answer: InteractionAnswer,
  ) => void;
  'task.interrupt': (projectId: string, taskId: string) => void;
  /** Back to before a user message; with `resend`, sends it again (edit or retry). */
  'task.rewind': (projectId: string, taskId: string, itemId: string, resend?: MessageInput) => void;
  'task.stopBackground': (projectId: string, taskId: string, backgroundId: string) => void;
  'task.setSettings': (projectId: string, taskId: string, settings: AgentSettings) => void;
  'task.merge': (
    projectId: string,
    taskId: string,
    interactionId: string,
    action: MergeAction,
  ) => void;
  'task.toggleCriterion': (projectId: string, taskId: string, index: number) => void;
  /** Files and folders for the "@" menu. */
  'files.suggest': (projectId: string, taskId: string, query: string) => PathSuggestion[];
  /** Which of the paths exist in the task's working folder (links in agent text). */
  'files.exist': (projectId: string, taskId: string, paths: string[]) => string[];
  'files.open': (projectId: string, taskId: string, path: string) => void;
  'files.pick': (kind: 'images' | 'files' | 'folder') => PickedFile[];
  'shell.openExternal': (url: string) => void;
}

/** Events from the main process: name → payload. */
export interface Events {
  'window.maximized': boolean;
  'agents.changed': AgentInfo[];
  /** Artifacts of a project changed (task list and task details). */
  'project.changed': { projectId: string };
  /** Live timeline events of a task run, in batches. */
  'task.events': {
    projectId: string;
    taskId: string;
    runId: string;
    /** Index of the first event in the run's timeline. */
    seq: number;
    events: TimelineEvent[];
  };
  /** Task state outside the timeline changed (status, run, queue): reopen the view. */
  'task.changed': { projectId: string; taskId: string };
}

export type MethodName = keyof Methods;
export type EventName = keyof Events;

/** The whitelist the preload exposes; must list every key of `Methods`. */
export const METHODS = [
  'window.minimize',
  'window.toggleMaximize',
  'window.close',
  'window.isMaximized',
  'app.getLocale',
  'app.setLocale',
  'app.getSetting',
  'app.setSetting',
  'projects.list',
  'projects.pickFolder',
  'projects.inspect',
  'projects.defaultParent',
  'projects.add',
  'projects.create',
  'projects.remove',
  'tabs.get',
  'tabs.set',
  'agents.list',
  'agents.refresh',
  'agents.install',
  'agents.login',
  'agents.models',
  'agents.commands',
  'tasks.list',
  'task.open',
  'task.send',
  'task.respond',
  'task.interrupt',
  'task.rewind',
  'task.stopBackground',
  'task.setSettings',
  'task.merge',
  'task.toggleCriterion',
  'files.suggest',
  'files.exist',
  'files.open',
  'files.pick',
  'shell.openExternal',
] as const satisfies readonly MethodName[];

export const EVENTS = [
  'window.maximized',
  'agents.changed',
  'project.changed',
  'task.events',
  'task.changed',
] as const satisfies readonly EventName[];

// Compile-time check that METHODS covers every method.
type Missing = Exclude<MethodName, (typeof METHODS)[number]>;
const _complete: Missing extends never ? true : Missing = true;
void _complete;

export const INVOKE_CHANNEL = 'skaro:invoke';
export const EVENT_CHANNEL = 'skaro:event';

/** What the renderer sees as `window.skaro`. */
export interface SkaroApi {
  readonly platform: string;
  invoke<M extends MethodName>(
    method: M,
    ...args: Parameters<Methods[M]>
  ): Promise<ReturnType<Methods[M]>>;
  on<E extends EventName>(event: E, listener: (payload: Events[E]) => void): () => void;
}
