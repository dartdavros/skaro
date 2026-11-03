# BA-5: контекст, compact и расширения

Дата: 31.10.2026. BA-5 принят в поддерживаемом контуре Windows.
Критерии и границы — [итоговая приёмка](builtin-agent-ba5-acceptance.md).
BA-4 зафиксирован коммитом `fcd8685`
`:sparkles: feat(agent): add BYOK vault and native model connectors`.
Контекст и расширения добавлены во внутренний runtime; продуктовый host/RPC,
task/chat и настройки по-прежнему требуют последующих этапов. UI не менялся.

## Источники и полномочия

Host задаёт scopePath внутри cwd, явный каталог task/ADR/C4/docs/skills и
pins цели, ограничений, решений, открытых вопросов, доказательств и заметок.
Модель не получает операции записи host pins. Каждый pin содержит origin
host/owner и revision. Note остаётся рабочей заметкой, не решением владельца.

Применимые AGENTS.md собираются от корня до scopePath в порядке вложенности.
Их текст сохраняется точно; расширять им host permissions запрещено.
Остальные документы остаются данными с full-byte SHA256, размером и числом
строк. `context_read` читает страницы по ID; изменение/удаление источника
требует refresh. Проверка актуальности повторяется перед каждым model request.
PathScope и private-path policy едины с файловыми инструментами: symlinks,
выход за область, `.git` и чтение runtime-журнала через read_file запрещены.

`refreshContext` — host lifecycle command; модель не меняет scope/каталог
аргументами инструмента. Источники и scope при resume должны совпадать с
сохранённой host-конфигурацией. Изменение файлов обновляет их ревизии;
перепривязка host pins к другой конфигурации не выполняется молча.

`SKILL.md` выбирается host по реальному пути в read scope. Метаданные читаются
полноценным YAML parser без aliases, сохраняются name/description/revision.
Тело загружается страницами только при необходимости. Автоматического сканирования
профилей, исполнения scripts или превращения skill text в разрешение нет.
Вручную проверен настоящий установленный openai-docs SKILL.md, без копии/fixture.

## Локальный compact

Compact здесь — детерминированная рабочая проекция с новой epoch, без модельного
summary. Сохраняются точные host pins, применимые инструкции, активные
пользовательские сообщения и пары вопрос/ответ. Rewind исключает отменённые
реплики из активного контекста; исторические записи остаются доказательствами.
Старое allow_once относится только к своему call ID, а не к новым действиям.

Объёмные результаты заменяются ссылками; недавний индекс содержит до 64
records и точную границу полного журнала. Большие tool results сохраняются
полностью в primary journal, модель получает ссылку на страницу, а не
выдуманный summary или успешный verdict. Если точные обязательные ограничения
сами превышают лимит, runtime явно отказывает вместо их обрезания.

Полный журнал, effect IDs, ответы и provider state не удаляются. Новый
checkpoint хранится как версионированный result существующей journal record;
wire schema 2 не меняется. Checkpoint выбирается только по hash host-команды
compact/refreshContext: похожий JSON из tool result не становится host context.

Compact разрешён на безопасной границе без активного model turn, открытых
interactions и unresolved effects. Он записывает context-boundary в текущую
continuation. Новая беседа собирается из fresh user input и общей проекции;
closed native items не редактируются и не приклеиваются к новой epoch.
Старый selection после compact отклоняется. Route change по-прежнему сбрасывает
continuation; общие факты/ограничения сохраняются отдельно.

`context_history` выдаёт публичную проекцию по sequence/hash и cursor, не raw
provider log. Continuation/created state, private reasoning, signatures,
encrypted items и raw native deltas исключены. Это предотвращает передачу
закрытого native state другому маршруту через обычный результат инструмента.
Исходный provider state остаётся в журнале для внутреннего replay своего API.

## MCP и продуктовые handlers

Используется официальный MCP SDK 1.30.1, уже присутствовавший в lockfile;
он добавлен прямой зависимостью runtime. YAML 2.9.1 также взят из существующего
lockfile. Установка — offline/frozen/ignore-scripts. Попытка lockfile-only
сначала потребовала отсутствующие offline metadata для @types/node; вместо
обновления дерева importer привязан к уже существующим snapshots.

Клиент реализован по [MCP TypeScript SDK v1](https://ts.sdk.modelcontextprotocol.io/client).
Поддержаны stdio и Streamable HTTP без fallback на другой transport/endpoint,
автоматического OAuth, sampling или elicitation. HTTP — HTTPS либо numeric
loopback, без userinfo/query/fragment; redirects и reconnect запрещены.
Ответы ограничены по размеру. Auth headers/env остаются в host closure,
не в persisted policy/журнале. Echo известных MCP credentials отклоняется.

Host задаёт ограниченный allowlist: name, readOnly. Схемы проверяются AJV;
изменение description/schema/policy меняет revision. Remote annotations
не дают read-only статус и не расширяют каталог. Config и host definitions
должны совпадать при открытии runtime. Произвольные MCP tools невидимы.

Расширения используют тот же coordinator, RW-очередь, approvals, intent/result,
stable call IDs, отмену и unknown outcomes, что встроенные инструменты.
В ask/auto MCP write требует allow_once с точными args; read-only scope
отвергает mutating extension. Сигнал/ошибка после отправки не доказывают
отсутствие удалённого эффекта: исход остаётся unknown, повтор запрещён.
После закрытия extension host нужен новый допущенный host scope; автоматический
reconnect после interrupt не заявляется.

Stdio получает чистое окружение без model credentials/Node injection variables.
Перед initialize/tools host записывает PID/birth и допускает процесс;
close останавливает проверенное дерево до закрытия stdin. Проверена Windows.
На остальных OS stdio явно недоступен до проверки process-tree backend.
Это владение процессом, не filesystem/network sandbox и не гарантия против
произвольных внешних brokers, запущенных чужим MCP server.

`scopedOperationPort` в mcp-server и `bindSkaroOperations` вызывают существующие
handlers с неизменным bound SkaroScope, availability/schema и admission checks.
Нового completion/merge/C4 workflow нет. Host RPC, подключение этого порта
в продуктовые task/chat относятся к BA-7. Настоящий app server и его внутренний
port проверены через `McpHttpServer.operations` на одном каталоге и handlers.

## Фактическая проверка и остаток

Локальные context-тесты используют настоящие AGENTS.md, план и ADR репозитория,
реальный RuntimeJournal и настоящий runtime question/answer: scoped selection,
paging, stale revision, compact без удаления записей, restart, dedup и точный
вопрос/ответ. Сетевых ответов и подготовленных журналов вместо runtime нет.

Штатный `taskBrowserServer` запускает настоящий установленный Playwright MCP
0.0.83 с isolated/headless browser. Проверены allowlist, invalid args,
ожидание allow_once до effect intent, реальный browser_tabs list, dedup и
подтверждённый выход процесса. Последующая приёмка проверила navigation,
readiness и screenshot настоящего Chatballs T-171; результаты приведены
в итоговой таблице. Это не browser-приёмка продуктового интерфейса Skaro.

Публичная история дополнительно проверена на шести настоящих BA-4 model
responses: 74 981 символ исходных records → 11 347 символ публичных записей,
private native fields — 0. Новых запросов модели эта проверка не выполняла.

Границы маршрутов, HTTP MCP на настоящих handlers и task browser/media приняты
в итоговом прогоне. Native compaction опциональна; direct API остаются BA-4,
task/chat host lifecycle — BA-7. macOS/Linux stdio явно недоступны до проверки
process-tree backend. Разрешённые OpenRouter payload/budget не расширяются
самим включением context; непроверенные случаи не объявляются готовыми.

Подготовленный live entry:

```powershell
node apps/desktop/scripts/verify-openrouter.mjs CREDENTIAL_REFERENCE_ID REVISION --context
```

Владелец отдельно разрешил полные scoped AGENTS.md, точное решение о direct live
и несекретные ссылки истории. Иные файлы в сценарий не включены, tools модели
не передавались. Два настоящих запроса gpt-4.1-nano — до compact и после
compact/restart — прошли; точное решение владельца сохранено, epoch = 1.
Старый context selection отклонён, исходные records остались неизменны,
closed native state в новые messages не передан. Стоимость по request receipts:
$0.00033132. Это проверка двух ходов, не приёмка длительной сессии.
Повторный запуск использовал сохранённый proof без новых model requests.
Всего за BA-4/BA-5 — 13 запросов и $0.65 reserved envelope; наблюдаемый прирост
usage ключа с начала приёмки — $0.00144372 из разрешённого $1.
`--prepare-context` только собирает entry и не обращается к credential host/сети.

## Длительная сессия после compact: критерий закрыт

Проверка 31.10.2026 выполнена на Windows через настоящий OpenRouter,
`openai/gpt-4.1-nano`, с ранее разрешёнными scoped AGENTS.md и решением владельца.
История выросла из реальных последовательных ответов модели: без подготовленных
диалогов, seed-данных, заглушек и искусственного заполнения контекста.
Порог сценария — минимум 24 хода и 32 768 фактических input tokens — достигнут
на 32-м ходе. Это ограниченная проверка длинного контекста, не многосуточный soak.

| Доказательство | Результат |
| --- | --- |
| Настоящие model requests, включая неуспешную смысловую проверку | 39 |
| Максимальный input по provider usage | 33 231 tokens |
| Compact / подтверждённые перезапуски host по PID/birth | 2 / 3 |
| Input после первого compact | 7 611 tokens, снижение 77,1% |
| Размер messages до / после первого compact | 207 811 / 32 682 bytes |
| Восстановление точных рабочих заметок / решения владельца | 2 / сохранено |
| Новые запросы при restart replay | 0 |
| Стоимость всех receipts этого сценария | $0.03329344 |

До compact сохраняется native chat continuation только своего route, revision
и epoch. После compact начинается fresh conversation без старых assistant/tool
items. Последние четыре рабочих заметки — точные ограниченные фрагменты публичных
ответов с sequence/hash/id; это данные модели, не полномочия или доказанные факты.
`workingNoteHead` явно обозначает источник последней заметки.

Первая попытка второго восстановления выбрала более раннюю заметку и была
отклонена проверкой точного совпадения. После добавления явного head выполнена
новая проверка с отдельным ID; первоначальный ответ и его стоимость сохранены.
Journal не переписывался, неизвестные outcomes не превращались в успешные.
Оба compact сохранили исходные records; stale selection отвергнут.

Proof `proof:long-context` находится в настоящем userData Skaro:
`verification/openrouter-ba4/session-long.jsonl`, вне Git. Повторный entry читает
сохранённый proof, не отправляя новые model requests:

```powershell
node apps/desktop/scripts/verify-openrouter.mjs CREDENTIAL_REFERENCE_ID REVISION --long-context
```

Общий предел владельца остаётся $1. Durable ledger учитывает подтверждённые
USD receipts и сохраняет резервы неизвестных исходов всех предыдущих журналов;
новый запрос резервируется до POST. Рабочий предел $0.95, ещё $0.05 — запас.
Во всех журналах 52 model intents: USD receipts $0.03447606 плюс $0.25 резерва
без подтверждённых receipts, всего $0.28447606. Цепочки SHA256 проверены.
Повторная сверка `/key` остановилась на credential-stage; свежий account usage
не подтверждён, стоимость сценария доказана сохранёнными request receipts.
Закрыт этот критерий для указанного маршрута и Windows. Последующая приёмка
закрыла остальные критерии поддерживаемого контура BA-5; продуктовая интеграция
и платформенные границы перечислены в итоговой таблице.
