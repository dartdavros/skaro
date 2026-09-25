// Demo feed for the browser preview (mock-bridge): the states of the "Лента агента" mockup, so the
// task screen can be compared with it. Never used in the app.

import { Timeline, type Item, type TimelineEvent, type TimelineState } from '@skaro/timeline';

type Draft = Item extends infer I
  ? I extends Item
    ? Omit<I, 'turnId' | 'startedAt' | 'native'>
    : never
  : never;

const T0 = Date.now() - 5 * 60_000;
let clock = T0;

function item(draft: Draft, turnId = 't1', secs = 3): TimelineEvent {
  clock += secs * 1000;
  return {
    t: 'item.upsert',
    item: {
      ...draft,
      turnId,
      startedAt: clock,
      ...(draft.status === 'done' ? { endedAt: clock + 2000 } : {}),
      native: { agent: 'demo', type: draft.kind, ref: draft.id },
    } as Item,
  };
}

const W = 'C:/work/shop-api';

export function demoTimeline(scenario: 'working' | 'finished'): TimelineState {
  clock = T0;
  const events: TimelineEvent[] = [
    { t: 'session.started', nativeSessionId: 'demo', model: 'claude-opus-5', capabilities: {} },
    { t: 'turn.started', turnId: 't1' },
    item({
      id: 'u1',
      kind: 'message',
      role: 'user',
      text: 'Начинай с сервисного слоя, UI потом.',
      status: 'done',
    }),
    item({
      id: 'r1',
      kind: 'reasoning',
      text: 'Пользователь просит начать с сервисов. Сначала найду, где сейчас проверяются роли, потом решу, куда переносить матрицу из ADR-0006, и только после этого трогаю middleware.',
      status: 'done',
    }),
    item({
      id: 'a1',
      kind: 'message',
      role: 'agent',
      phase: 'commentary',
      text: 'Разбираюсь в текущей авторизации. Матрица прав из `docs/adr/0006-roles.md` — переношу её в `src/auth/policy.ts`.',
      status: 'done',
    }),
    item({
      id: 'x1',
      kind: 'explore',
      op: 'read',
      target: `${W}/src/auth/middleware.ts`,
      detail: 'строки 1–84',
      status: 'done',
    }),
    item({
      id: 'x2',
      kind: 'explore',
      op: 'read',
      target: `${W}/src/auth/roles.ts`,
      status: 'done',
    }),
    item({
      id: 'x3',
      kind: 'explore',
      op: 'read',
      target: `${W}/docs/adr/0006-roles.md`,
      status: 'done',
    }),
    item({
      id: 'x4',
      kind: 'explore',
      op: 'search',
      target: 'requireRole',
      detail: '12 совпадений',
      status: 'done',
    }),
    item({
      id: 'x5',
      kind: 'explore',
      op: 'read',
      target: `${W}/src/services/orders.ts`,
      detail: 'строки 40–120',
      status: 'done',
    }),
    item({
      id: 'x6',
      kind: 'explore',
      op: 'fetch',
      target: 'https://casl.js.org/v6/en/guide/intro',
      status: 'done',
    }),
    item(
      {
        id: 'sub1',
        kind: 'task',
        title: 'Найти все проверки ролей в сервисах',
        actions: 14,
        status: 'done',
        summary:
          'Роли проверяются в orders.ts (4 места), catalog.ts (2) и refunds.ts (1). Возврат без заказа роль не проверяет.',
      },
      't1',
      2,
    ),
    {
      t: 'item.upsert',
      item: {
        id: 'sub1-x',
        turnId: 't1',
        parentId: 'sub1',
        kind: 'explore',
        op: 'search',
        target: 'hasRole',
        status: 'done',
        startedAt: clock,
        native: { agent: 'demo', type: 'explore', ref: 'sub1-x' },
      },
    },
    {
      t: 'item.upsert',
      item: {
        id: 'sub1-a',
        turnId: 't1',
        parentId: 'sub1',
        kind: 'message',
        role: 'agent',
        text: 'Роли проверяются в `orders.ts` (4 места), `catalog.ts` (2) и `refunds.ts` (1). Возврат без заказа роль не проверяет.',
        status: 'done',
        startedAt: clock,
        native: { agent: 'demo', type: 'message', ref: 'sub1-a' },
      },
    },
    item(
      {
        id: 'a2',
        kind: 'message',
        role: 'agent',
        phase: 'commentary',
        text: 'Переношу проверки в policy.ts и закрываю возврат без заказа.',
        status: 'done',
      },
      't1',
      40,
    ),
    item({
      id: 'e1',
      kind: 'file_change',
      files: [
        {
          path: `${W}/src/auth/policy.ts`,
          change: 'update',
          added: 6,
          removed: 1,
          diff: "@@ -1,3 +1,8 @@\n import { Role } from './roles';\n \n-const ADMIN_ONLY = ['finance'];\n+export const policy = {\n+  admin:   ['*'],\n+  manager: ['orders:*', 'catalog:*'],\n+  support: ['orders:read'],\n+} satisfies Record<Role, string[]>;\n",
        },
      ],
      status: 'done',
    }),
    item({
      id: 'e2',
      kind: 'file_change',
      files: [
        {
          path: `${W}/src/auth/policy.ts`,
          change: 'update',
          added: 80,
          removed: 3,
          diff: '@@ -20,3 +20,80 @@\n+export function assertCan() {}\n',
        },
      ],
      status: 'done',
    }),
    item({
      id: 'e3',
      kind: 'file_change',
      files: [{ path: `${W}/src/auth/permissions.ts`, change: 'add', added: 120 }],
      status: 'done',
    }),
    item({
      id: 'e4',
      kind: 'file_change',
      files: [{ path: `${W}/src/auth/legacy-acl.ts`, change: 'delete' }],
      status: 'done',
    }),
    item({
      id: 'e5',
      kind: 'file_change',
      files: [
        {
          path: `${W}/src/admin/guard.ts`,
          change: 'move',
          movePath: `${W}/src/admin/role-guard.ts`,
        },
      ],
      status: 'done',
    }),
    item({
      id: 'e6',
      kind: 'file_change',
      files: [{ path: `${W}/src/admin/routes.ts`, change: 'update' }],
      status: 'declined',
    }),
    item({
      id: 'e7',
      kind: 'file_change',
      files: [{ path: `${W}/src/admin/menu.ts`, change: 'update' }],
      status: 'failed',
    }),
    item({
      id: 'c1',
      kind: 'command',
      command: 'npm run lint',
      output: '',
      outputLive: false,
      status: 'done',
    }),
    item({
      id: 'c2',
      kind: 'command',
      command: 'npm test -- policy',
      description: 'Запускает тесты политики доступа',
      output:
        ' RUN  v3.2  src/auth\n ✓ policy › admin видит все разделы\n ✓ policy › менеджер видит заказы\n ✗ policy › менеджер не видит финансы\n   expected true to be false\n ✓ policy › поддержка только читает\n Tests  1 failed | 11 passed (12)',
      outputLive: false,
      status: 'failed',
    }),
    item({
      id: 'c4',
      kind: 'command',
      command: 'npm run test:watch',
      output: ' WATCH  src/auth\n ✓ 12 tests passed\n Waiting for file changes…',
      outputLive: false,
      background: { taskId: 'bg1', state: 'running' },
      status: 'running',
    }),
    item({
      id: 'c5',
      kind: 'command',
      command: 'npm run e2e -- admin',
      output: '',
      outputLive: false,
      status: 'interrupted',
    }),
    item({
      id: 'tl1',
      kind: 'tool',
      name: 'get_issue',
      server: 'linear',
      input: '{ "id": "SHOP-212" }',
      output:
        '{"title":"Роли и доступы админки","state":"In Progress","labels":["auth","admin"],"assignee":null}',
      status: 'done',
    }),
    item({
      id: 'n1',
      kind: 'notice',
      level: 'warning',
      code: 'other',
      text: 'Файл .env.local в .gitignore — агент не видит его содержимое.',
      status: 'done',
    }),
    {
      t: 'plan.updated',
      steps: [
        { id: 'p1', text: 'Найти текущие проверки ролей', status: 'done' },
        { id: 'p2', text: 'Описать матрицу прав в policy.ts', status: 'done' },
        {
          id: 'p3',
          text: 'Проверить права в сервисном слое',
          activeText: 'Проверяю права в сервисном слое',
          status: 'active',
        },
        { id: 'p4', text: 'Покрыть матрицу тестами', status: 'pending' },
        { id: 'p5', text: 'Убрать проверки из middleware', status: 'pending' },
      ],
    },
  ];

  if (scenario === 'working') {
    events.push(
      item({
        id: 'c3',
        kind: 'command',
        command: 'npx tsc --noEmit',
        description: 'Проверяет типы во всём проекте',
        output: '',
        outputLive: false,
        status: 'running',
      }),
      item({
        id: 'c6',
        kind: 'command',
        command: 'npm install @casl/ability@6',
        description: 'Устанавливает библиотеку прав',
        output: '',
        outputLive: false,
        status: 'queued',
      }),
      item({
        id: 'e8',
        kind: 'file_change',
        files: [{ path: `${W}/src/services/refunds.ts`, change: 'update' }],
        status: 'queued',
      }),
      {
        t: 'interaction.opened',
        interaction: {
          kind: 'approval',
          id: 'ap1',
          itemId: 'c6',
          action: {
            type: 'command',
            title: 'npm install',
            command: 'npm install @casl/ability@6',
            reason:
              'Нужна библиотека для матрицы прав — установка пакетов вне режима «Авто в пределах задачи».',
          },
          choices: ['allow_once', 'allow_session', 'deny'],
        },
      },
      {
        t: 'interaction.opened',
        interaction: {
          kind: 'approval',
          id: 'ap2',
          itemId: 'e8',
          action: {
            type: 'file_write',
            title: 'refunds.ts',
            paths: [`${W}/src/services/refunds.ts`],
            reason: 'Добавляю проверку роли для возврата без заказа',
          },
          choices: ['allow_once', 'allow_session', 'deny'],
        },
      },
      { t: 'activity', state: 'preparing_edit', target: `${W}/src/services/orders.ts` },
      { t: 'usage', inputTokens: 90_000, outputTokens: 4000, contextUsedPct: 72 },
    );
  } else {
    events.push(
      item({
        id: 'a3',
        kind: 'message',
        role: 'agent',
        phase: 'final',
        text: "Готово. Права проверяются в сервисном слое, middleware оставил страховкой. Отказы пишутся в журнал, тесты на матрицу прав зелёные.\n\n```typescript\n// Проверка прав в сервисном слое\nexport function assertCan(user: User, action: Action) {\n  if (!policy[user.role].includes(action)) {\n    throw new ForbiddenError('FORBIDDEN_ROLE', 403);\n  }\n}\n```\n\n| Роль | Заказы | Каталог | Финансы |\n|---|---|---|---|\n| `admin` | все | все | все |\n| `manager` | все | все | — |\n| `support` | чтение | — | — |",
        status: 'done',
      }),
      { t: 'usage', inputTokens: 38_000, outputTokens: 3000, contextUsedPct: 88 },
      { t: 'turn.completed', turnId: 't1', outcome: 'done' },
      { t: 'turn.started', turnId: 't2' },
      item({ id: 'u2', kind: 'message', role: 'user', text: 'Вливай', status: 'done' }, 't2'),
      item(
        {
          id: 'a4',
          kind: 'message',
          role: 'agent',
          phase: 'final',
          text: 'Запросил слияние — подтвердите его в карточке ниже.',
          status: 'done',
        },
        't2',
      ),
      {
        t: 'interaction.opened',
        interaction: {
          kind: 'merge',
          id: 'm1',
          from: 'skaro/T-020-admin-roles',
          to: 'main',
          files: 7,
          added: 212,
          removed: 18,
          blockers: [],
          baseAhead: 2,
          skaroChanges: ['.skaro/tasks/T-020-admin-roles.md'],
          conflicts: [],
        },
      },
      { t: 'turn.completed', turnId: 't2', outcome: 'done' },
      {
        t: 'interaction.opened',
        interaction: {
          kind: 'question',
          id: 'q1',
          questions: [
            {
              id: 'q1a',
              header: 'Способ проверки',
              text: 'Где проверять права: в middleware на уровне маршрутов или в каждом сервисе явно?',
              multi: false,
              allowFreeText: true,
              options: [
                {
                  label: 'В middleware',
                  description: 'Одна точка входа, но сервисы остаются без защиты',
                },
                {
                  label: 'Явно в сервисах',
                  description: 'Проверка рядом с бизнес-логикой — надёжнее',
                },
              ],
            },
            {
              id: 'q1b',
              header: 'Роли',
              text: 'Какие роли нужны на старте?',
              multi: true,
              allowFreeText: true,
              options: [
                { label: 'Администратор', description: 'Полный доступ' },
                { label: 'Менеджер', description: 'Заказы и каталог, без финансов' },
                { label: 'Поддержка', description: 'Только чтение заказов' },
              ],
            },
          ],
        },
      },
    );
  }
  return Timeline.from(events).state;
}
