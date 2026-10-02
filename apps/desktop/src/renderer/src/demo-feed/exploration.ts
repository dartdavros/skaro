import type { TimelineEvent } from '@skaro/timeline';
import { W, item, now } from './events';

/** Turn opening: the request, reasoning, reading the code and a subagent search. */
export function exploration(): TimelineEvent[] {
  return [
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
        startedAt: now(),
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
        startedAt: now(),
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
  ];
}
