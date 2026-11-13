import { addMessages } from '@skaro/ui';
const kinds = {
  'c4.applied': ['Согласованный пакет применён', 'Accepted package applied'],
  'decision.waiting': ['Ожидается решение владельца', 'Waiting for your decision'],
  'decision.requested': ['Запрошено решение владельца', 'An owner decision was requested'],
  'cache.evicted': ['Кеш сборки очищен', 'Build cache cleared'],
  'resource.released': ['Освобождён собственный ресурс', 'An owned resource was released'],
  'environment.started': ['Окружение задачи запущено', 'Task environment started'],
  'task.unblocked': ['Разблокирована задача', 'Task unblocked'],
};
for (const [kind, labels] of Object.entries(kinds))
  for (const [index, locale] of ['ru', 'en'].entries()) {
    addMessages(locale as 'ru' | 'en', {
      [`background.job.${kind}`]: labels[index]!,
      [`background.done.${kind}`]: labels[index]!,
      [`background.about.${kind}`]: '',
    });
  }
addMessages('ru', {
  'background.journal': 'Журнал проекта',
  'background.journalSubtitle': 'Важные события проекта',
  'background.recentSubtitle': 'Сейчас и недавно',
  'background.recentView': 'Недавняя работа',
  'background.loading': 'Загружаем…',
  'background.loadError': 'Не удалось загрузить события.',
  'background.retry': 'Повторить',
  'background.noEvents': 'Событий пока нет',
  'background.more': 'Показать ещё',
  'background.openDecision': 'Открыть решение',
});
addMessages('en', {
  'background.journal': 'Project journal',
  'background.journalSubtitle': 'Important project events',
  'background.recentSubtitle': 'Now and recently',
  'background.recentView': 'Recent work',
  'background.loading': 'Loading…',
  'background.loadError': 'Could not load events.',
  'background.retry': 'Retry',
  'background.noEvents': 'No events yet',
  'background.more': 'Show more',
  'background.openDecision': 'Open decision',
});
