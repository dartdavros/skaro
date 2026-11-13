# RC-3 — итоговая локальная приёмка 13.11.2026

**RC-3 завершён в согласованной области, критерии 8/8.** Реальная приёмка
pnpm и BuildKit закрыта. Изменения остаются в рабочем дереве; коммита и релиза нет.
RC-4 и общая приёмка AG-1 этим не закрываются.

## Настоящий BuildKit: cold → warm → eviction

Run `e350f566-c0a0-4acc-b0ed-4d545a479226`, **05:29:48–05:37:12 МСК**,
exit 0, `passed=true`:
[неизменяемый proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-buildkit-e350f566-c0a0-4acc-b0ed-4d545a479226/proof.json>).
Proof SHA-256:
`cea2f22fb139b2b93636222f809634ee930aa59558e53cc4a65a86e011afa95a`.
SHA-256 фактически исполнявшегося Electron bundle:
`32d5e7ac7db12d68799757facf634576f75a0f32d0267dbc31fff9c106550fa3`.

Использован только разрешённый backend зарегистрированной Stolovka,
project `b1a0a1fc-5435-4b37-a30a-c2b3d6c06f1b`. Source/frozen digest:
`065f8ca56fe09e035ab1b0c831c66c478fa1bd90c621bee8cdb5cc9ad7ef5a12`.
Recipe digest:
`9562759c2d8e329b866c25c2f80edc2a36cba207ff0c3ef19fa2fe48dce08b15`.
Source: 756 файлов / 2 112 137 bytes. Ни исходники, ни службы проекта не менялись.

| Проверка | Наблюдавшийся результат |
| --- | --- |
| Пустой cold cache | Штатный sweep только собственного builder, точный DU=0 под новым live admission |
| Cold | Оба source-bound RUN завершены, `observed=true`, `cached=false` |
| Warm | Оба RUN завершены, `observed=true`, `cached=true`; тот же frozen digest |
| Mandatory LLB gate | Перед каждым solve проверены два exec: memory=memorySwap=536870912, cpuQuota=cpuPeriod=100000, capability `exec.meta.linux.resources` |
| Сохранённые LLB receipts | Cold digest `eb088764257a543efab0130049d00177fac755cb3a04b4ba12d06c7f6cb144dc`; warm `c5646193cce1ebaa2d0e929462dfff66cc450e5ce8bf567d58ebb200c7f2e2a2`; нормализованные per-vertex limits |
| Настоящее наполнение | Перед финальным eviction DU=319 027 826 bytes |
| Финальное вытеснение | Только собственный builder/resource/generation, точный DU=0, ready без consumer, daemon остановлен |
| Допуски | Все 5 leases released; отдельное read-only чтение SQLite после завершения: незавершённых leases проекта 0 |
| Сохранность | `protectedBefore=protectedAfter`, `foreignBefore=foreignAfter`, `objectsBefore=objectsAfter`; project state не изменён |

Resource `resource-4cf91caed15c6186e4c12bea7d911093fa14807988f87c0446ca7bd5ff08cfd1`,
generation 1; builder `skaro-owned-9828f69ffb12488a9476e611630d0ce2`.
Контейнер, образ и собственный volume сохраняются для следующего использования;
вытеснено содержимое кеша. DU=0 не выдаётся за физически освобождённые байты
файла Docker VM или хоста. Общий Docker prune не выполнялся.

Стандартный egress разрешён владельцем для exact source; это не domain/LAN
firewall. Output — `cacheonly-no-deploy-image`. Raw LLB/source/logs не включены
в proof; сохраняются digests, normalized limits и source-bound RUN receipts.

## SQLite recovery и pnpm

| Сценарий | Фактическая приёмка |
| --- | --- |
| Шестая остановленная попытка `dec8f960-57e1-48eb-ac7b-2eb2c5089c43` | [SQLite archive-before-delete proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-archive-reconciliation-0bb03363-fa0d-4d9e-a35f-9800d15241f3/proof.json>), passed; только после проверенной долговечной копии удалены три явно разрешённых partial-дерева; leases released |
| Архив | ID `f5289b8f-cdc3-4222-9854-b423598b749b`; manifest SHA `855d0a1ca6efed914fade2f6ba24fdd5ff529abb01a3506a0d3e0842147482bc`; 8 282 узла, 6 738 файлов, 64 931 302 исходных логических bytes; архив остаётся в SQLite |
| Безопасный replay | [Proof](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-archive-reconciliation-6bb87bec-cf0b-41aa-bbe5-a633514492ef/proof.json>), passed, alreadyComplete/replayUnchanged |
| Настоящий pnpm | [Publication/self-check/offline x2/eviction](<C:/Users/drmar/AppData/Roaming/Skaro/verification/cache-workflow-cc36357a-9859-4dd8-97d3-172576307b47/proof.json>), 02:51:39–03:20:19 МСК, passed, все 5 leases released |
| Immutable pnpm store | 28 002 625 bytes; digest `aa2495dd74c990b5cd3f31e03fadc360077477cbae3a1ef80202ded0c3685e4b` не менялся при двух offline consumers; original lock сохранён, lifecycle scripts/shims не исполнялись |

Во всех сценариях защищены source, refs, история и чужие ресурсы.
Неуспешные попытки не переписаны: ход восстановления и первичные причины
сохранены в [resume](archiagent-resource-rc3-resume-2026-11-13.md) и
[BuildKit follow-up](archiagent-resource-rc3-buildkit-followup-2026-11-13.md).
Usage-only recovery/replay также passed, без старта daemon или удаления данных.

## Сверка критериев RC-3

Критерии [плана ресурсов](archiagent-resource-plan.md#rc-3--освобождение-кеши-и-чтение-истории)
оценены по совместным live и целевым контрактным доказательствам. Это не
заявление выполнения каждого разрушительного/fault сценария в живой системе.

| № | Критерий | Доказательство и граница |
| --- | --- | --- |
| 1 | Активные потребители и постоянное окружение сохранены | Cat-pilot T-005: повтор cleanup удержал generation 2 с `active-consumer`; main/T-010/local-version/refs/20 logs сохранены. Guards admission/stop проверены целевыми тестами |
| 2 | Разрешённый disposable checkout удалён, история и неизвестные ресурсы сохранены | T-005 generation 1 физически удалён, branch/commit сохранены; scope/ownership guards и source/Docker before/after прошли. Байты чужих volumes не аудитировались |
| 3 | Незавершённые/review/уникальные данные не удаляются по TTL/диску | Retention policy и generation guards проверены тестами; реальные retained cache failures удерживали данные и capacity до явной сверки, шестая попытка архивирована до разрешённого удаления. Реальная pressure/fault матрица — RC-4 |
| 4 | История без materialization/служб | T-005: exact bytes из Git, history/export/diff/path guards; worktree и Docker objects не создавались историческим чтением |
| 5 | Явное восстановление exact revision через lease | T-005: commit `f9c6a4e87a1ab11d835be02d5a581349e1abd247`, generation 2, новый released admission; mismatch не подменяется другой версией |
| 6 | Cache eviction ограничен собственными неиспользуемыми объектами | Настоящие pnpm/BuildKit циклы выше + exclusive live grant/fence и policy/ownership tests. Общий cache и чужие объекты не присваивались; private/secret inputs отклоняются контрактом |
| 7 | Нет global prune/выхода по ссылкам/неограниченного кеша | Только own immutable generation и dedicated builder; bounded accounting, native identity/path guards и policy tests. Hostile concurrent writer и hard filesystem quota не заявляются |
| 8 | Cleanup не требует модели и сохраняет исходы после reopen/ошибок | Реальные scoped cleanup/cache drivers без модели, model=0; SQLite handle/reopen tests, durable failure journals и успешные recovery/replay. Неопределённый executor удерживается fail-closed; OS crash/quota exhaustion — RC-4 |

Cat-pilot proof: [T-005](<C:/Users/drmar/AppData/Roaming/Skaro/verification/reclamation-workflow-e48ca0cf-e510-47a0-9857-3e3df761b33a/proof.json>),
повторно прочитан как `passed=true`, SHA-256
`76490a1fc8d90ce0bc5acb39b56e07c5494d76a3878fb7f43fda3d629f5301d8`.
Подробные исходные границы — в [отчёте RC-3](archiagent-resource-rc3.md).

## Итог проверок и следующие этапы

- После последних изменений: **5 файлов / 12 целевых тестов passed** — progress,
  LLB limits, BuildKit metadata/DU, live authority, SQLite reconciliation.
  Более ранние целевые пакеты и фактические preflight перечислены в исходных отчётах.
- Backend TypeScript, scoped ESLint и Prettier прошли. Последняя штатная
  `pnpm build` завершилась с exit 0 в 05:29 МСК; предупреждения сторонних библиотек сохранены.
- NO GOD: проверены затронутые модули, максимум 290 строк; progress, input,
  runtime, policy и verification responsibilities разделены.
- UI не изменён. Browser/UI, полный тестовый прогон, crash/stress/quota fault
  injection не выполнялись и не объявляются пройденными.

Дальше по плану: AC-4, оставшаяся C4-2 (backend начат, приёмка открыта), RC-4,
AC-5, C4-3 и AG-1. Новые UI-состояния требуют design gate AC-4. Разрешения
на релиз, commit или автоматическое выполнение следующих этапов нет.
