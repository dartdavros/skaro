import type { DotState, NavItem, ProjectTab } from '@skaro/ui';

export const swatches = [
  ['Топбар / панель', '#0f0f0f'],
  ['Основной фон', '#121212'],
  ['Поверхность', '#1a1a1a'],
  ['Поверхность +', '#242424'],
  ['Поле ввода', '#2b2b2b'],
  ['Подложка переключателя', '#0e0e0e'],
  ['Акцент', '#2a52be'],
  ['Сообщение пользователя', '#1c2a4d'],
  ['Ссылка', '#7d9ce8'],
  ['Ошибка', '#ef6a63'],
  ['Предупреждение', '#e0a33c'],
  ['Текст яркий', '#e0e0e0'],
  ['Текст', '#d5d5d5'],
  ['Текст вторичный', '#adadad'],
  ['Текст приглушённый', '#848484'],
  ['Метка', '#767676'],
] as const;

export const statuses: { value: string; label: string; dot: DotState }[] = [
  { value: 'todo', label: 'Не начата', dot: 'idle' },
  { value: 'working', label: 'В работе', dot: 'working' },
  { value: 'need', label: 'Нужен ответ', dot: 'attention' },
  { value: 'review', label: 'На ревью', dot: 'attention' },
  { value: 'error', label: 'Ошибка', dot: 'error' },
  { value: 'done', label: 'Готово', dot: 'done' },
];

export const models = [
  {
    value: 'fable',
    label: 'Fable 5.1',
    description: 'Максимальная глубина — медленнее и дороже',
  },
  { value: 'opus', label: 'Opus 5', description: 'По умолчанию для агентной разработки' },
  { value: 'sonnet', label: 'Sonnet 5', description: 'Баланс скорости и качества' },
  { value: 'haiku', label: 'Haiku 4.5', description: 'Быстрая и дешёвая, для простых правок' },
];

/** A fresh set of demo tabs: the initial state and the result of «+». */
export const projectTabs = (): ProjectTab[] => [
  { id: 'shop', label: 'Shop API', state: 'working' },
  { id: 'blog', label: 'Blog Engine', state: 'attention' },
  { id: 'landing', label: 'Skaro Landing' },
];

export const navItems: NavItem[] = [
  {
    id: 'tasks',
    label: 'Задачи',
    tip: 'Доска и список',
    icon: 'tasks',
    count: 2,
    countTip: 'Нужен ответ + на ревью',
    railTip: 'Задачи · 2 требуют внимания',
  },
  { id: 'docs', label: 'Документы', tip: 'Бриф, архитектура, решения', icon: 'docs' },
  { id: 'plan', label: 'План', tip: 'Этапы', icon: 'plan' },
  { id: 'chat', label: 'Чат', tip: 'Работа с агентом', icon: 'chat', separated: true },
  { id: 'params', label: 'Параметры', tip: 'Параметры проекта', icon: 'params' },
];

export const taskCards = () => [
  {
    title: 'Роли и доступы админки',
    stage: 'M03 · Админка',
    time: '—',
    agent: 'claude-code' as const,
    state: 'blocked' as DotState,
    tip: 'Заблокирована: ждёт T-004',
    selected: false,
  },
  {
    title: 'Вебхуки Stripe',
    stage: 'M02 · Платежи',
    time: '12 мин',
    agent: 'codex' as const,
    state: 'working' as DotState,
    tip: 'Агент работает',
    selected: false,
  },
  {
    title: 'Идемпотентность платежей',
    stage: 'M02 · Платежи',
    time: '1 ч',
    agent: 'claude-code' as const,
    state: 'attention' as DotState,
    tip: 'Нужен ответ',
    selected: false,
  },
  {
    title: 'Миграции заказов',
    stage: 'M01 · Каталог',
    time: '3 ч',
    agent: 'claude-code' as const,
    state: 'error' as DotState,
    tip: 'Ошибка запуска',
    selected: false,
  },
];
