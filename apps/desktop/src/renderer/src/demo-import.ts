// Demo import for the browser preview (mock-bridge): the sources of the ImportModal mockup, the
// import chat of the AgentChat mockup and the staged artifacts of the ImportReview mockup.

import { Timeline, type Item, type TimelineEvent, type TimelineState } from '@skaro/timeline';
import type { ImportReview, ImportReviewItem, ImportSource } from '../../shared/ipc';

/** "~/Docs/shop · 42 файла" and the like, whatever path the picker gives. */
export function importSource(path: string): ImportSource {
  const display = path.replace(/^C:\/Users\/dev/, '~');
  if (/\.docx$/i.test(path)) {
    return { path, display, kind: 'file', files: 1, readable: 1, unsupported: 0, formats: [] };
  }
  return {
    path,
    display,
    kind: 'folder',
    files: 42,
    readable: 30,
    unsupported: 12,
    formats: ['.fig', '.psd', '.sketch', '.vsdx'],
  };
}

const TZ = '~/Downloads/ТЗ-админка.docx';
const SHOP = '~/Docs/shop';

function item(
  key: string,
  type: ImportReviewItem['type'],
  title: string,
  sources: string[],
  extra: Partial<ImportReviewItem> = {},
): ImportReviewItem {
  return {
    key,
    type,
    title,
    update: false,
    sources,
    body: `## Контекст\n\nРаздел перенесён из исходного документа и сверен с кодом проекта.\n\n## Решение\n\n${title} — зафиксировано как в источнике, формулировки приведены к формату Skaro.\n`,
    dependsOn: [],
    refs: [],
    ...extra,
  };
}

export function importReview(): ImportReview {
  const task = (key: string, title: string, milestone?: string, deps: string[] = []) =>
    item(key, 'task', title, milestone === 'm2' ? [`${SHOP}/notifications.md`] : [TZ], {
      ...(milestone ? { milestone } : {}),
      dependsOn: deps,
      refs: [...(milestone ? [milestone] : []), ...deps],
      fields: {
        goal: `${title}.`,
        criteria: [
          'Сумма возврата не больше оплаченной',
          'повтор с тем же ключом не создаёт второй возврат (R-2)',
        ],
      },
    });
  return {
    milestones: { m1: 'M04', m2: 'M05' },
    items: [
      item('brief', 'brief', 'Бриф', [`${SHOP}/README.md`, TZ], {
        body: '## Что строим\n\nShop API — бэкенд интернет-магазина: каталог, заказы, оплата и админка для менеджеров.\n\n## Для кого\n\n- Покупатели — через витрину и приложение\n- Менеджеры — обработка заказов и возвратов в админке\n',
      }),
      item('arch', 'architecture', 'Архитектура', [`${SHOP}/architecture.pdf`, 'code'], {
        update: true,
        refs: ['adr2'],
        before:
          '## Компоненты\n\n| payments | Эквайринг Stripe | src/payments |\n\n## Потоки данных\n\nОплата идёт асинхронно.\n',
        body: '## Компоненты\n\n| payments | Эквайринг YooKassa, СБП, возвраты | src/payments |\n| notifications | Письма и пуши о заказах | src/notify |\n\n## Потоки данных\n\nОплата идёт асинхронно.\nВозвраты идут через очередь, как и вебхуки — см. ADR «Очередь задач».\n',
      }),
      item('adr1', 'adr', 'Выбор эквайера', [`${SHOP}/decisions/payments.md`]),
      item('adr2', 'adr', 'Очередь задач', [`${SHOP}/decisions/queue.md`, 'code']),
      item('adr3', 'adr', 'Хранение файлов в S3', [`${SHOP}/decisions/storage.md`]),
      item('adr4', 'adr', 'Авторизация JWT', [`${SHOP}/auth.md`], {
        update: true,
        before: '## Решение\n\nСессии в Redis.\n',
        body: '## Решение\n\nКороткоживущий JWT и refresh-токен в БД.\n',
      }),
      item('spec1', 'spec', 'Возвраты по картам', [TZ], {
        body: '## Проблема\n\nВозвраты оформляются вручную в кабинете эквайера — без следа в заказе и без чека.\n\n## Требования\n\n- Возврат из карточки заказа на сумму не больше оплаченной\n- По каждому возврату — чек по 54-ФЗ\n',
      }),
      item('spec2', 'spec', 'Роли и доступы админки', [TZ, `${SHOP}/roles.xlsx`]),
      item('spec3', 'spec', 'Уведомления о заказе', [`${SHOP}/notifications.md`]),
      item('doc1', 'doc', 'requirements.md', [`${SHOP}/nfr.md`], {
        update: true,
        before: '## Нефункциональные требования\n\n- Ответ API — не дольше 300 мс\n',
        body: '## Нефункциональные требования\n\n- Ответ API — не дольше 300 мс для 95% запросов\n- Доступность — 99,5% в месяц\n',
      }),
      item('doc2', 'doc', 'glossary.md', [`${SHOP}/glossary.md`]),
      item('m1', 'milestone', 'Возвраты', [TZ], {
        fields: {
          goal: 'Возвраты оформляются из админки и попадают в заказ, чек формируется автоматически.',
          doneWhen: 'Менеджер делает полный и частичный возврат без кабинета эквайера.',
        },
      }),
      task('t1', 'Возврат из карточки заказа', 'm1'),
      task('t2', 'Чек возврата по 54-ФЗ', 'm1', ['t1']),
      task('t3', 'Экран возвратов в админке', 'm1'),
      item('m2', 'milestone', 'Уведомления', [`${SHOP}/notifications.md`], {
        fields: { goal: 'Покупатель узнаёт о статусе заказа.', doneWhen: 'Письма и пуши уходят.' },
      }),
      task('t4', 'Письма о статусе заказа', 'm2'),
      task('t5', 'Пуши в приложение', 'm2'),
      { ...task('t6', 'Обновить зависимости платежей'), sources: ['code'] },
    ],
    skipped: [
      { path: `${SHOP}/flows.vsdx`, reason: 'формат не поддерживается' },
      { path: `${SHOP}/todo.md`, reason: 'пустой файл' },
      { path: `${SHOP}/requirements-old.md`, reason: 'дубликат requirements.md' },
      { path: `${SHOP}/team-offsite.md`, reason: 'не относится к проекту' },
    ],
    notes: [
      'В README оплата через Stripe, в коде — YooKassa. По вашему ответу оставил YooKassa, Stripe упомянут как прежний провайдер.',
      'Роль «оператор» в ТЗ совпадает с ролью manager в коде — объединил их.',
    ],
  };
}

type Draft = Item extends infer I
  ? I extends Item
    ? Omit<I, 'turnId' | 'startedAt' | 'native'>
    : never
  : never;

let clock = Date.now() - 10 * 60_000;

function event(draft: Draft, secs = 3): TimelineEvent {
  clock += secs * 1000;
  return {
    t: 'item.upsert',
    item: {
      ...draft,
      turnId: 'i1',
      startedAt: clock,
      ...(draft.status === 'done' ? { endedAt: clock + 1000 } : {}),
      native: { agent: 'demo', type: draft.kind, ref: draft.id },
    } as Item,
  };
}

/** The import chat of the AgentChat mockup: sources, the copy, the question, the ready card. */
export function demoImportTimeline(): TimelineState {
  clock = Date.now() - 10 * 60_000;
  const read = [
    'README.md',
    'architecture.pdf.md',
    'ТЗ-админка.docx.md',
    'decisions/payments.md',
  ].map((target, i) =>
    event({ id: `r${i}`, kind: 'explore', op: 'read', target, status: 'done' }, 1),
  );
  const events: TimelineEvent[] = [
    {
      t: 'session.started',
      nativeSessionId: 'demo-import',
      model: 'claude-opus-5-5',
      capabilities: {},
    },
    { t: 'turn.started', turnId: 'i1' },
    event({
      id: 'iu1',
      kind: 'message',
      role: 'user',
      text: `Импортировать документацию\n${SHOP} · 42 файла\n${TZ} · 1 файл`,
      status: 'done',
    }),
    event({
      id: 'iprep',
      kind: 'import_prep',
      prepared: 30,
      skipped: 12,
      files: [
        ['README.md', 'md'],
        ['architecture.pdf', 'pdf → текст'],
        ['ТЗ-админка.docx', 'docx → текст'],
        ['decisions/payments.md', 'md'],
        ['roles.xlsx', 'xlsx → таблица'],
        ['flows.vsdx', 'пропущен · формат не поддерживается'],
        ['mockups.fig', 'пропущен · формат не поддерживается'],
      ].map(([path, note]) => ({
        path: path!,
        note: note!,
        skipped: note!.startsWith('пропущен'),
      })),
      status: 'done',
    }),
    ...read,
    event({ id: 'is', kind: 'explore', op: 'search', target: 'payment', status: 'done' }, 1),
    event({ id: 'ith', kind: 'reasoning', text: '', status: 'done' }, 14),
    event({
      id: 'ia1',
      kind: 'message',
      role: 'agent',
      text: 'Беру YooKassa, Stripe упомяну как прежнего провайдера. Перенёс бриф и архитектуру, собрал ADR, спецификации и план.',
      phase: 'final',
      status: 'done',
    }),
    event({
      id: 'iimp',
      kind: 'proposal',
      proposal: {
        type: 'import',
        id: 'demo',
        groups: [
          { kind: 'brief', count: 1, updates: 0 },
          { kind: 'architecture', count: 1, updates: 1 },
          { kind: 'adr', count: 4, updates: 0 },
          { kind: 'spec', count: 3, updates: 0 },
          { kind: 'doc', count: 2, updates: 1 },
          { kind: 'plan', count: 2, tasks: 6, updates: 0 },
        ],
        total: 19,
        skipped: 4,
        notes: 2,
      },
      state: 'pending',
      status: 'done',
    }),
  ];
  const timeline = new Timeline();
  for (const e of events) timeline.apply(e);
  return timeline.state;
}
