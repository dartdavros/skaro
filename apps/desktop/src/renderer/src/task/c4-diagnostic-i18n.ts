import { addMessages } from '@skaro/ui';

addMessages('ru', {
  'c4.diagnostic.title': 'Требуется исправление C4-пакета.',
  'c4.diagnostic.invalid_data': 'Агенту нужно исправить указанные данные C4 и повторить проверку.',
  'c4.diagnostic.planned_parent':
    'Проверьте реализованность родителей. Публиковать дочерний элемент можно только внутри текущего родителя.',
  'c4.diagnostic.planned_view_member':
    'Представление с планируемыми элементами должно оставаться planned. Узкое представление реализованной части станет current при публикации.',
  'c4.diagnostic.missing_current_view':
    'Нужно отдельное planned-представление реализованной части. Skaro переведёт его в current при публикации; будущая часть останется planned.',
  'c4.diagnostic.code_path_not_file':
    'В привязке кода нужны конкретные файлы проекта вместо каталога.',
  'c4.diagnostic.missing_code_path':
    'Агенту нужно проверить отсутствующий файл и исправить привязку кода.',
  'c4.diagnostic.pending_package':
    'Завершите решение по ожидающему архитектурному пакету, затем агент повторит проверку.',
  'c4.diagnostic.stale_review':
    'Код или архитектура изменились. Агенту нужно заново прочитать контекст и выполнить C4-ревью.',
  'c4.diagnostic.review_required': 'Перед сдачей агенту нужно выполнить C4-ревью реализации.',
  'c4.diagnostic.more': 'Ещё причин: {n}.',
  'c4.diagnostic.continue': 'Продолжить',
  'c4.diagnostic.message':
    'Продолжи задачу с сохранённого результата. Прочитай get_c4_context и task.diagnostic, исправь причины отказа C4 по issue.nextStep, получи подтверждение необходимого архитектурного пакета и повтори review_c4 перед сдачей. Сохрани ограничения задачи и проверенную реализацию. Не обходи валидацию и не объявляй отказ данных сбоем Skaro без воспроизведения на корректном кандидате.',
});
addMessages('en', {
  'c4.diagnostic.title': 'The C4 package needs correction.',
  'c4.diagnostic.invalid_data':
    'The agent needs to correct the reported C4 data and repeat the review.',
  'c4.diagnostic.planned_parent':
    'Verify the parent implementation. A child can only be published inside a current parent.',
  'c4.diagnostic.planned_view_member':
    'Views containing planned members must stay planned. A narrow view of the implemented subset becomes current at publication.',
  'c4.diagnostic.missing_current_view':
    'A separate planned view of the implemented subset is needed. Skaro promotes it at publication; future work stays planned.',
  'c4.diagnostic.code_path_not_file':
    'The code binding needs concrete project files instead of a directory.',
  'c4.diagnostic.missing_code_path':
    'The agent needs to inspect the missing file and correct the code binding.',
  'c4.diagnostic.pending_package':
    'Resolve the pending architecture package, then the agent can repeat the review.',
  'c4.diagnostic.stale_review':
    'Code or architecture changed. The agent needs to read context and review C4 again.',
  'c4.diagnostic.review_required':
    'The agent needs to review the implementation against C4 before submitting.',
  'c4.diagnostic.more': '{n} more reasons.',
  'c4.diagnostic.continue': 'Continue',
  'c4.diagnostic.message':
    'Continue the task from its saved result. Read get_c4_context and task.diagnostic, follow each issue.nextStep, obtain approval for any required architecture package and repeat review_c4 before submitting. Preserve the task restrictions and verified implementation. Do not bypass validation or claim a Skaro defect without reproducing it on a valid candidate.',
});
