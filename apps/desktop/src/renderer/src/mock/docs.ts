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
  '.skaro/specs/0001-card-payment.md': `## Проблема
Первая версия оплаты без возвратов и частичных списаний.
`,
  '.skaro/specs/0002-idempotency.md': `## Проблема
Повторный запрос или вебхук не должен списать деньги дважды.

## Требования
- R-1 Каждая операция с деньгами принимает ключ идемпотентности
- R-2 Повтор с тем же ключом возвращает первый результат
`,
  '.skaro/specs/0005-admin-roles.md': `## Проблема
Все сотрудники видят и меняют всё в админке.

## Требования
- R-1 Три роли с матрицей прав: владелец, менеджер, поддержка
- R-2 Права проверяются на сервере, в сервисном слое
- R-3 Доступ без прав — 403 и запись в журнал действий
`,
  '.skaro/specs/0003-card-refunds.md': `## Проблема
Поддержка оформляет возвраты вручную в кабинете эквайера: долго, без следа в заказе и без чека возврата.

## Сценарии
- Покупатель отменил заказ до отгрузки — полный возврат
- Вернул часть товаров — частичный возврат на сумму позиций
- Возврат без заказа (ошибочное списание) — только роль manager

## Требования
- R-1 Возврат создаётся из карточки заказа на сумму не больше оплаченной
- R-2 Повторный запрос возврата с тем же ключом не создаёт второй возврат
- R-3 По каждому возврату формируется чек по 54-ФЗ
- R-4 Возврат без заказа доступен только роли manager и пишется в журнал

## Не входит
- Возвраты по СБП — отдельная спецификация
- Возврат наличными

## Открытые вопросы
- Нужен ли лимит суммы возврата без подтверждения старшего менеджера?
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
    spec('0001', 'Оплата картой', 'card-payment', 'superseded', '2026-09-14', {
      replacedBy: '0003',
    }),
    spec('0002', 'Идемпотентность платежей', 'idempotency', 'accepted', '2026-09-18', {}),
    spec('0003', 'Возвраты по картам', 'card-refunds', 'proposed', '2026-09-24', {
      replaces: '0001',
    }),
    spec('0005', 'Роли и доступы админки', 'admin-roles', 'accepted', '2026-09-20', {}),
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

function spec(
  id: string,
  title: string,
  slug: string,
  status: 'proposed' | 'accepted' | 'superseded',
  date: string,
  links: { replaces?: string; replacedBy?: string },
): DocEntry {
  return {
    kind: 'spec',
    path: `.skaro/specs/${id}-${slug}.md`,
    title,
    editedAt: Date.parse(date),
    spec: { id, status, date, ...links },
  };
}

export const docs = {
  list: (): DocEntry[] =>
    entries.map((d) => ({
      ...d,
      ...(d.adr ? { adr: { ...d.adr } } : {}),
      ...(d.spec ? { spec: { ...d.spec } } : {}),
    })),
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
  setSpecStatus(id: string, status: 'proposed' | 'accepted' | 'superseded'): void {
    const entry = entries.find((d) => d.spec?.id === id);
    if (entry?.spec) entry.spec.status = status;
  },
  createSpec(title: string): DocEntry {
    const n = entries.filter((d) => d.kind === 'spec').length + 1;
    const id = String(n).padStart(4, '0');
    const entry = spec(
      id,
      title,
      `spec-${n}`,
      'proposed',
      new Date().toISOString().slice(0, 10),
      {},
    );
    entry.editedAt = Date.now();
    const last = entries.findLastIndex((d) => d.kind === 'spec' || d.kind === 'adr');
    entries.splice(last + 1, 0, entry);
    TEXTS[entry.path] =
      '## Проблема\n\n\n## Сценарии\n- \n\n## Требования\n- R-1 \n\n## Не входит\n- \n\n## Открытые вопросы\n- \n';
    return entry;
  },
};
