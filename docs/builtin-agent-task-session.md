# Встроенная сессия в task lifecycle

Дата: 02.11.2026. Реализована внутренняя ветка attachment существующего
`RunRecord.agent=skaro` в `TaskRunSessions`. Это ещё не включение агента
в product picker, создание новой builtin-задачи или положительная приёмка BA-7.

## Подключение

`createServices` принимает main-only `builtinTasks` authorization port.
При его наличии task controller получает `BuiltinTaskModels`: общий configured
model host, хранилище ключей, актуальный каталог и настоящие scoped MCP handlers.
Отсутствие port даёт явный отказ до process admission; сохранённое подключение
или маршрут не становятся разрешением отправлять контекст и расходовать бюджет.
IPC для передачи этого port не добавлен, обычный startup его не устанавливает.

Authorization port обязан предоставить конкретные context/tool policies,
цену, предел шагов и gates резервирования/отправки каждого запроса. Фабрика
не подставляет permissive policy. Поддержано форматирование owner input
для Chat Completions и [native owner input OpenAI/Anthropic](builtin-agent-native-context-input.md).
Живые проверки прямых API отложены владельцем; metadata gate пока доступен
только для OpenRouter и не обходится новым formatter.

Общие task/handoff instructions, environment description и history sinks
вынесены в `task-session-options.ts`; managed Claude/Codex используют их же.
Native Skaro получает существующие acceptance/C4/completion gates и разрешённые
операции штатного MCP через process admission. Отдельного scheduler или
completion implementation нет. Browser extensions и передача environment
variables встроенному command executor ещё требуют продуктовой интеграции.

## Границы запуска и остановки

- Подготовленный runtime обязан сохранить точные project/task/run, native ID,
  journal/artifact paths, cwd, permission mode, выбранные model/effort и полный
  task/handoff prompt как host constraint. Чтение дополнительных каталогов
  не расширяется; plan-first/read-only не превращается в writable scope.
- Допуск создаётся только для настоящего текущего ActiveRun и saved RunRecord.
  После asynchronous preparation проверка повторяется до записи native ID.
  Recovery предыдущего process lease разрешён только после смерти его host;
  живой host не вытесняется.
- Native ID сохраняется до spawn, чтобы crash до первого события не терял
  связь с журналом. Синхронный spawn gate записывает настоящий OS owner и
  в task registry, и в native admission до допуска runtime к работе.
- Detach, handoff и shutdown отменяют незавершённую подготовку. Поздняя сессия
  не публикуется после закрытия/смены/удаления задачи. Credential/route leases
  отзываются вместе с process admission; owned process exit подтверждается.
- Durable command ID проходит из task/chat delivery через native worker
  до обычных send/steer. Повтор того же input/mode читает прежнюю запись;
  другой input с тем же ID отклоняется. Managed adapters могут игнорировать
  новый необязательный аргумент.
- Перед новым owner turn runtime сохраняет свежий scoped context без ручного
  compact. Refresh сохраняет compact epoch; отмена не признаётся принятым input.
  Mid-turn steering и существующие context freshness gates сохраняются.

## Проверки и остаток приёмки

Целевые проверки используют реальные дочерние процессы/native worker,
реальные журналы и инструкции репозитория. Отдельные pure DTO-проверки
отвергают подмену scope, paths, доступа, prompt, model и effort. Замены
provider/backend, fabricated ActiveRun и project seed не используются.

Сборка `pnpm build`, main TypeScript и lint изменённых файлов прошли.
Целевой прогон пяти файлов: 16 тестов прошли, включая настоящий compiled
native worker и повтор доставки после реального перезапуска дочернего процесса.
NO GOD: изменённые файлы меньше 300 строк; UI не менялся.

Положительный запуск настоящей builtin-задачи, очередь/handoff между агентами,
исправление, submit_result и merge ещё не приняты. Создание/выбор нового run
и task settings/default resolution пока остаются managed path; picker выключен.
Новый internal attachment не считается приёмкой этих сценариев.

На Cat-pilot T-008 сейчас `todo` и зависит от T-006, которая также `todo`;
T-005 завершена. Эти ограничения не обходились, task/C4/RunRecords не менялись.
Установленный пользовательский Skaro продолжает работать; второй services host
поверх его single-instance lock не запускался, приложение не закрывалось.

Дополнительные пять ранее разрешённых model POST уже израсходованы. В этой
работе новых запросов к моделям нет; прежний ledger остаётся 85 intents и
`$0.39324124` расходов/удержаний. Следующая живая приёмка требует конкретного
нового разрешения на task context, tools и число запросов в общем лимите `$1`.
