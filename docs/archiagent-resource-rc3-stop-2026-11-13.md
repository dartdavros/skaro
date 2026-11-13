# RC-3 — checkpoint остановки 13.11.2026

**По прямому поручению владельца работа остановлена.** Цель поставлена на паузу
13.11.2026 около 01:44 МСК; автоматическое продолжение отключено.
**Второй пункт не выполнен, RC-3 OPEN.** Это запись WIP, не acceptance и не релиз.
Коммит не создавался; изменения оставлены в рабочем дереве.

## 1. Что подтверждено настоящими запусками

- Третий scoped recovery и replay завершены ранее:
  [отчёт](archiagent-resource-rc3-third-recovery.md).
- Четвёртая и пятая неудачные попытки безопасно восстановлены; их replay
  подтвердили `alreadyComplete=true`, без нового controller и ledger revisions.
  [Хронология и receipts](archiagent-resource-rc3-pnpm-live.md).
- Исправлены относительный `modules-dir` и typed numeric CLI flags. В настоящем
  pinned SDK воспроизведено: `--config.network-concurrency=1` даёт string и TypeError
  PQueue, а `--network-concurrency=1` даёт number. То же исправлено для
  `child-concurrency` и `fetch-retries`. Read-only SDK probe проверил fetch/install
  argv, не вызывая requester/установку; лишний write grant отклонён.
- Шестая попытка прошла fetch и собрала CAS, но original-lock self-probe остановлен
  `managed_pnpm_target_identity_changed`. `ready`/immutable publication,
  два consumer reuse и explicit eviction **не достигнуты**.
- Read-only диагностическая проверка фактического installed graph шестой попытки
  прошла: **1 passed, 64.9 s**. CAS digest остался тем же. Это чтение **без присвоения
  ownership изменённому root**, не разрешение его удалить.
- Причина замены root установлена в настоящем pnpm 10.11: обычный prune удаляет
  предсозданный EMPTY `node_modules`, а install затем создаёт его заново.
  Поддержанного preserve-root flag нет. Native guard не отключался.
- Docker Desktop был запущен только с отдельного разрешения владельца. Daemon ID
  прежний. Пересоздана стандартная пустая сеть `bridge`; эта инфраструктурная дельта
  отдельно записана, а не выдана за неизменность старого network inventory.
  Compose/dev-скрипты, BuildKit solve и службы проекта вручную не запускались.

## 2. Последнее подтверждённое retained-состояние

Intent: `dec8f960-57e1-48eb-ac7b-2eb2c5089c43`.

- [Producer proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-dec8f960-57e1-48eb-ac7b-2eb2c5089c43/proof.json>):
  `passed=false`, 00:16:01–00:24:41 МСК 13.11.
- [Native/preservation postcheck](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-dec8f960-57e1-48eb-ac7b-2eb2c5089c43/failure-postcheck.json>):
  00:28 МСК; source/foreign сохранены относительно post-restart baseline,
  20 прежних proof/receipt files, пять journals и 15 прежних released leases неизменны.
- Cache key: `102fa58971c4f254c22bceffde0ef3633f76d495eec918875631604069290a97`,
  generation 1, `retained`, `immutable=false`, 28 002 625 logical bytes.
- CAS digest: `03d61d409d764e2aef1e8f6583520b2c3bac23fe39e139c2cc4e7effaff643bb`.
- Source lease `9e0a4e3a-9b4a-4ade-b0fe-1aa11b9d73a3` и dependency lease
  `d190e8b9-e78f-416b-8105-24328af1a0ed`: оба retained revision 3.
- Original captured numeric ino `13229323907920232` небезопасен как Number;
  observed exact ino `13229323905476734`, birthtimeNs `1794518654652054800`.
  Birth time тоже изменился: это реальная замена, не только округление.
- Ни изменённый target, ни остальные partial-деревья шестой попытки после сбоя
  не присваивались и не удалялись. Архивирование шестой попытки **не запускалось**;
  её leases вручную не освобождались.

Данные выше — последний выполненный preservation check, а не новая live-сверка
в момент остановки. При возобновлении нужна свежая read-only проверка.

## 3. Что добавлено локально после шестой попытки

### Exact native identity и подготовка target — код, ещё не live acceptance

- [Native identity](../apps/desktop/src/main/managed-native-identity.ts):
  tagged decimal-string dev/ino/birthtimeNs, без JSON BigInt и Number rounding.
- [Private layout](../apps/desktop/src/main/managed-pnpm-layout.ts):
  exact root/per-node/file-handle observations и строгий старый guard;
  подготовка реальной объявленной `.pnpm` directory до SDK, без marker/fake manifest.
- [Metadata decoder](../apps/desktop/src/main/managed-cache-metadata.ts) сохраняет
  старые записи читаемыми, но unsafe legacy identity не становится authority.
- [Configuration](../apps/desktop/src/main/managed-pnpm-lock.ts) содержит будущий
  commandProfile v5 и targetPreparation discriminator; старые generations не переопределены.
- Исправлен canonical-decimal край с terminal newline в desktop validators/tests.
- Exact-native локальный пакет до последней интеграции: по отчёту исполнителя
  **8 pure tests passed**, scoped types/format passed. Это не проверки всего текущего WIP.

### Archive-before-delete — согласовано владельцем, но НЕ выполнено

Владелец разрешил полную проверенную копию реальных partial-деревьев и link metadata
перед snapshot-bound удалением под новым admission/fence, резерв копии до 256 MiB.
Исходный installed target не должен превращаться в новый SDK-created capability.

- Добавлены [manifest/metadata](../apps/desktop/src/main/managed-verification-archive-metadata.ts),
  [snapshot](../apps/desktop/src/main/managed-verification-archive-snapshot.ts),
  [paths](../apps/desktop/src/main/managed-verification-archive-paths.ts) и
  [link-aware removal](../apps/desktop/src/main/managed-verification-archive-remove.ts).
  Deletion требует opaque in-memory capability, explicit roles и synchronous gate
  непосредственно перед каждым unlink/rmdir; serialized receipt не является grant.
- Независимый review первоначального file-blob backend нашёл durability gap:
  file fsync + reopen/hash не гарантируют сохранение новых directory entries при
  power loss. Настоящая диагностическая directory fsync на Windows вернула EPERM.
  Это не sandbox denial; ACL/права не ослаблялись. Старый file backend **не применялся**.
- Вместо него подготовлены [SQLite store](../apps/desktop/src/main/managed-verification-archive-store.ts)
  и [adapter](../apps/desktop/src/main/managed-verification-archive-sqlite.ts):
  реальные BLOBs/manifest в существующей application DB, не base64 settings.
- Core API [repository](../packages/core/src/db/verification-archive.ts),
  [durability](../packages/core/src/db/verification-archive-durability.ts),
  [schema](../packages/core/src/db/verification-archive-schema.ts),
  [write protocol](../packages/core/src/db/verification-archive-write.ts),
  [guards](../packages/core/src/db/verification-archive-guards.ts) подключён к
  [AppDb](../packages/core/src/db/appdb.ts) как `verificationArchives`.
  Предусмотрены WAL/FULL readback, успешный FULL checkpoint с busy=0 и полным
  количеством frames, exact existing-DB pin, immutable sealed data, project/UUID
  scoping и gates перед SQL writes/commit/checkpoint. Constructor не создаёт архив.
- `verify-only` capability не разрешает deletion. `delete-ready` должен появляться
  только после настоящего durability barrier и полной повторной проверки BLOBs,
  manifest, native DB identity и оставшихся originals.
- [SQLite WAL contract](https://sqlite.org/wal.html) использован как основание дизайна,
  **не как подтверждение выполнения нашей реализации**. Runtime versions проверены
  без открытия DB: обычный Node 24.9.0 / SQLite 3.50.4; Electron 44.4.5 / SQLite 3.53.4.
  В core добавлен write guard для известного WAL-reset bug; старый Node не должен
  использоваться для archive writes, readonly inspection отдельно допустима.
- Core follow-up по отчёту исполнителя: **10 pure protocol tests passed**, scoped
  core types/format passed. SQL schema/triggers, настоящие SAVEPOINT callbacks,
  checkpoint failure paths и actual archive I/O **не проходили runtime-проверку**.
- Desktop SQLite-helper tests написаны; последний новый набор целиком не запускался.

## 4. Известный незавершённый WIP — с него начинать при отдельном продолжении

1. [Sixth journal](../apps/desktop/src/main/verification/cache-archive-sixth-journal.ts),
   [runner](../apps/desktop/src/main/verification/cache-archive-sixth-run.ts) и
   [inspection](../apps/desktop/src/main/verification/cache-archive-sixth-inspection.ts)
   ещё используют старый `evidenceDirectory` API и не адаптированы к SQLite receipts.
   В runner остаются незавершённые ссылки/импорты. Текущее desktop-дерево **нельзя
   считать compileable/готовым к live**: финального успешного typecheck/build нет.
2. Связать SQLite archiveId/project/subject/native DB pin и manifest SHA с immutable
   approved snapshot; реализовать pre-open pin существующей DB, без create-missing fallback.
3. Уточнить reserve с учётом DB/WAL growth, backlog, page size, manifest и overhead;
   не выходить за согласованные 256 MiB. RAM controller в draft — 512 MiB.
4. Закончить безопасную retry/replay/state-machine интеграцию и отдельный scoped
   driver. Archive live entrypoint и launcher ещё не созданы.
5. Пройти независимый review **фактической** SQLite/domain интеграции, scoped types,
   lint/format/tests/build и реальный read-only preflight. Последний родительский
   desktop tsc завершался с ошибками; часть narrowing ошибок исправлена, но после
   замены backend общий прогон не повторён.
6. Проверить покрытие exact-native identity в общих cache helpers перед заявлением
   end-to-end гарантии; сделанный рефакторинг ограничен private pnpm layout.
7. Только после этого возможен согласованный archive-before-delete recovery,
   durable-copy verification, cleanup/replay/preservation postcheck. Затем — новый
   pnpm-only publication/original-lock reuse/eviction, а не слепой retry.

Последняя прошедшая стандартная сборка и пакет **44 passed / 2 skipped** относятся
к v4 **до** нового archive/native WIP и не подтверждают сегодняшнее дерево.
Полный suite, RC-4, BuildKit solve, службы проекта и установка в основном checkout
не выполнялись. Прежние проверочные результаты не переименовывать в текущую приёмку.

## 5. Остановка

На момент фиксации нет running background jobs и работающих подагентов.
Цель paused/disarmed; автоматическое продолжение не должно запускаться без нового
прямого поручения владельца. Docker Desktop, ранее разрешённый к запуску, не
останавливался: это затронуло бы существующие чужие контейнеры. Retained partial,
резервации, исходники, старые proofs/journals и весь dirty working tree оставлены.
Git status содержит много более ранних изменений: не приписывать весь diff этой
сессии, не делать reset/clean, не удалять unknown файлы и не коммитить весь tree.
