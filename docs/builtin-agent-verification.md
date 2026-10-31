# Встроенный агент: фактические проверки

История выполнения [плана](builtin-agent-plan.md). Результаты каждого этапа
относятся к его объёму; они не означают готовность всего встроенного агента.

## Начало BA-6, 31.10.2026

Browser evidence добавлено в общую схему check_evidence: source/revision/args hash,
inputs/environment до и после, приватный JSON output и PNG hashes. Missing image
делает artifactsCurrent=false; последующий MCP-вызов — latestObservation=false.
Observation остаётся данными, а не автоматическим verdict о критериях.

По указанию владельца текущие живые проверки перенесены на Cat-pilot; правило
добавлено в AGENTS.md. Browser driver принимает только путь зарегистрированного
Cat-pilot и открывает настоящий index.html через file://. Proof:
verification/extensions-2ab7ee93-940e-4dda-b069-93c6d4f2515a/proof.json (userData).
PNG просмотрен, console 0 errors/0 warnings, сетевых ресурсов страницы 0.
Штатный Cat-pilot scene-animation check прошёл: 10 анимаций, 18 отсчётов,
CSS pause/reduced-motion. Ни HTTP-сервера, ни seed/fixtures, ни правок Cat-pilot.
После всех probes повторный capture подтвердил неизменность 26 полных
tracked/dirty/untracked входов Cat-pilot. HTTP/internal handlers также проверены
на Cat-pilot, proof: verification/extensions-3482f4b9-bd1c-42c6-8763-a0cb59fc2872/proof.json.
Штатная сборка, TypeScript desktop, ESLint/Prettier и четыре целевых regression
в builtin-checks/MCP/native-worker прошли. Исходники меньше 300 строк,
renderer/UI не менялись. Полная приёмка BA-6, внешние зависимости и
completion/C4 gates остаются открытыми; model requests этого прогона — 0.
Ранний прогон этого блока на Chatballs относится к истории до указания владельца,
не заменяет приёмку Cat-pilot; новых прогонов Chatballs после указания нет.

Продолжение после `70abc14`: измеряемое host окружение фиксируется до/после
команды и повторно проверяется по OS/runtime/executable hash и очищенному env.
Изменение LANG в изолированном процессе теста дало environmentCurrent=false
при inputsCurrent/outputCurrent=true; значение восстановлено. Секретные значения
env не сохраняются. Неизвестные toolchain/dependencies/services остаются открытыми.
Git metadata также использует очищенный env с отключённым fsmonitor hook;
cwd проверки ограничен основным project scope.

Диагноз хранится как гипотеза модели с категорией и ссылкой на реальный отказ.
Retry требует диагноза и сохраняет command/cwd/shell/timeout/имя/criterion IDs.
Реальный git diff --no-index сравнил два разных scoped AGENTS.md и вернул exit 1;
повтор без диагноза, замена команды и увеличение timeout отклонены до процесса.
Разрешённый повтор также сохранил отказ. Никакого planted дефекта/fixture нет;
это проверка истории неуспеха, не приёмка исправления значимого дефекта BA-6.
Целевой builtin-checks и два compiled native-worker сценария прошли.
Штатная сборка main/workers/preload/renderer, TypeScript desktop/runtime,
ESLint, Prettier и diff check прошли. Изменённые исходники меньше 300 строк;
полный suite не запускался, модельные API не вызывались.

Добавлены run_check/check_evidence поверх существующего executor и approval.
Реальная команда git diff --check на настоящем checkout сохранила fingerprints
HEAD/index/tracked/dirty/untracked inputs и hash приватного output. Проверены
allow_once, read-only отказ до intent, dedup без нового процесса, process paging,
отказ поддельной sequence/hash ссылке и утрата подтверждения удалённого output.
Шесть целевых сценариев в builtin-checks/context/native-worker прошли без
fixtures и fake API; проверка нового command evidence выполнена повторно
после добавления read-only отказа и чтения output через process paging.
Штатная сборка main/workers/preload/renderer, TypeScript runtime/desktop main,
lint и форматирование прошли; полный suite
не запускался. UI и продуктовый submit_result не менялись.

Это первый проверенный блок, не закрытая BA-6. Открыты среда/зависимости,
browser evidence, цикл исправлений и completion/C4 gates. Неизвестные зависимости
не считаются безопасными; exit code 0 не включает автоматическую приёмку.
Контракт и ограничения — [builtin-agent-checks.md](builtin-agent-checks.md).

## Продолжение BA-5, 31.10.2026

### Закрытие BA-5

BA-5 принят в текущем поддерживаемом Windows-контуре. Закрыты HTTP MCP и
внутренний port на настоящих службах/handlers зарегистрированного Skaro,
границы четырёх API-профилей, блокирование route change открытым вопросом,
точный ответ после compact/restart и обновление system frame нового поручения
на настоящей сохранённой модельной сессии. Проектные scopes, schema, allow_once
до intent, dedup и отказ от replay отозванного HTTP grant проверены фактически.

Настоящий browser/media прогон выполнен на существующем Chatballs T-171:
readiness 200 с PostgreSQL/Redis, navigation, PNG screenshot 119 790 bytes,
console 0 errors/0 warnings, private artifact SHA256, отсутствие base64 в
journal и подтверждённый выход MCP процесса. Screenshot просмотрен: форма
входа настоящего приложения. Учётные записи/seed не менялись, model requests — 0.
Исправлен необходимый для Chrome OS env allowlist в MCP, без model credentials.
Connection refused, два timeout и отказ schema до screenshot intent сохранены;
приёмка не ослаблена. [Точная таблица и proof IDs](builtin-agent-ba5-acceptance.md).

Ниже сохранена история промежуточных прогонов; их незакрытые пункты отражают
состояние на тот момент. BA-4 direct live отложен владельцем, BA-7 task/chat,
BA-8 UI и BA-9 платформенная приёмка не объявляются выполненными.

BA-4 зафиксирован коммитом `fcd8685`. Реализованы scoped context и ревизии,
локальный compact с сохранением primary journal/точных решений, paged documents
и публичная история без закрытого native state. Добавлены host-selected skills,
MCP SDK stdio/HTTP, ограниченный каталог/JSON schema validation и интеграция
extension tools с существующим coordinator/approvals/effects. Внутренний
Skaro operation port связывает прежние handlers, scope и admission checks;
продуктовый task/chat host не подменялся.
Полный объём и ограничения — в [BA-5](builtin-agent-context.md).

Три context-сценария проверили реальные AGENTS.md/план/ADR, stale source revision,
вопрос/ответ, compact/restart и dedup. Настоящий taskBrowserServer/Playwright MCP
прошёл browser_tabs list, ограничение каталога, invalid args, allow_once,
dedup и подтверждение выхода владельца PID/birth. Это не навигация по приложению.
Настоящий SKILL.md openai-docs прочитан новым inspector: name/description/revision
получены, содержимое профиля не копировалось в тестовые fixtures.

Публичная проекция проверена на шести настоящих OpenRouter responses BA-4:
raw native/reasoning/signatures в model-readable history отсутствуют.
Модельные запросы для этой проверки не выполнялись; расход BA-4 не увеличен.
Первый regression-прогон пяти файлов дал 17 успехов и один timeout5s в model
admission/lifecycle тесте на фоне сборки. Изолированный повтор без изменений
кода/ожиданий прошёл. Точная причина того timeout отдельно не доказана;
проверка не ослаблялась и лимит теста не менялся.
После финальной сборки ещё семь process/compiled-native сценариев в двух
файлах прошли. Всего затронуты 25 сценариев в семи файлах; каждый имеет
успешный результат с учётом указанного изолированного повтора.

Сборка BA-5 прошла main, runtime/native/command/credential workers, preload и
renderer. TypeScript runtime/timeline/MCP/desktop main и adapter-skaro,
ESLint/Prettier изменённого кода прошли. Исходники меньше 300 строк;
UI-компоненты не менялись. Предупреждения Zod/Claude SDK/web-tree-sitter
остались сторонними. Полный suite и UI browser-приёмка не запускались.

Незакрыты: все native/route
продолжения, HTTP MCP на настоящем продукте, browser/media workflow задачи,
macOS/Linux stdio и host RPC. Владелец отдельно разрешил расширенный context
payload: scoped AGENTS.md, точное решение о direct live и несекретные ссылки
истории. Сценарий `verify-openrouter.mjs REFERENCE REVISION --context` прошёл
настоящие два model requests до compact и после compact/restart. Сохранены
решение владельца, epoch = 1 и все исходные records; старый selection отклонён,
закрытый native state не передан. Стоимость двух receipts — $0.00033132.
Повторный запуск получил сохранённый proof без новых model requests:
общий счётчик остался 13, резерв — $0.65. Usage ключа обновился до наблюдаемого
прироста $0.00144372 с начала BA-4/BA-5; предел владельца — $1.
Режим `--prepare-context` ранее скомпилировал entry без запуска credentials/API.
Проверка двух ходов не закрывает критерий длительной модельной сессии.

### Длительная сессия: закрытый критерий

Продолжение зафиксировано после BA-5 commit `d65cca6`. Настоящий OpenRouter
gpt-4.1-nano выполнил 39 запросов: 32 хода до первого compact, восстановление,
четыре продолжения и две попытки второго восстановления. Порог >=24 ходов /
>=32 768 input tokens достигнут; пик 33 231. После compact вход сократился
до 7 611 tokens, messages — с 207 811 до 32 682 bytes. Два compact и три
перезапуска Electron host подтверждены журналом и разными PID/birth.

Две последние рабочие заметки и решение владельца восстановлены точно.
Первый ответ второго восстановления указал более раннюю заметку; отказ
сохранён вместе со стоимостью. Добавлена явная ссылка workingNoteHead;
исправленная проверка получила новый ID. Старые записи не редактировались.
Повтор после restart не добавил model requests или effects. Стоимость всех
39 receipts — $0.03329344. Proof: `proof:long-context` в настоящем userData,
`verification/openrouter-ba4/session-long.jsonl`, не в Git.

Продолжение своего route/revision/epoch сохраняет native messages; compact
создаёт fresh conversation без закрытых assistant/tool items. Рабочие заметки
остаются данными модели с точным источником, не решением владельца.
Бюджет теперь учитывает receipts и сохранённые резервы неизвестных исходов,
не сбрасывая старые попытки; предел $0.95 плюс $0.05 запаса в рамках общего $1.
Это проверка длинного контекста Windows/OpenRouter, не многосуточный soak
и не закрытие всех маршрутов, MCP или продуктового UI. Подробности —
[BA-5](builtin-agent-context.md#длительная-сессия-после-compact-критерий-закрыт).

Финальная штатная сборка прошла main/workers, preload и renderer. Целевые
context/journal/direct-contract проверки — 13 успешных тестов; после уточнения
workingNoteHead повторены context и compiled native worker — ещё пять успехов
(три context повторяются, итого 15 разных сценариев в четырёх файлах).
TypeScript runtime/desktop main, ESLint, Prettier и `git diff --check` прошли.
Изменённые исходники меньше 300 строк; UI не менялся, полный suite не запускался.

Read-only проверка всех сохранённых журналов подтвердила SHA256-цепочки:
52 model intents, 47 USD receipts суммарно $0.03447606 и $0.25 сохранённого
резерва пяти запросов без подтверждённой USD receipt; durable total $0.28447606.
Повторное чтение `/key` дважды остановилось на credential-stage, до model POST;
причина не установлена. Свежий account usage не подтверждён: стоимость длинного
сценария выше взята из сохранённых receipts, не из предположения о балансе ключа.

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
