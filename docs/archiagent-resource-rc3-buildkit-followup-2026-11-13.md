# RC-3 — BuildKit после stopped recovery

Продолжение [основного отчёта](archiagent-resource-rc3-resume-2026-11-13.md).
**BuildKit и RC-3 приняты:** [итог 8/8](archiagent-resource-rc3-acceptance-2026-11-13.md).
Ниже сохранена история предшествующих попыток. Коммит/релиз не выполнялись.

## Закрытое восстановление остановленной cold-фазы

Stopped recovery: **04:51:56–04:54:47 МСК**, exit 0, `passed=true`:
[proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-reconciliation-c888b122-981d-4492-b404-48cf2bdfba09/proof.json>).
Проверены stopped daemon, closed client/RPC, полный frozen input, native pins,
сохранность исходников/истории и текущих Docker objects. Только после этого
закрыт старый fence и released два исходных резерва и свежий controller.
Ни объекты, ни содержимое не удалялись; generation 1 сохранён, ready не записан.
Хеш фактически прочитанного volume archive:
`db8094f3e71df4a7514dd6ee98af988a68ad30165483d4eb1b3f9fca22a57163`.
SHA-256 исполнявшегося bundle:
`e155745a3ad3580488ec668058cff2f91c170b960b61cb47fda9b32220b6bb4f`.

Replay: **04:56:37–04:57:02 МСК**, exit 0, `passed=true`,
`replayUnchanged=true`:
[proof replay](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-reconciliation-3bd4197d-5a0d-4d40-afa1-f148aeaea121/proof.json>).
Journal/lease IDs, states и revisions не изменились; новых effects нет.

## Четвёртая фактическая попытка

Run `67e75deb-f3cf-4505-b3e9-a456765c82ab`, **04:58:03–04:59:24 МСК**,
exit 1, `passed=false`:
[proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-67e75deb-f3cf-4505-b3e9-a456765c82ab/proof.json>).
SHA-256 proof: `211b71798a72a869287fb57bd5d0e451ab66de162b36e298e1ae061e2c16ad2e`;
bundle: `3b92ccff463a9d74576fc56bb643ee5620f0756b068feece19f6b9dcf7b606b4`.

Archive-чтение перед baseline разбудило настоящую Docker VM.
Source/history/refs, foreign inventory и хеши существующих Docker objects
совпали до/после. Исправление порядка baseline подтверждено, настройки Docker
и дополнительные контейнеры не использовались.

Повторная активация остановилась на `managed_buildkit_usage_unknown`, ещё до
выполнения cold solve. Machine cause сохранён внутри scenarioError.
Daemon физически остановлен; source input и cache сохранены. Retained:
source `06205845-d4b6-4a67-8ee1-fb60caf84e58`,
builder `41b0c86e-8331-478b-adb9-315a89f63bd9`.
Fence: maintenance/retry, externalPending=false, PID 3112.
В legacy entry ещё указан consumer предыдущей cold-попытки, PID 21792;
он не принимается за текущий executor. Отдельный точный case проверяет оба
закрытых процесса, собственный stopped daemon, settled RPC и preserved bytes.

## Исправление формата DU и actor attribution

Первичный [Buildx v0.37.1](https://github.com/docker/buildx/blob/v0.37.1/commands/diskusage.go)
формирует `Size` через HumanSize даже в JSON и предоставляет `Reclaimable`.
Этот ответ не содержит требуемых точных байтов/`InUse`; пересчёт округлённых
значений и выдача unknown за 0 не применяются.

Используется штатный `buildctl` закреплённого собственного образа:
`buildctl --addr unix:///run/buildkit/buildkitd.sock du --format '{{json .}}'`.
Команда выполняется только в exact owned daemon под текущим live build grant.
[Его DU](https://github.com/moby/buildkit/blob/master/cmd/buildctl/diskusage.go)
сериализует исходный [UsageInfo](https://github.com/moby/buildkit/blob/master/client/diskusage.go):
`size` — integer bytes, `inUse` — boolean. JSON null означает nil/пустой slice;
пустой stdout, неверная структура, humanized size и unsafe integer — отказ.
Это запрос того же настоящего daemon, без helper-контейнера/заглушки.

Runtime записывает текущие intent/PID/birth до maintenance action; source RUN
затем записывает supervised client. Повторная активация больше не оставляет
legacy consumer как будто это текущий владелец. После подтверждённого idle stop
consumer очищается обычным lifecycle.

Целевые тесты после исправления: **4 файла / 10 passed**, backend TypeScript
и scoped lint прошли. Штатная сборка завершилась с exit 0 в 05:16 МСК;
сохранились предупреждения сторонних библиотек, ошибок нет. Точный
usage-only recovery/replay завершён; последующий настоящий cold/warm/eviction
с LLB guard и проверкой сохранности также прошёл (итог по ссылке выше).

## Usage-only recovery и replay

Recovery **05:16:40–05:19:32 МСК**, exit 0, `passed=true`:
[proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-reconciliation-ed622f10-9213-436a-b222-659a0c0093d8/proof.json>).
Точные source/volume/native/closed-process guards пройдены; оба старых retained
резерва и новый controller released. Политика: `no-start-no-delete-no-ready-state`.
Generation 1 сохранён. Volume archive SHA-256:
`c63cc9a59f5704677e7d20b819d58de9f3618712f8cf43a577cff8104641e8cc`.
Bundle SHA-256:
`a052947b9758c010bb86f3987b76593b702810a1e20a13fe01e869656b708c39`.

Replay **05:20:02–05:20:26 МСК**, exit 0, `passed=true`, `alreadyComplete=true`,
`replayUnchanged=true`:
[proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-reconciliation-84f8c989-fbd6-4c46-b94a-5b8152640b9a/proof.json>).
Journal и все admission records остались неизменными, новые effects отсутствуют.

## Пятая фактическая попытка и RUN progress

Run `59bf181b-3363-46f9-94d4-bc3321c6e311`, **05:20:44–05:25:02 МСК**,
exit 1, `passed=false`:
[proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-59bf181b-3363-46f9-94d4-bc3321c6e311/proof.json>).
Proof SHA-256: `ef3ac01ef0e25d7f134b327f4d9f71a60e69ff741d0d01832d9c4b00eb366eec`;
bundle: `7a0401b2ff4fbdb86507ea3aa4ea4b68785920ebdd9780ec8f9e2a0477e41d44`.

Реактивация прошла с точным DU 16 384 bytes. Настоящий LLB с двумя RUN прошёл
mandatory limits gate. Ledger содержит завершение solve, GC и idle daemon stop;
builder штатно ready, consumer/fence отсутствуют, все три допуска released.
Input удалён штатным lifecycle после проверки. Кеш: 319 027 826 bytes.
Source/history/refs, foreign inventory и существующие object hashes совпали.

Приёмка остановилась на проверке RUN receipts; `cold` не сохранён, поскольку
проверка вычислялась до присваивания результата proof. Успешного cold/warm
из этого failed proof не заявляем. Теперь результат сохраняется до validation.

[Buildx v0.37.1 зависит от BuildKit v0.33.0](https://github.com/docker/buildx/blob/v0.37.1/go.mod).
Его [rawjson display](https://github.com/moby/buildkit/blob/v0.33.0/util/progress/progressui/display.go)
пишет целый SolveStatus: [vertexes[].digest](https://github.com/moby/buildkit/blob/v0.33.0/client/graph.go),
а прежний parser ожидал плоские `id/name`. Parser выделен в отдельный модуль,
читает только завершённые source-bound RUN vertices, не принимает logs за receipts,
отклоняет ошибки, неоднозначные имена и неверные cached/completed типы.

Нормальный ready builder больше не направляется в старый recovery. Перед новым
cold штатный funded sweep подтверждает DU=0 только собственного кеша; context
экспортируется заново. Cold/warm/eviction и foreign guards сохраняются.
После правок **5 файлов / 12 тестов passed**; types/lint и сборка прошли.
Последующий run `e350f566-c0a0-4acc-b0ed-4d545a479226` прошёл весь cold/warm/eviction
цикл, exit 0, passed=true; результаты сохранены в итоговой приёмке.
