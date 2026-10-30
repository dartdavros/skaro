import { addMessages } from '@skaro/ui';
addMessages('ru', {
  'background.title': 'Фоновая работа',
  'background.subtitle': 'Что Skaro делает сам, без агентов и ваших команд',
  'background.running': 'Сейчас',
  'background.recent': 'Недавно',
  'background.empty': 'Skaro сейчас ничего не делает в фоне',
  'background.close': 'Закрыть',
  'background.runs': 'Запусков: {n}',
  'background.job.graph.index': 'Индексирует код проекта {project}',
  'background.done.graph.index': 'Код проекта {project} проиндексирован',
  'background.fail.graph.index': 'Не удалось проиндексировать код проекта {project}',
  'background.about.graph.index':
    'Индекс нужен для графа кода и поиска. Обновляется после изменений в файлах.',
  'background.job.environment.task': 'Удаляет окружение задачи {task} · {project}',
  'background.done.environment.task': 'Окружение задачи {task} удалено · {project}',
  'background.fail.environment.task': 'Не удалось удалить окружение задачи {task} · {project}',
  'background.about.environment.task':
    'Задача завершена: её контейнеры, тома и образы больше не нужны.',
  'background.job.environment.merge': 'Удаляет окружение слияния {merge} · {project}',
  'background.done.environment.merge': 'Окружение слияния {merge} удалено · {project}',
  'background.fail.environment.merge': 'Не удалось удалить окружение слияния {merge} · {project}',
  'background.about.environment.merge':
    'Слияние завершено: его контейнеры, тома и образы больше не нужны.',
  'background.job.merge.retire': 'Удаляет копию завершённого слияния {task} · {project}',
  'background.done.merge.retire': 'Копия завершённого слияния {task} удалена · {project}',
  'background.fail.merge.retire': 'Не удалось удалить копию слияния {task} · {project}',
  'background.about.merge.retire':
    'Рабочая копия и окружение слияния после его завершения не нужны.',
  'background.job.docker.prune': 'Очищает Docker от неиспользуемых данных',
  'background.done.docker.prune': 'Docker очищен от неиспользуемых данных',
  'background.fail.docker.prune': 'Не удалось очистить Docker',
  'background.about.docker.prune':
    'Удаляются тома без контейнеров, образы без тегов и кеш сборки старше суток. Ваши данные не затрагиваются.',
  'background.result.freed': 'освобождено {size} ГБ',
  'background.result.nothing': 'удалять было нечего',
  'background.result.cancelled': 'отменено',
});
addMessages('en', {
  'background.title': 'Background work',
  'background.subtitle': 'What Skaro does by itself, without agents or your commands',
  'background.running': 'Now',
  'background.recent': 'Recently',
  'background.empty': 'Skaro is not doing anything in the background',
  'background.close': 'Close',
  'background.runs': 'Runs: {n}',
  'background.job.graph.index': 'Indexing the code of {project}',
  'background.done.graph.index': 'Code of {project} indexed',
  'background.fail.graph.index': 'Could not index the code of {project}',
  'background.about.graph.index':
    'The index serves the code graph and search. It is refreshed after file changes.',
  'background.job.environment.task': 'Removing the environment of task {task} · {project}',
  'background.done.environment.task': 'Environment of task {task} removed · {project}',
  'background.fail.environment.task': 'Could not remove the environment of task {task} · {project}',
  'background.about.environment.task':
    'The task is finished: its containers, volumes and images are no longer needed.',
  'background.job.environment.merge': 'Removing the environment of merge {merge} · {project}',
  'background.done.environment.merge': 'Environment of merge {merge} removed · {project}',
  'background.fail.environment.merge':
    'Could not remove the environment of merge {merge} · {project}',
  'background.about.environment.merge':
    'The merge is finished: its containers, volumes and images are no longer needed.',
  'background.job.merge.retire': 'Removing the copy of finished merge {task} · {project}',
  'background.done.merge.retire': 'Copy of finished merge {task} removed · {project}',
  'background.fail.merge.retire': 'Could not remove the copy of merge {task} · {project}',
  'background.about.merge.retire':
    'A finished merge no longer needs its working copy and environment.',
  'background.job.docker.prune': 'Cleaning unused Docker data',
  'background.done.docker.prune': 'Unused Docker data cleaned',
  'background.fail.docker.prune': 'Could not clean Docker',
  'background.about.docker.prune':
    'Removes volumes without containers, untagged images and build cache older than a day. Your data is not touched.',
  'background.result.freed': '{size} GB freed',
  'background.result.nothing': 'nothing to remove',
  'background.result.cancelled': 'cancelled',
});
