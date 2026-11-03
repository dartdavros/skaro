# Native inspection bridge

Дата: 01.11.2026. Это read-only host boundary для проверок BA-6 и будущего BA-7.
Task/chat запуск встроенного агента, модельный цикл и сдача не включены.

`startBuiltinNativeSession` принимает набор privileged host ports; inspection
использует его `verification`. Native transport передаёт worker только `scope/admission`;
функции, DB handles, AbortSignal и credentials не сериализуются. Worker создаёт
proxy port, адаптер передаёт его binding в owned runtime, а фактическое чтение
выполняет прежний TaskRuns acceptance service в main. Второго backend нет.

Запрос IPC имеет только type/id. Caller не выбирает project/task/run/admission.
Host binding должен совпадать с сохранённым tools scope и session ID; scope
без живого host отвергается до native spawn. И в main, и в адаптере OS identity
дочернего процесса проверяется до/после запроса. Сам port также сохраняет свои
проверки admission и фактического TaskRun/C4/criteria. Инспекция не даёт права
выполнения или сдачи; `binding.execution` для неактивного run остаётся blocked.

Для каждого перехода есть bounded client/server: до 8 pending запросов, timeout
20 s, reply до 256 KiB. Клиент связывает ответы с request ID, игнорирует поздние
ответы после отмены и не принимает результат после закрытия. Abort передаётся
вверх обоих IPC-переходов; owner lease signal и закрытие отзывают host. Во время
interrupt отменяется конкретная инспекция, канал пригоден для explicit resume.
Ошибки host передаются общей статической диагностикой, без raw message/cause.

Приёмочный driver использует настоящие compiled native/runtime entries из
build directory, явно переданного host. В продукте default остаётся
`app.getAppPath()/out/main`; это не выбор модели и не поиск подставного worker.
Managed Claude/Codex по-прежнему используют прежний native transport.

```powershell
pnpm build
node apps/desktop/scripts/verify-builtin-extensions.mjs --native-verification
```

Не создавать отдельный проект или задачи для probe. Он выбирает настоящий
Cat-pilot из registry и читает T-008. Scope с намеренно несуществующим runId
проверяет read-only inspection/отказы; активный TaskRun не фабрикуется.

Проверено: 9 реальных criterion IDs/текстов совпали с direct port, scope args
отвергнуты, in-flight inspection отменена, после interrupt выполнен explicit
resume, после отзыва lease инспекция запрещена. Отсутствующий host и иной scope
не запускают процесс. При restart создаётся новый owned runtime с живым host;
история остаётся в том же journal. Выход двух процессов проверен через OS.
Ввод explicit resume в private verification journal не вызывает модель и не
является новым решением владельца по продуктовой задаче.

Driver также передаёт через настоящий runtime локальное предложение
`plan_checks`: без команд, все критерии явно uncovered. Это не план, созданный
моделью, и не проверка выполнения требований. `assess_checks` получает только
отрицательные verdicts без evidence. После настоящего restart повторяются
исходные call IDs, отдельно вызывается свежая оценка через новый host. Primary
journal проверяется на сохранность sequence/hash ссылки и отсутствие повторных
plan records; `check_evidence` не принимает ссылку плана как доказательство.

Этот сценарий обнаружил различие live/replay: advanced IPC сохранял необязательный
`context: undefined`, а JSON journal опускал поле. Теперь primary journal приводит
подтверждаемую запись к её сохраняемой JSON-форме до reducer/checkpoint/events.
Schema 2 и существующая проверка hash chain сохраняются; история не переписывается.

Первоначальный proof: `verification/extensions-65cf398f-b057-4fbd-bcff-cc71bbf78f2b/proof.json`
в userData Skaro. Primary journal: `native-verification.jsonl` в том же каталоге.
Task и C4 setting остались неизменными; model requests 0, ключ не читается.

Повтор с plan/assessment/replay после исправления журнала принят:
`verification/extensions-a13a9e10-c048-4358-9842-83d9200d3c23/proof.json`.
Все 9 критериев остаются uncovered, readyToSubmit=false. Исходная ссылка плана
сохранилась после restart, один plan record, два настоящих runtime завершены,
check processes/model requests 0, task/C4 не изменены. Неуспешная попытка до
исправления сохранена в `extensions-e61e8017-3f37-4b63-a917-4a7a95c407ea`.
Сборка, типы runtime/desktop, lint/format и 8 целевых journal/native тестов прошли.

Также добавлен [native порт операций](builtin-agent-native-operations.md).
Открыто: положительное execution admission настоящей активной задачи, передача
credentials/environment/model ports, task-chat scheduler и применение evidence
в completion/capture. RPC read-only inspection не является OS sandbox или
атомарной гарантией последующей сдачи. Существующий внешний submit_result не
менялся. Общая [приёмка BA-6](builtin-agent-ba6-verification.md) остаётся открытой.
