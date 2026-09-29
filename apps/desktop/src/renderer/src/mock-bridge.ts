// In-memory bridge for running the renderer in a plain browser (UI review against the mockups).
// Never used in the app: the preload always provides window.skaro.

import { BUILT_IN_DEFAULTS } from '../../shared/ipc';
import type {
  AgentInfo,
  AgentSettings,
  Events,
  Methods,
  ProjectInfo,
  ProjectSettings,
  SkaroApi,
  TabsState,
  TaskDetail,
  ChatSummary,
  ProjectCard,
} from '../../shared/ipc';
import type { TimelineState } from '@skaro/timeline';
import { demoChatTimeline } from './demo-chat';
import { demoImportTimeline, importReview, importSource } from './demo-import';
import { demoTimeline } from './demo-timeline';
import { docs } from './mock/docs';
import { board, milestones, plan, tasks } from './mock/tasks';

// `?empty` starts with no projects (the empty "Проекты" screen).
const empty = new URLSearchParams(location.search).has('empty');
const projects: ProjectInfo[] = empty
  ? []
  : [
      { id: 'p1', name: 'Shop API', path: '/Users/dev/code/shop-api', missing: false },
      { id: 'p2', name: 'Blog Engine', path: '/Users/dev/code/blog-engine', missing: false },
      { id: 'p3', name: 'Skaro Landing', path: '/Users/dev/code/skaro-landing', missing: false },
    ];
let tabs: TabsState = empty ? { projects: [] } : { projects: ['p1', 'p2', 'p3'], active: 'p1' };
const settings = new Map<string, unknown>([['ui.locale', 'ru']]);
let counter = projects.length;

const agents: AgentInfo[] = [
  { id: 'claude-code', installed: true, version: '2.1.281', authenticated: true, sizeBytes: 230e6 },
  { id: 'codex', installed: false, sizeBytes: 90e6 },
];

const projectSettings: ProjectSettings = {
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
const noChats = new URLSearchParams(location.search).has('nochats');
const chats: ChatSummary[] = noChats
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
const chatTimelines = new Map<string, TimelineState>();
/** Grows on every change so the screen takes the new snapshot. */
const chatSeqs = new Map<string, number>();

function chatTimeline(id: string): TimelineState {
  let timeline = chatTimelines.get(id);
  if (!timeline) {
    timeline = id === 'imp1' ? demoImportTimeline() : demoChatTimeline();
    chatTimelines.set(id, timeline);
  }
  return timeline;
}

const listeners = new Map<string, Set<(payload: unknown) => void>>();

function emit<E extends keyof Events>(event: E, payload: Events[E]): void {
  for (const listener of listeners.get(event) ?? []) listener(payload);
}

function boardChanged(projectId: string, change: () => void): void {
  change();
  emit('project.changed', { projectId });
}

/** "Выбрать логотип…" in the browser mock: a fixed picture instead of a file dialog. */
const MOCK_LOGO = `data:image/svg+xml;base64,${btoa(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="6" fill="#2a52be"/><path d="M7 15l5-8 5 8z" fill="#fff"/></svg>',
)}`;

function mockProject(id: string): ProjectInfo {
  const project = projects.find((p) => p.id === id);
  if (!project) throw new Error('unknown project');
  return project;
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
  'app.projectDefaults': () => ({
    ...BUILT_IN_DEFAULTS,
    ...(settings.get('defaults.project') as object),
  }),
  'app.setProjectDefaults': (value) => void settings.set('defaults.project', value),
  'app.version': () => '2.0.3',
  'app.checkUpdate': () => ({ current: '2.0.3' }),
  'app.pickApp': () => undefined,
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
  'projects.overview': () => {
    const now = Date.now();
    const zero = { working: 0, needs: 0, review: 0, failed: 0, blocked: 0 };
    const cards: ProjectCard[] = [
      {
        id: 'p1',
        name: 'Shop API',
        path: '/Users/dev/code/shop-api',
        missing: false,
        branch: 'main',
        milestone: { id: 'M02', title: 'Платежи', done: 3, total: 8 },
        counts: { ...zero, working: 2, needs: 1, blocked: 2 },
        running: [
          {
            id: 'T-014',
            title: 'Интеграция с эквайрингом',
            agent: 'claude-code',
            model: 'claude-opus-5',
          },
          { id: 'T-017', title: 'Идемпотентность платежей', agent: 'codex', model: 'gpt-6-astra' },
        ],
        agent: 'claude-code',
        activeAt: now - 4 * 60_000,
      },
      {
        id: 'p2',
        name: 'Blog Engine',
        path: '/Users/dev/code/blog-engine',
        missing: false,
        branch: 'main',
        milestone: { id: 'M04', title: 'Редактор постов', done: 5, total: 9 },
        counts: { ...zero, review: 2, blocked: 1 },
        running: [],
        agent: 'codex',
        activeAt: now - 26 * 60_000,
      },
      {
        id: 'p3',
        name: 'Skaro Landing',
        path: '/Users/dev/code/skaro-landing',
        missing: false,
        branch: 'main',
        milestone: { id: 'M03', title: 'Документация', done: 6, total: 6 },
        counts: zero,
        running: [],
        agent: 'claude-code',
        activeAt: now - 190 * 60_000,
      },
      {
        id: 'p4',
        name: 'Timetracker',
        path: '/Users/dev/code/timetracker',
        missing: false,
        branch: 'main',
        counts: zero,
        running: [],
        agent: 'codex',
        activeAt: now - 2 * 86_400_000,
      },
      {
        id: 'p5',
        name: 'Old Dashboard',
        path: '/Users/dev/archive/old-dashboard',
        missing: true,
        counts: zero,
        running: [],
        agent: 'claude-code',
        activeAt: now - 42 * 86_400_000,
      },
    ];
    return cards
      .filter((c) => projects.some((p) => p.id === c.id) || c.id === 'p4' || c.id === 'p5')
      .map((c) => {
        const p = projects.find((x) => x.id === c.id);
        return p ? { ...c, name: p.name, ...(p.logo ? { logo: p.logo } : {}) } : c;
      });
  },
  'project.rename': (id, name) => {
    const p = mockProject(id);
    if (name.trim()) p.name = name.trim();
    return { ...p };
  },
  'project.pickLogo': (id) => {
    const p = mockProject(id);
    p.logo = MOCK_LOGO;
    return { ...p };
  },
  'project.removeLogo': (id) => {
    const p = mockProject(id);
    delete p.logo;
    return { ...p };
  },
  'project.settings': () => ({ ...projectSettings }),
  'project.saveSettings': (_p, next) => void Object.assign(projectSettings, next),
  'import.scan': (paths) => paths.map((path) => importSource(path)),
  'import.start': (projectId) => {
    const chat: ChatSummary = {
      id: 'imp1',
      title: 'Импорт документации',
      agent: 'claude-code',
      archived: false,
      kind: 'import',
      live: false,
      updatedAt: Date.now(),
    };
    if (!chats.some((c) => c.id === chat.id)) chats.unshift(chat);
    emit('chats.changed', { projectId });
    return chat;
  },
  'import.review': () => importReview(),
  'import.openSource': () => undefined,
  // `?nocode` opens a project without code of its own (the start screens of D-32).
  'project.hasCode': () => !new URLSearchParams(location.search).has('nocode'),
  'projects.relocate': (id, path) => ({ id, name: path, path, missing: false }),
  'projects.openIn': () => undefined,
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
  'agents.config': (agent) => ({
    dir: agent === 'codex' ? 'C:/Users/dev/.codex' : 'C:/Users/dev/.claude',
    mcp:
      agent === 'codex'
        ? []
        : [
            { name: 'github', state: 'ok', tools: 12 },
            { name: 'claude.ai Google Drive', state: 'needs_auth', tools: 0 },
            { name: 'linear', state: 'failed', tools: 0, error: 'spawn npx ENOENT' },
          ],
    skills: 4,
    hooks: 2,
  }),
  'agents.openConfigDir': () => undefined,
  'agents.commands': () => [
    { name: 'compact', description: 'Сжать историю разговора', kind: 'command' },
    { name: 'review', description: 'Ревью текущих изменений', kind: 'command' },
    { name: 'init', description: 'Описать проект в CLAUDE.md', kind: 'command' },
    { name: 'security-review', description: 'Проверить изменения на уязвимости', kind: 'command' },
    { name: 'test-runner', description: 'Навык · запуск и разбор тестов', kind: 'skill' },
  ],
  'tasks.list': () => tasks.map((t) => ({ ...t })),
  'tasks.slots': () => ({ total: 3, free: 1 }),
  'tasks.run': (projectId, ids) => boardChanged(projectId, () => board.run(ids)),
  'tasks.archive': (projectId, ids, archived) =>
    boardChanged(projectId, () => board.archive(ids, archived)),
  'tasks.delete': (projectId, ids) => boardChanged(projectId, () => board.delete(ids)),
  'tasks.move': (projectId, ids, milestone) =>
    boardChanged(projectId, () => board.move(ids, milestone)),
  'tasks.unblock': (projectId, ids) => boardChanged(projectId, () => board.unblock(ids)),
  'tasks.assign': (projectId, ids, a) =>
    boardChanged(projectId, () => board.assign(ids, a.agent, a.model)),
  'docs.list': () => docs.list(),
  'docs.read': (_p, path) => docs.read(path),
  'docs.write': (projectId, path, text) => boardChanged(projectId, () => docs.write(path, text)),
  'docs.create': (projectId, name) => {
    const entry = docs.create(name);
    emit('project.changed', { projectId });
    return entry;
  },
  'docs.createSpec': (projectId, title) => {
    const entry = docs.createSpec(title);
    emit('project.changed', { projectId });
    return entry;
  },
  'docs.setAdrStatus': (projectId, id, status) =>
    boardChanged(projectId, () => docs.setStatus(id, status)),
  'docs.setSpecStatus': (projectId, id, status) =>
    boardChanged(projectId, () => docs.setSpecStatus(id, status)),
  'docs.reveal': () => undefined,
  'plan.milestones': () => milestones.map((m) => ({ ...m })),
  'plan.create': (projectId, input) => {
    const created = plan.create(input);
    emit('project.changed', { projectId });
    return created;
  },
  'plan.update': (projectId, id, input) => boardChanged(projectId, () => plan.update(id, input)),
  'plan.delete': (projectId, id) => boardChanged(projectId, () => plan.delete(id)),
  'plan.reorder': (projectId, ids) => boardChanged(projectId, () => plan.reorder(ids)),
  'plan.placeTask': (projectId, taskId, milestoneId, index) =>
    boardChanged(projectId, () => plan.placeTask(taskId, milestoneId, index)),
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
  'chats.list': () => chats.map((c) => ({ ...c })),
  'chats.defaults': () => ({ agent: 'claude-code', model: 'claude-opus-5' }),
  'chat.open': (projectId, chatId) => {
    const chat = chats.find((c) => c.id === chatId);
    if (!chat) throw new Error('The chat is not found');
    return {
      projectId,
      chat,
      settings: { agent: chat.agent, model: 'claude-opus-5', effort: 'high' },
      timeline: chatTimeline(chatId),
      seq: chatSeqs.get(chatId) ?? 1,
    };
  },
  'chat.create': (projectId, settings, input) => {
    const chat: ChatSummary = {
      id: `c${chats.length + 1}`,
      title: input.text.split('\n')[0]!.slice(0, 60),
      agent: settings.agent,
      archived: false,
      live: false,
      updatedAt: Date.now(),
    };
    chats.unshift(chat);
    emit('chats.changed', { projectId });
    return chat;
  },
  'chat.send': () => undefined,
  'chat.respond': () => undefined,
  'chat.interrupt': () => undefined,
  'chat.rewind': () => undefined,
  'chat.setSettings': () => undefined,
  'chat.archive': (projectId, chatId, archived) => {
    const chat = chats.find((c) => c.id === chatId);
    if (chat) chat.archived = archived;
    emit('chats.changed', { projectId, chatId });
  },
  'chat.proposal': (projectId, chatId, itemId, action) => {
    const timeline = chatTimeline(chatId);
    timeline.items = timeline.items.map((item) => {
      if (item.id !== itemId || item.kind !== 'proposal') return item;
      if (action.action === 'reject') return { ...item, state: 'rejected' };
      if (action.action === 'revert') return { ...item, state: 'reverted' };
      const p = item.proposal;
      const tasks =
        p.type === 'plan'
          ? p.tasks
              .filter((t) => !action.tasks || action.tasks.includes(t.ref))
              .map((t, i) => ({ id: `T-01${i + 3}`, title: t.title, ref: t.ref }))
          : undefined;
      return {
        ...item,
        state: 'applied',
        result: {
          ...(p.type === 'plan' && p.milestone?.isNew
            ? { milestone: { id: p.milestone.id, title: p.milestone.title } }
            : {}),
          ...(tasks ? { tasks } : {}),
          ...(p.type === 'adr' ? { adr: { id: p.id, title: action.adr?.title ?? p.title } } : {}),
          ...(p.type === 'import'
            ? {
                applied: action.import?.length ?? p.total,
                imported: [
                  { kind: 'brief' as const, title: 'Бриф', update: false },
                  { kind: 'architecture' as const, title: 'Архитектура', update: true },
                  {
                    kind: 'adr' as const,
                    code: 'ADR-0008',
                    title: 'Выбор эквайера',
                    update: false,
                  },
                  { kind: 'adr' as const, code: 'ADR-0009', title: 'Очередь задач', update: false },
                  {
                    kind: 'spec' as const,
                    code: 'SPEC-0004',
                    title: 'Возвраты по картам',
                    update: false,
                  },
                  { kind: 'plan' as const, code: 'M04', title: 'Возвраты', update: false },
                ],
              }
            : {}),
        },
      };
    });
    chatSeqs.set(chatId, (chatSeqs.get(chatId) ?? 1) + 1);
    emit('chats.changed', { projectId, chatId });
  },
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
  'files.pick': (kind) =>
    kind === 'folder'
      ? [{ path: 'C:/Users/dev/Docs/shop', kind: 'folder' }]
      : [{ path: 'C:/Users/dev/Downloads/ТЗ-админка.docx', kind: 'file' }],
  'shell.openExternal': () => undefined,
};

const bridge: SkaroApi = {
  platform: 'win32',
  pathOf: (file: File) => `C:/Users/dev/Docs/${file.name}`,
  invoke: (method, ...args) =>
    Promise.resolve((handlers[method] as (...a: unknown[]) => unknown)(...args) as never),
  on: <E extends keyof Events>(event: E, listener: (payload: Events[E]) => void) => {
    const set = listeners.get(event) ?? new Set();
    listeners.set(event, set);
    const wrapped = listener as (payload: unknown) => void;
    set.add(wrapped);
    return () => void set.delete(wrapped);
  },
};

Object.defineProperty(window, 'skaro', { value: bridge });
