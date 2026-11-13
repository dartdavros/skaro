# RC-3 — освобождение ресурсов, кеши и исторический доступ

Даты: 12–13.11.2026. Статус: **завершён, локальная приёмка 8/8**.
[Итоговые proof и границы](archiagent-resource-rc3-acceptance-2026-11-13.md):
настоящие pnpm publication/offline x2/eviction и BuildKit cold/warm/eviction прошли.
SQLite archive-before-delete recovery/replay шестой попытки также пройдены;
удалены только три явно разрешённых partial-дерева после долговечной копии.
[Checkpoint остановки](archiagent-resource-rc3-stop-2026-11-13.md) и
[ход продолжения](archiagent-resource-rc3-resume-2026-11-13.md) сохранены.
Изменения находятся в рабочем дереве; коммита/релиза нет, RC-4 и AG-1 не закрыты.
Основание: [план ресурсов](archiagent-resource-plan.md#rc-3--освобождение-кеши-и-чтение-истории)
и [контракт ресурсов](project-resources.md).

## Разрешённые границы текущей проверки

Владелец разрешил запуск Docker Desktop и штатного Cat-pilot, а также цикл
очистки/исторического чтения/явного восстановления завершённой T-005. Разрешение
не отменяет guards: точная публикация, зарегистрированное disposable-владение,
отсутствие потребителей, чистота checkout и сохранность ветки/истории обязательны.
Разрешено освободить только закрепление T-005 от предыдущей проверки.
T-010, основная копия, постоянные и неизвестные ресурсы не являются целью удаления.

Проверочный запуск ограничен зарегистрированным Cat-pilot до `createServices`.
До старта служб выполняется preflight реального checkout и состояния recovery;
остальные зарегистрированные ресурсы защищаются временными verification consumers.
Это настоящие потребители проверки, не искусственные данные приложения.
После завершения снимаются только собственные временные закрепления.

Владелец согласовал отдельные управляемые кеши и выделенный BuildKit builder,
при необходимости официальный образ; общий Docker/npm/pnpm cache не присваивается.
Лимиты на приложение, не на каждый проект:

| Кеш | Объём | Число объектов | Простой |
| --- | --- | --- | --- |
| Исторические экспорты | 128 MiB | 256 | 7 дней |
| Зависимости | 1 GiB | 32 | 14 дней |
| BuildKit | 2 GiB | Ограничивается политикой выделенных builders | 7 дней |

Срок не разрешает удаление активного, неизвестного или изменённого объекта.
При невозможности безопасного вытеснения новая работа удерживается по бюджету.

Позднее владелец разрешил настоящую Stolovka.pro только для cache-приёмки.
Read-only preflight gateway/backend и адаптеры проверены отдельно; службы,
миграции и исходники проекта не менялись. Точные границы, fingerprints и
открытые шаги — в [расширении кешей](<archiagent-resource-rc3-caches.md>).

## Lifecycle и взаимное исключение

Журнал шагов разделён по resource ID, generation и шагу. Legacy-запись читается
только при полном совпадении идентичности; завершение старой попытки не может
переписать checkpoint нового поколения. Исполнение одного эффекта сериализуется.

Повторные проверки потребителей сами по себе не исключают нового потребителя
между проверкой и удалением. Поэтому вводится отдельный долговечный SQLite fence:
claim, выдача/bind admission и прямые изменения consumers используют атомарную
проверку. Fence не изображает вычислительный слот и не создаёт фиктивный consumer.
Он охватывает физические эффекты, проверку результата и финальную запись реестра.

Повтор после частичного эффекта требует той же операции, поколения и источника.
Для внешнего Git/Docker-эффекта intent сохраняется до запуска. Неопределённый
внешний executor не считается завершённым только потому, что завершился PID
основного приложения: такой fence удерживается для явной сверки, без TTL.
Неограниченное автоматическое recovery этого случая не заявляется; это открытая
граница RC-4. Отдельная fenced maintenance для cache сохраняет собственный
проверенный exclusive lease до подтверждённого завершения, не освобождает его
раньше и не присваивает retained lease после перезапуска.

Удаление Docker больше не использует blanket `rm -v`. Метки — способ обнаружения,
а не право удалить объект. Точные image/network/volume identities проверяются
вместе с потребителями и provenance, записанным при успешном управляемом запуске.
Старые, общие, external, анонимные или непроверенные объекты удерживаются;
похожее имя и отсутствие другого работающего контейнера не заменяют provenance.

Периодическая/событийная уборка интеграционных checkout выбирает только допустимые
applied/stale операции без работающего исполнителя. Она не вызывает общий
workflow recovery, модель или повторный запуск задачи.

## Точная история и восстановление

- `GitSnapshot` читает проверенный commit без Git replace objects; проверка,
  список, размер и bytes используют одну семантику точной версии.
- Явное восстановление передаёт `expectedCommit` через RC-2 admission. После
  ожидания, внутри сериализованного создания, повторно проверяется сохранённая
  ветка; затем сверяются HEAD и ветка созданного checkout. Нет reset или
  подстановки актуальной ветки при несовпадении.
- `fileDiff` остаётся сравнением рабочей копии с HEAD. Удаление чистого checkout
  не превращает его в diff последнего commit. Для отсутствующей копии возврат
  `unchanged` требует сохранённого clean-proof, привязанного к resource ID,
  generation, lifecycle operation, ветке и commit. Недоказанный точный diff
  недоступен явно, а не заменяется другим сравнением.
- Перед удалением чистота staged/unstaged проверяется core-исполнителем;
  checkpoint сохраняется перед эффектами. Частично очищенная копия может
  продолжить удаление только по точному checkpoint той же операции/версии.
- Выданная наружу рабочая копия получает долговечный consumer. Завершение
  `shell.openPath`, таймер и перезапуск не подтверждают закрытие редактора.
  Такой consumer автоматически не освобождается; legacy-доступ удерживается.

## Исторические экспорты

Публикация журналируется перед записью. Полный временный файл синхронизируется,
после чего публикуется атомарной ссылкой без перезаписи существующего пути.
Проверяются digest, размер, inode/aliases и каноничность путей. После сбоя точная
запись продолжается; изменённые и неизвестные bytes не перезаписываются.
При необходимости точный новый экспорт занимает отдельный объект и бюджет.

Общий бюджет агрегируется по разрешённой области приложения; проверочный scope
не очищает чужие проекты. Выданный OS-файл закрепляется до доказанного освобождения.
Вытеснение удерживает неизвестные/изменённые файлы и hard-link aliases; изменение
атрибутов допускается только для проверенного собственного единственного файла
или точной пары временной/опубликованной ссылок одной записи.

Исходы имеют resource ID, generation и стабильную причину в долговечном реестре
и событиях. Это **не утверждение о новом отображении в UI**: общей схемы новых
cache-состояний ещё нет, она относится к design gate AC-4. Новые панели, тексты
или неподтверждённые ключи фоновой работы не добавляются.

## Управляемые кеши: фактическая поддерживаемая область

Инструменты доступны только текущему изолированному task/run. Произвольный cwd,
флаги сборки и заявленная агентом ownership не принимаются. На время preflight
и всех эффектов отдельно удерживается точный shared lease task-worktree;
неопределённое завершение дочернего исполнителя удерживает собственный lease,
даже если родительская задача уже остановлена.

Admission выполняется до общего mutex инвентаря. Для кешей используется
`wait: false`: после первого настоящего измерения недоступная capacity возвращает
точную причину, а не бесконечное ожидание под файловой блокировкой. Перед эффектами
повторно проверяются policy и inventory; изменённый план требует нового вызова.

- Прежний npm adapter: публичный package-lock v2/v3, SHA512 tarballs,
  immutable ключ и writable CAS clone; frozen offline установка без lifecycle
  scripts и command shims. Private/local/workspace/yarn/config отклоняются.
- Добавлен ограниченный pnpm10.11/lock9 adapter с отдельным packaged runtime,
  transport-only mirror, полной проверкой store и обязательным original-lock
  offline roundtrip перед `ready`. Shims допустимы только внутри нового private
  target и не исполняются; Windows junction layout не переименовывается.
  Настоящие publication/original-lock offline x2/eviction прошли 13.11.2026.
- Установка ограничена 1,5 GiB распакованных файлов / 4096 узлами; admission
  отдельно учитывает scratch, метаданные, target и консервативную RAM.
  Существующий `node_modules` не присваивается и не удаляется.
- BuildKit сохраняет bounded scratch/no-network профиль. Добавлен gated
  trusted single-stage профиль immutable official base: настоящий AST/Dockerignore
  и exact-source host approval, без переписывания рецепта. Контекст до 128 MiB /
  4096 узлов; неизвестный base/RUN peak учитывается консервативно, не как quota.
- Новый remote builder имеет точные container/volume/daemon identities, restart
  `no` и лимиты Docker. Official-image acquisition охвачен fence; перед RUN
  проверяется настоящий LLB с per-exec CPU/RAM/capability. Изолированный pinned
  client, cold без cache hit, warm с двумя cache hit и explicit own eviction
  с DU=0 реально проверены 13.11.2026. Сохранены source/history/refs/foreign objects;
  [детали и proof](archiagent-resource-rc3-acceptance-2026-11-13.md).
- Результат solve — `cacheonly`, не deploy image. Idle cache — 2 GiB, builders
  по умолчанию один на приложение. Transient/base/image бюджеты считаются отдельно;
  следующий проект получает удержание, а не неограниченное создание builders.
- Prune/solve/reconfigure и подтверждённая остановка idle daemon охвачены одним
  exact exclusive lease и durable fence. Точный DU читается через buildctl
  собственного daemon под live grant, без implicit bootstrap Buildx. При отмене
  DU не запускается через stop-only escape. Неизвестное состояние
  удерживается для RC-4; retained lease не присваивается новому исполнителю.
- Исходы сохраняются в resource ledger и deduplicated events без нового UI.

Реальная приёмка этой ограниченной области кешей закрыта. Поддержка произвольной
сборки, hard quota и полная crash/stress матрица этим не заявляются.

## Штатная проверка T-005 — успешно, 12.11.2026 14:47 МСК

[Локальный proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/reclamation-workflow-e48ca0cf-e510-47a0-9857-3e3df761b33a/proof.json>)
содержит `passed: true`, без cleanup errors. Это приёмка перечисленного сценария,
не всех критериев RC-3.

| Шаг | Фактический результат |
| --- | --- |
| Допуск | Реальная done T-005, опубликованный exact commit, чистый зарегистрированный disposable checkout; пустые runtime/admission/inbox перед services |
| Очистка | Generation 1, `worktree.remove` verified с первой попытки; checkout отсутствует, ветка и Git-история сохранены |
| История | Точные bytes экспорта совпали с Git; suggestions/existence/diff/path guards без materialization и без изменения Docker objects |
| Восстановление | Тот же `f9c6a4e87a1ab11d835be02d5a581349e1abd247`, generation 2, новый released admission `101246ee-3ec9-4289-9310-1b9a4db0b5cd` |
| Повтор cleanup | Восстановленный checkout сохранён с причиной `active-consumer` |
| Сохранность | До/после совпали source fingerprints main, T-010 и зарегистрированной local-version, branch refs и хеши всех 20 run-логов |
| Завершение | Временных verification pins и cleanup fences не осталось; runtime не запущен |

Исходный/восстановленный checkout: 10 исходных файлов, 27 750 логических байт,
одинаковый fingerprint. Разницу свободного места хоста не выдаём за объём
освобождённых данных: метрика зависит от параллельной нагрузки и восстановления.
После явного доступа сохраняются новые generation-2 `explicit-access` и
`worktree:access` consumers; автоматически снимать их без доказанного освобождения
нельзя. Это не старое generation-1 закрепление, которое владелец разрешил снять.

Экспорт реально прочитан `verification-readFile`; нативный редактор не запускался.
Ignored bytes и содержимое постоянных/неизвестных Docker volumes не хешировались:
для них подтверждена защита реестром/consumers, а не побайтовый аудит томов.

Предшествующий запуск `reclamation-workflow-8b6c0a2f-bd80-4dbd-9101-07e6f124c227`
остановился ДО pin release/cleanup на timeout read-only `docker system df`.
Он не считается успешным; сохранён отдельно. Перед повтором исправлено разрешение
относительных run-log paths от dataDir, а для холодной Docker-инвентаризации
увеличен timeout до 120 секунд. Никакой Docker-ответ не подменялся.

## Ограничения приёмки

- Предыдущий `reclamation-workflow-3504b104-ed03-4dbf-bccb-d7059dd89d03`
  завершился ошибкой сравнения `done` и `review`. Его историческое чтение не
  считается успешной полной приёмкой RC-3, а proof не переписывается.
- У штатного Cat-pilot нет lockfile зависимостей и Dockerfile. Проверку реального
  наполнения/использования/вытеснения cache выполнена на отдельно разрешённой
  настоящей Stolovka. Пустой builder и искусственная инфраструктура не использованы.
- Не создаются fake backend, mock API, fixtures, seed, искусственные файлы/тома
  для демонстрации освобождённого места; общий Docker prune не выполняется.
- Логические размеры файлов, Docker usage и свободное место хоста измеряются
  раздельно; изменение свободного места не приписывается очистке без доказательства.
- Авария ОС, реальное исчерпание quota, многозадачный stress и полный recovery
  остаются отдельной приёмкой RC-4/AG-1. Их нельзя заменить описанием кода.

## Текущие целевые проверки

12.11.2026 выполнены следующие проверки основной сессией:

| Проверка | Результат |
| --- | --- |
| Cleanup + точная история, повторный общий прогон | 19 файлов / 49 тестов, успешно, 14:41 |
| Политика/metadata кешей, provenance, bounded build, fail-fast admission | 5 файлов / 18 тестов, успешно, 14:40 |
| Worktree deletion/resource records | 3 файла / 4 теста, успешно, 14:41 |
| Регрессии реестра ресурсов и учёта capacity | 2 файла / 5 тестов, успешно, 12:47 |
| Cleanup/reconciliation, cache adapters, изолированный Docker, host-source contract и настоящий read-only preflight | 4 core + 10 desktop файлов / 55 тестов, успешно, 19:24 |
| TypeScript desktop backend после текущей интеграции кешей | Повторно успешно после 55 тестов |
| TypeScript core/MCP | Повторный прогон успешен |
| Svelte check текущего renderer | Повторно 0 ошибок / 0 предупреждений |
| Prettier + ESLint итоговых cache-модулей и wiring | Успешно, файлы ≤300 строк после форматирования |
| Штатная сборка `pnpm run build` | Повторно успешно после текущих 55 тестов, exit 0; предупреждения сторонних библиотек |
| Новый scoped live-протокол T-005 | Успешен, `passed: true`, 14:47; границы описаны выше |

Общий целевой прогон:

```powershell
pnpm exec vitest run `
  packages/core/src/db/resource-cleanup.test.ts `
  packages/core/src/db/resource-cleanup-stop.test.ts `
  packages/core/src/db/resource-cleanup-handles.test.ts `
  packages/core/src/db/admission.test.ts `
  packages/core/src/git/completed-worktree-diff.test.ts `
  apps/desktop/src/main/environment-stop-authority.test.ts `
  apps/desktop/src/main/resource-lifecycle.test.ts `
  apps/desktop/src/main/environment-docker-ownership.test.ts `
  apps/desktop/src/main/environment-resource-guard.test.ts `
  apps/desktop/src/main/integration-resource-retention.test.ts `
  packages/core/src/git/worktree-path-guard.test.ts `
  apps/desktop/src/main/integration-retirement-policy.test.ts `
  packages/core/src/git/snapshot.test.ts `
  packages/core/src/git/worktree-create.test.ts `
  apps/desktop/src/main/task-worktree-retention.test.ts `
  apps/desktop/src/main/history-file-metadata.test.ts `
  apps/desktop/src/main/history-file-records.test.ts `
  apps/desktop/src/main/history-file-storage.test.ts `
  apps/desktop/src/main/history-path-guard.test.ts
```

Используются реальные Git-объекты и файлы репозитория, реальные SQLite handles
(включая повторное открытие), SQLite в памяти и чистые проверки контрактных
metadata, без поддельных проектных checkout/сервисов. Проверен настоящий путь
`ApplicationResources.stopOwner` → сохранённый `HeldResource` → разрешённый
stop-only teardown, а не только эквивалентная запись состояния вручную.
Итоговая сборка, последние 12 целевых тестов и реальная cache-приёмка 13.11
перечислены в [закрытии RC-3](archiagent-resource-rc3-acceptance-2026-11-13.md).
Fault injection внешних executor, симуляции junction-race и стресс не выполнялись.
