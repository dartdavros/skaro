# RC-3 — продолжение после checkpoint 13.11.2026

Владелец поручил продолжить RC-3 с checkpoint остановки: закончить интеграцию,
пройти сборку/целевые проверки и настоящую приёмку кешей. **RC-3 завершён**;
[итоговая приёмка 8/8](archiagent-resource-rc3-acceptance-2026-11-13.md).
Ниже сохранён ход продолжения и неуспешные попытки. RC-4/AG-1 не закрыты.

## Завершённая локальная интеграция

- Journal, inspection и recovery runner переведены с `evidenceDirectory` на
  SQLite archive/project/subject IDs, manifest SHA и exact native DB identity.
  Ключ архива и pin включены в неизменяемый snapshot digest.
- Отдельный opener проверяет существующую обычную DB до открытия SQLite,
  затем сверяет native pin и фактическое соединение. Read-only preflight
  не создаёт и не мигрирует DB. Нового application state/recovery всех проектов нет.
- Резерв учитывает B-tree/overflow pages, WAL frames/backlog и journal slack;
  лимит владельца 256 MiB сохранён. Рост main DB/WAL проверяется перед эффектами.
- Повтор незавершённого копирования допускает только тот же manifest и точное
  подмножество content-addressed BLOBs; существующие bytes повторно проверяются.
  Sealed archive не перезаписывается. Receipt не является deletion capability.
- Общие `cacheTree`, descriptor reads, clone prechecks и `CacheRemovalPlan`
  используют bigint native observations; прежние числовые inode больше не
  авторизуют удаление. Digest формата исторических inventories не менялся.
- Добавлены отдельные scoped archive и BuildKit launchers. BuildKit verifier
  подготовлен для cold/warm receipts, explicit eviction собственного builder
  и проверки сохранности прежних Docker objects; его live-приёмки ещё нет.

## Проверки текущего продолжения

- Штатная `pnpm build` пройдена дважды; вторая сборка включает новый код
  кешей. Предупреждения сторонних библиотек не объявляются ошибками сборки.
- Desktop backend `tsc`, core `typecheck`, scoped ESLint и Prettier пройдены.
- Целевой пакет: **13 файлов, 66 passed / 4 skipped**. Skips — явно включаемые
  проверки реального окружения, не поддельные API или fixtures.
- Отдельно включён read-only пакет настоящих gateway/backend и Docker:
  **3 файла, 12 passed**. Установок, Docker solve и служб проекта он не запускает.
- Первый archive preflight: **passed=true**, 01:57:29–02:05:42 МСК,
  ID `011672ff-7455-4c43-bea3-80d20799c92e`. Это read-only сверка реальных
  original trees, CAS, source/refs/history и предыдущих proofs/journals.
  Journal и архив при этом не записывались; retained leases остались retained.
- Docker Desktop запущен; daemon ID совпал с checkpoint:
  `04b42192-4024-4df0-bfcd-6cb463cd280e`. Сервисы проектов не запускались.
- Изменённые в этом продолжении backend-модули проверены на размер: файлов
  больше 300 строк нет. UI не менялся, browser acceptance не заявляется.

## Gate перед реальными эффектами

Автоматический approval review отклонил команду `archive-sixth-recovery`:
он не признал ссылку checkpoint на прежнее согласие достаточным основанием
для необратимого удаления original partial trees. Команда **не была запущена**.
После этого владелец **явно разрешил** после проверенной долговечной
SQLite-копии удалить только artifact, scratch/original-lock-proof и staging
input шестой попытки `dec8f960-57e1-48eb-ac7b-2eb2c5089c43` и поручил продолжать
до закрытия настоящей cache-приёмки. Scoped recovery запущен отдельно,
run ID `0bb03363-fa0d-4d9e-a35f-9800d15241f3`.

Новый controller `a5c208f9-7caf-450e-874e-b612b3d555c5` получил admission.
Snapshot: 8 282 узла, **64 931 302 logical bytes**. SQLite page size 4096;
main DB baseline 488 665 088 bytes, WAL baseline 0; резерв **257 588 320 bytes**
(245,7 MiB), в пределах 256 MiB. Archive ID
`f5289b8f-cdc3-4222-9854-b423598b749b`. Эти счётчики не являются evidence
готовой копии, удаления или фактического возврата свободного места хоста.

В ходе recovery записаны все **2 440 BLOBs / 26 926 623 bytes**, manifest
**3 306 891 bytes**. Sealed manifest SHA-256:
`855d0a1ca6efed914fade2f6ba24fdd5ff529abb01a3506a0d3e0842147482bc`.
**Recovery прошёл, 02:12:06–02:48:56 МСК, exit 0, passed=true.**
[Фактический proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-archive-reconciliation-0bb03363-fa0d-4d9e-a35f-9800d15241f3/proof.json>)
подтверждает обязательные copy/seal/durability/readback проверки и удаление
только трёх разрешённых деревьев: **64 931 302 logical bytes** оригиналов.
Source/history/refs, прежние Docker objects/worktrees и project/run/runtime
state совпали до/после. Nonterminal leases проекта: **0**. Старые proofs/journals
и нерелевантные resource/lease records проверены сохранённым preservation contract.
SQLite-архив оставлен в существующей DB; число bytes не объявляется измеренным
возвратом свободного места хоста.

Исходная Git revision рабочего дерева: `22f3d4fb0ec12c3cfd0e49d650869f1ee13175ea`;
это dirty tree, не коммит реализации. SHA-256 фактически исполненного
`cache-archive-workflow.cjs` первого recovery:
`496a05a1d87ce88a83cc1245ed591ea791683ea1d61b77a825bf4c18401d40b4`.
**Безопасный повтор пройден**, 02:49:47–02:50:57 МСК, exit 0:
[proof replay](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-archive-reconciliation-6bb87bec-cf0b-41aa-bbe5-a633514492ef/proof.json>).
`alreadyComplete=true`, `replayUnchanged=true`: journal и все leases сохранились
без новых ID/revisions, активных/retained leases 0. Архив повторно прочитан;
новая копия и новые deletion effects не создавались.

Дополнительные регрессии общих cache helpers, reconciliation и cleanup:
**11 файлов, 42 passed / 2 skipped**. Это затронутый пакет, не полный suite.

## Настоящая pnpm-приёмка — пройдена

13.11, **02:51:39–03:20:19 МСК**, exit 0, `passed=true`:
[proof pnpm](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-cc36357a-9859-4dd8-97d3-172576307b47/proof.json>).
Опубликовано immutable поколение 1 ключа
`a0a12d8e04ee2a50273e1902274604300cfda25ec5f94f02ca9fd3ec5e6bc08e`:
28 002 625 bytes, digest
`aa2495dd74c990b5cd3f31e03fadc360077477cbae3a1ef80202ded0c3685e4b`.
Original-lock self-check прошёл с exact native target pin, guard не отключался.
Два независимых private inputs выполнили настоящий frozen offline install:
каждый **8 897 604 installed bytes / 1 924 nodes**, scripts disabled,
shims не исполнялись. У всех трёх операций один исходный input digest
`4d379e0ac41bbf065870259f7f3ddabbcf581ea7e2306dbf42e171bff14044a3`.
Оба consumer использовали то же поколение/digest; полное чтение CAS проверено
после каждого. Explicit eviction удалил только это поколение и 28 002 625
logical bytes. Это не проверка LRU/capacity pressure искусственными данными.
Все пять leases released. Source/history/refs, Docker/worktrees и project/run/runtime
state совпали до/после; в основном checkout ничего не устанавливалось.
SHA-256 исполненного `cache-workflow.cjs`:
`d35729a873472554eb4481cb50a44c46fa30c3f345ab262bf7c0e3bd74ccf553`.

## Подготовка реальной BuildKit-приёмки

Установленный Buildx: v0.37.1, необходимые `--resource`/`--call` доступны.
До provisioning исправлен LLB-вызов: `--call=convertllb,format=json`.
[Buildx этой версии](https://github.com/docker/buildx/blob/v0.37.1/build/build.go)
сам добавляет `frontend.` к имени subrequest; прежний аргумент добавлял его дважды.
Guard фактических RUN resources/capabilities сохранён. Отдельный целевой пакет
LLB/resource/profile/cache/Docker policy: **5 файлов, 12 passed / 2 skipped**.
Это protocol-policy unit tests, не поддельные ответы Docker и не live evidence.

Первый фактический BuildKit-запуск **03:25:59–03:28:06 МСК** завершился exit 1:
[proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-b617b593-efd3-419d-9d5c-fcdb0ba6242f/proof.json>).
Cold/warm receipts отсутствуют. Сохранились два retained допуска и запись
`creating` поколения 1; создание контейнера/тома/image и RUN не начинались.
Source/history/refs и прежние Docker objects/worktrees совпали до/после.
SHA-256 proof: `028d3475a6550095e6cbc6d8faaebdf119ddf5fa927c59608b022bb03894a719`;
исполненного bundle: `4dc8abb91133eb7528df434543d13b3b9f025c60f991fc9a4248897710243a22`.

Причина воспроизведена тестом настоящей SQLite admission: `bind` запрещал
добавить новый builder lock к существующему shared source lock. Исправлено
монотонное добавление с сохранением всех старых binding/mode/generation;
подмена, удаление и конфликтующее связывание по-прежнему отклоняются.
BuildKit отдельно получает исходный live handle из admission; восстановленные
строки ledger не служат таким capability. Общая семантика maintenance не менялась.
Целевые проверки: **9 файлов, 22 passed / 2 skipped**, TypeScript и scoped lint.
Дополнительный тест bounded recovery identity: **1 passed**.

Незавершённая инициализация проверена read-only: builder consumers/objectIds
пусты, cleanup-fence отсутствует, на диске только пустая директория `buildx`.
Реализован отдельный ограниченный recovery: закреплённый failed proof,
native pin пустой структуры, source/Docker preservation, новый controller,
точное снятие только двух неиспользованных резервов и проверяемый replay.
Он не удаляет файлы/объекты и не переводит builder в ready. Завершение реального
bootstrap выполняется отдельно под новым exclusive live admission с DU=0.

Recovery выполнен **03:45:41–03:50:18 МСК**, exit 0, `passed=true`:
[proof reconciliation](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-reconciliation-f3b16c11-3351-4414-9ba3-07ab1783da52/proof.json>).
Controller `cd8cc176-1bd9-466a-95d4-4d6c6b17be80` и два исходных резерва released.
Builder остался `creating`, пустые директории сохранены; внешних эффектов нет.
SHA-256 bundle: `0df8be1bf56eb9e5cae670464e94863659ebb972426f5f052e2284b2ae90e909`.
Replay **03:50:59–03:51:07 МСК**, exit 0, `alreadyComplete=true`,
`replayUnchanged=true`:
[proof replay](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-reconciliation-55e94fa2-dc7a-4d43-959c-b2db463765f0/proof.json>).
SHA-256 replay bundle: `2dd5713643557c1b48d818b2e77d87a6b918150ef6bdef4af334925e2c0c1e34`.
Для последующих проверок native Docker inspect выполняется ограниченными
пакетами до 16 объектов; каждый ответ проверяется по точному Id/Name и хешируется
в прежней форме. Совместимость с исходным proof подтверждена реальным replay.

После восстановления повторная сборка `pnpm build` успешна, exit 0;
desktop backend TypeScript, scoped lint и размер изменённых модулей проверены.
Дополнительная регрессия передачи admission: **3 passed / 1 opt-in skipped**;
живой допуск здесь проверяется настоящими cache drivers, не этим skipped тестом.
Второй настоящий BuildKit run `6d8c9c2c-d207-4e66-8486-f6c38bb5f692`,
**03:54:24–03:55:30 МСК**, завершился exit 1:
[failed proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-6d8c9c2c-d207-4e66-8486-f6c38bb5f692/proof.json>).
SHA-256 proof: `6bdd0caaa816e0e26839b0c3830f0b6dd8e3f13065dbab584ae6e8fdd6e159ae`;
bundle: `119f642203a69dd3834d827b0dc843bc5ab905aa3d13dabca1a77770cf0964cb`.
Созданы только собственные pinned image, volume и контейнер
`3bb4530634a3b50302151ec32b9634bd601e3240a4785225663c4ae70d3168e0`.
Контейнер остался `created`, StartedAt нулевой, PID 0; daemon/RUN не запускались,
`/buildkitd.toml` внутрь не копировался. Cold/warm receipts отсутствуют.

Найдено несовпадение guard с настоящим Docker: при privileged-профиле Engine
добавляет ровно `SecurityOpt=["label=disable"]` — см.
[generateSecurityOpt](https://github.com/moby/moby/blob/master/daemon/create.go).
Добавлена точная поддержка этого значения, остальные security options остаются
запрещены. Policy tests проходят. Финальная проверка также обнаружила смену
network ID `b677380ae3ee4e6a7728c0e3b810b9f5ab3fe128f00a37d600b7db5db6492ac1`
на `3c842f8f56e414f7c4859224e6263c86aa7656613464da03280f71c0bf484295`
(текущий `bridge`). Причина/инициатор смены не доказаны; старый запуск не считается
приёмкой сохранности. Команд network create/rm драйвер не исполняет.
В старом proof финальная ошибка замаскировала сценарную; verifier исправлен,
теперь сохраняет их отдельно и пишет промежуточные after-наблюдения сразу.

[Read-only diagnostic](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-diagnostic-7652efec-3e33-4afc-9dc6-9d36f49dfe8f/proof.json>)
подтвердил исправленный identity guard и source/history/refs, затем отказал
на историческом inventory из-за смены сети. Это **failed**, не passed.
Отдельное настоящее bounded чтение Docker archive API подтвердило пустой volume:
1536 tar bytes, только директория `buildkit/`, ни одного файла/ссылки;
SHA-256 `77a6f5fcb282e7fa90a85237b421e76d28002ff992fea5c00ff761a4e9c1f115`.
Данные не извлекались на диск, helper-контейнеры не создавались.

Подготовлен новый scoped recovery только для этого никогда не запускавшегося
allocation. Он требует native pins реальных config files, пустой volume,
точные metadata/lease snapshots, свежий controller и стабильный текущий inventory.
Отдельный core reconciliation запрещает даже локальные эффекты и изменения
resource records; может завершить только проверенный maintenance fence.
Ни файлы, ни Docker-объекты при recovery не удаляются, ready не записывается.
Первый bootstrap затем требует нового exclusive admission и DU=0.
Целевой пакет этого изменения: **4 файла, 13 passed**; обычный filesystem
reconciliation и проверки настоящего live handle сохранены.

Created recovery выполнен **04:16:48–04:18:28 МСК**, exit 0, `passed=true`:
[proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-reconciliation-3f990c04-52b6-4abb-af6d-ffbe06d22c50/proof.json>).
Пустота тома, `created`/нулевой StartedAt, exact native layout и source/history/refs
подтверждены до и после завершения старого fence и снятия двух резервов.
Текущие существующие Docker objects/inventory стабильны; историческая смена
`bridge` этим результатом не отменяется. Объекты, содержимое и generation сохранены,
builder остаётся `retained`, ready не записан. Новый controller released.
Replay **04:18:59–04:19:10 МСК**, exit 0, `alreadyComplete=true`,
`replayUnchanged=true`:
[proof replay](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-reconciliation-99fefba8-7869-4a26-8bd5-91b07b80ee84/proof.json>).
SHA-256 сохранённого replay bundle:
`7f949623e53a56d32d29a7312fd7d9c875c5c31fb9432cadbfaee1a4fc0252e0`.

После изменений core ещё раз пройдены **9 файлов / 25 passed / 1 opt-in skipped**,
backend/core TypeScript и scoped lint. NO GOD: cleanup 280 строк, отдельный
cache claim/preparation 201, created-recovery runner 231; остальные изменённые
модули также менее 300 строк. Общие control cost/settlement вынесены отдельно.
Docker inventory/hash checks получают тот же pinned client/endpoint, что builder.
Bootstrap использует явный штатный `--bootstrap` под funded build admission.
По [исходникам Buildx v0.37.1](https://github.com/docker/buildx/blob/v0.37.1/store/nodegroup.go)
его persisted daemon flags находятся в поле `Flags`; guard проверяет это поле,
а также отсутствие несогласованных config Files. Целевые policy tests — 4 passed.

Третий run `26789bd3-4855-47d7-bb42-36053b483fef`, **04:23:45–04:26:36 МСК**:
[failed proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-26789bd3-4855-47d7-bb42-36053b483fef/proof.json>).
SHA-256 proof `2bcbb693e916c20faf8c0b63b2b6628bb4cfcd44c81da850698c9699aee8c4bc`,
bundle `a2ca436bbf4625c6ea9f921955c3b98a33d9b4ac3491047f6e3e3b9462aecc8b`.
Реальный bootstrap/DU=0/idle stop и его release прошли. Cold-фаза остановлена;
RUN receipts отсутствуют, source/history/refs совпали до/после. Собственный daemon
остановлен, fence `externalPending=false`, old consumer — main PID 21792,
а не RUN-client. Полная копия input сохранена: 756 файлов / 2 112 137 bytes.
Остались два retained допуска cold-фазы; bootstrap-допуск released.

Первичный протокол выявил ошибку guard: LinuxResources находятся в
[OpMetadata](https://github.com/moby/buildkit/blob/master/client/llb/state.go),
JSON `metadata[vertex].linux_resources`, а не `exec.meta.linuxResources`.
Разбор исправлен по upstream schema; обязательные 512 MiB/no-swap-extra/1 CPU,
capability каждого RUN, число exec и network/security guards сохранены.
Также отклоняются неожиданные типы чисел. При следующем solve сохраняются digest
настоящего LLB и нормализованные per-vertex limits; raw source/LLB не сохраняются.
Bounded stable cause codes больше не теряются при остановке daemon.

Локальный `init.log` зафиксировал старт VM в **04:24:21**, после baseline,
и выключение в **04:32:39**. Это согласуется со штатным
[Resource Saver](https://docs.docker.com/desktop/use-desktop/resource-saver/):
read-only lists могут обслуживаться без пробуждения VM. В третьем proof сеть
`bridge` сменилась с `00e2180de385bdafbfbab0e42a7964f8a4e09387d371d72bf581da9711226fd3`
на `de50ab62f10f2efa51bc98786c464746d0fa9c5e0ce9be0971f2fbf5ecabd7dd`.
Новый протокол делает настоящее bounded archive-чтение собственного stopped
builder перед baseline; настройки Docker и дополнительные контейнеры не нужны.
Foreign IDs/configurations по-прежнему сравниваются строго.

Подготовлен read-only stopped recovery с новым controller: закрытый client,
остановленный точный daemon, settled RPC, хеш содержимого тома, исходный proof,
native pins и совпадение frozen input с approved source обязательны вместе.
Recovery не запускает executor и не удаляет данные. Cold может повторно использовать
только эту копию через одноразовый host capability под новым live exclusive grant;
его штатный cleanup использует исходный native snapshot, warm — обычный новый export.
Новый целевой пакет: **5 файлов / 16 passed**, backend/core TypeScript и scoped lint.

Stopped recovery/replay завершены, четвёртый live выявил неподходящий DU formatter.
Текущие результаты и исправления вынесены в [BuildKit follow-up](archiagent-resource-rc3-buildkit-followup-2026-11-13.md).

BuildKit cold/warm/eviction, итоговая сохранность и checklist RC-3 закрыты:
[итоговая приёмка](archiagent-resource-rc3-acceptance-2026-11-13.md).
Коммит и релиз не выполнялись. Работающий интерфейс и прохождение общей
приёмки по старым результатам не заявляются.
