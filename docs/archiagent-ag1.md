# AG-1 — совместная приёмка и управляемое включение

13.11.2026. **AG-1 завершён в проверенном контуре Windows / Codex / Cat-pilot.**
Поручение владельца: продолжить план AG-1, сборку, целевые проверки и настоящую
приёмку Cat-pilot. Это не поручение выпустить релиз или запускать весь backlog.

## Исходные границы

- Реальный зарегистрированный Cat-pilot, scope до createServices; остальные
  проекты не восстанавливаются, не индексируются и не участвуют в cleanup.
- Рабочее дерево содержит предыдущие незакоммиченные AC/RC/C4 изменения.
  Они сохраняются. Исходный Skaro HEAD: `22f3d4fb0ec12c3cfd0e49d650869f1ee13175ea`.
- C4 baseline: модель 4, согласованный пакет applied, 24 прежних task runs,
  две bindings impact-v1; проектный default пока package-v1. Последний
  проверочный native audit сохраняет ожидаемую ошибку после контролируемого EOF.
- Старые разрешения, owner Stop, pending вопросы и неопознанные ресурсы
  не объявляются новыми полномочиями. Fixtures, fake API/servers и seed не создаются.
- Предыдущие proof — исходная история и ориентир; они не засчитываются вместо
  нового совместного исполнения на текущей сборке.

## Единый барьер

Реализован owner-only CAS barrier: сначала штатный off/fence,
затем один SQLite commit выбирает протокол **будущих** запусков и включает
dispatch. Receipt связан с request ID, версией feature-контрактов, coordinator ID,
schema и fingerprint совместимости/прав/пакетов/старых bindings.
Повтор того же request не повторяет включение; после off требуется новый intent.
Новые разрешения не создаются. Совместимый rollback меняет только default
будущих запусков через тот же барьер; старые bindings не переписываются.
Неизвестный activation record блокирует новый dispatch и legacy bypass,
но не запрещает безопасный off. Future database schema отклоняется до WAL/writer.

Новый UI не введён: используются существующие очередь, фоновые состояния,
карточки, журналы и typed owner-control API. Отсутствующие макеты не обходятся.

## Матрица проверки

| Сценарий плана | Статус AG-1 |
| --- | --- |
| Две задачи / одна причина / один эффект | Подтверждён новым shared и browser исполнением T-010/T-011 |
| Чат помогает задаче / Stop не отменяется | Подтверждён causal native chat grant по реальному tool call и хешу причины; один эффект, T-010 продолжилась автоматически, T-011 сохранила Stop |
| Изменённые входы во время ожидания | T-014: stale delivery не повторялась. T-016: реальное dirty rename сохранилось при новой версии требований, stale candidate отвергнут; проверка и review относятся к текущему commit |
| Постоянная local version до Git-приёмки | Подтверждена настоящая установка immutable T-016 candidate в зарегистрированный cat-pilot-dev; HTTP/browser/SHA проверены при неизменном base HEAD |
| Model wait / housekeeping без LLM | Configured account cap и housekeeping подтверждены; это не provider-wide outage |
| Глобальный бюджет / справедливая очередь | По отдельному разрешению выполнено host-only Cat-pilot/ChatRouter/Cat-pilot FIFO: 3 настоящих OS reader, общий ledger и измеренный host budget, cap 1, политика восстановлена |
| Общий ответ / исходный чат / crash replay | Новый browser crash с pending, сохранение решения и один эффект подтверждены |
| Обычная реализация / технический C4 без вопроса | T-016: точный Compose, rename, новый независимый review aligned/realized:[], native submit_result и штатная автоматическая публикация; модель 5, все 9 вопросов открыты, material-пакета задачи нет |
| Существенное решение / один вопрос / отказ | Настоящий impact-v1 пакет T-015 отклонён по прямому указанию владельца; replay отвергнут, restart сохранил отказ, Stop, модель 4 и все 9 вопросов |
| Завершение / сохранение основного контура | Task и candidate checkout физически удалены; постоянный контур при работающем браузере сохранил container IDs, данные и отдельный immutable release. После проверки своя установка штатно откатана в исходное остановленное состояние |
| Docker unavailable / unknown retention | Object IDs исправлены после настоящего отказа CLI; неизвестные чужие Git worktrees сохранены. Искусственного unknown ресурса для collector нет |
| Миграция / off / compatible rollback / on | Атомарный барьер/rollback и native Stop/reconciliation подтверждены |

Итоговая сверка `finish-proof.json` прошла. Настоящий impact owner package
T-015 отклонён; новый полный аудит сохранил результат `partial`, а не полную
архитектурную сверку. Прежние границы обрыва до первой физической записи,
hardware power loss и других платформ/адаптеров не закрыты; см.
[handoff](archiagent-c4-3-handoff.md). Выпуск и глобальное включение остальных
проектов не выполнялись.

## Настоящие свидетельства

Каталог: `C:/Users/drmar/AppData/Roaming/Skaro/verification/archiagent-ag1-6055ec03-a99d-47b5-acfe-845186f7d79b/`.
Контракт owner API и безопасного отката: [управляемое включение](archiagent-activation.md).

| Файл | Что подтверждено |
| --- | --- |
| `preflight.json` | Долговечные VACUUM INTO обеих БД, integrity/fsync/SHA-256; исходники, run/chat rows и политики |
| `storage-readonly-verification.json` | Все 12 собственных SQLite-копий сохранили исходные SHA-256 и integrity; без удаления и правок живых БД |
| `inspect-proof.json` | Настоящие сервисы, ресурсы, измеренный бюджет, 50 прежних исторических ссылок |
| `activation-proof.json` | Off → impact → compatible package rollback → impact; один replay, прежние bindings/решения/Stop сохранены |
| `quota-proof.json` | Настоящий configured account cap, waiting без capacity holdings, housekeeping без LLM, fence старой очереди, свежий допуск |
| `shared-proof.json` | Два настоящих Codex-исполнителя сообщили об одном зарегистрированном сервисе; один incident/вопрос/эффект, реальный HTTP readiness, две continuation |
| `browser-shared-proof.json` | Production Electron, pinned/shared decision, crash/restart, один эффект, T-010 продолжилась, остановленная T-011 не запустилась |
| `chat-inspect-proof.json` | Свежий настоящий read-only project chat прочитал общие incidents; это не доказательство причинного ремонта именно из чата |
| `chat-causal-proof.json` | Настоящий native chat прочитал incident и вызвал decide_project_incident; один durable grant с уникальным reason hash, один реальный эффект, автоматическая continuation T-010, Stop T-011, ноль ручных пересылок |
| `inputs-observe-proof.json` | Новый настоящий T-014 impact run; точный native echo новой команды и актуальная версия требований; прежняя delivery остановлена только после verified host Stop и не повторялась |
| `resources-proof.json` | Реальный отказ Docker CLI и graceful enforce, сохранённые object IDs постоянного контура, байты/регистрации всех Git worktrees, явные причины удержания |
| `c4-observe-proof.json` | Настоящий полный native audit: partial, модель 4 и 9 вопросов сохранены, своего пакета нет; observation не вызвал модель |
| `material-prepare-proof.json` | Настоящий Codex в T-015 сформировал impact-v1 пакет; архитектура не применена, после Stop остаётся ровно одно решение владельца |
| `material-REVIEW.md` | Читаемый полный diff architecture.md, нового ADR-0002 и модели 4 → 5; это предложение, не принятая архитектура |
| `browser-material-reject-proof.json` | Настоящий owner Reject ровно T-015, stale replay, обычный restart, отсутствие применения и автоматического повторного вопроса; Stop сохранён |
| `budget-two-projects-proof.json` | Отдельно разрешённое host-only исключение ChatRouter: 3 реальных reader-процесса, FIFO Cat/ChatRouter/Cat, нулевые holdings ожидающих, проверенные PID/birth/exit, прежние leases и политика сохранены |
| `technical-review-proof.json` | Реальная T-016: авторизованный native rename, сохранённая dirty работа при смене входов, commit task branch, один независимый semantic review aligned/realized:[], одинаковые browser-пиксели |
| `local-before-acceptance-proof.json` | Настоящие configured checks/readiness, immutable candidate и установленный cat-pilot-dev до Git-приёмки; HTML и SHA JS совпали, runtime budget и данные сохранены |
| `compose-review-proof.json` | Новое независимое native-ревью четырёх разрешённых путей: aligned/realized:[], точный Compose, сохранённое поведение, реальные одинаковые browser-пиксели; старый JS-only receipt не подставлен |
| `task-summary-format-repair.json` | Восстановлены только пустые строки, потерянные старым host summary writer, из точного проверенного входа; native-вердикты критериев и принятый SHA сохранены, semantic context снова строго совпал |
| `technical-publish-proof.json` | **Passed**: штатная автоматическая публикация T-016, точные четыре source paths, модель 5 и 9 вопросов; один merge, идемпотентный replay, физический cleanup и сохранённый работающий постоянный контур |
| `restore-local-proof.json` | После gate выполнен штатный rollback собственной установки и восстановлен исходный путь configured check; base и модель 4 сохранены |
| `finish-proof.json` | Все обязательные совместные сценарии подтверждены; прежние bindings/Stop сохранены, лишних merge/material решений нет, scoped capacity holdings — 0 |

T-014 создана штатным workflow как реальная read-only задача AG-1, не seeded run.
Уточнялись только её собственные требования во время настоящего ожидания
account cap. Выполнен `node --check js/pause-controls.js`. Продуктовые исходники
и критерии прежних задач не менялись. Binding нового запуска impact-v1 получена
штатно; исходные 24 bindings сохранены.

После T-014/T-015 всего 26 task runs: прежние 22 package-v1 и 2 impact-v1
сохранены, добавлены 2 настоящих impact-v1. Управляемый default будущих запусков
Cat-pilot теперь impact-v1; глобальное включение остальных проектов не выполнялось.
С T-016 всего 27 runs: 22 package-v1 и 5 impact-v1.

## Сборка и целевые проверки

Production build main/preload/renderer прошёл, повторная сборка с диагностикой
этапов штатного shutdown также прошла. TypeScript main и Svelte check прошли;
Svelte: 0 ошибок и 0 предупреждений. Целевые Vitest покрывают activation/CAS,
миграцию и dispatch, future schema, очередь команд, Stop proof, проекцию решений
и сохранение Docker object IDs. Итоговый целевой прогон: 11 файлов, 36 тестов
прошли. После интеграционных исправлений итоговый целевой прогон — 20 файлов,
56 тестов, все passed. Полный suite не запускался.

Проверены размеры файлов AG-1: максимальный изменённый файл — shared/ipc.ts,
297 строк. UI-компоненты в AG-1 не добавлялись. Новый shutdown trace использует
существующий SKARO_TRACE и не меняет порядок остановки сервисов.

## Разрешённый объём и итог публикации

[Конкретное предложение](archiagent-ag1-remaining-acceptance.md) содержит полный
объём отказа от T-015, точного технического переименования и штатной сдачи,
а также узкого host-only исключения для проверки бюджета двух реальных проектов.
Это историческое предложение получило явное разрешение целиком.

Владелец разрешил весь предложенный объём одним ответом: native выходы,
отказ T-015, точный JS rename с обычной сдачей и ограниченный host-only бюджет
ChatRouter. Для работ ChatRouter не запускались AppState/createServices,
native agents, UI, backend, индексация, workflow recovery или Docker cleanup.
При local-приёмке существующий путь проверки в `.skaro/config.yaml` сопровождал
rename: `node --check js/motion-controls.js`; остальные байты сохранялись,
проверка не отключалась. После publication gate выполнен штатный rollback своей
установки и восстановлен исходный `node --check js/pause-controls.js`.

### Закрытый gate публикации

Принятая модель 4 содержит `compose.yaml` в current code bindings четырёх
dev-элементов. Файл реально существует и используется настоящим контуром,
но не отслеживается Git; это untracked работа владельца, не ignore-правило.
Обычная публикация T-016 правильно остановилась до изменения base:
`C4ValidationError: … missing code path compose.yaml`.

Нельзя незаметно закоммитить этот дополнительный файл, ослабить требование
публикуемого code tree или изменить принятую модель. [Точное предложение](C:/Users/drmar/AppData/Roaming/Skaro/verification/archiagent-ag1-6055ec03-a99d-47b5-acfe-845186f7d79b/compose-publication-review.md)
содержит полные существующие байты, SHA и дополнительный объём: учесть ровно
этот Compose в Git, обновить только собственную T-016 и заново пройти review,
local-before-Git, штатную сдачу и cleanup. Владелец отдельно разрешил именно
этот Compose и продолжение той же T-016; весь этот объём выполнен.

Итоговый base — `465ac5124bfe1107e0c2bda37b99c263f3f535c7`. Техническая
актуализация модели 4 → 5 меняет JS code/evidence paths, а не current/planned,
девять вопросов или отклонённую архитектуру T-015. В Git вошли ровно
`compose.yaml`, `index.html`, `js/pause-controls.js` → `js/motion-controls.js`;
Compose сохранил 1152 байта и SHA-256
`1d126374267b985c58a06678a49a45852acae559f9bf9c8364bc6264cc1bae7a`.
Остальные source bytes и untracked работа владельца сохранены.

Физическое отсутствие одноразовых checkout подтверждено отдельно от Docker
cleanup вызовов. Во время проверки постоянный контейнер, его IDs, данные и
независимый immutable release сохранились; настоящий браузер продолжал читать
сервис. После этого своя установка штатно откатана в исходное остановленное
состояние. Путь configured check теперь законно сопровождает опубликованный
rename: `node --check js/motion-controls.js`. Scoped capacity holdings — 0;
27 bindings сохранены: 22 package-v1 и 5 impact-v1. Для будущих запусков
Cat-pilot включён impact-v1; остальные проекты не включались.

## Найденные интеграционные дефекты

- Проекция очереди читала старые merge cards завершённых T-012/T-013. Теперь
  повторное слияние не предлагается, история и настоящие pending choices сохранены.
- Недоступная Docker-инвентаризация стирала сохранённые object IDs. Теперь
  недоступность отличается от успешного пустого наблюдения и не создаёт новую
  deletion authority. Последующий live сценарий сохранил IDs и файлы.
- После stale admission неизвестная native delivery удерживала writer даже
  после Stop. Теперь host receipt подтверждает teardown всех task runtimes
  по PID/birth; только после этого старая delivery завершается как остановленная,
  без повторения. Task Stop не подтверждает доставку integration resolver.
  При явном Stop чата также захватываются прежние неизвестные delivery.
- Ошибка первого native chat startup теперь сохраняется существующим error
  notice, а не только при resume. Новый UI для этого не создавался.
- Independent C4 reviewer получает точные base Git objects, исходные checkout
  hashes и Git-normalized working blob IDs. CRLF checkout не выдаётся за новое
  поведение относительно LF Git blob. Добавление уже существующего current
  source получает mechanical preservation только при побайтном совпадении с
  отдельным зарегистрированным primary checkout, без реализации требований
  planned. Это не разрешение менять файлы; все остальные source changes
  по-прежнему требуют полного review. Semantic review не подменяет отдельные
  синтаксические, browser и local-installation acceptance gates.
- Неудачный read-only reviewer оставлял uncertain control operation и блокировал
  новую проверку. Теперь только новое owner intent, точная job/run/fingerprint
  identity и физически подтверждённая остановка старого worker позволяют штатно
  сверить старую операцию как failed. Её verdict и история не переписываются.
- Host summary writer схлопывал пустые строки чужих секций и делал собственный
  C4 receipt устаревшим. Теперь добавление/замена итога сохраняет требования,
  отступы и code blocks. В T-016 восстановлен только потерянный формат из
  настоящего проверенного входа; все три native-принятых критерия, SHA и receipt
  сохранены. Затем нормальный capture с исправленным writer и автоматический
  merge прошли со строгой проверкой свежести, без новой ручной C4-оценки.
- Lifecycle готового local candidate теперь завершается после доказанной Git
  публикации именно его принятого результата. Done/readiness сами по себе
  не разрешают удаление: проверяются текущие критерии, точный SHA, manifest,
  реальные Git publication receipts, отсутствие writer и pending installation.
  Далее используются прежние generation/ownership/consumer/recovery-ref guards.
  Установленный постоянный release остаётся независимым persistent ресурсом.

## Неуспешные попытки и границы

- `backup-storage.json` — прерванная попытка WOF-сжатия, не passed proof.
  Write handle разворачивал WOF; скрипт исправлен. Все 12 копий затем независимо
  проверены read-only. Колебания свободного места хоста не приписываются сжатию.
- `chat-proof.json` не прошёл: первая native delivery осталась неопределённой;
  routine delegated ремонт уже выполнил детерминированный координатор. Это не
  причинный ремонт LLM-чатом. Новая отдельная read-only диагностика chat прошла.
- Первые `inputs-proof.json` / `inputs-recheck-*` не засчитываются как успех.
  Настоящий stale admission выявил незавершённость native Stop/reconciliation.
  После исправления старая и новая delivery сверены по реальным IDs и журналам.
- Драйвер дополнительно сравнивал живую ссылку на turns и пропустил завершённый
  owner turn. Сравнение исправлено. Независимый `inputs-observe-proof.json`
  связывает точный command ID с его настоящим ходом. Два последующих служебных
  continuation и usage записаны явно; это не повторная owner delivery и не
  нулевой расход модели. Observation не запускал модель.
- Прежние resource assertions и browser proofs сохраняются в `*-previous-*`.
  Ошибочное ожидание исключения от graceful collector исправлено в драйвере;
  итог проверяется по настоящему отказу CLI и retained outcome в ledger.
- Новый browser прогон показал partial C4, настоящий pending material-пакет,
  его review и pinned shared question. Windows taskkill вернул 128 после
  закрытия окна; попытка не засчитана как успешное восстановление. Драйвер
  теперь сохраняет результат taskkill и требует фактический exit собственного
  процесса вместо одного exit code утилиты.
- Отдельная recovery-попытка подтвердила реальную пагинацию 246 → 0 и геометрию
  закреплённого решения над вводом. Cleanup предыдущей неуспешной попытки уже
  остановил T-010, поэтому после ответа она правильно не продолжилась; timeout
  автоматического продолжения не засчитывается как успех. Требуется новый
  ограниченный сценарий со свежим разрешённым intent. T-015 остаётся pending.
- Штатный выход первого диагностического экземпляра подтверждён trace с
  exit code 0. В следующем экземпляре обнаружено настоящее native-предупреждение
  о работающих/ожидающих агентах; его принятие ожидает разрешения по computer-use.
  В failed proof не подставляется успешный normal exit.
- Последующий исправленный `browser-shared-proof.json` прошёл полностью:
  новый crash/restart и один effect/native continuation, pagination/pinned,
  сохранённые material pending/Stop и подтверждённый владельцем normal exit.
  Первые неуспешные попытки не перезаписаны успешным статусом.
- Первое T-016 prepare ожидало пустой index после `git mv`, а следующий driver
  передавал уже удалённый staged путь в `git add`. Обе ошибки драйвера сохранены
  как failed proofs. Продолжение использовало ту же настоящую задачу и те же
  байты без повторного rename; проверены только разрешённые staged пути.
- Неуспешные Compose review proofs сохранены в `compose-review-previous-*`:
  invalid native evidence, блокировка старым uncertain read-only control и
  оценка runtime acceptance вместо архитектурного соответствия не засчитаны
  как aligned. Новое настоящее ревью `e6341466…` прошло с исходными source
  hashes, отдельным mechanical proof и явными пределами архитектурной оценки.
- Первые `technical-publish-previous-*` сохраняют настоящий Compose gate и
  timeout после host formatting regression. Исправление не меняло принятый SHA,
  boolean-вердикты или C4 receipt. Итоговая публикация и replay записали ровно
  один merge. Служебный retained outcome во время фонового cleanup не выдан
  за удаление; окончательное физическое отсутствие обоих checkout проверено.
- Остановка контейнера / освобождение capacity не выдаются за освобождённые
  байты хостовой файловой системы. В проверке сохранности физическое освобождение
  равно 0; постоянные и неизвестные чужие checkout не удалялись.

Общий статус закрыт итоговым `finish-proof.json`, а не отдельным CAS или сборкой.
Сопоставимого измерения ускорения до/после нет: причинный chat-сценарий занял
174.693 с, но сравнивался другой процесс; это не численное доказательство
ускорения. Во время cleanup свободное место хоста изменилось с 34 687 954 944
до 34 686 971 904 байт; эта дельта не приписывается удалённым checkout.
Ограничения платформ, audit coverage и обрыва до первой записи сохранены явно.
Релиз Skaro и новые изменения пользовательского backlog этим не выполнялись.
