// Demo chat for the browser preview (mock-bridge): the conversation of the AgentChat mockup, so
// the chat screen can be compared with it. Never used in the app.

import { Timeline, type Item, type TimelineEvent, type TimelineState } from '@skaro/timeline';

type Draft = Item extends infer I
  ? I extends Item
    ? Omit<I, 'turnId' | 'startedAt' | 'native'>
    : never
  : never;

const T0 = Date.now() - 2 * 60_000;
let clock = T0;

function item(draft: Draft, secs = 3): TimelineEvent {
  clock += secs * 1000;
  return {
    t: 'item.upsert',
    item: {
      ...draft,
      turnId: 't1',
      startedAt: clock,
      ...(draft.status === 'done' ? { endedAt: clock + 1000 } : {}),
      native: { agent: 'demo', type: draft.kind, ref: draft.id },
    } as Item,
  };
}

const ARCH_BEFORE = [
  '# Архитектура',
  '',
  '## Заказы',
  'Заказы живут в модуле orders.',
  '',
  '## Каталог',
  'Каталог отдаёт товары.',
].join('\n');

const ARCH_AFTER = [
  '# Архитектура',
  '',
  '## Заказы',
  'Заказы живут в модуле orders.',
  '',
  '## Платежи',
  'Эквайринг за интерфейсом PaymentProvider, webhook-обработчик идемпотентен.',
  '',
  '## Каталог',
  'Каталог отдаёт товары.',
].join('\n');

const body = (goal: string) => `## Цель\n\n${goal}\n\n## Критерии приёмки\n\n- [ ] Готово\n`;

export function demoChatTimeline(): TimelineState {
  clock = T0;
  const events: TimelineEvent[] = [
    { t: 'session.started', nativeSessionId: 'demo', model: 'claude-opus-5', capabilities: {} },
    { t: 'turn.started', turnId: 't1' },
    item({
      id: 'u1',
      kind: 'message',
      role: 'user',
      text: 'Дальше делаем платежи. Разбей на этап и задачи, зависимости учти.',
      status: 'done',
    }),
    item(
      {
        id: 'r1',
        kind: 'reasoning',
        text: 'Нужно понять, как сейчас устроены заказы и есть ли уже решения по оплате. Прочитаю архитектуру и ADR, потом предложу этап и задачи с зависимостями.',
        status: 'done',
      },
      8,
    ),
    ...[
      '.skaro/architecture.md',
      '.skaro/adr/0004-orders.md',
      'src/orders/order.service.ts',
      'src/orders/order.entity.ts',
      'src/checkout/checkout.controller.ts',
      'package.json',
    ].map((target, i) =>
      item({ id: `x${i}`, kind: 'explore', op: 'read', target, status: 'done' }, 1),
    ),
    item({ id: 'x9', kind: 'explore', op: 'search', target: 'payment', status: 'done' }, 1),
    item({
      id: 'a1',
      kind: 'message',
      role: 'agent',
      phase: 'final',
      text: 'Эквайринг лучше вынести за интерфейс провайдера — тогда webhook-обработчик не зависит от конкретного сервиса. Записал это решением и собрал этап.',
      status: 'done',
    }),
    item({
      id: 'p1',
      kind: 'proposal',
      proposal: { type: 'doc', path: 'architecture.md', before: ARCH_BEFORE, after: ARCH_AFTER },
      state: 'pending',
      status: 'done',
    }),
    item({
      id: 'p2',
      kind: 'proposal',
      proposal: {
        type: 'adr',
        id: '0007',
        title: 'Провайдер эквайринга за интерфейсом',
        body: '## Контекст\n\n…\n\n## Решение\n\n…\n\n## Последствия\n\n…\n',
        summary:
          'Работаем через `PaymentProvider`; конкретный сервис подключается адаптером. Причина — смена провайдера не должна трогать бизнес-логику заказов.',
      },
      state: 'pending',
      status: 'done',
    }),
    item({
      id: 'p3',
      kind: 'proposal',
      proposal: {
        type: 'plan',
        milestone: { id: 'M02', title: 'Платежи', isNew: true },
        tasks: [
          { ref: 'a', title: 'Ключи и конфиг эквайринга', dependsOn: [], dependsOnTitles: [] },
          {
            ref: 'b',
            title: 'Модель платежа',
            dependsOn: ['T-004'],
            dependsOnTitles: ['Схема БД'],
          },
          {
            ref: 'c',
            title: 'Webhook статусов оплаты',
            dependsOn: ['T-006'],
            dependsOnTitles: ['Интеграция с эквайрингом'],
          },
          {
            ref: 'd',
            title: 'Возвраты по картам',
            dependsOn: ['b'],
            dependsOnTitles: ['Модель платежа'],
          },
        ].map((t) => ({ ...t, body: body(t.title) })),
      },
      state: 'pending',
      status: 'done',
    }),
    item({
      id: 'p4',
      kind: 'proposal',
      proposal: {
        type: 'plan',
        milestone: { id: 'M01', title: 'Базовый API', isNew: true },
        tasks: [],
      },
      state: 'applied',
      result: {
        milestone: { id: 'M01', title: 'Базовый API' },
        tasks: ['a', 'b', 'c', 'd', 'e', 'f'].map((ref, i) => ({
          id: `T-00${i + 1}`,
          title: ref,
          ref,
        })),
      },
      status: 'done',
    }),
    { t: 'usage', inputTokens: 11_000, outputTokens: 1_000, contextUsedPct: 34 },
    { t: 'turn.completed', turnId: 't1', outcome: 'done' },
  ];
  return Timeline.from(events).state;
}
