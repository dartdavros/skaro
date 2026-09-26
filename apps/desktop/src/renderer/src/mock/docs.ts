// Documents of the in-memory bridge: the texts of the Documents mockup.

import type { DocEntry } from '../../../shared/ipc';

const DAY = 86_400_000;
const F = '```';

const TEXTS: Record<string, string> = {
  '.skaro/brief.md': `## Что строим
Shop API — бэкенд интернет-магазина: каталог, заказы, оплата и админка для менеджеров. Клиенты — веб-витрина и мобильное приложение.

## Для кого
- **Покупатели** — через витрину и приложение
- **Менеджеры** — обработка заказов в админке
- **Поддержка** — возвраты и ответы клиентам

## Границы
### Входит
- REST API каталога и заказов
- Оплата картой и через СБП, чеки по 54-ФЗ
- Админка с ролями и журналом действий

### Не входит
- Витрина и мобильное приложение — отдельные проекты
- Складской учёт — остаётся в 1С
`,
  '.skaro/architecture.md': `## Обзор
Монолит на **Node.js** с разделением на модули. Внешний мир общается с сервисом только через REST API, описанный в \`openapi.yaml\`.

${F}mermaid
flowchart LR
  Client[Витрина и приложение] --> API[REST API]
  API --> Services[Сервисный слой]
  Services --> DB[(PostgreSQL)]
  Services --> Queue[Очередь задач]
${F}

## Компоненты
| Модуль | Отвечает за | Где |
|---|---|---|
| catalog | Товары, категории, остатки | \`src/catalog\` |
| orders | Корзина, заказы, статусы | \`src/orders\` |
| payments | Эквайринг, СБП, возвраты, чеки | \`src/payments\` |
| admin | Роли, доступы, журнал | \`src/admin\` |

## Потоки данных
Оплата идёт асинхронно: API создаёт платёж, провайдер присылает вебхук, обработчик в очереди обновляет статус заказа. Выбор базы — в [ADR-0001](adr/0001-database.md), очередь — в [ADR-0002](adr/0002-queue.md).

${F}ts
// src/payments/webhook.ts
export async function onWebhook(evt: ProviderEvent) {
  await queue.add('payment.status', evt, { jobId: evt.id });
}
${F}

## Правила и ограничения
- Бизнес-логика только в сервисном слое, контроллеры тонкие
- Проверка прав — на сервере, в \`src/auth/policy.ts\`, а не только в UI
- Любая операция с деньгами идемпотентна по ключу запроса
- Секреты — только из переменных окружения, никогда в репозитории
- Новая зависимость — только через ADR

## Хранение
PostgreSQL 16, миграции через \`node-pg-migrate\`. Схема меняется только миграциями, ручные правки в проде запрещены.
`,
  '.skaro/adr/0001-database.md': `## Контекст
Нужны транзакции для заказов и платежей, отчёты и гибкие атрибуты товаров.

## Решение
Используем **PostgreSQL 16**. Атрибуты товаров храним в \`jsonb\`.

## Последствия
- Отчёты строятся SQL-запросами без отдельного хранилища
- Схема меняется только миграциями
`,
  '.skaro/adr/0002-queue.md': `## Контекст
Вебхуки провайдера и отправка чеков должны переживать рестарты и повторяться при сбоях.

## Решение
Фоновые задачи — **BullMQ** на Redis. Ключ задачи — ID события провайдера, чтобы не обработать его дважды.

## Последствия
- В инфраструктуре появляется Redis
- Нужен мониторинг длины очереди
`,
  '.skaro/adr/0003-sessions.md': `## Контекст
Админке нужна авторизация с возможностью отозвать сессию.

## Решение
Храним серверные сессии в Redis, в cookie — только ID сессии.
`,
  '.skaro/adr/0004-jwt.md': `## Контекст
Мобильному приложению неудобны cookie-сессии, а Redis на старте хочется не держать.

## Решение
Короткоживущий **JWT** (15 минут) и refresh-токен в БД. Отзыв — удалением refresh-токена.

## Последствия
- Access-токен нельзя отозвать до истечения срока
- Список активных входов виден в админке
`,
  '.skaro/docs/requirements.md': `## Нефункциональные требования
- Ответ API — не дольше 300 мс для 95% запросов
- Доступность — 99,5% в месяц
- Персональные данные хранятся в РФ

## Нагрузка
Пиковая — 50 заказов в минуту во время распродаж.
`,
  '.skaro/docs/research-payments.md': `## Провайдеры
| Провайдер | Комиссия | СБП | Чеки |
|---|---|---|---|
| ЮKassa | 2,8% | да | да |
| CloudPayments | 2,7% | да | да |
| Т-Касса | 2,5% | да | нет |

## Вывод
Берём **ЮKassa**: есть СБП и чеки из коробки, понятные вебхуки.
`,
};

const now = Date.now();
// `?nobrief` opens "Документы" without a brief (its empty state).
const noBrief = new URLSearchParams(location.search).has('nobrief');

const entries: DocEntry[] = (
  [
    { kind: 'brief', path: '.skaro/brief.md', title: 'Бриф', editedAt: now - 3 * DAY },
    {
      kind: 'architecture',
      path: '.skaro/architecture.md',
      title: 'Архитектура',
      editedAt: now - 2 * 3_600_000,
    },
    adr('0001', 'Выбор БД', 'database', 'accepted', '2026-09-12', {}),
    adr('0002', 'Очередь задач', 'queue', 'proposed', '2026-09-21', {}),
    adr('0003', 'Сессии в Redis', 'sessions', 'superseded', '2026-09-10', { replacedBy: '0004' }),
    adr('0004', 'Авторизация JWT', 'jwt', 'accepted', '2026-09-16', { replaces: '0003' }),
    {
      kind: 'doc',
      path: '.skaro/docs/requirements.md',
      title: 'requirements.md',
      editedAt: now - 5 * DAY,
    },
    {
      kind: 'doc',
      path: '.skaro/docs/research-payments.md',
      title: 'research-payments.md',
      editedAt: now - 7 * DAY,
    },
  ] as DocEntry[]
).filter((d) => !(noBrief && d.kind === 'brief'));

function adr(
  id: string,
  title: string,
  slug: string,
  status: 'proposed' | 'accepted' | 'superseded',
  date: string,
  links: { replaces?: string; replacedBy?: string },
): DocEntry {
  return {
    kind: 'adr',
    path: `.skaro/adr/${id}-${slug}.md`,
    title,
    editedAt: Date.parse(date),
    adr: { id, status, date, ...links },
  };
}

export const docs = {
  list: (): DocEntry[] => entries.map((d) => ({ ...d, ...(d.adr ? { adr: { ...d.adr } } : {}) })),
  read: (path: string): string => TEXTS[path] ?? '',
  write(path: string, text: string): void {
    TEXTS[path] = text;
    const entry = entries.find((d) => d.path === path);
    if (entry) entry.editedAt = Date.now();
    else if (path === '.skaro/brief.md')
      entries.unshift({ kind: 'brief', path, title: 'Бриф', editedAt: Date.now() });
  },
  create(name: string): DocEntry {
    const file = `${name.replace(/\.md$/, '')}.md`;
    const entry: DocEntry = {
      kind: 'doc',
      path: `.skaro/docs/${file}`,
      title: file,
      editedAt: Date.now(),
    };
    entries.push(entry);
    TEXTS[entry.path] = '';
    return entry;
  },
  setStatus(id: string, status: 'proposed' | 'accepted' | 'superseded'): void {
    const entry = entries.find((d) => d.adr?.id === id);
    if (entry?.adr) entry.adr.status = status;
  },
};
