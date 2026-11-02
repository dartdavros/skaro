# BA-7: сдача, окружение и локальный handoff

Дата: 02.11.2026. Полная BA-7 ещё не принята. Все новые живые проверки —
на зарегистрированном Cat-pilot; model POST в этом продолжении — 0.

| Сценарий | Результат |
| --- | --- |
| Stop/resume, main exit/restart, повторное восстановление истории | Приняты ранее, см. [протокол](builtin-agent-task-stop-acceptance.md) |
| Skaro → Codex → Skaro → Claude → Skaro | Принят transactional handoff настоящего остановленного run; managed model turns не запускались |
| Окружение task command | Настоящая supervised-команда получает явные host variables; в primary config сохраняется только revision |
| Сдача без доказательств / от прежнего run | Отказ в штатных services до изменения критериев |
| Настоящий Playwright MCP | Каталог подключён, вызов до active native admission отклонён, auxiliary process завершён |
| Проверенная реализация, замечание, повторная сдача | Ещё не приняты |
| Сохранение настоящего worktree/environment при handoff и capture/merge | Ещё не приняты |
| Product picker / создание builtin-чата / Electron task view | Отдельная приёмка BA-8 остаётся открытой |

## Подтверждённый handoff

`verification/extensions-4bf9512d-a33a-42a3-a528-7b510e376c77/proof.json`
в userData Skaro. Использованы штатные readiness/model discovery установленных
Codex и Claude, `setSettings` и `handoffBuiltin`. Четыре successor RunRecord
созданы настоящей транзакцией, а не заполнены как тестовые данные.

Первоначальный run `a0d711e0-2d66-47a2-ae23-721ece167fea` сохранился предшественником.
Текущий run T-006 — `d4f326b6-29af-40cd-a9e1-43e69fafdf63`, agent `skaro`,
без nativeSessionId. История сообщений сохранилась без дублирования, stop intent
наследован, старый admission остаётся exited. Managed preference возвращена
CAS-записью к прежнему значению; task/C4/model configuration не менялись.
Checkout/branch остались in-place: это не положительная проверка worktree.

## Проверка перед записью критериев

Положительный builtin verdict требует актуального собственного native admission
и assessment из настоящего primary journal. Проверяются scope/session, primary
hash и requestHash assessment, host/criterion revisions, C4, открытые решения,
неизвестные эффекты, актуальные входы и окружение, выходные artifacts и provenance.
Перед записью повторно измеряются evidence и перечитывается acceptance state.

Частичный отчёт разрешён: доказательства нужны для каждого положительного
verdict. Для него assessment отдельно хранит неподдержанные критерии и причины,
блокирующие приёмку: ошибка плана/окружения не маскируется отсутствием других
verdicts. Завершение требует положительной свежей проверки всех критериев.
Отрицательный отчёт сам по себе не выдаёт приёмку. Managed submit сохраняет
прежний контракт.

Только validation/criterion write находятся под project mutation gate.
Последующие capture/criteriaChanged/launchUnblocked выполняются после его
освобождения: вложенный запуск зависимой задачи не должен ждать собственный gate.
На merge сохраняется D-45: только configured checks, новый общий прогон не добавлен.

Историческое unknown model billing не удаляется и не переигрывается. Оно перестаёт
блокировать новую verification только при primary provenance более позднего
подтверждённого provider continuation. Pending model, unknown tools/commands,
открытые вопросы и неопределённый исход текущей операции остаются блокирующими.

## Окружение и browser port

Явные task variables передаются приватными startup/command IPC через native
worker и adapter. Глобальные API/auth variables не наследуются. Runtime bootstrap
overrides, нулевые байты, Windows case collisions и превышение лимита отвергаются.
Primary config содержит только hash revision; командный вывод всё ещё может
содержать переменную, которую явно напечатала сама команда.

Task browser использует существующий официальный isolated/headless Playwright MCP,
точный task scope/admission и реестр принадлежащих run процессов. Каждый invoke
проверяет active admission до и после вызова. Отзыв lease предшествует ожидаемому
async close model/extensions. File access включается только явно для штатного
статического Cat-pilot. Это не filesystem/network sandbox; D-28 не меняется.

Host может передать отдельный owner-reviewed `verificationReview`: точные
command/observation fingerprints, measured dependency fingerprint, criterion
revision и основания допущений. Default waiver отсутствует. Исходный receipt
сохраняет measured unresolved; принятые допущения показываются отдельно как
`host-reviewed-assumptions`, без заявления о measured dependency closure.
Изменение dependencies, command/cwd/shell/timeout/criterion mapping либо browser
args/revision не переносит review на новую проверку.

Новый browser call того же MCP host делает прежнее observation не последним.
Skaro assessment/C4/submit calls сами браузер не меняют и не инвалидируют receipt.

## Настоящий preflight и проверки

`verification/extensions-d03cbb73-a206-4332-b3f0-3ae5c077fd17/proof.json`:
unsupported builtin claims и stale managed scope отклонены; официальный browser
catalog получен; browser invoke до native owner отклонён; auxiliary owner вышел.
На прежнем primary подтверждено сохранение unknown billing после успешного
continuation. Task/criteria/runs/C4/settings/execution и ledger не изменились.
Native owners/model requests не создавались. Metadata review lease — не active
native admission и не положительная приёмка browser workflow.

Main/runtime/adapter typecheck, lint, production build и 22 целевых теста в
10 файлах прошли. Среди них настоящий compiled native worker: принятие/отказ
process owner, отказ чужому replay boundary, interrupt/close и отсутствие POST
без model host. Полный suite не запускался. Новые/изменённые файлы ≤300 строк;
UI и файлы Cat-pilot в этом изменении не менялись.

Trusted script `apps/desktop/scripts/cat-pilot-flight-check.mjs` открывает настоящий
`file://` в установленном Chrome. Flight baseline: критерии T-006 1–9 не выполнены,
критерий 10 уже обеспечен фоном; page errors отсутствуют. Существующий project
background checker проходит. Проверено также выполнение flight measurement
при очищенном command environment. Это отрицательная проверка до реализации,
а не сдача задачи. Controls/Firefox/WebKit/три реальных цикла подготовлены кодом,
но положительно ещё не проверены; штатные Firefox/WebKit отсутствуют.

## Следующая положительная приёмка

После подготовки пакета владелец сначала выбрал только локальный код.
Последующее уточнение: «post можно, но за рамки 1 доллар не заходить».
Оно отменяет запрет новых POST; продолжение — в следующей сессии в рамках
подготовленного пакета и прежнего общего $1, с сохранением всех расходов/holds.
До этого уточнения дополнительные POST и запуск/сдача T-006/T-008 не выполнялись.
Установку отсутствующих браузеров отдельное уточнение про POST явно не разрешает.
Полная BA-7 остаётся открытой; порядок продолжения — в [передаче](builtin-agent-next-session.md).

Рядом с proof подготовлен `task-workflow-review.json`, canonical SHA256
`600af359e54afa9328a70a418205f04784220a016778f298bb1bbcc3bc969cb1`.
Это предложение состава данных/действий: 14 настоящих source files, инструкции
и 19 критериев T-006/T-008, реальные tool schemas и ограниченные производные
результаты. T-008 предлагается только после штатного завершения T-006, в новом
настоящем worktree. Новые рисунки/дизайн, чужие проекты и произвольный shell
исключены. Перед live остаются binding точных grants и положительная приёмка.

Все прежние четыре POST использованы: 89 intents / 428414440 nanoUSD
($0.42841444) расходов и удержаний. Пакет предлагает до 40 дополнительных
OpenRouter запросов: максимум 129 intents, прежние holds сохраняются, технический
ceiling $0.95, общий лимит владельца $1. Последующее разрешение POST применяется
к этому ограниченному продолжению; подготовка пакета сама не выдаёт разрешения.
Прямого fallback нет: только `http://127.0.0.1:10809`. Публичный model catalog
через этот VPN proxy вернул HTTP 200, без ключа и данных проекта.

## Локальные исправления после решения владельца

Operational gate write tools использует ту же primary-проверку, что и verification:
неизвестные исходы команд/tools блокируют действия; старое unknown model billing
может быть отделено только после более позднего подтверждённого continuation.
Неподкреплённые model metadata дают отказ. Настоящий прежний T-006 primary прочитан
напрямую, без services/model host: два unknown model receipts сохранились,
operational blockers — 0. Это не положительная проверка записи после Stop.

Task/chat startup, detach, handoff и неожиданное завершение используют общий
retirement: отзыв lease, ограниченное ожидание host closer, cleanup и независимое
подтверждение OS exit. Ошибка или зависание closer не пропускают очистку процесса;
ошибки возвращаются вызывающему коду. Closer фиксируется до первого await, поэтому
позднее завершение старой операции не закрывает новый host. Runtime exit сообщает
ошибку teardown и сохраняет stopError вместо unhandled pump rejection.

Контракт retirement проверяется настоящими SQLite admissions и собственными
дочерними OS-процессами, без project/task/run seeds, model replies или mock API.
Отдельно проверяются отказ closer, его deadline и отказ cleanup: процесс должен
выйти, admission стать exited, старый lease отклоняться, а ошибка сохраниться.

После локальных исправлений прошли production build, main/runtime typecheck,
lint и 20 целевых тестов в 6 файлах: retirement, operational effects, submission,
настоящие file/command/question/recovery tools и compiled native worker.
Полный suite не запускался. Максимальный изменённый файл — 288 строк.
UI и source Cat-pilot не менялись; новых model POST, задач и browser installs нет.
