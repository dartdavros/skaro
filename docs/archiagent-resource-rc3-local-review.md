# RC-3 — исправления и локальная проверка 12.11.2026

Статус: **RC-3 OPEN**. Это не live-приёмка и не релиз.
Этот отчёт фиксирует локальный этап: на нём владелец разрешил только исправления
и локальные проверки; recovery, pnpm installation, BuildKit и службы не запускались.
Позднее отдельно разрешён и успешно выполнен только [recovery третьей попытки](archiagent-resource-rc3-third-recovery.md);
это не pnpm/BuildKit live-приёмка.
Основной контракт — [RC-3](archiagent-resource-rc3.md),
история кешей — [расширение](archiagent-resource-rc3-caches.md).

## Сохранённое настоящее состояние

Два recovery выполнены ранее успешно. Второй:
[proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-reconciliation-9bcb28e8-c566-4f16-8be2-1f20ed83cf6d/proof.json>),
завершение 12.11.2026 20:21 МСК, `passed=true`, 25 230 371 logical bytes.
Это не новая очистка текущей сессии.

Третья попытка `a316594d-37b4-4863-b107-ac40437ac9a9` завершилась в 20:42 МСК
с generic SDK command error, `passed=false`:
[proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-a316594d-37b4-4863-b107-ac40437ac9a9/proof.json>).
Source lease `fa9ac833-12c7-4755-bf49-2ab5d796b804` и dependency lease
`af857f4d-3988-440d-84be-74e45391c5c5` сохранены retained; не освобождались.

Настоящий read-only regression test после изменений подтвердил:

- все 52 исходных архива, mirror, пустой приватный target и полные unique counters;
- artifact 25 427 010 bytes, scratch 29 453 bytes, stage 13 907 bytes;
- неизменность обоих прежних recovery journals/proofs;
- отсутствие journal третьего recovery; никаких admission или cleanup effects.

Полные archive facts не означают успешной установки.

## Исправления

1. **Удаление recovery.** Проверенная surviving native inventory передаётся
   непосредственно deleter, без принятия нового сканирования за исходное.
   Primitive identities, children и digests копируются до await. Проверяются
   ancestors и ожидаемый оставшийся child set; он сокращается только после
   успешного собственного удаления. Каждый файл bounded-stream перечитывается
   с SHA256 перед unlink. Одиночный file-root также поддерживается.
2. **Authority каждого эффекта.** Cancellation/live-controller/exact fence gate
   выполняется перед каждым destructive syscall, не только перед первым в дереве.
3. **Полнота установленного graph.** Проверяются обязательные production,
   development и transitive edges, manifest identity/version/digest, отдельные
   snapshot/peer-context physical roots, bin providers/targets и Windows shim
   suffixes. Manifest/bin facts формируются из проверенных архивов, записываются
   исключительно в immutable artifact и читаются из проверенного clone до SDK.
   Missing facts — fail-closed. Новый configuration discriminator меняет cache key,
   не переопределяя исторические retained generations.
4. **Node resolution shadowing.** Независимый review выявил дополнительный обход
   через nested payload node_modules и file-before-directory `.js/.json/.node`,
   включая scoped и hoisted fallback. Все nodes вне bound package payloads
   проверяются structural whitelist; вложенные payload resolution scopes принимают
   только точные разрешённые self-dependency links/bins.
5. **Runtime budget.** Порядок: pinned archive inspection → aggregate sweep →
   durable expansion precharge → extraction → physical recount. Наблюдаемый
   host-side отказ пересчитывает только собственный settled tree; при неизвестном
   исполнителе/нечитаемом дереве сохраняется прежний charge, не нулевой размер.

## Границы проверки

- Unit-тесты удаления проверяют metadata/inventory переходы на прочитанных настоящих
  файлах репозитория, без fixture trees или физического удаления.
- Graph/budget tests — чистые bounded protocol metadata, без SDK и поддельной
  инфраструктуры. Это не доказательство совместимости итогового pnpm layout.
- Graph validation не заявляет полного byte-for-byte attestation всех payload files.
  Отсутствующие optional ветви допустимы; присутствующая ветвь проверяется строго.
- Между последней проверкой pathname и unlink/rmdir остаётся OS TOCTOU.
  Защита от произвольного hostile concurrent filesystem writer не доказана.
- Mid-delete revocation/crash interleavings, descendant closure и производительность
  не проверялись runtime fault injection.
- UI не менялся; browser/UI, полный тестовый прогон и live-приёмка не выполнялись.
- Разрешение на exact-source BuildKit было получено ранее, но прогон не выполнен.

## Итог локальных проверок

| Проверка | Результат |
| --- | --- |
| Независимый review удаления | Прежние два findings закрыты на уровне кода; новых blocker не найдено |
| Точечный retry независимого review resolution guard | Успешно; перечисленные shadow обходы не найдены в итоговом guard |
| TypeScript desktop backend | Успешно после исправления narrowing; повторно после последнего guard |
| TypeScript core/MCP | Успешно |
| Scoped ESLint и Prettier | Успешно после последнего guard |
| Целевые unit/contract tests | 17 файлов, 73 passed / 6 skipped после последнего guard |
| Настоящий retained third-attempt inventory read-only | 1 passed; 52 архива, оба прежних journals/proofs неизменны |
| Штатная сборка `pnpm run build` | Повторная итоговая сборка exit 0 после последнего guard |

Итого 74 выполненных целевых теста, не полная тестовая матрица. Пропуски —
отдельные opt-in preflight cases, не объявленные успешными. Итоговый guard
проверен после ограниченного retry review-агента; сбои до retry не считаются review.
Сборка оставляет предупреждения сторонних Zod/Claude SDK/web-tree-sitter и о
смешанном static/dynamic import task-environment-version; они не скрыты и не
считаются ошибками текущих cache-модулей. Коммит не выполнялся.
