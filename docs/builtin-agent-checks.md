# BA-6: проверки и доказательства

Дата: 01.11.2026. Этап начат, полная приёмка BA-6 не закрыта.
Добавлены внутренний evidence слой и read-only проекция приёмки; продуктовый
task/chat host и UI не подключались.
Живой проект для текущего продолжения — **Cat-pilot**, по прямому указанию
владельца от 31.10.2026. Новые проверки на Chatballs не выполняются; прежние
его proof относятся только к историческому прогону.

`run_check` использует существующие ToolCoordinator, подтверждение точных
аргументов, RW-очередь, ToolProcesses и Windows Job Object. Второго executor,
очереди задач или completion service нет. В read-only scope команда запрещена.
В ask/auto нужен allow_once до effect intent. Повтор того же call ID возвращает
сохранённый результат, без нового исполнения. Неизвестный эффект не повторяется.

Перед запуском сохраняются команда, имя проверки, ссылки на критерии, cwd,
shell, время, host runtime/OS/executable hash и отпечаток входов. После реального
завершения процесса сохраняются exit code, результат и приватный output artifact
с SHA256/размером. Journal schema 2 не меняется: используются версионированные
result records `check:ID:started/result`, связанные с обычным intent процесса.
Прерванная проверка без финального record не становится успешной.

Сохраняется также окружение после команды. `environmentCurrent` при повторной
проверке сравнивает OS/host runtime/executable и hash очищенного env, не записывая
значения переменных. Изменение измеряемого окружения во время исполнения даёт
`environment-changed`. Старые evidence без этих измерений не получают новый
положительный verdict. Это не аттестация произвольного toolchain или сервисов.

`diagnose_check` связывает гипотезу модели с настоящим неуспешным result:
implementation/command/infrastructure/flaky/unrelated/unknown, причина и план
исправления. Гипотеза не меняет исход, не является решением владельца и не
доказывает устранение причины. `run_check.retryOf` требует такого диагноза;
повтор сохраняет точные command/cwd/shell/timeout, имя и набор criterion IDs.
Ослабленный повтор не запускает процесс. Новая попытка получает свой ID и
обратную ссылку, исходный отказ остаётся в primary journal. Повтор автоматически
не назначается; обычные approvals, неизвестные outcomes и остановка сохраняются.

Отпечаток входов включает HEAD, Git index и полные hashes всех tracked и
неигнорируемых untracked файлов, включая dirty bytes и удаления. Требуется
корень настоящего Git worktree; symlinks, hardlinks, submodules/необычные файлы,
выход из scope и превышение лимитов отвергаются. Проверяются изменения файлов
при чтении, index и состава каталога во время сбора. Смена любого охваченного
входа консервативно делает прежнее доказательство устаревшим. HEAD недостаточен.
Это наблюдение mutable worktree до/после команды, не атомарный filesystem snapshot.

`check_evidence` принимает точную sequence/hash ссылку на настоящий check result,
заново собирает входы и проверяет bytes output artifact. Произвольный tool result,
ложная ссылка или текст «проверено» не являются доказательством. Изменение входов
во время команды фиксируется как inputs-changed, даже при exit code 0.

## Измеряемые host dependencies

Host может задать `tools.verificationDependencies`: до 64 явно выбранных
обычных файлов по абсолютным canonical paths. Это не аргумент инструмента;
при resume изменение списка отвергается вместе с изменением tools scope.
Для каждого файла сохраняются ID, path, размер и полный SHA256; список имеет
собственную policy revision. Проверяются identity/размер/времена до/после чтения
через открытый descriptor и повторно по пути. Symlink/path alias, каталог,
исчезнувший или изменившийся файл не получают положительное измерение.
Лимиты: 512 MiB на файл, 1 GiB на весь список; отмена прерывает чтение.

Эти данные входят в окружение command/browser evidence до/после и повторно
измеряются в `check_evidence` и acceptance preflight. Отсутствующая зависимость
даёт ошибку вместо подставного значения. Изменение bytes или policy лишает
прежнее evidence актуальности окружения. В отчёте `dependencyMeasurement`
доступны IDs, размеры, hashes и `coverage: declared-files-only`.

Живые drivers Cat-pilot выбирают настоящие runtime/PowerShell/Git launcher/
command worker и runtime/Chrome/MCP manifest/entry. Измерение launcher или entry
не доказывает всех загруженных DLL/модулей или фактическое разрешение каждой
команды. Поэтому исходные unresolved для полного toolchain, ignored dependencies
и внешних сервисов сохраняются. Сам список не выдаётся за полную аттестацию
окружения и не разрешает автоматическую сдачу.

## Browser observations в общей схеме

Host может явно пометить допущенный MCP tool как browser observation с
criterion IDs. Серверные annotations и аргументы модели этого права не дают.
Политика входит в revision инструмента. Для вызова сохраняются точные источник/
revision и args hash, входы и окружение до/после, время и подтверждённый output.
`browser-observation` имеет outcome `observed` или `tool-error`, не verdict «критерий выполнен».

`check_evidence` проверяет command и browser записи одним механизмом. JSON output
и прикреплённые images должны быть неизменёнными обычными файлами внутри private
artifactDir. Для browser проверяются также завершённый исход исходного эффекта,
host revision и отсутствие последующего MCP-вызова (`latestObservation`). Последний
флаг отражает порядок инструментов, не доказывает неизменность живой страницы.
Самопроизвольные изменения внешнего окружения по-прежнему требуют проверки.

Живой прогон выполнен на **Cat-pilot**: реальный `index.html` через `file://`,
без HTTP-сервера, fixtures, seed или правок проекта. Каталог берётся из настоящего
реестра Skaro; другой путь/HTTP URL browser driver не принимает. В отдельном
фиксированном driver включён официальный MCP file-access option; общая настройка
taskBrowserServer и продуктовые права не расширялись. Inputs берутся из Cat-pilot,
а не из checkout Skaro. Кадр штатных CSS-анимаций семплирован на 50% через browser
debug API; это измерение существующей анимации. Реализация кнопки не входит в проверку.

Proof: `verification/extensions-2ab7ee93-940e-4dda-b069-93c6d4f2515a/proof.json`
в userData Skaro. Проверены JSON/PNG hashes, актуальность inputs/environment/source,
отсутствие image и историчность screenshot после следующего вызова. Console:
0 errors/0 warnings, ресурсы страницы — только file://. Дополнительно прошла
существующая `checks/scene-animation.cjs`: 10 анимаций, 18 отсчётов, CSS pause и
reduced-motion. Исходники Cat-pilot и его незавершённые задачи не менялись.
HTTP/internal probes также используют зарегистрированный Cat-pilot; совпадение
результатов, scope/schema, approval/dedup и отказ от replay после отзыва grant
проверены на настоящих handlers. Proof:
`verification/extensions-3482f4b9-bd1c-42c6-8763-a0cb59fc2872/proof.json`.

```powershell
node apps/desktop/scripts/verify-builtin-extensions.mjs --browser CAT_PILOT_PROJECT_ROOT
```

## Предварительная оценка приёмки

Внутренние tools `inspect_acceptance`, `plan_checks` и `assess_checks` работают
только с живым host port, admission session и сохранённым task scope. Модель
не выбирает project/task/run через аргументы. Inspector возвращает реальные
тексты criterion IDs. Без host port инструменты дают явный отказ; scope
сохраняется в tools config, поэтому restart не позволяет подменить привязку.

`plan_checks` сохраняет модельное предложение `verification-plan:ID:result`:
точные command/cwd/shell/timeout/name/criterion IDs, полные текущие Git inputs,
ревизию критериев и доступные context source revisions. Для каждого критерия
нужен check или явно записанная причина `uncovered`; дубли и неизвестные IDs
отвергаются. План с непокрытыми требованиями разрешает продолжение анализа,
не доказывает достаточность покрытия и не становится evidence.

В bound task scope `run_check` требует точную sequence/hash ссылку на шаг плана.
Команда, имя, cwd, shell, timeout и criterion coverage должны совпасть. Критерии,
host binding и context sources проверяются заново; context нужен для исполнения.
Compact с теми же source revisions не обесценивает план только сменой epoch.
Изменения implementation допускаются: новый результат всегда измеряет новые
inputs, старый success не переносится. Runtime снова проверяет живой допуск
после hashing/journal persistence непосредственно перед исполнением.

`binding.execution` отделён от готовности сдачи: текущая работа может проверяться
до C4-review, но не после остановки/завершения, handoff или при открытых owner
decisions. Standalone verification без task host сохраняет прежний API run_check.
Read-only acceptance port передан в настоящий дочерний runtime через
[native inspection bridge](builtin-agent-native-verification.md). Продуктовый
task/chat host, прочие ports и запуск модели через этот bridge ещё не подключены.

`TaskRuns.builtinAcceptance` читает существующие task/completion/C4 данные,
без второй таблицы состояния. Criterion IDs включают project/task ID, ревизию
действующих критериев и порядковый номер. Checkout привязан host к текущему
запуску; несовпадение run/runtime, остановка, handoff и открытые interactions
не разрешают продолжение. Проверка C4 использует ту же валидацию, что сдача,
но не записывает artifact-only review. Прежний `assertC4TaskReview` сохраняет
его запись для существующего workflow. Результат completion читается и
проверяется существующим `assertResultUnchanged`, без импорта legacy результата.

`inspectVerificationAcceptance` — внутренняя read-only preflight, не модельный
инструмент и не операция сдачи. Она проверяет session admission, checkout,
актуальную ревизию/набор criterion IDs, полноту положительных предложений и
точные evidence references. Неизвестные/повторные IDs, неподтверждённые ссылки,
устаревшие inputs/output/browser artifacts и неизвестные зависимости блокируют
готовность. Host-состояние, входы и измеряемое окружение сверяются до/после.
Старые host projections без checkout binding не получают положительный preflight.

Оценка сохраняется в primary journal как `verification-assessment:ID`;
повторное и параллельное использование ID прямого inspection API отвергается.
Model tools сохраняют общую дедупликацию call ID: повтор возвращает прошлую
запись, не новую оценку. Pending/unknown runtime effects и открытые interactions
блокируют готовность; собственный assessment intent не считается чужим pending.
Для bound command evidence повторно проверяется план и его источники. Запись не является
capability для последующей сдачи: файловая система изменяема, а проверка не
атомарна с `submit_result`. Модельное сопоставление evidence с критерием остаётся
предложением; наличие успешной команды не доказывает требование. Неизвестная
среда всегда требует review, поэтому текущий слой не выдаёт готовность задачи.

При настоящем запуске из Electron обнаружен дефект supervisor: PowerShell
возвращался до выхода GUI-subsystem worker и закрывал Job Object. Протокол
worker теперь передаётся потоковым pipeline, удерживающим PowerShell до выхода
worker; Job Object и общий executor сохранены. Проверочный driver передаёт путь
к собранному command worker, как продуктовый native host.

## Подготовленный model-plan probe

Локальный driver сохраняет `model-plan-payload.json`: стартовый запрос,
схемы трёх разрешённых tools и точную проекцию девяти критериев T-008 Cat-pilot.
Проекция содержит IDs/тексты/met, ревизию и состояния C4/continuation; raw source
files, абсолютные paths, environment, Git inputs и credential в неё не входят.
Подготовка не читает ключ и не вызывает модель. Это новый payload относительно
ранее согласованных живых передач данных Skaro. Владелец явно разрешил этот
payload 01.11.2026. Живой probe прошёл через включённый владельцем Xray:
5 model requests, 4 tool calls, включая одну корректировку неполного вызова.
Task/C4 не изменились, команды и сдача не выполнялись.

По указанию владельца live launcher требует `SKARO_VERIFY_PROXY` — адрес
реального включённого loopback HTTP proxy без userinfo/path/query. Он передаёт
NODE_USE_ENV_PROXY=1 и HTTP_PROXY/HTTPS_PROXY только acceptance host; NO_PROXY
разрешает обход лишь для localhost. До чтения credential проверяются настройки
и настоящий публичный каталог через этот transport. Прямого fallback нет,
TLS не ослабляется. Command workers сохраняют прежний allowlist окружения.
Проверенный адрес Xray — http://127.0.0.1:10809. Ранний HTTP 403 относился к
прямым Node/curl-запросам, игнорировавшим системный proxy Windows; это не отказ
доступа через включённый VPN. Другой endpoint или fake API не использовались.

После согласования точного payload отдельный `verify-openrouter.mjs` режим
`--plan PAYLOAD_PATH SHA256` может выполнить проверку с существующим vault.
Он сверяет hash и текущую проекцию перед отправкой, допускает только
inspect_acceptance/plan_checks/assess_checks, требует checks:[] и все verdicts
met:false/evidence:[]. Каталог сужается по реальным успешным результатам:
inspector → plan → assessment → без tools. Требуемый tool_choice исключает
ранний finish; изменение схем/добавление инструментов в фазе отвергается.
Неполные аргументы получают только статическую подсказку policy, чтобы модель
могла их исправить. Остальные tool errors и изменение проекции останавливают
POST. Проекции настоящих успешных tool results не
содержат остальных полей journal. Итог проверяет реальные durable results,
а не только названия tools в ответе модели.

Маршрут фиксирован на openai/gpt-4.1-nano через OpenRouter, каталог и ценовые
пределы проверяются перед модельным POST; fallback не добавляется. Используется
прежний общий $1 ledger в verification/openrouter-ba4, новый session-plans.jsonl
участвует в том же подсчёте, unknown reservations не сбрасываются. Подготовлены
не более шести шагов. Это тест живого планирования, не исправление задачи,
положительное execution admission или сдача; продуктовый BA-7 bridge не включён.

## Честные ограничения

Exit code 0 означает успешное исполнение записанной команды, не принятие задачи.
Ignored dependencies (например node_modules), фактическое разрешение toolchain
через PATH, внешние сервисы и изменяемое окружение пока остаются неопределёнными.
`acceptance: requires-environment-and-criteria-review` возвращается всегда.
Ссылки на критерии — заявленное сопоставление, не подтверждение их выполнения.

Открыты: доверенная host-привязка внешнего окружения/зависимостей,
проверенный полный цикл исправления значимого дефекта и атомарное применение
evidence в существующих completion/C4 gates. Criterion IDs и read-only проекция
реализованы; это не полная интеграция сдачи. Внешний submit_result не менялся;
проверен отказ реальному неактивному scope без изменения задачи/C4. Сохранение
плана, его отрицательные execution gates и restart проверены на Cat-pilot;
успешное исполнение плана в активной задаче и сдача через built-in host пока
не проверены/не подключены. На других
OS command backend остаётся явно недоступен. Полная приёмка BA-6 не заявлена.

## Проверка реализации

Целевой `builtin-checks.test.ts` работает на настоящем репозитории и выполняет
`git diff --check` через штатный executor. Нет подготовленного Git-проекта,
mock API, fixtures, seed истории или искусственной команды вместо проверки.
Проверены allow_once до запуска, сохранение и повтор без эффекта, реальная
проверка sequence/hash и отказ поддельной ссылке; удаление созданного процессом
output лишает доказательство подтверждения. Добавлена проверка read-only отказа
до intent. Остальные требования этапа пока не считаются пройденными.

Дополнительно сравниваются два настоящих scoped AGENTS.md через git diff
--no-index: exit 1 — реальный результат сравнения разных файлов, не planted
дефект или fixture. Отсутствие диагноза, подмена команды и увеличение timeout
блокируют повтор до процесса; допустимый повтор не скрывает прежний отказ.
Изменение разрешённого LANG в изолированном процессе теста делает измеряемое
окружение устаревшим, не меняя inputs/output; исходный LANG восстанавливается.
