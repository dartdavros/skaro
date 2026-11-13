# RC-3 — настоящий pnpm-цикл на Stolovka

Даты: 12–13.11.2026. **Второй пункт ещё не выполнен, RC-3 OPEN.**
**13.11 работа остановлена по поручению владельца, цель на паузе.**
Актуальные WIP, проверки и условия продолжения: [stop checkpoint](archiagent-resource-rc3-stop-2026-11-13.md).
Поздний archive/native код не является проверенной live-реализацией.
Владелец поручил «Делай второй пункт» после успешного
[третьего scoped recovery](archiagent-resource-rc3-third-recovery.md).
Разрешена только цепочка pnpm publication → original-lock offline use → повторное
использование → explicit-owned eviction. BuildKit solve, службы проекта, модель,
общий workflow recovery и установка в основном checkout не разрешены.

## Preflight перед четвёртой попыткой

- Настоящий зарегистрированный project/root/HEAD и исходный gateway подтверждены:
  `b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b`, HEAD
  `f8ecfcf2ac53ebae686e81af7f0a7af12948224d`.
- 3 целевых test files / **12 passed**, включая оба actual read-only opt-in cases.
- Каталог dependency artifacts пуст; 9 прежних leases терминальны, собственных
  cleanup fences нет. Действуют прежние бюджеты: dependencies 1 GiB / 32 objects.
- [Durable baseline](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-pnpm-preflight-8f34c8c6-8f50-42d4-83d0-4792657d0d1b/baseline.json>)
  содержит SHA256 3 прежних recovery journals, 6 proof/postcheck files, предыдущие
  leases и hashes чужих resource/lease records. Ничего не создавалось в source.

## Четвёртая попытка: guarded failure, не публикация

**22:24:04–22:26:24 МСК**, intent `4184d324-e8da-4846-acd6-9fcfb380a85b`:
[настоящий proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-4184d324-e8da-4846-acd6-9fcfb380a85b/proof.json>),
exit 1, `passed=false`, `managed_pnpm_fetch_failed_exit_1_unreported`.

Полные 52 SHA512-bound архива и trusted manifest/bin graph facts подготовлены,
но `ready`, original-lock probe, два consumer и eviction **не состоялись**.
Собственные partial данные, fence и source pin сохранены, а не очищены по dead PID:

- source lease `09450e5e-7ff8-4ddb-bf8e-5cf978e72002`;
- dependencies lease `cb13c480-5f2c-4c03-b0aa-58f121e8c4cb`;
- оба `retained`, revision 3;
- artifact key `f56b9b44195084b524ee980830e707327955dff6ce4f838ecdd33589db805aae`,
  generation 1, 25 433 204 logical bytes, unique expansion 9 468 521 bytes / 1925 nodes;
- новый private target пуст; store имеет только 515 стандартных пустых директорий
  `v10`, `files/index` и по 256 hex buckets, без files/links.

[Preservation postcheck](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-4184d324-e8da-4846-acd6-9fcfb380a85b/failure-postcheck.json>)
в 22:35 МСК подтвердил source/history/branches, project/run/runtime,
Docker/worktrees, все 6 прежних proof files, 3 journals, предыдущие 9 leases
и чужие resource/lease records неизменными. `preservationPassed=true` не является
cache acceptance: в документе отдельно сохранено `publicationAccepted=false`.

## Восстановление четвёртой попытки

**23:01:25–23:10:30 МСК**: [scoped recovery proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-41292787-715a-4648-90c4-388cb250179a/proof.json>)
`passed=true`, `alreadyComplete=false`, 25 476 564 logical bytes удалены. SHA256
proof `960863c2e8411bdc42fc9a6a01530b374dbb15729c5d30563fd3218dd65d98ca`,
complete journal `470fea42a034060b06423dbeaf48929ba471161f9b806f764fe21ad3947adefa`.

[Перед replay](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-41292787-715a-4648-90c4-388cb250179a/before-replay.json>)
независимо подтверждены физическое отсутствие artifact/scratch/input-stage, released
resource/fence состояния, 12 released leases, отсутствие source consumers, те же
6 прежних proof files, три прежних journal bytes, предыдущие 9 lease values, чужие
resource/lease records, пустой builder catalogue и прежняя default cache policy.
[Replay](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-10187710-ab3d-4542-8f6a-aea57f1147c2/proof.json>)
в 23:11:37–23:12:04 МСК прошёл с `alreadyComplete=true`.
[Postcheck / baseline следующего цикла](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-10187710-ab3d-4542-8f6a-aea57f1147c2/postcheck.json>)
подтвердил отсутствие нового controller/request, изменений всех 12 leases,
owned resource revisions/outcomes и четырёх journal bytes; все три дерева отсутствуют.
В baseline зафиксированы 12 прежних proof/receipt files и protected records.
Следующий pnpm-only цикл завершился пятой guarded failure; подробности и текущий
внешний blocker приведены ниже. Publication/reuse/eviction всё ещё не приняты.

## Выявленный интеграционный дефект и подготовка повтора

Независимый bounded review настоящего pinned SDK pnpm 10.11 установил конкретное
несоответствие: абсолютный `modules-dir` присоединяется SDK к project/lockfile root
через `path.join`, а на Windows получается второй drive prefix внутри пути.
Это согласуется с пустым target/store, но потерянный stdout исходной попытки
не позволяет заявлять доказанной точную причину exit 1.

Исправление [command builder](../apps/desktop/src/main/managed-pnpm-command.ts)
использует `relative(work, modules)` с отказом на empty/cross-volume result.
Sibling private targets с `..` допустимы; absolute virtual-store-dir сохраняется,
поскольку SDK нормализует его отдельно. Новый configuration commandProfile v3
меняет будущий cache key; существующие retained generations не переопределяются.

[Диагностика](../apps/desktop/src/main/managed-pnpm-diagnostics.ts) теперь принимает
pretty pre-reporter `{error:{code}}`, reporter `{err:{code}}` и конечный whitelist
OS/Node error identifiers. Raw messages, paths, argv и credentials в durable error
не попадают. Regression cases проверяют фактическую `path.join` семантику, sibling
и cross-volume targets, обе error envelopes и отсутствие secret leakage.

Отдельные read-only probes настоящего pnpm под Node permission с запрещёнными
filesystem writes подтвердили принятие flags и достижение store mkdir. Их
намеренный `ERR_ACCESS_DENIED` — ограничение probe, **не ошибка настоящего driver**.
Mirror native `file:C:\...` поддерживается SDK; он не заменялся спекулятивно.

Локальные command/diagnostics tests: **12 passed / 1 skipped**; независимый review
четырёх исправленных файлов не нашёл blocker. Отдельный новый
[tagged recovery seam](../apps/desktop/src/main/verification/cache-verification-reconciliation-initialized-layout.ts)
готов: точные producer/graph SHA256, generation/counters/lease IDs/revision 3,
516 store-inclusive empty directories, byte-for-byte graph regeneration из всех
52 SHA512-verified архивов. Legacy seam не расширяется; полный original native
inventory сохраняется для удаления, а projection используется только при чтении
старого archive validator. Независимый bounded review шести новых модулей не нашёл
blocker; parent проверил wiring/producer hashing/no-fallback и старые native gates.

Integrated checks: desktop main types, scoped ESLint/Prettier и стандартный build
прошли; 13 test files / **57 passed, 4 opt-in skipped**. После исправления только
слишком узкого literal-типа в test helper повторные types/lint/format и 5 targeted
metadata cases прошли. Настоящий новый read-only opt-in preflight прошёл:
**1 passed**, 199.6 s (22:57–23:00 МСК), включая все 52 архивных facts, native/ledger
closure, три прежних complete journals и negative mutations actual metadata.
Только после этого выполнены scoped recovery, идемпотентный replay и preservation
postcheck четвёртой попытки. Затем запущен исправленный pnpm-only цикл.
[Durable local-validation receipt](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-4184d324-e8da-4846-acd6-9fcfb380a85b/local-validation-87379c79-5b14-41da-acd6-86f4faa15819.json>)
связывает 19 code/test SHA256 и результаты checks; максимальный размер файла 280 lines.

## Пятая попытка и воспроизведённый numeric-config дефект

**23:13:13–23:15:53 МСК 12.11**, intent `b407c6df-bf21-4c8b-b364-39fd95eb2180`:
[producer proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-b407c6df-bf21-4c8b-b364-39fd95eb2180/proof.json>)
снова `fetch_failed_exit_1_unreported`, до ready. Поэтому исправление modules-dir
не объявляется доказанной причиной исходного сбоя.
[Postcheck](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-b407c6df-bf21-4c8b-b364-39fd95eb2180/failure-postcheck.json>)
подтвердил сохранность 12 prior proofs/receipts, четырёх journals, прежних 12 leases,
source/project/foreign state; новые два leases retained revision 3, store и target пусты.

На настоящих pinned SDK parser/getConfig/createPackageRequester без filesystem writes
воспроизведён TypeError PQueue: prefixed `--config.network-concurrency=1` превращается
в строку, а конструктор требует number. `child-concurrency` и `fetch-retries` также
были строками. [Pure production argv](../apps/desktop/src/main/managed-pnpm-arguments.ts)
теперь использует typed direct flags для чисел; commandProfile v4 меняет будущий key.
[Повторяемый diagnostic](../apps/desktop/scripts/verify-pnpm-numeric-options.mjs)
использует те же production args и реальные SDK function bodies с in-memory export
access, без замены реализации/fixtures. Он разрешает только exact read-only Node
startup, проверяет pinned SDK SHA и неизменность inputs, НЕ вызывает requester,
fetch/install или worker. Historical string-args воспроизводят TypeError; typed
fetch/install args дают числа 1/1/0 и успешный constructor. Лишний write grant
отклоняется до чтения residue. Замечание review к guard исправлено и перепроверено.

Последние checks: desktop main types, scoped ESLint/Prettier, standard build passed;
9 test files / **44 passed, 2 opt-in skipped**. Новый exact fifth tagged recovery
отдельно от четвёртого прошёл bounded review и actual read-only preflight:
**1 passed, 163.8 s**, с byte-preserved четырьмя прежними complete journals.

## Внешний blocker перед recovery effects

Запуск [пятого recovery](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-2f998651-c668-4e70-8f50-26a84a29b73f/proof.json>)
остановился на read-only Docker observation: `dockerDesktopLinuxEngine` named pipe
отсутствует; прямой настоящий `docker info` также вернул daemon-unavailable.
Docker Desktop/контейнеры/службы проекта не запускались и guard не обходился.

[Pre-effect postcheck, 00:02 МСК 13.11](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-2f998651-c668-4e70-8f50-26a84a29b73f/pre-effect-postcheck.json>)
подтвердил `cleanupExecuted=false`, pending journal без preparations/sessions,
две прежние retained reservations, 12 прежних released leases, прежние proof/journal
bytes и foreign ledger/protected records. Все три partial дерева остаются на месте;
новый publication с typed numeric flags ещё НЕ запускался. Нужен настоящий Docker
endpoint и проверка его foreign inventory, а не замена окружения/ручной release.

## Продолжение после разрешённого запуска Docker Desktop

Владелец отдельно разрешил запуск Docker Desktop с предупреждением об автоматическом
восстановлении существующих контейнеров. Linux endpoint восстановлен; daemon ID прежний.
Никакие compose/dev-скрипты или BuildKit solve не выполнялись.

[Recovery пятой попытки](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-b6ab6ac5-e62d-4b7d-8902-cbcbcacee03c/proof.json>)
в **00:05:48–00:12:46 МСК 13.11** завершён: `passed=true`, удалено 25 476 564 logical bytes.
[Pre-replay сверка](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-b6ab6ac5-e62d-4b7d-8902-cbcbcacee03c/before-replay.json>)
подтвердила 15 released leases, отсутствие cache/scratch/stage и source consumers.
[Идемпотентный replay](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-5a5f585b-0809-4415-af1c-27b1d9c486d5/proof.json>)
прошёл с `alreadyComplete=true`.

Разрешённый запуск Docker пересоздал пустую стандартную сеть `bridge`:
старый ID `0dff1c8e818804bfeb48bed646020e39e7ae0f30ae85de8dbe9da173a75a45b3`,
новый `b732e987a9c6ec708ed45438e7f16b6092a0e5dc1ab5b81adf24f2f019e4c93b`.
Прямой inspect подтвердил `default_bridge=true`, пустые Labels/Containers.
Это отдельная owner-authorized infrastructure delta, НЕ неизменность прежнего
network inventory. Containers/volumes/images/worktrees совпали со старым inventory;
внутри recovery before/after foreign inventory полностью одинаков.
[Post-restart baseline](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-5a5f585b-0809-4415-af1c-27b1d9c486d5/postcheck.json>)
служит отдельной границей следующего typed-numeric pnpm-цикла, сохраняя старые receipts.

## Шестая попытка: fetch прошёл, original-lock target guard остановил publication

**00:16:01–00:24:41 МСК 13.11**, intent `dec8f960-57e1-48eb-ac7b-2eb2c5089c43`:
[producer proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-dec8f960-57e1-48eb-ac7b-2eb2c5089c43/proof.json>)
`passed=false`, `managed_pnpm_target_identity_changed` внутри original-lock self-probe.
Typed numeric flags позволили пройти fetch; собственный CAS собран, но `immutable`
и `ready` не установлены, два consumers и eviction ещё не выполнялись.

[Preservation/native postcheck](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-dec8f960-57e1-48eb-ac7b-2eb2c5089c43/failure-postcheck.json>)
подтвердил сохранность source/foreign against post-restart baseline, 20 прежних
proof/receipt files, пяти journals и 15 прежних released leases. Новые два leases
retained revision 3, artifact generation 1 retained с 28 002 625 logical bytes.
Новый код не присваивал target и не удалял unknown/changed дерево.

Native root действительно изменился: captured ino `13229323907920232`, birth
`1794518653338.6357`; observed exact bigint ino `13229323905476734`, birthtimeNs
`1794518654652054800`. Это не только округление: время рождения тоже другое.
Одновременно captured numeric ino уже превышает MAX_SAFE_INTEGER; native precision
требует отдельного решения, а не ослабления сравнения. Target теперь содержит
настоящие `.pnpm`, `.bin`, manifests, aedes/mqtt links. Empty-store recovery seams
не являются разрешением удалять такое дерево. Требуется позитивный поддержанный
контракт installed-target/native-lineage; слепой retry/ручной release запрещены.

Bounded static review настоящего pinned SDK установил обычную причину замены:
`modules-cleaner/prune` безусловно вызывает `removeIfEmpty(modulesDir)` даже без
удалённых dependencies. Frozen install с synthesized currentLockfile проходит
через prune, удаляет предсозданный пустой root, затем создаёт новый при установке.
Fetch пропускает этот шаг из-за `ignorePackageManifest=true`. Поддержанного флага
сохранения EMPTY root не найдено. Кандидат подготовки, ещё НЕ проверенный runtime:
создать заранее именно объявленную реальную `.pnpm` virtual-store directory внутри
исходного identity-recorded root, а не фиктивный файл или поддельный modules manifest.
Нужны проверка поведения SDK, решение exact-native precision и отдельный безопасный
recovery контракт для уже удержанного populated/symlink-aware шестого partial.

Postcheck отдельно фиксирует исправление verification-only сверки: raw
`resources.value` не содержит id, поэтому baseline ошибочно включил active source
row в immutable protectedResources. Исходный baseline не перезаписан. Все поля
source registration отдельно сравнены без consumers; единственное разрешённое
изменение — два consumers точных новых retained leases. Остальные protected rows
по-прежнему byte-identical.

## Границы оставшейся приёмки

Успех требуется отдельно подтвердить настоящими publication до `ready`, original-lock
frozen/offline roundtrip, двумя consumers той же generation/digest и explicit eviction
только нового собственного поколения. Это не synthetic disk pressure/LRU, не полный
RC-4 crash-recovery и не BuildKit acceptance. Коммит не выполнялся.
