# Внутренний handoff builtin ↔ managed

Дата: 02.11.2026. Код BA-7; положительная приёмка настоящей задачи открыта.

`TaskRuns.handoffBuiltin` принимает явный route/effort, права и isolation для
существующего настоящего run. Обратный переход к Claude Code/Codex использует
прежний `setSettings`. Product AgentId/picker этим не расширяется.

TaskRunHandoff проверяет актуальный run и неизменность isolation, готовность
managed target либо точный сохранённый builtin route и каталог. Проверка
повторяется после остановки прежней сессии и чтения истории, до публикации.
Смена агента не запускается поверх рабочего хода, attachment или занятого
слота; восстановление уже сохранённого intent из его очереди выделено явно.

Прежний stopForHandoff отзывает native admission/credential lease, останавливает
принадлежащие run процессы и требует подтверждённого выхода. Ошибка остановки
не разрешает новый writer. Новый run сохраняет прежние checkout/branch,
previousRunId и существующий handoff context. Native session ID, браузер,
старые разрешения и model/tool grants новому процессу не наследуются.

Публикация successor, его настроек, execution intent и pending owner input
выполняется одной SQLite-транзакцией `continueRun`. Дополнительные записи
состояния синхронны и используют то же соединение. Для builtin настройки
пишутся по новому run ID; прежние managed preferences не заменяются builtin
выбором. Model host готовится отдельно при attachment и требует новых grants.

Входы собираются из durable TaskStartup и ещё ожидающей очереди. Одинаковый
command ID с прежним содержимым не дублируется; конфликтующий текст даёт отказ.
Successor получает новую startup-попытку с собственным выбором агента.
Recovery завершает сохранённый handoff до возобновления входа, поэтому pending
выбор прежнего агента не применяется к новой сессии.

Сохраняются enabled/stop, blocker, fingerprint и счётчик отсутствия прогресса.
Прежний terminal turn ID не переносится в механизм dedup нового агента.
Наследование не перезаписывает уже существующий execution intent successor.
Незавершённые вопросы и решения остаются в прежней истории и handoff context;
live permissions истекают по прежним правилам continuationTimeline.

## Проверки и ограничения

- 4 файла, 11 целевых тестов прошли: ordered/deduplicated inputs, конфликт
  command ID, настоящие SQLite settings execution/startup, сохранение стопа,
  blocker/stall bound, имена из реестра и task session policy.
- TypeScript main, lint, форматирование и production build прошли.
  Изменённые файлы не превышают 300 строк.
- Тесты не создают проекты/задачи/run, не используют fake agent/backend или
  ответы модели. Сам положительный transactional handoff настоящего run,
  process/permission expiry, Electron feed и продолжение после рестарта
  этими проверками не приняты.
- Живая проверка допускается только на Cat-pilot. Дополнительных model POST
  не было. Продуктовый picker, полная сдача/merge и BA-7 остаются открытыми.
