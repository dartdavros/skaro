# RC-3 — расширение кешей для настоящего pnpm/BuildKit проекта

Дата исходного технического отчёта: 12.11.2026; основной текст ниже исторический.
**13.11.2026 настоящая pnpm/BuildKit приёмка закрыта, RC-3 принят 8/8:**
[proof, checks и границы](archiagent-resource-rc3-acceptance-2026-11-13.md).
Изменения остаются в рабочем дереве, коммит/релиз не выполнялись.

## Разрешение и сохранность источника

Владелец отдельно разрешил использовать зарегистрированную Stolovka.pro,
`b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b`, только для настоящей проверки кешей.
Корень: `C:\Users\drmar\Projects\stolovka\code`. Это не разрешение менять проект,
запускать его службы, миграции, задачи, модель или общее workflow recovery.
Разрешение не распространяется на Chatballs и не меняет общий Cat-pilot scope.

Выбраны настоящие контексты `gateway` для pnpm и `backend` для BuildKit.
Основная копия содержит изменения метаданных Skaro — они сохраняются.
Незавершённая запись T-023 с failed runtime не превращается в действующий run:
нельзя подделывать `endedAt`, захватывать задачу или устанавливать зависимости
в основную копию ради проверки. Требуется отдельный host-only путь допуска
настоящего источника и собственный operational staging, без фиктивного проекта.
Host-only project scope и неприсваиваемая через JSON source capability добавлены.
Operational staging и отдельный Electron driver подключены и были реально
исполнены; первая попытка удержала данные/резервы при ошибке архива, а не дошла
до ready. Полная живая приёмка ещё не подтверждена. Общий task-only dispatcher
и Cat-pilot AppState не расширены.

## Что добавлено в код

- Task-инструменты принимают только относительный `context`; произвольный cwd,
  CLI-флаги и якобы выданное агентом разрешение запрещены. Удерживается корень
  настоящего task-worktree, а выбор подкаталога только сужает источник. Проверяются
  каноничность, inode/volume/birth identity корня и контекста, повторный допуск.
- Прежняя npm-область сохраняется. Для pnpm поддерживается ограниченный публичный
  lock9 / один importer с точным `pnpm@10.11.0`. Config/hooks/workspaces,
  private/local/git/alias resolutions не присваиваются как безопасные.
- Владеющий приложению mirror меняет только transport tarball на проверенные
  `file:`-пути. Package/snapshot identity и peer-context multiplicity сохраняются.
  Общий pnpm store и глобально установленный pnpm не используются. Точный
  упакованный runtime включается в собственный проверяемый артефакт.
- Перед состоянием `ready` обязателен настоящий frozen/offline roundtrip исходных
  manifest/lock bytes из полной writable-копии store. Original-lock consumer
  не получает immutable store напрямую; полный digest проверяется до/после.
  Этот код добавлен, но его живое выполнение на Stolovka ещё не подтверждено.
- Lifecycle scripts, pnpmfile и side-effects cache отключены. Стандартные pnpm
  shims разрешены только внутри нового приватного target и не исполняются:
  утверждения, что `bin-links=false` запрещает их в pnpm10.11, нет.
- На Windows новый конечный `node_modules` создаётся исключительно и проверяется
  отдельным validator ссылок/shims. Установленный каталог не переименовывается:
  junctions и абсолютные данные pnpm иначе указывали бы в старый staging.
  Существующий target не присваивается; неясный partial target удерживается.
- Build-контекст читается с настоящими Dockerignore-правилами; [Dockerfile](<C:/Users/drmar/Projects/stolovka/code/backend/Dockerfile>)
  разбирается AST, не заменяется синтетическим рецептом. Экспортируются точные
  проверенные bytes/modes/digests, затем источник и frozen context сверяются снова.
  Для tracked example-template допустим только строгий небольшой placeholder
  subset; это не универсальное доказательство отсутствия секретов в исходниках.
- Default-профиль остаётся ограниченным scratch без сети. Новый trusted-профиль
  требует одного immutable official-library base и точного host approval:
  project/context/source digest/recipe digest/profile. Worker не может выдать
  себе такое разрешение. Обычная сеть **не** является public-domain allowlist
  или запретом доступа в LAN.
- Builder provision использует отдельный точный контейнер/том и remote driver
  `docker-container://<container ID>`, а не неявный docker-container driver,
  включающий `network.host` entitlement. Проверяются daemon, immutable image,
  labels/token/generation, единственный state volume, отсутствие чужих mounts,
  restart policy `no`, заданные entrypoint/command, RAM/swap/CPU и bridge network.
  Старый recovery discriminator не переобозначается новым владением.
- Добавлен fail-closed барьер фактического LLB с per-RUN resource constraints:
  отсутствие поддерживаемого ответа/лимитов запрещает настоящий solve.
  Совместимость выбранного subrequest и структуры ответа ещё нужно подтвердить
  на реальном frontend; unit metadata не заменяют это доказательство.
- Cancel/error teardown останавливает только точно проверенный собственный
  контейнер, без cancellation-rejected DU/bootstrap. Неясный executor/диск
  сохраняет fence, consumer и retained admission для явной RC-4 reconciliation.

## Изоляция Docker client

Добавлен отдельный клиент с собственными HOME и DOCKER_CONFIG, без наследования
proxy, context, сертификатов и credentials владельца. Read-only discovery читает
существующий context только для выбора локального named pipe / Unix socket;
TCP/SSH/TLS отклоняются до обращения к удалённому Engine. Pull/build используют
только собственный конфиг и точные установленные Docker/Buildx binaries.
Пустая запись public Docker Hub auth не даёт включить default native keychain;
credential helpers и proxy defaults в создаваемом конфиге отсутствуют.

Binding включает daemon ID, canonical executable paths и SHA256 обоих binaries;
он включён в resource dataVersion. Перед командой проверяются bytes собственного
конфига и hashes binaries. Новый recovery contract —
`skaro:owned-isolated-remote-buildkit-v3`; старый builder не присваивается молча.
Конфиг создаётся исключительно внутри admitted fence, неизвестный каталог
не перезаписывается. Сам этот этап создания пока предстоит живой приёмке.

Read-only проверка настоящего Docker Desktop прошла 16:53 и 17:09 МСК:

- endpoint: `npipe:////./pipe/dockerDesktopLinuxEngine`;
- daemon: `04b42192-4024-4df0-bfcd-6cb463cd280e`;
- binding: `52207c0f7698277547e0de04271d2e6390ce3e716818dc4fad87991d2bfec06f`;
- фактические cgroup capability fields — `CpuCfsQuota` / `CpuCfsPeriod`:
  ошибочное написание parser исправлено по настоящему ответу Engine;
- установленный Buildx имеет vendor hardlink (`nlink=2`). Только для read-only
  host binaries допустимы такие links с полным streaming SHA256 и проверкой
  неизменности identity/link count. Правила `nlink=1` для CAS не ослаблялись.

## Host-only источник, operational staging и отдельный driver

Прямой scoped AppDb допускает только настоящий зарегистрированный UUID/root,
отдельно разрешённые владельцем. AppState/createServices не создаются: runtime
задач, recovery и чужие проекты не сбрасываются и не запускаются. Read-only
проверка реального registry/root/HEAD прошла без записи source registration.
HEAD: `f8ecfcf2ac53ebae686e81af7f0a7af12948224d`.

Добавлен путь регистрации настоящего project-root как persistent worktree,
shared generation-bound source lease и WeakSet capability на время действия.
Это не task/run и не disposable synthetic checkout. Незавершённые делегированные
leases удерживают source pin; сериализованное утверждение worker о root/lease
capability не создаёт. Добавлены additive lifetime locks/current/settled guards
в существующий admission: они не заменяют task authority, consumer checks или
проверку остановки runtime. Partial disk без consumer PID также удерживает резерв.

Общий source parser проверяет настоящий gateway ДО переноса: запрещённые configs
нельзя просто потерять при копировании. Копируются только исходные manifest/lock
bytes в новый собственный staging; target receipt содержит native identity.
Его очистка и release допускаются только под точным exclusive lease/fence,
после проверенного завершения child, проверки target и digest исходных inputs.
Неясный executor/partial data удерживает fence, полный резерв и source pin.

Driver использует настоящее имя/single-instance lock Skaro, прямой scoped AppDb,
обычные production cache adapters и сохраняет source/history/refs, runtime/run
state и существующие Docker objects до/после. Сценарий — настоящая publication,
две original-lock offline установки и явное удаление только созданного поколения.
Политика удаления переиспользуется sweep/operator путями, без поддельных ages,
pressure или incoming entries. Это НЕ доказательство живого capacity-pressure/LRU.
### Первый настоящий запуск: guarded failure, не cache acceptance

12.11.2026, 17:41–17:43 МСК: после загрузки штатного Electron driver реально
зарегистрировал persistent source, получил обычный admission, создал собственный
staging и дошёл до публичных tarballs. Попытка
`5c22df0b-7bbb-42e0-b173-5de72efad0ac` завершилась
`managed_dependencies_unsupported_archive_expansion`:
[настоящий proof, passed=false](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-5c22df0b-7bbb-42e0-b173-5de72efad0ac/proof.json>).
Существовавшие source/history/refs, project/run/runtime state, Docker objects и
worktree inventory совпали до/после. Только main source: 1545 файлов / 117685739
байт, SHA-256 `2922158684fa3b364e42df257501906dc51a89ba0b8e00c59a0e526fa1228d7c`.

Исследование actual integrity-bound tarball выявило обычный DefinitelyTyped root
`node/`, не ошибку checksum/PAX. Parser исправлен: ровно один portable top-level
root; escape/empty components, links, sparse/GNU/PAX overrides остаются запрещены.
Проверка настоящего архива выполнялась read-only, без extraction/fixtures.
Проверка pnpm runtime дополнительно требует прежний известный root `package/`.

Неудачная попытка НЕ объявлена публикацией: original-lock roundtrip, два consumer
и eviction не состоялись. Partial cache/staging, fence и оба lease сохранены:
source `c3808eaa-498b-49ed-8ffb-effed791dad1`, dependencies
`d6635421-c166-4095-851b-e27d9a8d46cf`. Это удержание estimates (3 GiB + 128 MiB RAM,
6 GiB host disk, build slot), не утверждение о физическом расходе этих объёмов.
До повтора нужен явный bounded reconcile с положительным подтверждением закрытия
executor и точной физической сверкой собственного поколения. Dead PID/TTL либо
ручное обнуление DB/fence не являются основанием для release.

### Bounded reconciliation: первая настоящая очистка пройдена, RC-3 открыт

12.11.2026 подготовлен отдельный scoped recovery driver, не ослабляющий обычный
запрет на повторный cache admission при retained leases. Новый control request
получает собственный admission, а native request/session receipt записывается
до возможных cleanup effects. Старые grants не переиспользуются и не оживляются.
Обычные cleanup/runLeased/stop сохраняют прежние ограничения.

Read-only сверка настоящих остатков прошла: официальный pnpm runtime содержит
1111 файлов и 242 каталога; каждый digest/размер/путь совпал с pinned архивом.
Artifact фактически содержит **24017392 bytes**, 1114 файлов, 245 каталогов,
SHA-256 inventory `c2e971d1a4378c9f8c130e63c725c192dc41c538d2ba4a068f834fe4560b58ec`.
Persisted counter **23546313 bytes** меньше на **471079 bytes** — ровно один
последний целый SHA512-valid tarball исходного lock-prefix, записанный перед
ошибкой expansion, но до сохранения счётчика. Произвольное расхождение запрещено.
Staging: 13907 bytes / 2 исходных файла; scratch: только 2 пустых private npmrc.

Журнал сохраняет неизменяемую карту известных файлов/каталогов/native identities
до удаления. Replay принимает только оставшееся подмножество этой карты, не
неизвестные файлы, заменённые native roots или новую генерацию. Core-контекст
cache reconciliation запрещает внешний executor, renewal/reclassification и
проверяет тот же opaque live controller также при успешной финализации.
Снятие исходных резервов возможно только после физической сверки/отсутствия
всех трёх owned trees и завершения barriers. Учет control leases закрывается
после durable completion; это не обещание полной RC-4 recovery.

На интеграции до финальных review-исправлений в 19:02 МСК: **14 core + 38 desktop
= 52 целевых теста**, TypeScript, ESLint и штатная сборка прошли. Проверки были
metadata/read-only; journal persistence, физическое удаление и release настоящих
leases ещё не выполнялись. Повторный review выявил необходимость обработать
never-granted cancelled preparations, закрывать control accounting при replay
complete journal и ожидать async resource shutdown до закрытия SQLite.
После исправлений в 19:24 МСК прошли **14 core + 41 desktop = 55 целевых
тестов**, TypeScript, ESLint, форматирование и повторная штатная сборка (exit 0).
Повторный независимый review не нашёл blocker в ordering/fence/shutdown.
Настоящий scoped recovery выполнен в **19:27–19:32 МСК**, exit 0, `passed=true`:
[proof восстановления](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-29618648-ae98-4af3-b4dc-ddbc7291cd64/proof.json>).
Удалено **24031299 logical bytes** собственных cache/scratch/input trees; оба
исходных lease и новый control lease released, persistent source без consumers.
Source/history/refs, project/run/runtime, Docker/worktrees совпали до/после.
Освобождение учётных RAM/disk estimates не означает физического расхода/возврата
3 GiB RAM или 6 GiB disk. Native crash/kill для создания replay-сценария не делали.

### Второй настоящий запуск: выявлен неверный подсчёт узлов

Повторная попытка `e4d8d85e-9c07-4daa-b039-ef4d6d540c35` завершилась в **19:36 МСК**
на aggregate `npmExpansionFits`, не на archive-root parser:
[новый настоящий proof, passed=false](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-e4d8d85e-9c07-4daa-b039-ef4d6d540c35/proof.json>).
Все 37 скачанных tarballs SHA512-valid и образуют точный prefix исходного lock.
Первые 36: 7922114 logical bytes / 4076 старых depth-counted nodes. Последний
`rfdc@1.4.1`: 6828 compressed / 27150 logical bytes / 41 depth+layout nodes;
aggregate 4117 превысил неизменённый лимит 4096, хотя уникальных payload nodes
у 37 архивов всего **1187**. Общие родители ошибочно повторно считались для
каждой записи. Физические cache bytes 25216464 включают последний архив;
expanded counters остались на prefix36, поскольку aggregate не принят.

Исправление не поднимает лимит: shared decoder считает уникальные portable
nodes с duplicate/case/type guards; отдельный planner учитывает весь original
lock graph, peer copies, dependency links и Windows bin shims в каждом consumer
scope. На настоящем prefix37 и полном topology52 получено 1411 projected nodes
с ещё 15 непроверенными payloads; это НЕ успешная установка всего lock.
Legacy decoder counters отдельно сохранены для восстановления уже созданных
поколений. Вторая собственная очистка затем успешно выполнена в 20:21 МСК.
Третья попытка завершилась SDK error; после [review-исправлений](archiagent-resource-rc3-local-review.md)
её [scoped recovery](archiagent-resource-rc3-third-recovery.md) успешно завершён
в 22:15 МСК: 25 470 370 logical bytes удалены, leases released; безопасный повтор пройден.
Последующая [четвёртая попытка pnpm](archiagent-resource-rc3-pnpm-live.md) остановилась
на fetch в 22:26 МСК; её scoped recovery/replay завершены в 23:10/23:12 МСК.
Исправленный pnpm-only publication/original-lock consumers/eviction выполняется.

В **20:09 МСК** прошли **14 core + 60 desktop = 74 теста**, в том числе настоящий
read-only V2 reconciliation, оба accounting режима и C4-2 observation safety.
TypeScript/ESLint и штатная сборка прошли. Полная pnpm/BuildKit acceptance и RC-3
по-прежнему OPEN; C4-2 observation не объявлен semantic approval/приёмкой.

## Источник, фактически прочитанный без сборки

Целевой тест прочитал backend без изменений, Docker solve и загрузок образов:

| Факт | Результат |
| --- | --- |
| Файлы | 756 |
| Логические bytes | 2 112 137 |
| Уникальные узлы контекста | 848 |
| Source digest | `065f8ca56fe09e035ab1b0c831c66c478fa1bd90c621bee8cdb5cc9ad7ef5a12` |
| Recipe digest | `9562759c2d8e329b866c25c2f80edc2a36cba207ff0c3ef19fa2fe48dce08b15` |

Прочитан также настоящий gateway manifest/lock с pnpm10.11. Это metadata/preflight,
не доказательство наполнения кеша, offline установки, cache hit или вытеснения.

## Учёт ресурсов

Бюджет idle BuildKit cache остаётся 2 GiB. Отдельно учитываются до 1 GiB builder
image, 1 GiB консервативного base expansion и 4 GiB transient RUN allowance:
при default budget резерв Docker disk составляет 8 GiB, а не только размер кеша.
Для хостового context резервируется не менее 128 MiB, для Docker RAM/CPU —
1 GiB / 2 CPU. Daemon ограничивается 512 MiB / 1 CPU; per-RUN план также требует
512 MiB / 1 CPU. Без доказательства descendant cgroups эти бюджеты не схлопываются.

Это консервативные оценки, а не математическая гарантия peak arbitrary RUN,
guest free space или filesystem quota. Реальный admission обязан заново измерить
хост и Docker-pool; общий backing volume учитывается совместно с резервом ОС.
Публикация/использование pnpm учитывают собственные store clones и target, bounded
archive expansion 1,5 GiB / 4096 nodes, без нулевого учёта неизвестных размеров.

## Историческое состояние перед live (12.11.2026)

На текущем коде 12.11.2026 в 18:00 МСК: **8 файлов / 34 теста успешно**, включая
явно разрешённое read-only чтение настоящих gateway/backend, registry/root
и локального Docker. Backend TypeScript и ESLint затронутых модулей прошли.
Повторная штатная сборка завершилась с exit 0; прежние предупреждения сторонних
библиотек сохранены, без ошибок.
Полная тестовая матрица, browser/UI и живые cache-сценарии не запускались.

Перед live ещё необходимы:

1. Scoped recovery третьей попытки и безопасный повтор **завершены**;
   partial данные отсутствуют, leases released. Это не повторная установка.
2. Проверить создание/использование изолированного Docker client на настоящем
   собственном builder. Read-only preflight и pure config metadata это не заменяют.
3. Разрешение владельца на exact-source trusted build со стандартным egress
   получено; сам прогон не выполнен. Нужны настоящий LLB/лимиты и actual cold/warm
   RUN receipts. Текущая сессия ограничена локальными проверками, без live.
4. Настоящая pnpm publication → original-lock offline use → eviction; настоящее
   BuildKit заполнение/повторное использование/вытеснение под admission/fence.
5. Проверка source/refs/существующих ресурсов до/после и durable live proof.

Windows `EBUSY` в dev-зависимостях был установлен по настоящему directory handle:
его держал `YandexDisk2`, PID 13184. Владелец разрешил завершение; к повторной
проверке процесс уже отсутствовал, поэтому никакой чужой процесс не завершался.
После исчезновения блокировки frozen offline reinstall завершился 900/900.
Повреждённые links не исправлялись подменой исходников или изменением lock pin.
Эта диагностика не является приёмкой продуктового cache recovery.

13.11 работа была остановлена владельцем: [stop checkpoint и WIP](archiagent-resource-rc3-stop-2026-11-13.md).
Затем владелец явно поручил продолжение: [текущий отчёт](archiagent-resource-rc3-resume-2026-11-13.md).
SQLite archive/recovery/replay шестой попытки и новая настоящая pnpm-публикация,
два original-lock offline consumers и eviction пройдены. Затем прошёл полный
BuildKit cold/warm/eviction; [RC-3 принят 8/8](archiagent-resource-rc3-acceptance-2026-11-13.md).
