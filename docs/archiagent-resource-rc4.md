# RC-4 — восстановление и измеримая приёмка ресурсов

Дата: 13.11.2026. RC-4 завершён в проверенной области, локальная приёмка 8/8.
Реализация остаётся в рабочем дереве.
Основание — [план ресурсов](archiagent-resource-plan.md),
[контракт](project-resources.md), результаты RC-3, AC-5 и C4-2.
Коммит и релиз Skaro не выполнялись.

## Изменения runtime

1. Подготовка worktree проходит общий admission **до** создания каталогов
   и изменения generation в ledger. Вложенный `ResourceGit` использует тот же
   permit; второго резервирования нет. Чужой execution owner отклоняется.
   Раньше остановка в ожидании бюджета могла оставлять изменённую generation
   без созданного checkout.
2. Recovery настоящей частичной очистки больше не блокирует себя повторной
   записью неизменившихся source/consumers до входа в cleanup fence.
   Сам fence не ослаблен: изменившийся источник или потребители удерживают
   ресурс с причинами `cleanup-source-changed` / `cleanup-consumers-changed`.
   Неизвестный внешний executor не объявляется завершённым.

Измерения, наблюдение обрыва, чтение сохранённых proof и сценарии разделены
в небольшие verification-модули. UI, дизайн, тексты экранов и настройки
уведомлений пользователя не менялись. Проверочный scoped instance использует
ранее реализованный silent mode.

## Реальный контур

Только Cat-pilot `78bc2cd3-981b-40ed-a395-c6c6bc7da51b`, scope установлен
до `createServices`. Chatballs и другие проекты не запускаются/восстанавливаются.
Новых API, серверов, fixtures, seed-данных или подставных задач нет.

Объект очистки — ранее реально завершённый и опубликованный T-013:
`resource-4a486ab77d59c945264544db28ee6792c3eab04b1707739044e1b0e8f526e46e`,
точный source commit `75138acc5cd1a769fc2ade158144454c1fa1ec26`.
Использован действующий контракт завершённого disposable checkout.
Остальные ресурсы защищены отдельным настоящим verification consumer;
существующие preview pins T-005/T-010 и неизвестные данные не снимаются.

До проверок: долговечная SQLite-копия, fsync, integrity `ok`, SHA256
`1810280d36c27b4342ee92e7d38ba84819a3e6686af0003b9f4c39db2f9d531c`.
Каталог `rc4-preflight-373a62bf-5174-47dc-b015-c43487f1d8bf`.
Новая миграция схемы для этих исправлений не нужна; проверяется повторное
открытие текущих реальных записей и сохранность их идентичности/generation.
Старые неизвестные записи не получают задним числом право удаления.

## Выполненные живые сценарии

- Реальное чтение `index.html` под shared lease, аварийный выход владельца
  через `app.exit(75)` без release. После restart grant стал retained;
  collector сохранил checkout с `active-consumer`. Только после проверки
  завершения прежнего OS owner и отсутствия внешнего executor lease отпущен.
  Возраст записи не использован как разрешение очистки.
- Настоящий Docker CLI получил несуществующий named-pipe endpoint только
  в процессе проверочного клиента. Никакой daemon или чужой контейнер
  не останавливался. Collector сохранил checkout с `docker-unavailable`.
  Следующий процесс использовал штатный Docker и заново проверил mounts.
- Реальный обрыв очистки в generation 1: `index.html` уже удалён, `.git`
  ещё присутствует, lifecycle `running`, tracked-clean proof записан,
  `externalPending=false`. Наблюдатель сохранил checkpoint/fsync и вызвал
  `app.exit(76)`. Журнал не создавался искусственно.
- Production recovery завершил ту же операцию
  `5dd6e870-bf62-485e-a2ea-7be40ed2f842`, без ручного снятия fence или
  изменения generation. Дополнительный sweep не изменил verified checkpoint.
- При реальном настроенном RAM reserve ожидание не создало checkout и
  не изменило generation. Остановка сохранилась после возврата бюджета.
  Затем два штатных восстановления exact revision и cleanup прошли в
  generations 2/3; старый event не исполнил действие над новой generation.
  Это повтор resource lifecycle существующей опубликованной задачи,
  не два новых цикла разработки с моделью.
- Для одного настоящего read-only Codex-клиента (`gpt-6.1-sol`, тот же
  `managed:codex`) задан недоступный proxy только в env дочернего процесса.
  Порт предварительно проверен как закрытый; сервер не создавался.
  Native session `01a1d482-3717-7440-842e-d4e7718cbdaf` выдала настоящий
  transport retry. Пока она ожидала повтор, housekeeping отработал без модели;
  затем PID+birth клиента остановлен и capacity освобождена. Это подтверждённая
  ошибка клиента и остановка владельцем, не выдуманный terminal/provider outcome.
- Реальная политика существующего аккаунта дала `waiting_quota` с причиной
  `account_quota_unknown_or_blocked`. Остановленное ожидание не возобновилось
  после снятия cap; отдельный свежий admission прошёл. Исходная policy возвращена.
- С предзапусковой SQLite-копией сверены все **8** owner decisions, включая
  состояния и evidence; они неизменны. T-010/T-011/T-012/T-013 остались
  disabled. Итог: generation 3 released, активных reservations 0, собственные
  verification pins сняты. Пользовательские preview pins сохранены.
- Browser-проверка настоящего Cat-pilot в документированном `file://`
  совпала с ранее принятым кадром 1200×720 при 5000 ms анимации:
  `14f666eca43dba6bdd022bc299ba2c62ea2ee47959c50a16aa8b9d6b631872d6`.
  Новые UI-состояния Skaro не добавлялись и не заявляются проверенными.

Неуспешные попытки сохранены отдельно: сначала verification-драйвер пытался
добавить consumer внутрь действующего fence, затем обнаружился описанный выше
production-дефект повторной записи source. Финальное успешное восстановление
использовало исходный crash checkpoint, без сброса журнала и повторного обрыва.
Первая transport-попытка ошибочно ждала terminal outcome вместо действительного
retry notice; её exact native process остановлен, неуспешный proof/log сохранён.
Успешная проверка честно фиксирует retry boundary и последующую owner stop.

## Измерения

| Наблюдение | Фактический результат |
| --- | --- |
| Git worktrees до / после очистки T-013 | 8 → 7 |
| Логические bytes всех зарегистрированных Git worktrees | 8 109 830 → 7 824 970 |
| После двух дополнительных restore/cleanup | 7 worktrees, те же 7 824 970 logical bytes |
| Recovery частичной очистки | 5 017 ms до подтверждения результата |
| Exact restore generations 2 / 3 | 1 627 / 1 563 ms |
| Cleanup generations 2 / 3 | 5 693 / 4 685 ms |
| Остановленное RAM-ожидание | 178 ms, физического checkout нет |
| Admission reader / двух restore | 60 / 28 / 35 ms до grant |
| Остановленное account-ожидание | 1 642 ms |
| Fresh model admission после снятия cap | 30 ms; модель не запускалась |
| Успешная transport-проверка с остановкой | 18 209 ms; успешных model responses 0 |

Каждая фаза сохраняет host free/available disk, available/total RAM, память
и CPU main, Electron app metrics и OS ancestry Skaro/service children.
WMI `WorkingSetSize` — bytes; CPU сохраняется в исходных 100ns ticks.
Docker objects, `system df` и running-container stats сохраняются отдельно,
с разделением собственных Compose identities и остальных контейнеров.

Логический размер файлов, Docker accounting и свободное место хоста не
приравниваются друг к другу. Например, вокруг recovery available disk хоста
изменился с 10 052 993 024 до 10 051 788 800 bytes, несмотря на удаление
payload: фоновая нагрузка не изолирована. Эта разница не объявляется расходом
Skaro или числом освобождённых cleanup bytes. Host VM allocated bytes — `null`
с причиной отсутствия метрики; Docker cache usage её не заменяет.
Финансовая стоимость и provider billing не измерены; нулевая цена или
число израсходованных tokens не выдумываются. Split reservations без
отдельного grant event имеют `waitMs=null`, не фиктивный ноль.

## Docker Desktop и оставшиеся объекты

Первый строгий общий snapshot comparison не прошёл: исчез network ID
`3d96a98ec3cd0470329b289ad42bc68389f5e223a449ebf5eb8bb468bfcc2304`,
появился `b21e0910880035c45327abfeb934330698ff97512648b693145ac60af3b5ea00`.
Причина не была автоматически объявлена успешной очисткой.

Штатный monitor Docker Desktop сохранил `starting VM`, запуск linux/wsl
из stopped и resync этих ID в 13:24:54–13:25:13 МСК. Новый объект реально
проверен как системный default `bridge`, без Compose labels.
Имя прежнего opaque ID первоначальная метрика не сохраняла, поэтому оно
остаётся неизвестным. Перезапуск/crash daemon нами не выполнялся;
наблюдён настоящий idle wake, а не управляемая crash-проверка Docker.

Контейнеры, volumes и images совпадают с исходным snapshot. Весь список
Docker objects, включая networks, совпадает с настоящим post-wake baseline
перед `docker-unavailable`; именно после него выполнены обрыв cleanup,
recovery и два resource cycles. Исходный network drift, пути/хеши реальных
monitor logs и их точные выдержки сохранены в `finish-proof.json`.
Глобальная неизменность Docker ID от самого первого snapshot **не заявляется**.

В конце остаются 7 Git worktrees: main, существующая local version,
T-005/T-010 с пользовательскими preview-потребителями, незавершённая T-011
и два неопознанных в worktree ledger checkout (старый integration и private
merge checkout). Последние удержаны с отсутствием доказанного права удаления.
Они существовали до RC-4; новые бесхозные checkout этим этапом не оставлены.
Снятие transient reservation не считается удалением этих каталогов.

## Проверки и границы

Целевые тесты: 7 файлов / 19 passed, включая новые регрессии раннего admission
и неизменившегося/изменившегося source при действующем настоящем SQLite fence.
Используются чистые metadata checks и реальные host/SQLite observations,
не fake backend. Полный suite не запускался.
Штатная сборка main/preload/renderer, desktop TypeScript/Svelte (0 errors,
0 warnings), целевые ESLint/Prettier и whitespace check прошли.
Предупреждения сторонних библиотек при сборке сохранены в check log.
NO GOD: затронутые production/verification-модули не превышают 300 строк;
крупнейший изменённый production-модуль — 234 строки. Новый компонент UI
не создавался, design baseline не менялся.

| Критерий RC-4 | Доказательство и точная граница |
| --- | --- |
| 1. Restart сверяет ledger/Git/Docker/processes | Настоящий reader crash, retained shared lease, физическое подтверждение завершения владельца; нет TTL-based удаления |
| 2. Частичная очистка восстанавливается | Настоящий filesystem checkpoint generation 1, тот же operation ID, успешный recovery и неизменный replay |
| 3. Docker недоступен / снова доступен | Реальная ошибка подключения клиента, durable retained; новый штатный процесс заново проверяет mounts. Daemon crash не имитировался |
| 4. Модель, Stop и решения | Настоящий native transport retry, configured account wait/stop/fresh admission; 8 decisions и stopped intents сохранены |
| 5. Измерения до/после | Worktrees/logical bytes, Docker accounting, OS/Electron RAM/CPU, admission wait и recovery durations; неизвестные метрики обозначены |
| 6. Различение метрик и причинности | Нет обещания freed disk по размеру файлов; host VM allocation/billing неизвестны; Docker idle wake выделен отдельно |
| 7. Повтор resource cycle без роста | Два exact restore/cleanup generations 2/3, 7 → 7 worktrees и одинаковые logical bytes; старые неизвестные объекты удержаны с причиной |
| 8. Качество и штатная проверка | 19 targeted tests, types/Svelte, lint/format, сборка, NO GOD и настоящий browser Cat-pilot. UI Skaro не менялся |

Отметки относятся к этому конечному набору реальных сценариев и guards.
В частности, повтор resource lifecycle не подменяет полный новый цикл разработки
задачи, а idle wake — управляемый crash Docker daemon.

Проверено на Windows, на текущих реальных ресурсах Cat-pilot. Этот этап
не доказывает аппаратный power loss, глобальное падение Docker daemon,
provider-wide outage, macOS/Linux или полный новый цикл разработки задачи.
Общий ресурсный результат сверяется с AC-5; его исторические shared-decision
и coordinator crash proof не подменяют текущий ресурсный recovery.
Полный ручной C4 audit, его UI/design gate и общая приёмка относятся к C4-3/AG-1.

## Свидетельства

Основной каталог:
`C:/Users/drmar/AppData/Roaming/Skaro/verification/resource-recovery-fb902486-9ada-4aa5-91af-379631951d4d`.

Он содержит `case.json`, реальные reader/cleanup checkpoints,
`inspect`, `recover-reader`, `docker-unavailable`, `recover-cleanup`, `cycles`,
`model-wait`, `model-unavailable`, `finish` proof, native transport logs,
before/after metrics и сохранённые предыдущие неуспешные попытки.
Поздние phase proof содержат хеш реально исполнявшегося Electron bundle
и Skaro HEAD с явной отметкой грязного рабочего дерева; исходные ранние proof
задним числом этим полем не дополнялись.
