// In-memory bridge for running the renderer in a plain browser (UI review against the mockups).
// Never used in the app: the preload always provides window.skaro.

import type {
  AgentInfo,
  AgentSettings,
  Events,
  Methods,
  ProjectInfo,
  SkaroApi,
  TabsState,
  TaskDetail,
  TaskSummary,
} from '../../shared/ipc';
import { demoTimeline } from './demo-timeline';

const projects: ProjectInfo[] = [
  { id: 'p1', name: 'Shop API', path: '/Users/dev/code/shop-api', missing: false },
  { id: 'p2', name: 'Blog Engine', path: '/Users/dev/code/blog-engine', missing: false },
  { id: 'p3', name: 'Skaro Landing', path: '/Users/dev/code/skaro-landing', missing: false },
];
let tabs: TabsState = { projects: ['p1', 'p2', 'p3'], active: 'p1' };
const settings = new Map<string, unknown>([['ui.locale', 'ru']]);
let counter = projects.length;

const agents: AgentInfo[] = [
  { id: 'claude-code', installed: true, version: '0.3.281', authenticated: true, sizeBytes: 230e6 },
  { id: 'codex', installed: false, sizeBytes: 90e6 },
];

const tasks: TaskSummary[] = [
  {
    id: 'T-020',
    title: 'Роли и доступы админки',
    status: 'in_progress',
    milestone: { id: 'M03', title: 'Админка' },
    archived: false,
  },
  {
    id: 'T-021',
    title: 'Список заказов',
    status: 'review',
    milestone: { id: 'M03', title: 'Админка' },
    archived: false,
  },
  {
    id: 'T-022',
    title: 'Экспорт отчётов',
    status: 'todo',
    milestone: { id: 'M03', title: 'Админка' },
    archived: false,
  },
];

const taskSettings: AgentSettings = {
  agent: 'claude-code',
  model: 'claude-opus-5',
  effort: 'high',
  permissionMode: 'auto',
  planFirst: false,
  isolation: 'worktree',
};

function detail(id: string): TaskDetail {
  const task = tasks.find((t) => t.id === id) ?? tasks[0]!;
  return {
    ...task,
    dependsOn: [{ id: 'T-004', title: 'Схема БД и миграции', status: 'done' }],
    blocks: [{ id: 'T-021', title: 'Список заказов', status: 'todo' }],
    branch: `skaro/${task.id}-admin-roles`,
    goal: 'Разграничить доступ в админке: роли «владелец», «менеджер» и «поддержка», проверка прав на уровне сервисного слоя, а не только UI.',
    criteria: [
      {
        text: 'Три роли: владелец, менеджер, поддержка — с матрицей прав из ADR-0006',
        done: false,
      },
      { text: 'Проверка прав в сервисном слое, а не только в UI', done: true },
      { text: 'Попытка доступа без прав возвращает 403 и пишется в журнал', done: false },
      { text: 'Юнит-тесты на матрицу прав', done: false },
    ],
    notes: 'Роли уже заведены в схеме БД (T-004). Матрицу прав согласовали в ADR-0006.',
  };
}

function addMock(path: string): ProjectInfo {
  counter++;
  const project = { id: `p${counter}`, name: path.split('/').pop() ?? path, path, missing: false };
  projects.push(project);
  return project;
}

const handlers: {
  [M in keyof Methods]: (...args: Parameters<Methods[M]>) => ReturnType<Methods[M]>;
} = {
  'window.minimize': () => undefined,
  'window.toggleMaximize': () => undefined,
  'window.close': () => undefined,
  'window.isMaximized': () => false,
  'app.getLocale': () => (settings.get('ui.locale') as 'ru' | 'en' | undefined) ?? 'ru',
  'app.setLocale': (locale) => void settings.set('ui.locale', locale),
  'app.getSetting': (key) => settings.get(key) ?? null,
  'app.setSetting': (key, value) => void settings.set(key, value),
  'projects.list': () => projects,
  'projects.pickFolder': () => '/Users/dev/code/shop-api',
  'projects.inspect': (path) => ({
    path,
    name: path.split('/').pop() ?? path,
    exists: true,
    git: true,
    branch: 'main',
  }),
  'projects.defaultParent': () => '/Users/dev/code',
  'projects.add': (path) => addMock(path),
  'projects.create': (parent, name) => addMock(`${parent}/${name}`),
  'projects.remove': (id) =>
    void projects.splice(
      projects.findIndex((p) => p.id === id),
      1,
    ),
  'tabs.get': () => tabs,
  'tabs.set': (state) => void (tabs = state),
  'agents.list': () => agents,
  'agents.refresh': () => agents,
  'agents.install': () => undefined,
  'agents.login': () => undefined,
  'agents.models': () => [
    {
      id: 'claude-fable-5-1',
      name: 'Fable 5.1',
      description: 'Максимальная глубина — медленнее и дороже',
      isDefault: false,
      efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'xhigh' }, { id: 'max' }],
      images: true,
    },
    {
      id: 'claude-opus-5',
      name: 'Opus 5',
      description: 'Для агентной разработки',
      isDefault: true,
      efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
      defaultEffort: 'high',
      images: true,
    },
    {
      id: 'claude-sonnet-5',
      name: 'Sonnet 5',
      description: 'Баланс скорости и качества',
      isDefault: false,
      efforts: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }],
      images: true,
    },
    {
      id: 'claude-haiku-4-5',
      name: 'Haiku 4.5',
      description: 'Быстрая и дешёвая, для простых правок',
      isDefault: false,
      efforts: [],
      images: false,
    },
  ],
  'agents.commands': () => [
    { name: 'compact', description: 'Сжать историю разговора', kind: 'command' },
    { name: 'review', description: 'Ревью текущих изменений', kind: 'command' },
    { name: 'init', description: 'Описать проект в CLAUDE.md', kind: 'command' },
    { name: 'security-review', description: 'Проверить изменения на уязвимости', kind: 'command' },
    { name: 'test-runner', description: 'Навык · запуск и разбор тестов', kind: 'skill' },
  ],
  'tasks.list': () => tasks,
  'task.open': (projectId, taskId) => ({
    projectId,
    task: detail(taskId),
    settings: taskSettings,
    ...(taskId === 'T-022'
      ? {}
      : {
          run: {
            id: 'r1',
            agent: 'claude-code',
            startedAt: Date.now() - 300_000,
            worktree: 'C:/work/shop-api',
            branch: 'skaro/T-020-admin-roles',
            live: true,
          },
          timeline: demoTimeline(taskId === 'T-021' ? 'finished' : 'working'),
        }),
    seq: 0,
    queued: false,
    slotsFree: true,
    sandboxHolds: false,
  }),
  'task.send': () => undefined,
  'task.respond': () => undefined,
  'task.interrupt': () => undefined,
  'task.rewind': () => undefined,
  'task.stopBackground': () => undefined,
  'task.setSettings': (_p, _t, next) => void Object.assign(taskSettings, next),
  'task.merge': () => undefined,
  'task.toggleCriterion': () => undefined,
  'files.suggest': (_p, _t, query) =>
    [
      'src/auth/',
      'src/auth/policy.ts',
      'src/auth/roles.ts',
      'src/auth/middleware.ts',
      'src/auth/policy.test.ts',
      'src/admin/role-guard.ts',
    ]
      .filter((p) => p.includes(query))
      .map((path) => ({ path, kind: path.endsWith('/') ? 'folder' : 'file' })),
  'files.exist': (_p, _t, paths) =>
    paths.filter((p) => p.startsWith('src/') || p.startsWith('docs/')),
  'files.open': () => undefined,
  'files.pick': () => [],
  'shell.openExternal': () => undefined,
};

const bridge: SkaroApi = {
  platform: 'win32',
  invoke: (method, ...args) =>
    Promise.resolve((handlers[method] as (...a: unknown[]) => unknown)(...args) as never),
  on:
    <E extends keyof Events>(_event: E, _listener: (payload: Events[E]) => void) =>
    () =>
      undefined,
};

Object.defineProperty(window, 'skaro', { value: bridge });
