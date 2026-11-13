# RC-3 — scoped recovery третьей cache-попытки

Дата: 12.11.2026. Статус: **первый пункт выполнен**. RC-3 остаётся **OPEN**.
Основание: прямое поручение владельца «делай первый пункт» после локальных
[исправлений и проверок](archiagent-resource-rc3-local-review.md).

## Разрешённая область

- Только SDK-failed intent `a316594d-37b4-4863-b107-ac40437ac9a9`, generation 1,
  зарегистрированная Stolovka.pro `b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b`.
- Только положительно проверенные собственные artifact/scratch/input trees.
  Основной checkout, исходники, refs, история и чужие ресурсы не являются целью.
- Новые pnpm installs, BuildKit solve, проектные службы, модель и общий workflow
  recovery не запускаются. Это не cache publication/reuse/eviction acceptance.
- Используется штатный отдельный Electron driver с exact project/phase/failed-intent
  selectors, scoped database и отдельным fresh controller admission.

## Предварительная проверка

Перед эффектами выполнен настоящий read-only preflight на текущем коде:
[reconciliation preflight](../apps/desktop/src/main/verification/cache-verification-reconciliation-replay.test.ts) — **6 passed**, включая один
opt-in case полного selected-attempt plan/native/ledger inspection.

Подтверждены отсутствие старого исполнителя, exact source inputs, native identities,
original retained reservations/fence, два неизменных прежних journals/proofs:

| Область | Логические bytes |
| --- | ---: |
| Artifact, 52 архива, 1164 файла / 245 директорий | 25 427 010 |
| Scratch | 29 453 |
| Input staging | 13 907 |
| Всего | 25 470 370 |

Accounted artifact bytes совпали с физическими; unjournaled delta = 0.
Complete unique expansion: 9 468 521 bytes / 1925 nodes, включая shim reserve.
Это не факт успешной установки пакетов.

## Исполнение и доказательства

Штатный driver собран на текущем коде и выполнен с exact failed intent:

- **22:08:07–22:15:38 МСК**: [основной proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-34caf2d2-328a-4934-9363-5c4923b2e108/proof.json>),
  exit 0, `passed=true`, `alreadyComplete=false`, journal `complete`.
- Удалено **25 470 370 logical bytes**. Физическое отсутствие трёх exact targets
  подтверждено driver validator и отдельно через native `lstat` после повторного запуска.
- Source lease `fa9ac833-12c7-4755-bf49-2ab5d796b804` и dependency lease
  `af857f4d-3988-440d-84be-74e45391c5c5`: `released`, revision 4, только после
  physically settled effects. Новый controller `0443acfd-5c60-4f2c-87a4-fae7607b10a3`
  также released; у persistent source нет orphaned consumers.
- Source fingerprint: 1545 файлов / 117 685 739 bytes,
  `2922158684fa3b364e42df257501906dc51a89ba0b8e00c59a0e526fa1228d7c` — неизменен.
  Source/history/branches, project/run/runtime и Docker/worktrees совпали до/после.
- **22:16:30–22:16:58 МСК**: [безопасный повтор](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-a76fa812-45c6-4fa4-b96d-e10a9259d08f/proof.json>),
  exit 0, `passed=true`, `alreadyComplete=true`; новый controller не создавался.
- [Durable postcheck](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-a76fa812-45c6-4fa4-b96d-e10a9259d08f/postcheck.json>)
  в 22:18 МСК: journals глубоко равны, SHA256 их JSON serialization совпадает;
  original/final leases совпадают полностью, включая revisions и timestamps;
  один preparation/session, все 9 итоговых leases проекта released.
  Protected/foreign fingerprints одинаковы на всём интервале обоих запусков.

Во время исполнения отдельной read-only SHA256-проверкой подтверждена неизменность:

- первого recovery proof: `de24b45b0de11fcd980564ddae54c05fa00f7d257ca8b47aabfe89dd47ff8a68`;
- второго recovery proof: `3bcbc4e4030af4cabcd3a19c708d151bd8ce36211470175795db97ab76576709`;
- исходного third-failure proof: `dfbbe9632f4e60378cabddd290db99cd5bf33ead1ba62eddb9ef1dcf8b043103`.

Эти три immutable proofs и оба прежних journals повторно проверены driver перед
completion; финальный postcheck подтвердил прежние SHA256 proofs после обоих запусков.
Продуктовый код в этом поручении не менялся; driver пересобран перед каждым запуском.
Новая полная сборка/тестовая матрица ради документации не запускалась; коммита нет.

## Границы

Безопасный повтор завершённого recovery не является fault-injection crash/replay.
Mid-delete revocation, авария ОС, stress, полный recovery RC-4 и pnpm/BuildKit live
acceptance этим пунктом не закрываются. Освобождение логических bytes и учётных
резервов не означает доказанный физический прирост свободного места/RAM хоста.
