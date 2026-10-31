# Встроенный агент: фактические проверки

История выполнения [плана](builtin-agent-plan.md). Результаты каждого этапа
относятся к его объёму; они не означают готовность всего встроенного агента.

## Результат BA-4, 31.10.2026

BA-1–BA-3 зафиксированы локальным коммитом `0ab4004`
`:sparkles: feat(agent): add bundled runtime and guarded tools`.
Продолжение BA-4 добавляет [credential vault](builtin-agent-credentials.md),
[коннекторы и внутренние model/tool loops](builtin-agent-models.md).
OpenAI Responses, Anthropic Messages и DeepSeek Chat Completions написаны,
но их живые проверки отложены прямым указанием владельца. Профили pending,
продуктовый model host/task/chat не подключены, UI не менялся.

OpenRouter проверен с настоящим BYOK из DPAPI на gpt-4.1-nano и
claude-haiku-5.5: по три реальных инструмента, streaming, scope denial,
продолжение, restart/replay без новых запросов. Дополнительно прошли
interrupt реального streaming и отказ несовместимого top_p без fallback.
После выделения общего model-step/executor и native loop повторно пройдены
replay настоящих журналов и native deltas; генерации при replay отсутствуют.
Согласованный payload ограничен exact whitelist первых строк двух файлов.

Всего по BA-4 выполнены 11 model requests: шесть в двух успешных цепочках,
три первоначальные неудачные попытки, одна отмена и один известный отказ API.
Четыре неизвестных исхода сохранены, автоматического повтора не было.
Расход двух успешных цепочек — $0.0008513; наблюдаемый прирост usage ключа —
около $0.0011124. Reserved envelope всех попыток — $0.55, общий предел —
$0.80 из разрешённого владельцем $1. Ограничения учёта — в документе моделей.

Прошли 39 targeted-сценариев в девяти файлах: registry, route contracts,
direct request contracts/approved payload, journal/model admission, runtime
processes, file/command tools, DPAPI vault и compiled native worker.
Последний исходный прогон семи файлов дал 34 успеха и один старый assert
со строкой «not implemented»; после уточнения host gate этот assert обновлён
на «no model request was sent», файл процессов прошёл все пять сценариев.
Четыре direct-контракта повторно прошли после общего model-step; четыре
compiled/DPAPI сценария прошли по финальной main-сборке.

Первая попытка проверки DPAPI/importer выявила несовместимость advanced IPC
serialization между разными V8. Закрытый канал переведён на JSON; ключ
не переносится в argv/env/файлы проекта. Проверка project-path сначала
отвергала всё внутри home из-за соседнего пользовательского `.skaro`;
исправлена проверка именно вложенности каталога. Повторные реальные
Electron/DPAPI проверки прошли. Заглушек для исправления окружения не было.

TypeScript runtime/desktop main и изменённые shared/adapters, ESLint,
Prettier, ссылки и `git diff --check` проверены. Изменённые исходники
не превышают 300 строк; product UI-компоненты не добавлялись.
Финальная `pnpm build` прошла для main, native/runtime/command/credential
workers, preload и renderer. Сохранились предупреждения сторонних
Zod/Claude SDK/web-tree-sitter; build errors нет.
Полный suite и browser-проверка UI не выполнялись: UI не менялся.
Результаты прямых API, signed reasoning, images, всех fallback-политик
и macOS/Linux не заявляются. Незакрытая BA-4 приёмка сохранена в плане.

## Результат BA-1, 31.10.2026

Фактические контракты и ограничения описаны в
[builtin-agent-contracts.md](builtin-agent-contracts.md).
Bundled и managed-npm поставки разделены; `skaro` зарегистрирован один раз
как contract-only без runtime, авторизации, загрузки или UI. Внешние агенты,
их ID/выбор и release manifest v1 сохранены. Введены Connection/Model/Route,
исходные API-профили и route capabilities, host-порты и политика credentials,
версии форматов и правила совместимости. Новые SDK не подключались.

Проверено: 24 целевых теста реестра, маршрутов, допуска и manifest v1.
Первые два запуска Vitest с fork workers завершились ENOENT временного кеша
при загрузке модулей; те же четыре файла прошли с `--pool=threads`.
Типы timeline, agents, core, обоих адаптеров, MCP и desktop main проверены.
Штатная `pnpm build` прошла для main, preload и renderer. ESLint изменённого
кода и `git diff --check` прошли; новые/изменённые исходники меньше 300 строк.
Сборка сообщила предупреждения сторонних Claude SDK и web-tree-sitter.
Полный suite не запускался; mocks/fixtures/seed/временные серверы не создавались.

Через настоящий `AgentInstaller` и фабрику реестра проверены установленные
Claude Code 0.3.285 и Codex 0.159.2: оба подтвердили installed/authenticated.
Codex в sandbox сначала завершился из-за доступа к SQLite; та же проверка
вне sandbox прошла. Генерация и изменения проекта агентами не запускались.

Незакрытая живая приёмка BA-1: повторная установка и интерактивный вход
Claude Code/Codex не выполнялись. Проверка текущего статуса, прежних
pins/платформенных пакетов и manifest не заменяет проверку загрузки/входа.
Работающий bundled runtime, OS credential vault/ротация и запросы к четырём API
не заявляются: в BA-1 определены их контракты, исполнение — следующие этапы.
UI не менялся, browser-проверка не проводилась.

## Результат BA-2, 31.10.2026

Созданы настоящие пакеты runtime и адаптера; единственная регистрация `skaro`
переведена в `runtime-core`, без включения в продуктовый каталог.
Реализованы отдельный процесс через native worker, ownership gate и отмена
startup, сохраняемое закрытие и проверка выхода, JSONL-журнал и производный
checkpoint, восстановление состояния и ленты, дедупликация команд, ответы,
смена настроенного маршрута/прав и conversation rewind. Подробности и точные
границы — [builtin-agent-runtime.md](builtin-agent-runtime.md).

Коннекторы, инструменты и context compact отсутствуют: их вызовы дают явные
ошибки. Цикл модели и фактическая отмена запроса/инструмента не проверены.
Поведение с interaction/effect facts проверяется как контракт журнала,
а не как исполнение инструментов или вопросы настоящей модели.

В ходе проверки обнаружены запрет sandbox на `taskkill` и отдельный дефект
Windows: append-дескриптор не поддерживает truncate оборванного хвоста.
Дефект исправлен. Итог: 35 целевых тестов в семи файлах прошли, без skipped.
28 тестов журнала, реестра, маршрутов, допуска и manifest выполнены с
`--pool=threads`; семь OS-сценариев отдельного процесса и собранного native
worker — вне sandbox. Проверены конкурентный запуск двух runtime, gate
допуска/отказа, отмена startup, shutdown, OS kill/recovery и совпадение live/replay.
Неизвестный исход intent и ответы проверены на уровне контракта журнала.
TypeScript runtime, adapter-skaro, agents и desktop main, ESLint, Prettier,
ссылки документации и `git diff --check` прошли. В изменённых исходниках нет
файлов больше 300 строк. Итоговая штатная `pnpm build` прошла для main,
runtime worker, native worker, preload и renderer; сохранены предупреждения
сторонних Claude SDK/web-tree-sitter. Полный suite не запускался; UI, авторизация и API
моделей не затрагивались.

Остаток приёмки BA-2: отмена настоящего API-запроса, инструмента и модельного
вопроса, фактический provider continuation, продолжение после compact/rewind,
дерево рабочих процессов BA-3, task/chat recovery и остальные OS/arch.
BA-2 целиком закрытым не объявляется.

## Результат BA-3, 31.10.2026

Реализован [слой инструментов](builtin-agent-tools.md): схемы, scoped file
operations, optimistic context patch, очередность чтений/записей, approvals,
вопросы/планы и guarded image reference. Команды Windows выполняются через
настоящий Job Object; stdin, EOF, timeout, background, stop и сохранённый
страничный вывод проходят реальный runtime и native worker.

Filesystem/network sandbox не реализован. По D-28 в auto команды всегда
требуют allow_once; реальный probe подтвердил возможность доступа утверждённой
команды за cwd внутри собственного тестового каталога. Read-only и файловые
scope-проверки сохраняются; Job Object не выдан за security sandbox.

Журнал повышен до schema 2, без изменения release manifest v1. Старый schema 1
отклоняется до явной миграции. Runtime и журнал закрываются single-flight;
проигравшие таймеры process yield отменяются. После OS kill вывод сохранён,
исход бывшей команды неизвестен, эффект не запускается повторно.

В ходе разработки найдена и исправлена неправильная передача строки cmd;
общий checkCommand сохранён единым для core/runtime. Первичная проверка
stdin/вывода падала и после ожидания flush в тестовой команде — причина была
в invocation, а не подставном ответе. В одном прогоне отмечен Runtime exit
not confirmed; изолированный сценарий прошёл. Исправлены конкурирующее dispose
и оставшийся таймер; прямая причина того единичного сбоя отдельно не доказана.
Ожидание готовности вывода в crash-сценарии заменено с предположения о yieldMs
на проверку фактического появления marker до OS kill.

Итоговые 47 целевых тестов в десяти файлах прошли с `--pool=threads --maxWorkers=2`:
45 сценариев в девяти файлах и два compiled-native сценария после сборки.
BA-3 files/commands, затронутые BA-1/BA-2 и существующий check-shell. Сборка
`pnpm build` прошла для main, runtime/native/command workers, preload и renderer.
TypeScript desktop main/runtime/adapter-skaro/core, ESLint и проверки структуры
пройдены. Compiled-native проверяет новый invokeTool read_file и structured
result через настоящий worker, а также прежний gate допуска/отказа и live/replay.
Prettier, ссылки, `git diff --check` и лимиты размера исходников проверены.
Сборка содержит предупреждения сторонних Zod/Claude SDK/web-tree-sitter.
Полный suite не запускался; browser-проверка UI не выполнялась.

Не закрыты: Linux/macOS managed command backend; проверенный OS security
sandbox; положительная проверка изображения с настоящим модельным маршрутом;
вызовы инструментов моделью и отмена настоящего API-запроса; продуктовый
workflow/UI. В BA-3 закрыты проверки настоящего tool/question cancellation
и обычного дерева процессов Windows, ранее отложенные в BA-2.
Авторизация, модельные API, mock servers, fake backend и seed-данные не использовались.
