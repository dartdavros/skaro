# Native host operations

Дата: 01.11.2026. Подготовка BA-7: существующие внутренние операции Skaro доступны
owned runtime через main → native worker → runtime. Продуктовый task/chat запуск,
модельный цикл, сдача задачи и выбор агента в UI ещё не включены.

`startBuiltinNativeSession` принимает набор host ports: `verification` и
`extensions`. Последний связывает scope/admission с настоящим
`RuntimeExtensionHost`. `bindSkaroOperations` по-прежнему использует прежние
MCP handlers, availability и схемы; новой реализации workflow или scheduler нет.

## Привязка и вызовы

Через IPC проходят только scope/admission, descriptors и конкретные аргументы.
Сервисные функции, DB handles, AbortSignal, grant headers и credentials остаются
в main. В конфигурации сессии сохраняются точные extension policies и
`extensionsScope`; при resume смена области отвергается по primary journal.
Отсутствующий host, подмена scope или политики не допускаются при старте.
Если переданы оба порта, их scope/admission должны совпадать.

Native entry требует callback сохранения OS ownership. Worker допускает runtime
только после его выполнения в main; main и адаптер повторно проверяют OS birth
владельца до/после вызова. Host проверяет исходный каталог и JSON schema, а
обычный ToolCoordinator сохраняет approvals, очередь и durable call IDs.
Модель не выбирает host, project/task/run/admission или новый каталог.

Inspection и extensions используют общий bounded RPC: до 8 pending запросов,
request до 64 KiB, reply до 256 KiB. Inspection timeout — 20 s, операции — до
30 min, lifecycle control — 60 s. Отмена передаётся через оба IPC-перехода;
поздний ответ после отмены/закрытия не принимается. Raw ошибки host не возвращаются.
Неподтверждённый исход операции становится `effect-unknown`, а не успешным
результатом. Повтор того же tool ID возвращает записанный исход без dispatch.

## Interrupt и close

`RuntimeExtensionHost.interrupt` опционален. Внутренний порт Skaro не владеет
отдельным MCP-процессом и сохраняет привязку после отмены текущих вызовов.
Native proxy передаёт lifecycle control к исходному host. Остановка ждёт
settlement допущенных вызовов; drain ограничен 30 s, отказ не считается
подтверждённой остановкой и блокирует возобновление tools.

Отдельный [общий host lease](builtin-agent-native-lifetime.md) отзывает всю
native-сессию и автоматически завершает owned runtime. Это отличается от
signal отдельного порта, который запрещает его вызовы.

Если host не реализует resumable interrupt, используется его окончательный
close. В частности, прежний Playwright MCP завершается с проверкой выхода
владельца; его соединение не оставляется живым ради resume. Для дальнейшей
работы такого расширения нужен новый допущенный host. Окончательный native
close отзывает RPC, закрывает original host, ждёт pending calls и подтверждает
выход owned runtime прежним механизмом.

Это не OS sandbox и не транзакция с отменой внешнего эффекта. Если handler уже
выполнил действие, транспорт его не откатывает. Cancellation/error/timeout не
разрешают повтор эффекта; текущие проверки существующего handler сохраняются.

## Живая проверка

```powershell
pnpm build
node apps/desktop/scripts/verify-builtin-extensions.mjs --native-operations
node apps/desktop/scripts/verify-builtin-extensions.mjs --native-verification
```

Driver выбирает зарегистрированный Cat-pilot и настоящий project_chat scope,
не создаёт проект, чат или TaskRun. Единственная допущенная операция —
`get_project_context`. Ей намеренно задана более строгая policy readOnly=false,
чтобы проверить approval до intent. Driver отвечает allow_once только на этот
точный локальный вызов с пустыми аргументами. Модель и ключ не используются.

Проверяются прямой/native результат, schema/scope отказы, dedup, explicit resume,
restart с новым host, запрет смены сохранённого scope и отзыв in-flight вызова.
Отдельный malformed restart действительно запускает owned runtime и должен
завершить его без допуска новой области. Task T-008 и C4 сравниваются до/после;
все OS owners фиксируются в private `native-owners.jsonl` до допуска.

Принято: `verification/extensions-48fa0f43-4068-47d7-a45b-2e6b58529d80/proof.json`
в userData Skaro; primary journal — `native-operations.jsonl`. Четыре allow_once
до intent, точное совпадение с direct handler, resume/restart и сохранение scope
проверены. In-flight отзыв дал durable unknown и повтор без dispatch. Три
настоящих runtime завершены, включая отказавший malformed restart; task/C4
не изменены, check processes/model requests 0. Ранняя неуспешная попытка
`extensions-7b0a0fb1-6801-40fe-bc1c-d5e1bdf5a1b3` сохранена: observer ошибочно
считал исторические approvals новыми. Исправлен driver, а не ослаблен runtime.

Сборка, типы runtime/adapter/desktop, lint/format, 6 journal, 5 process,
1 настоящий MCP и 2 compiled-native регрессии прошли. Найденная во время работы
регрессия MCP shutdown исправлена до приёмки; существующий тест не ослаблялся.
Повтор criteria/plan/assessment/cancel/restart на общем RPC также принят:
`verification/extensions-9315d44d-dd1c-4e75-8df7-99e3b334a607/proof.json`.

Общая [BA-6](builtin-agent-ba6-verification.md) остаётся открытой: успешное
исполнение плана активной задачи, model/task-chat lifecycle и evidence в
completion/capture ещё не приняты. Каталог агента и UI не изменялись.
