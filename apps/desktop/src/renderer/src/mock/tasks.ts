// Tasks of the in-memory bridge: the data of the Tasks mockup, changed by the board's actions.

import type {
  AgentId,
  MilestoneInfo,
  TaskStage,
  TaskStatus,
  TaskSummary,
} from '../../../shared/ipc';

const MS: Record<string, string> = { M01: 'Базовый API', M02: 'Платежи', M03: 'Админка' };
const MIN = 60_000;
/** Tasks that implement a specification of the Documents mockup. */
const SPEC: Record<string, { id: string; title: string; path: string }> = {
  'T-016': {
    id: '0003',
    title: 'Возвраты по картам',
    path: '.skaro/specs/0003-card-refunds.md',
  },
  'T-022': {
    id: '0003',
    title: 'Возвраты по картам',
    path: '.skaro/specs/0003-card-refunds.md',
  },
  'T-020': {
    id: '0005',
    title: 'Роли и доступы админки',
    path: '.skaro/specs/0005-admin-roles.md',
  },
};

type Row = [string, string, string, TaskStatus, AgentId | '', string, number, string[]?];

// id, title, milestone, status, agent, model, minutes ago, depends on
const ROWS: Row[] = [
  ['T-004', 'Схема БД и миграции', 'M01', 'done', 'claude-code', 'Sonnet 5', 1500],
  ['T-007', 'Каталог товаров', 'M01', 'done', 'claude-code', 'Sonnet 5', 1500],
  ['T-009', 'Точка входа FastAPI', 'M01', 'done', 'codex', 'GPT-5.6 Terra', 1500],
  ['T-010', 'Корзина', 'M01', 'done', 'claude-code', 'Opus 5', 2880],
  ['T-011', 'Ключи и конфиг эквайринга', 'M02', 'done', 'claude-code', 'Sonnet 5', 180],
  ['T-012', 'Модель платежа', 'M02', 'done', 'claude-code', 'Opus 5', 120],
  ['T-013', 'Схема платежей', 'M02', 'done', 'codex', 'GPT-5.6 Terra', 24],
  ['T-014', 'Интеграция с эквайрингом', 'M02', 'in_progress', 'claude-code', 'Opus 5', 0],
  ['T-019', 'Идемпотентность вебхуков', 'M02', 'needs_answer', 'codex', 'GPT-5.6 Terra', 60],
  ['T-016', 'Возвраты по картам', 'M02', 'review', 'claude-code', 'Opus 5', 4],
  ['T-015', 'Webhook статусов оплаты', 'M02', 'blocked', '', '', 1500, ['T-014']],
  ['T-017', 'Отчёты по платежам', 'M02', 'failed', 'codex', 'GPT-5.6 Terra', 40],
  ['T-020', 'Роли и доступы админки', 'M03', 'todo', '', '', 1500],
  ['T-021', 'Список заказов', 'M03', 'todo', '', '', 1500],
  ['T-022', 'Экран возвратов', 'M03', 'blocked', '', '', 1500, ['T-016']],
  ['T-023', 'Обновить зависимости платежей', '', 'todo', '', '', 1500],
];

/** The stage behind a shown status: a failed task failed while it was in progress. */
const STAGES: Partial<Record<TaskStatus, TaskStage>> = {
  blocked: 'todo',
  queued: 'in_progress',
  needs_answer: 'in_progress',
  failed: 'in_progress',
};

export const tasks: TaskSummary[] = ROWS.map(
  ([id, title, ms, status, agent, model, ago, deps]) => ({
    id,
    title,
    status,
    stage: STAGES[status] ?? (status as TaskStage),
    ...(ms ? { milestone: { id: ms, title: MS[ms]! } } : {}),
    archived: false,
    ...(agent ? { agent } : {}),
    ...(model ? { model } : {}),
    deps: deps ?? [],
    waitsFor: status === 'blocked' ? (deps ?? []) : [],
    ...(SPEC[id] ? { spec: SPEC[id] } : {}),
    updatedAt: Date.now() - ago * MIN,
  }),
);

export const milestones: MilestoneInfo[] = [
  {
    id: 'M01',
    title: MS['M01']!,
    order: 1,
    goal: 'Каталог и заказы доступны через REST API.',
    criteria: 'Все эндпоинты описаны в OpenAPI и покрыты тестами.',
  },
  {
    id: 'M02',
    title: MS['M02']!,
    order: 2,
    goal: 'Принимать оплату картой и СБП.',
    criteria:
      'Оплата проходит end-to-end в тестовом режиме, статусы заказов обновляются по вебхукам.',
  },
  {
    id: 'M03',
    title: MS['M03']!,
    order: 3,
    goal: 'Управлять заказами и доступами без SQL.',
    criteria: 'Менеджер и поддержка работают только в админке, права проверяются на сервере.',
  },
];

tasks.forEach((task, i) => (task.order = i + 1));

export const plan = {
  /** Only a milestone without started tasks; its tasks go with it. */
  delete(id: string): void {
    milestones.splice(
      milestones.findIndex((m) => m.id === id),
      1,
    );
    for (const task of tasks.filter((t) => t.milestone?.id === id))
      tasks.splice(tasks.indexOf(task), 1);
  },
  reorder(ids: string[]): void {
    for (const m of milestones) m.order = ids.indexOf(m.id) + 1;
    milestones.sort((a, b) => a.order - b.order);
  },
  placeTask(taskId: string, milestoneId: string, index: number): void {
    const task = tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (milestoneId) task.milestone = { id: milestoneId, title: MS[milestoneId] ?? '' };
    else delete task.milestone;
    const siblings = tasks
      .filter((t) => (t.milestone?.id ?? '') === milestoneId && t !== task && !t.archived)
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    siblings.splice(index, 0, task);
    siblings.forEach((t, i) => (t.order = i + 1));
  },
};

function pick(ids: string[]): TaskSummary[] {
  return tasks.filter((t) => ids.includes(t.id));
}

export const board = {
  archive(ids: string[], archived: boolean): void {
    for (const task of pick(ids)) task.archived = archived;
  },
  delete(ids: string[]): void {
    for (const task of pick(ids)) tasks.splice(tasks.indexOf(task), 1);
  },
  move(ids: string[], milestone: string): void {
    for (const task of pick(ids)) task.milestone = { id: milestone, title: MS[milestone] ?? '' };
  },
  unblock(ids: string[]): void {
    for (const task of pick(ids)) {
      if (task.status === 'blocked') task.status = 'todo';
      task.waitsFor = [];
    }
  },
  assign(ids: string[], agent: AgentId, model?: string): void {
    for (const task of pick(ids)) {
      task.agent = agent;
      if (model) task.model = model;
    }
  },
  run(ids: string[]): void {
    for (const task of pick(ids)) if (task.status !== 'blocked') task.status = 'queued';
  },
};
