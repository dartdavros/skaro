// Typed IPC between the renderer and the main process (architecture.md 10): the renderer has no
// Node access and can call only the methods listed here.

import type {
  AgentCommand,
  AgentModel,
  AgentUserConfig,
  InteractionAnswer,
  TimelineEvent,
} from '@skaro/timeline';

import type {
  Locale,
  AgentId,
  AgentInfo,
  AgentSettings,
  TaskSummary,
  MilestoneInfo,
  StageInfo,
  ImportSource,
  ImportReview,
  DocEntry,
  TaskAssignment,
} from './ipc-entities';
import type {
  RunSlots,
  TaskView,
  MessageInput,
  MergeAction,
  ChatSettings,
  ChatSummary,
  ChatView,
  ProposalAction,
  PathSuggestion,
  FileDiff,
  PickedFile,
  ProjectInfo,
  ProjectCard,
  ProjectSettings,
  ProjectDefaults,
  FolderInfo,
  TabsState,
} from './ipc-sessions';
import type { UpdateState } from './updates';
import type { Diagnostics } from './diagnostics';
export * from './ipc-entities';
export * from './ipc-sessions';
export type { UpdateState } from './updates';

/** Methods the renderer may call: name → signature. */
export interface Methods {
  'task.revertMerge': (projectId: string, taskId: string, commit: string) => void;
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
  'diagnostics.export': () => Diagnostics;
  'app.checkUpdate': () => UpdateState;
  'updates.state': () => UpdateState;
  'updates.download': () => UpdateState;
  'updates.apply': () => UpdateState;
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
  /** The name shown in Skaro; the folder keeps its name. */
  'project.rename': (projectId: string, name: string) => ProjectInfo;
  /** SVG, PNG or JPG picker; undefined if cancelled. Throws "too large" over LOGO_MAX_BYTES. */
  'project.pickLogo': (projectId: string) => ProjectInfo | undefined;
  'project.removeLogo': (projectId: string) => ProjectInfo;
  'project.settings': (projectId: string) => ProjectSettings;
  /** Saves at once; turning "agentFiles" on or off writes or removes the Skaro block. */
  'project.saveSettings': (projectId: string, settings: ProjectSettings) => void;
  /** The project has code of its own, not only Skaro files (D-32: what the start screens offer). */
  'project.hasCode': (projectId: string) => boolean;
  /** "Импорт документации": what is in the picked folders, files and archives. */
  'import.scan': (paths: string[]) => ImportSource[];
  /** Copies the sources and starts the import chat; returns the chat. */
  'import.start': (projectId: string, paths: string[], settings: ChatSettings) => ChatSummary;
  /** What the import agent staged, for the review screen. */
  'import.review': (projectId: string, chatId: string) => ImportReview;
  /** "Открыть исходный файл" of an import source. */
  'import.openSource': (projectId: string, chatId: string, source: string) => void;
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
  /** Board: "В работе" → "Не начата" — the agent stops, the task waits for a new start. */
  'tasks.cancel': (projectId: string, taskId: string) => void;
  /** Board: "На ревью" → "Готово" — merges by the open card; `open` when it needs the feed. */
  'tasks.merge': (projectId: string, taskId: string) => 'merged' | 'open';
  'tasks.assign': (projectId: string, taskIds: string[], assignment: TaskAssignment) => void;
  /** The stages of the project, in plan order. */
  'stages.list': (projectId: string) => StageInfo[];
  /** «Запустить» / «Продолжить»: the tasks of the stage go one after another. */
  'stages.run': (projectId: string, stageId: string, message: string) => void;
  /** «Остановить»: the working agent stops, the waiting tasks leave the queue. */
  'stages.stop': (projectId: string, stageId: string) => void;
  /** «Влить готовое»: a merge card for the finished tasks in the feed of the stage. */
  'stages.mergeFinished': (projectId: string, stageId: string) => void;
  /** Milestones in plan order. */
  'plan.milestones': (projectId: string) => MilestoneInfo[];
  /** Deletes a milestone without started tasks, together with its tasks. */
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
  /** "Новая спецификация": .skaro/specs/<n>-<slug>.md with the empty sections, proposed. */
  'docs.createSpec': (projectId: string, title: string) => DocEntry;
  'docs.setAdrStatus': (
    projectId: string,
    adrId: string,
    status: 'proposed' | 'accepted' | 'superseded',
  ) => void;
  'docs.setSpecStatus': (
    projectId: string,
    specId: string,
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
  /** Current uncommitted changes of a file in the task's (or the project's) working folder. */
  'files.diff': (projectId: string, taskId: string, path: string) => FileDiff;
  'files.pick': (kind: 'images' | 'files' | 'folder') => PickedFile[];
  'shell.openExternal': (url: string) => void;
}

/** Events from the main process: name → payload. */
export interface Events {
  'updates.changed': UpdateState;
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
  /** "Импорт · 6 из 19": an import being written (ImportReview mockup). */
  'import.progress': { projectId: string; chatId: string; done: number; total: number };
}

export type MethodName = keyof Methods;
export type EventName = keyof Events;

export { METHODS, EVENTS } from './ipc-channels';

export const INVOKE_CHANNEL = 'skaro:invoke';
export const EVENT_CHANNEL = 'skaro:event';

/** What the renderer sees as `window.skaro`. */
export interface SkaroApi {
  readonly platform: string;
  /** Path on disk of a file or a folder dropped into the window. */
  pathOf(file: File): string;
  invoke<M extends MethodName>(
    method: M,
    ...args: Parameters<Methods[M]>
  ): Promise<ReturnType<Methods[M]>>;
  on<E extends EventName>(event: E, listener: (payload: Events[E]) => void): () => void;
}
