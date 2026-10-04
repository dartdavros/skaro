import type { TimelineEvent } from '@skaro/timeline';
import { item } from './events';

/** The turn finished: final answer, a merge request and an open question. */
export function finished(): TimelineEvent[] {
  return [
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
  ];
}
