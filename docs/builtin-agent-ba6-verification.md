# Встроенный агент: проверки BA-6

История этапа из [общего отчёта](builtin-agent-verification.md).

## Native inspection bridge, 01.11.2026

Реализован [read-only мост](builtin-agent-native-verification.md) main → native
worker → owned runtime. По существующему IPC передаётся только scope/admission;
implementation acceptance port остаётся в main. Проверены реальные критерии
Cat-pilot T-008, отмена in-flight инспекции, продолжение после interrupt, отзыв
lease, missing host/scope mismatch до spawn и restart с новым host. Два настоящих
runtime-процесса завершены с проверкой OS identity; task/C4 не изменены, model
requests 0. Proof: verification/extensions-65cf398f-b057-4fbd-bcff-cc71bbf78f2b/proof.json
в userData Skaro. Сборка, типы runtime/adapter/desktop, lint и две прежние
compiled-native регрессии прошли. Это подготовка native host boundary; TaskRun
не создавался, модель/credentials/submit/task-chat scheduler не подключены.

## Продолжение BA-6, 01.11.2026

После уточнения владельца установлен настоящий transport: Xray слушает
127.0.0.1:10809 и включён как системный proxy Windows, но Node/curl его не
подхватывали. Прямой GET давал 403, тот же официальный endpoint через Xray —
200. Ранний вывод о недоступности OpenRouter через VPN был неверен: проверки
обходили proxy. Launcher теперь требует явный loopback VPN proxy, передаёт его
только acceptance host и проверяет каталог до credential; прямого fallback нет.

Живой model-plan Cat-pilot прошёл через Xray, model openai/gpt-4.1-nano:
`verification/openrouter-ba4/session-plans.jsonl`, record
`proof:catpilot-plan-7b3a42fd6305e343-sequential-v3`.
Пять настоящих model requests, четыре tool calls, одна исправленная ошибка
аргументов; успешные inspect_acceptance/plan_checks/assess_checks подтверждены
durable records, финальный readyToSubmit=false. Task/C4 не изменены, tool
processes 0. Reported cost успешного v3 — $0.0014827. Shared ledger после всех
попыток: 65 request intents, $0.38699476 включая retained reservations, лимит
$1 не менялся. Ранние реальные ответы/отказы и резервации не удалялись.

Первая модель вызвала три инструмента параллельно, затем при суженном каталоге
завершилась до assessment. В следующем required-call прогоне она пропустила
uncovered. Guards сохраняли отказы. Добавлены host-политика сужения реального
каталога по фазам, required tool_choice и только статическая policy-подсказка
при неверных аргументах. Это позволило настоящей модели исправить вызов без
ослабления criterion/scope gates и без отправки произвольных ошибок или файлов.
Без политики прежнее поведение ChatTurn сохраняется; добавление/изменение
схем в выбранном каталоге запрещено. Полная BA-6 по-прежнему открыта.
Финальная штатная сборка, TypeScript runtime/desktop main, ESLint, Prettier и
diff прошли. Одиннадцать целевых тестов selection/proxy/diagnostics/context/
compiled-native прошли; исходники не превышают 300 строк. Локальные Cat-pilot
HTTP/routes/owner/acceptance/plan guards прошли без model calls, proof:
`verification/extensions-95a190dc-4ab3-462f-b124-86f9217843ec/proof.json`.
Повторно подготовленный payload имеет тот же согласованный hash. Полный suite
не запускался, UI не менялся, новая browser-проверка не требовалась.

Владелец разрешил подготовленный Cat-pilot payload. Два настоящих запуска
OpenRouter driver остановились до model POST: первый с прежним coarse stage
credential, второй с уточнённым credential-limits. Vault binding metadata
совпадает с сохранённым reference; ключ не выводился. Сам HTTP-статус /key
не установлен: credential boundary скрывает исключение consumer. Независимый
публичный GET https://openrouter.ai/api/v1/models без Authorization вернул
HTTP 403, JSON `Access denied by security policy.` Поэтому доступ к штатному
endpoint тогда считался blocker; последующая проверка через требуемый VPN
устранила его (описано выше). Другого endpoint или fake API не было.
Payload Cat-pilot не отправлен, новых model requests/расходов не добавлено.

Driver получил точные credential-store/owner/limits этапы и безопасный failed
envelope: только ограниченные name/code/status, без message/stack/cause.
Два целевых unit-теста этого контракта прошли; они не подменяют API/окружение.
Штатная сборка, TypeScript desktop main, ESLint/Prettier и повторная compile-only
проверка полного live driver прошли. Исходники не превышают 300 строк. Ledger
после отказов по-прежнему содержит 52 model requests и 284476060 nanoUSD
с учётом reservations. Полный suite и новые model POST не запускались.

Первоначальная подготовка ограниченного model-plan сценария выполнялась без API.
Реальный локальный proof подготовки:
`verification/extensions-990788b8-0105-4aba-9af8-9bbead070e8a/proof.json`.
Payload: `model-plan-payload.json` в том же каталоге; semantic SHA256
`7b3a42fd6305e343ad6d13cc9d95489d5cdf767150cb6aaa87e1cae54774c598`.
Локально проверены tool allowlist, отказ выполнению/положительным verdicts и
точная проекция инспектора. Полный OpenRouter driver скомпилирован в prepare
режиме без credential host/API; типы и lint прошли. Ранее согласованные payloads
не включали эти критерии Cat-pilot; на момент подготовки отправка ожидала решения
владельца (последующее разрешение и сетевой blocker описаны выше). Shared ledger
прочитан без сети: 52 запроса, $0.28447606 включая
сохранённые reservations; лимит $1 не изменён. Новые model requests этого блока: 0.
Финальная штатная сборка прошла; изменённые исходники не превышают 300 строк,
Prettier и diff проверены. Живой OpenRouter --plan до разрешения не запускался;
его положительный сетевой результат не заявляется. Полный suite не запускался.

Добавлены внутренние tools inspect_acceptance/plan_checks/assess_checks и
persisted verificationScope. Живой task host даёт criterion IDs/тексты,
модель сохраняет checks/uncovered с точными параметрами и context revisions.
План — предложение модели, не proof. Bound run_check требует совпадающий шаг
плана, свежий context и execution admission; standalone API сохранён.
Preflight также учитывает runtime effects/interactions и план command evidence.

На реальной T-008 Cat-pilot проверены запись/восстановление плана, stale revision,
неполное сопоставление критериев, duplicate step, подмена scope аргументами,
команды/coverage/reference, отсутствие плана и inactive run. Ноль процессов
в плановом probe, task/C4 не изменены; model requests 0. Proof:
`verification/extensions-677f10e8-3c9d-406b-a8b4-f232bce48ddb/proof.json`.
Тот же прогон подтвердил прежние HTTP/internal, route/owner и acceptance cases.
Четыре целевых checks/context теста прошли. Это проверка реальных tools с
явно неподтверждёнными предложениями, не вызовы модели или успешная сдача.
Активная task с контекстом и положительное planned execution пока не проверены;
product/native host bridge — следующий BA-7, не включён текущими изменениями.
Штатная сборка main/workers/preload/renderer, два compiled-native сценария,
типы runtime/desktop main, ESLint и форматирование прошли. Все изменённые
исходники меньше 300 строк. Полный suite и новая browser-проверка UI не
запускались; UI не менялся.

Host dependency measurements добавлены в command/browser evidence и preflight.
Список host-selected canonical files имеет revision и полные SHA256/размеры;
проверяются descriptor/path identity, изменения при чтении, лимиты и отмена.
Он входит в persisted tool scope; модель не может передать его аргументом.
Полнота toolchain/ignored dependencies/services не объявляется доказанной:
`coverage: declared-files-only`, исходные unresolved сохраняются.

Живые proof Cat-pilot: browser
`verification/extensions-d9dc2872-ea29-4a2e-8e5d-85d38d706f61/proof.json`, command/acceptance
`verification/extensions-22c573a2-c636-4812-a6de-4ba219ceba59/proof.json`.
В каждом подтверждены четыре реальных host файла, актуальность evidence;
browser также проверил missing image, историчность, console 0/0 и file://.
Три целевых теста checks/dependencies прошли без fixtures/seed/API. Первый
прогон checks корректно вернул inputs-changed из-за параллельных рабочих правок;
повтор выполнен после завершения правок, ожидания теста не ослаблялись.
Штатная сборка и два compiled-native сценария прошли; типы runtime/desktop,
lint, форматирование и размеры модулей проверены. PNG Cat-pilot просмотрен.
Полный suite не запускался, внешние модельные запросы не выполнялись.

Добавлена read-only проекция действующих criteria/completion/C4 из TaskRuns и
предварительная оценка evidence в primary runtime journal. Criterion IDs имеют
project/task/revision namespace, checkout и admission session проверяются.
Сверяются host-состояние, полные входы и измеряемое окружение до/после;
повторная и параллельная оценка с тем же ID запрещены. Продуктовый task/chat
host не включён, preflight не является разрешением на последующий submit.

На настоящей T-008 Cat-pilot прочитаны 9 критериев. Реальный `git diff --check`
через Windows Job Object прошёл, но его evidence не объявлено выполнением
критерия: запуск неактивен, C4 отсутствует, зависимости требуют review.
Проверены stale criteria, unknown ID, forged reference, reuse/concurrent ID,
project/checkout binding и прежний отказ submit_result неактивному scope.
Task и запись C4 остались неизменны; модельных запросов — 0. Proof в userData:
`verification/extensions-f2b0354d-056b-444c-bbbd-a09d45643ded/proof.json`.
Тот же прогон проверил настоящие HTTP/internal handlers, route boundaries и
сохранённые owner decisions без новых модельных запросов.

Первые два запуска остановились до admission command supervisor. Сначала
исправлен путь к собранному command worker в проверочном driver, затем найден
дефект самого Windows supervisor: PowerShell не ждал GUI-subsystem Electron и
закрывал Job Object. Потоковый protocol pipeline удерживает supervisor;
исполнитель и Job Object сохранены. Два последующих живых прогона прошли.
Пять целевых тестов builtin-command-tools/builtin-checks подтвердили approval,
stdin/timeout, остановку дерева, crash/recovery, hashes и retry restrictions.
Два сценария собранного native worker также прошли. Штатная финальная
`pnpm build`, TypeScript timeline/runtime/desktop main, ESLint, Prettier и
`git diff --check` прошли. Изменённые исходники не превышают 300 строк.
Сохранились предупреждения сторонних Zod/Claude SDK/web-tree-sitter.
Полный suite не запускался, UI не менялся, новая browser-проверка не выполнялась.

Полная BA-6 открыта: аттестация внешней среды/зависимостей, доказанный полный
цикл исправления значимого дефекта задачи и применение evidence при настоящей
сдаче. Исправление supervisor — найденный runtime-дефект, не приёмка автономного
исправления Cat-pilot. Подробнее: [контракт и ограничения](builtin-agent-checks.md).

## Начало BA-6, 31.10.2026

Browser evidence добавлено в общую схему check_evidence: source/revision/args hash,
inputs/environment до и после, приватный JSON output и PNG hashes. Missing image
делает artifactsCurrent=false; последующий MCP-вызов — latestObservation=false.
Observation остаётся данными, а не автоматическим verdict о критериях.

По указанию владельца текущие живые проверки перенесены на Cat-pilot; правило
добавлено в AGENTS.md. Browser driver принимает только путь зарегистрированного
Cat-pilot и открывает настоящий index.html через file://. Proof:
verification/extensions-2ab7ee93-940e-4dda-b069-93c6d4f2515a/proof.json (userData).
PNG просмотрен, console 0 errors/0 warnings, сетевых ресурсов страницы 0.
Штатный Cat-pilot scene-animation check прошёл: 10 анимаций, 18 отсчётов,
CSS pause/reduced-motion. Ни HTTP-сервера, ни seed/fixtures, ни правок Cat-pilot.
После всех probes повторный capture подтвердил неизменность 26 полных
tracked/dirty/untracked входов Cat-pilot. HTTP/internal handlers также проверены
на Cat-pilot, proof: verification/extensions-3482f4b9-bd1c-42c6-8763-a0cb59fc2872/proof.json.
Штатная сборка, TypeScript desktop, ESLint/Prettier и четыре целевых regression
в builtin-checks/MCP/native-worker прошли. Исходники меньше 300 строк,
renderer/UI не менялись. Полная приёмка BA-6, внешние зависимости и
completion/C4 gates остаются открытыми; model requests этого прогона — 0.
Ранний прогон этого блока на Chatballs относится к истории до указания владельца,
не заменяет приёмку Cat-pilot; новых прогонов Chatballs после указания нет.

Продолжение после `70abc14`: измеряемое host окружение фиксируется до/после
команды и повторно проверяется по OS/runtime/executable hash и очищенному env.
Изменение LANG в изолированном процессе теста дало environmentCurrent=false
при inputsCurrent/outputCurrent=true; значение восстановлено. Секретные значения
env не сохраняются. Неизвестные toolchain/dependencies/services остаются открытыми.
Git metadata также использует очищенный env с отключённым fsmonitor hook;
cwd проверки ограничен основным project scope.

Диагноз хранится как гипотеза модели с категорией и ссылкой на реальный отказ.
Retry требует диагноза и сохраняет command/cwd/shell/timeout/имя/criterion IDs.
Реальный git diff --no-index сравнил два разных scoped AGENTS.md и вернул exit 1;
повтор без диагноза, замена команды и увеличение timeout отклонены до процесса.
Разрешённый повтор также сохранил отказ. Никакого planted дефекта/fixture нет;
это проверка истории неуспеха, не приёмка исправления значимого дефекта BA-6.
Целевой builtin-checks и два compiled native-worker сценария прошли.
Штатная сборка main/workers/preload/renderer, TypeScript desktop/runtime,
ESLint, Prettier и diff check прошли. Изменённые исходники меньше 300 строк;
полный suite не запускался, модельные API не вызывались.

Добавлены run_check/check_evidence поверх существующего executor и approval.
Реальная команда git diff --check на настоящем checkout сохранила fingerprints
HEAD/index/tracked/dirty/untracked inputs и hash приватного output. Проверены
allow_once, read-only отказ до intent, dedup без нового процесса, process paging,
отказ поддельной sequence/hash ссылке и утрата подтверждения удалённого output.
Шесть целевых сценариев в builtin-checks/context/native-worker прошли без
fixtures и fake API; проверка нового command evidence выполнена повторно
после добавления read-only отказа и чтения output через process paging.
Штатная сборка main/workers/preload/renderer, TypeScript runtime/desktop main,
lint и форматирование прошли; полный suite
не запускался. UI и продуктовый submit_result не менялись.

Это первый проверенный блок, не закрытая BA-6. Открыты среда/зависимости,
browser evidence, цикл исправлений и completion/C4 gates. Неизвестные зависимости
не считаются безопасными; exit code 0 не включает автоматическую приёмку.
Контракт и ограничения — [builtin-agent-checks.md](builtin-agent-checks.md).

