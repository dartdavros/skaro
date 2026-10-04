import type {
  AgentInfo,
  AgentSettings,
  Events,
  ProjectInfo,
  ProjectSettings,
  TabsState,
  TaskDetail,
  ChatSummary,
} from '../../../shared/ipc';
import type { TimelineState } from '@skaro/timeline';
import { demoChatTimeline } from '../demo-chat';
import { demoImportTimeline } from '../demo-import';
import { tasks } from './tasks';

// `?empty` starts with no projects (the empty "Проекты" screen).
export const empty = new URLSearchParams(location.search).has('empty');

export const projects: ProjectInfo[] = empty
  ? []
  : [
      { id: 'p1', name: 'Shop API', path: '/Users/dev/code/shop-api', missing: false },
      { id: 'p2', name: 'Blog Engine', path: '/Users/dev/code/blog-engine', missing: false },
      { id: 'p3', name: 'Skaro Landing', path: '/Users/dev/code/skaro-landing', missing: false },
    ];

export let tabs: TabsState = empty
  ? { projects: [] }
  : { projects: ['p1', 'p2', 'p3'], active: 'p1' };

export const settings = new Map<string, unknown>([['ui.locale', 'ru']]);

export let counter = projects.length;

export const agents: AgentInfo[] = [
  { id: 'claude-code', installed: true, version: '2.1.281', authenticated: true, sizeBytes: 230e6 },
  { id: 'codex', installed: false, sizeBytes: 90e6 },
];

export const projectSettings: ProjectSettings = {
  defaultAgent: 'claude-code',
  defaultModel: 'claude-opus-5',
  defaultEffort: 'medium',
  permissionMode: 'auto',
  baseBranch: 'main',
  branchTemplate: 'skaro/{id}-{slug}',
  isolation: 'worktree',
  mergeStrategy: 'squash',
  deleteBranch: true,
  autoAcceptDocs: false,
  agentFiles: true,
  agentInstructions: 'Код на TypeScript, тесты обязательны, коммиты на английском.',
};

export const taskSettings: AgentSettings = {
  agent: 'claude-code',
  model: 'claude-opus-5',
  effort: 'high',
  permissionMode: 'auto',
  planFirst: false,
  isolation: 'worktree',
};

export function detail(id: string): TaskDetail {
  const task = tasks.find((t) => t.id === id) ?? tasks[0]!;
  return {
    ...task,
    dependsOn: [{ id: 'T-004', title: 'Схема БД и миграции', status: 'done' }],
    blocks: [{ id: 'T-021', title: 'Список заказов', status: 'todo' }],
    branch: `skaro/${task.id}-admin-roles`,
    goal: 'Разграничить доступ в админке: роли «владелец», «менеджер» и «поддержка», проверка прав на уровне сервисного слоя, а не только UI.',
    criteria: [
      {
        text: `${task.spec ? 'R-1 ' : ''}Три роли: владелец, менеджер, поддержка — с матрицей прав из ADR-0006`,
        done: false,
      },
      {
        text: `${task.spec ? 'R-2 ' : ''}Проверка прав в сервисном слое, а не только в UI`,
        done: true,
      },
      {
        text: `${task.spec ? 'R-3 ' : ''}Попытка доступа без прав возвращает 403 и пишется в журнал`,
        done: false,
      },
      { text: 'Юнит-тесты на матрицу прав', done: false },
    ],
    notes: 'Роли уже заведены в схеме БД (T-004). Матрицу прав согласовали в ADR-0006.',
    ...(task.spec
      ? {
          requirements: [
            { id: 'R-1', text: 'Три роли с матрицей прав: владелец, менеджер, поддержка' },
            { id: 'R-2', text: 'Права проверяются на сервере, в сервисном слое' },
            { id: 'R-3', text: 'Доступ без прав — 403 и запись в журнал действий' },
          ],
        }
      : {}),
  };
}

// `?nochats` opens the "Чат" section without chats (the start screen).
export const noChats = new URLSearchParams(location.search).has('nochats');

export const chats: ChatSummary[] = noChats
  ? []
  : [
      ['c1', 'Платежи: этапы и задачи', false, true],
      ['imp1', 'Импорт документации', false, false],
      ['c2', 'Идемпотентность вебхуков', false, false],
      ['c3', 'Разбор ТЗ по админке', false, false],
      ['c4', 'Выбор очереди задач', false, false],
      ['c5', 'Первичный бриф проекта', true, false],
      ['c6', 'Сравнение ORM', true, false],
    ].map(([id, title, archived, live], i) => ({
      id: id as string,
      title: title as string,
      agent: 'claude-code',
      archived: archived as boolean,
      ...(id === 'imp1' ? { kind: 'import' as const } : {}),
      live: live as boolean,
      updatedAt: Date.now() - i * 3_600_000,
    }));

export const chatTimelines = new Map<string, TimelineState>();

/** Grows on every change so the screen takes the new snapshot. */
export const chatSeqs = new Map<string, number>();

export function chatTimeline(id: string): TimelineState {
  let timeline = chatTimelines.get(id);
  if (!timeline) {
    timeline = id === 'imp1' ? demoImportTimeline() : demoChatTimeline();
    chatTimelines.set(id, timeline);
  }
  return timeline;
}

export const listeners = new Map<string, Set<(payload: unknown) => void>>();

export function emit<E extends keyof Events>(event: E, payload: Events[E]): void {
  for (const listener of listeners.get(event) ?? []) listener(payload);
}

export function boardChanged(projectId: string, change: () => void): void {
  change();
  emit('project.changed', { projectId });
}

/** "Выбрать логотип…" in the browser mock: a fixed picture instead of a file dialog. */
export const MOCK_LOGO = `data:image/svg+xml;base64,${btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#2a52be"/><path d="M7 15l5-8 5 8z" fill="#fff"/></svg>',
)}`;

export function mockProject(id: string): ProjectInfo {
  const project = projects.find((p) => p.id === id);
  if (!project) throw new Error('unknown project');
  return project;
}

export function addMock(path: string): ProjectInfo {
  counter++;
  const project = { id: `p${counter}`, name: path.split('/').pop() ?? path, path, missing: false };
  projects.push(project);
  return project;
}
export function getTabs(): TabsState {
  return tabs;
}
export function setTabs(value: TabsState): void {
  tabs = value;
}
