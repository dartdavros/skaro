# Native model host

Дата: 01.11.2026. Добавлен внутренний модельный порт main → native worker →
owned runtime. Настоящий модельный план Cat-pilot через него проверен.
Продуктовые send/steer, task/chat scheduler,
completion/capture и UI не включены; полная BA-6/BA-7 приёмка открыта.

## Граница host/runtime

Общие wire DTO Chat/Native вынесены в timeline; существующие коннекторы,
их provider semantics, model-step и tool executor переиспользуются. Runtime
принимает внутренний `modelTurn` с устойчивым ID, сохраняет intent/result,
continuation и tools. Main владеет настоящим коннектором и credential port.
В native/runtime передаются только scope/admission, маршрут, модельная policy
и baseline sequence/hash журнала. Credential reference, ключ и grant headers
не передаются в worker config или shell environment.

`RuntimeSessionHost` объединяет verification/extensions/model. Порты должны
иметь одинаковый scope/admission. Сохраняемая model policy не меняется при resume;
отсутствующий model host и подмена route/policy отвергаются. Перед startup main
и адаптер сравнивают baseline с настоящим primary journal. После restart старые
intent не могут получить новый request permit. Baseline привязан к последнему
hash, а не только количеству записей.

`RuntimeHostServer` использует один lifecycle/dispatch для трёх портов, чтобы
main и адаптер не реализовывали cleanup отдельно. Общий session lease и OS birth
checks из предыдущего этапа сохраняются. Окончательное закрытие ждёт settlement
host calls и всего runtime model turn, включая streaming journal/final result.
Второй одновременный modelTurn получает durable отказ, не обрывая первый ход.

## До модельного POST

Host читает настоящий primary journal без второго writer/lock owner. Reader
проверяет canonical regular file, identity/size/timestamps, завершённый JSONL
и последовательность/hash chain schema 2. Mutable или повреждённое чтение
даёт отказ; подставная история не используется. Лимит чтения — 64 MiB.

Текущий intent должен быть новее baseline и оставаться pending. Route, model
policy и session должны совпадать, session не должна быть stopped/closed.
Host возвращает quotation reservation, runtime сохраняет `budget:ID`, затем
`ID:dispatch` со ссылкой sequence/hash, request hash и binding hash. Перед POST
host повторно проверяет durable dispatch и точное совпадение quotation.
Вызов complete допускается один раз на request ID; старый неизвестный исход
не получает автоматического повтора. Новый host не переисполняет старый intent.

Это не OS sandbox или аттестация недоверенного исполняемого кода. Primary journal
остаётся mutable; concurrent change консервативно запрещает dispatch. Владелец
runtime и host callbacks считаются частью доверенной реализации Skaro.

## Policy, поток и ошибки

ModelToolAdmission теперь допускает async host calls. Сужение каталога tools
по-прежнему не добавляет инструментов и не меняет schemas; requireAllowed
выполняется до tool executor. projectResult выполняется у host. Native continue
может асинхронно использовать исходный коннектор, не переписывая provider state.
Новые wire schemas валидируют requests, не переставляя reviewed JSON-поля.

Model RPC имеет отдельные limits: request 2 MiB, reply 16 MiB, streaming text
1 MiB на request, 16 KiB на delta, до 8 pending, timeout 120 s. Прежние
inspection/extension limits не расширяются. Настоящие text deltas проходят
оба перехода IPC и батчами сохраняются в primary journal. Частичный текст
не становится успешным модельным результатом. Total text journal limit — 8 MiB.

Raw provider/credential errors не передаются через IPC. Статус настоящего
ModelHttpError переносится как bounded status; прочий неподтверждённый результат
сохраняет unknown semantics и запрет автоматического повтора. Результаты tools,
native events, reasoning/continuation и provenance идут по прежним контрактам.

## Выполненные проверки

Сборка после последней правки runtime прошла, лог в temp:
`skaro-native-model-verified-build.log`. TypeScript desktop main, lint и
проверки размеров файлов пройдены. Все новые/изменённые source files меньше
300 строк. UI не менялся, browser-проверка не требуется.

Прошли 12 целевых tests: async catalogue selection (2), direct connector
contracts (4), journal (6). После итогового изменения ожидания полного хода
повторены journal (6) и compiled-native (2): все прошли. Полного suite не было.

Ранний настоящий preflight без concurrent assertion принят:
`verification/extensions-8bd345f8-972a-414f-9f5f-bd8582f8fa79/proof.json`
в userData Skaro. Реальные Cat-pilot services, vault и OpenRouterConnector;
при отсутствии approvalHash reserve отвергнут до POST. Проверены отсутствие
host, другой route, неверный maxSteps, повтор хода, stale baseline, fresh-host
restart, чтение 9 критериев после отказа и выход двух настоящих runtime.
Task/C4 не изменены, model requests 0, reservations 0. Ключ не расшифровывался.

Повтор с concurrent assertion принят после восстановления approval reviewer:
`verification/extensions-e2d7924e-9cd2-4abc-a6df-9f36b7a4c4bb/proof.json`.
Отказ второму ходу не завершил первый runtime. Итоговый hostModelWork ждётся
при interrupt/close; прежний usage-limit blocker снят прямым повтором владельца.

Живой `--native-plan` принят: primary journal
`verification/openrouter-ba4/session-nativeplan.jsonl`, command
`nativeplan-7b3a42fd6305e343-v1`. Пять настоящих запросов OpenRouter через Xray,
реальные inspect_acceptance/plan_checks/assess_checks, readyToSubmit=false.
Настоящий streaming text совпал с content ответов, quotation/reservation/
dispatch сохранены до POST. Повтор того же turn ID не создаёт записей или POST.
Один настоящий runtime завершён с проверкой OS identity, task/C4 не изменены,
check processes 0. Цена прогона по receipts $0.0016499; общий ledger после него
70 request intents, $0.38864466 с прежними reservations, лимит $1 сохраняется.

После живой проверки закрыта async race двух complete одного request ID:
dispatched Set проверяется повторно после чтения quotation/journal,
непосредственно перед синхронным claim. Это не автоматический retry model POST.
Дополнительно прошли 20 целевых tests: selection/direct contracts/journal/
process/MCP и настоящий DPAPI vault, включая несекретную reference при rotation,
reopen, revoke и отказ при другом binding. Полный suite не запускался.

Итоговая сборка после race guard прошла. Четыре native regression proofs
в userData Skaro `verification/`:

- preflight: `extensions-6a7f6371-44ab-476d-a505-448e505c9a2f/proof.json`;
- criteria/plan/replay: `extensions-b12fd698-6f67-4bd2-8b10-7ae8b564df27/proof.json`;
- operations: `extensions-4fe18644-bb35-4847-b380-0caaec898c29/proof.json`;
- lifetime: `extensions-dad50bbf-d21c-4e49-a7fc-d037bc1538a1/proof.json`.

Во всех этих локальных повторах model requests 0, task/C4 не менялись,
выход настоящих процессов подтверждён. Настоящий model-plan не повторялся ради
нового зелёного результата; его реальные receipts/continuation сохранены.

## Повтор и дальнейшая интеграция

1. Запустить `node apps/desktop/scripts/verify-builtin-extensions.mjs
   --native-model-preflight`. Новый assertion должен подтвердить concurrent
   rejection без выхода первого runtime. Это настоящий контур без model POST.
2. Повторить затронутые `--native-verification`, `--native-operations`,
   `--native-lifetime` последовательно: они используют single-instance lock.
   Эти прогоны не выполняют model POST и не изменяют Cat-pilot.
3. Живой driver — `verify-openrouter.mjs REFERENCE REVISION --native-plan
   PAYLOAD_PATH PAYLOAD_HASH` с несекретной актуальной ссылкой credential.
   Обязательный `SKARO_VERIFY_PROXY=http://127.0.0.1:10809`; direct fallback нет.
   Не включать ключ в argv/env/chat. Launcher передаёт proxy только credential
   host; shell/runtime остаются без model secrets.
4. Проверить реальный plan/assessment, streaming text journal, usage/cost receipts,
   dedup и подтверждённый выход. Не повторять failed request/turn автоматически.
   При новой осмысленной попытке сохранить исходный отказ и консервативный hold.
5. После прохождения DoD записать новые proof, проверить NO GOD/format/diff
   и сохранить emoji conventional commit. Далее — положительная execution
   admission настоящей задачи и model/task-chat/completion интеграция.

Ранее владелец разрешил payload Cat-pilot T-008:
`verification/extensions-990788b8-0105-4aba-9af8-9bbead070e8a/model-plan-payload.json`
в userData. Semantic SHA256:
`7b3a42fd6305e343ad6d13cc9d95489d5cdf767150cb6aaa87e1cae54774c598`.
Driver сравнивает файл и текущую проекцию с этим hash до POST. Разрешение касается
только read-only планирования трёх tools, не выполнения команд или сдачи.
Общий прежний лимит $1 сохраняется: ledger сканирует session*.jsonl в
`verification/openrouter-ba4`, включая новый `session-nativeplan.jsonl`.
Unknown reservations не обнуляются; ledger после этого этапа — $0.38864466.

Для direct OpenAI/Anthropic/DeepSeek живые API по-прежнему отложены владельцем.
BA-8 требует отдельного утверждённого дизайна; новые UI состояния не придуманы.
