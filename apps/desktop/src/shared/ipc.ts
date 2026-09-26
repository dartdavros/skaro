// Typed IPC between the renderer and the main process (architecture.md 10): the renderer has no
// Node access and can call only the methods listed here.

import type {
  AgentCommand,
  AgentModel,
  AgentUserConfig,
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

export interface TaskSummary extends TaskRef {
  milestone?: { id: string; title: string };
  archived: boolean;
  /** Assigned agent, else the agent of the last run; undefined — not assigned. */
  agent?: AgentId;
  model?: string;
  deps: string[];
  /** Dependencies not done yet (a blocked task waits for them). */
  waitsFor: string[];
  /** Last change: the task file or its latest run. */
  updatedAt: number;
  /** Position inside its milestone. */
  order?: number;
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

/** A document of "Документы" (Documents mockup). */
export interface DocEntry {
  kind: 'brief' | 'architecture' | 'adr' | 'doc';
  /** Relative to the project root: ".skaro/adr/0001-database.md". */
  path: string;
  /** ADR title or the file name of a free document. */
  title: string;
  /** Last change of the file on disk. */
  editedAt: number;
  adr?: {
    id: string;
    status: 'proposed' | 'accepted' | 'superseded';
    date?: string;
    replaces?: string;
    replacedBy?: string;
  };
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
}

/** A project chat in the list ("Чат" section). */
export interface ChatSummary {
  id: string;
  title: string;
  agent: AgentId;
  archived: boolean;
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
}

/** A project card on "Проекты" (Projects mockup): status, current milestone, running tasks. */
export interface ProjectCard {
  id: string;
  name: string;
  path: string;
  /** The folder is gone (moved or deleted). */
  missing: boolean;
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

/** A task on the project overview: waiting for the user or worked on now. */
export interface OverviewTask {
  id: string;
  title: string;
  milestone?: { id: string; title: string };
  status: 'review' | 'needs_answer' | 'in_progress';
  /** When the run started (working) or stopped (waiting for the user). */
  since: number;
  /** What the task changed so far in its worktree. */
  stats?: { files: number; added: number; removed: number };
  agent: AgentId;
  model?: string;
}

/** "Недавние события": what happened, with the titles it names. */
export interface ProjectEvent {
  kind: string;
  data: Record<string, unknown>;
  at: number;
  taskTitle?: string;
  milestoneTitle?: string;
}

/** "Обзор" (ProjectOverview mockup). */
export interface ProjectOverview {
  id: string;
  name: string;
  path: string;
  branch?: string;
  /** No uncommitted changes in the main working copy. */
  clean?: boolean;
  attention: OverviewTask[];
  running: OverviewTask[];
  /** Tasks waiting for a free slot. */
  queued: { id: string; title: string }[];
  /** "Старт проекта": what is there already. */
  start: {
    brief?: { updatedAt: number };
    architecture?: { adrs: number; rules: number };
    milestones: number;
    tasks: number;
    /** A milestone without tasks yet. */
    emptyMilestone?: { id: string; title: string };
    hidden: boolean;
  };
  milestones: { id: string; title: string; done: number; total: number }[];
  events: ProjectEvent[];
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

/** "О программе": the running version and a newer release, if any. */
export interface UpdateInfo {
  current: string;
  latest?: string;
  /** Release page. */
  url?: string;
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
  /** Project settings for all projects ("Настройки"); a project's own values win. */
  'app.projectDefaults': () => ProjectDefaults;
  'app.setProjectDefaults': (defaults: ProjectDefaults) => void;
  'app.version': () => string;
  /** Asks GitHub Releases for a newer Skaro (only on the user's click). */
  'app.checkUpdate': () => UpdateInfo;
  /** "Другой…": an application picked by the user; undefined if cancelled. */
  'app.pickApp': () => string | undefined;
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
  /** Cards of the "Проекты" screen. */
  'projects.overview': () => ProjectCard[];
  /** "Найти заново": the project folder moved to `path`. */
  'projects.relocate': (id: string, path: string) => ProjectInfo;
  'projects.openIn': (id: string, app: 'explorer' | 'terminal' | 'editor') => void;
  'project.overview': (projectId: string) => ProjectOverview;
  'project.settings': (projectId: string) => ProjectSettings;
  /** Saves at once; turning "agentFiles" on or off writes or removes the Skaro block. */
  'project.saveSettings': (projectId: string, settings: ProjectSettings) => void;
  'tabs.get': () => TabsState;
  'tabs.set': (state: TabsState) => void;
  'agents.list': () => AgentInfo[];
  'agents.refresh': () => AgentInfo[];
  'agents.install': (agent: AgentId) => void;
  'agents.login': (agent: AgentId) => void;
  /** `projectId` '' lists models outside a project (Settings). */
  'agents.models': (agent: AgentId, projectId: string) => AgentModel[];
  'agents.commands': (agent: AgentId, projectId: string) => AgentCommand[];
  /** "Ваши настройки агента": folder, MCP servers with their state, skills, hooks. */
  'agents.config': (agent: AgentId) => AgentUserConfig;
  'agents.openConfigDir': (agent: AgentId) => void;
  'tasks.list': (projectId: string) => TaskSummary[];
  'tasks.slots': () => RunSlots;
  /** Mass launch: blocked tasks are skipped, the rest start or wait for a slot. No agent — each task's own. */
  'tasks.run': (
    projectId: string,
    taskIds: string[],
    /** The first message of each task ("Начни работу по описанию задачи."). */
    message: string,
    assignment?: TaskAssignment,
  ) => void;
  'tasks.archive': (projectId: string, taskIds: string[], archived: boolean) => void;
  /** Deletes the tasks with their branches and worktrees. */
  'tasks.delete': (projectId: string, taskIds: string[]) => void;
  'tasks.move': (projectId: string, taskIds: string[], milestoneId: string) => void;
  'tasks.unblock': (projectId: string, taskIds: string[]) => void;
  'tasks.assign': (projectId: string, taskIds: string[], assignment: TaskAssignment) => void;
  /** Milestones in plan order. */
  'plan.milestones': (projectId: string) => MilestoneInfo[];
  'plan.create': (projectId: string, input: MilestoneInput) => MilestoneInfo;
  'plan.update': (projectId: string, milestoneId: string, input: MilestoneInput) => void;
  /** Deletes a milestone; its tasks go to the previous one (the next one for the first). */
  'plan.delete': (projectId: string, milestoneId: string) => void;
  /** New order of milestones (drag on "План"). */
  'plan.reorder': (projectId: string, milestoneIds: string[]) => void;
  /** Drag of a task: to `milestoneId` at `index` among its tasks. */
  'plan.placeTask': (projectId: string, taskId: string, milestoneId: string, index: number) => void;
  /** Brief and architecture (when they exist), ADRs, free documents. */
  'docs.list': (projectId: string) => DocEntry[];
  /** Text of a document without its frontmatter. */
  'docs.read': (projectId: string, path: string) => string;
  /** Writes the text; brief.md and architecture.md are created when missing. */
  'docs.write': (projectId: string, path: string, text: string) => void;
  /** "Новый документ": .skaro/docs/<name>.md, empty. */
  'docs.create': (projectId: string, name: string) => DocEntry;
  'docs.setAdrStatus': (
    projectId: string,
    adrId: string,
    status: 'proposed' | 'accepted' | 'superseded',
  ) => void;
  /** "Показать в папке". */
  'docs.reveal': (projectId: string, path: string) => void;
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
  /** Project chats, active and archived, most recent first. */
  'chats.list': (projectId: string) => ChatSummary[];
  /** Agent, model and effort a new chat starts with. */
  'chats.defaults': (projectId: string) => ChatSettings;
  'chat.open': (projectId: string, chatId: string) => ChatView;
  /** Starts a chat with its first message. */
  'chat.create': (projectId: string, settings: ChatSettings, input: MessageInput) => ChatSummary;
  'chat.send': (projectId: string, chatId: string, input: MessageInput) => void;
  'chat.respond': (
    projectId: string,
    chatId: string,
    interactionId: string,
    answer: InteractionAnswer,
  ) => void;
  'chat.interrupt': (projectId: string, chatId: string) => void;
  'chat.rewind': (projectId: string, chatId: string, itemId: string, resend?: MessageInput) => void;
  'chat.setSettings': (projectId: string, chatId: string, settings: ChatSettings) => void;
  'chat.archive': (projectId: string, chatId: string, archived: boolean) => void;
  'chat.proposal': (
    projectId: string,
    chatId: string,
    itemId: string,
    action: ProposalAction,
  ) => void;
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
  /** Live timeline events of a chat, in batches. */
  'chat.events': { projectId: string; chatId: string; seq: number; events: TimelineEvent[] };
  /** The chat list or a chat's state outside the timeline changed. */
  'chats.changed': { projectId: string; chatId?: string };
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
  'app.projectDefaults',
  'app.setProjectDefaults',
  'app.version',
  'app.checkUpdate',
  'app.pickApp',
  'projects.list',
  'projects.pickFolder',
  'projects.inspect',
  'projects.defaultParent',
  'projects.add',
  'projects.create',
  'projects.remove',
  'projects.overview',
  'projects.relocate',
  'projects.openIn',
  'project.overview',
  'project.settings',
  'project.saveSettings',
  'tabs.get',
  'tabs.set',
  'agents.list',
  'agents.refresh',
  'agents.install',
  'agents.login',
  'agents.models',
  'agents.commands',
  'agents.config',
  'agents.openConfigDir',
  'tasks.list',
  'tasks.slots',
  'tasks.run',
  'tasks.archive',
  'tasks.delete',
  'tasks.move',
  'tasks.unblock',
  'tasks.assign',
  'plan.milestones',
  'plan.create',
  'plan.update',
  'plan.delete',
  'plan.reorder',
  'plan.placeTask',
  'docs.list',
  'docs.read',
  'docs.write',
  'docs.create',
  'docs.setAdrStatus',
  'docs.reveal',
  'task.open',
  'task.send',
  'task.respond',
  'task.interrupt',
  'task.rewind',
  'task.stopBackground',
  'task.setSettings',
  'task.merge',
  'task.toggleCriterion',
  'chats.list',
  'chats.defaults',
  'chat.open',
  'chat.create',
  'chat.send',
  'chat.respond',
  'chat.interrupt',
  'chat.rewind',
  'chat.setSettings',
  'chat.archive',
  'chat.proposal',
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
  'chat.events',
  'chats.changed',
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
