# Driver настоящего T-006 Stop/resume

02.11.2026. Владелец разрешил точный review payload, настоящий T-006 run и до
четырёх дополнительных запросов в общем лимите $1. [Stop/resume и модельное
продолжение после выхода main приняты](builtin-agent-task-stop-acceptance.md),
все четыре запроса использованы.

`--task-stop-live REVIEW_PATH CANONICAL_SHA256` использует только зарегистрированный
Cat-pilot и обычные `TaskRuns.launchBuiltin`, `interrupt`, `send`, `cancel`.
Main-only authorization подключается только в этом CLI mode. Product picker,
обычный запуск приложения и разрешения других задач не меняются.
Для подготовки есть `--task-stop-review`, для read-only проверки конкретного
пакета — `--task-stop-check REVIEW_PATH CANONICAL_SHA256`.
После успешного Stop/resume предусмотрены
`--task-stop-main-restart REVIEW_PATH SHA256 STOP_PROOF_PATH` (ровно один
оставшийся разрешённый запрос) и `--task-stop-replay REVIEW_PATH SHA256 PROOF_PATH`
(только чтение реальной истории, без model host). Повторный main-restart после
его успешной записи отклоняется; новый task-run или source payload не создаётся.

Перед созданием run driver проверяет точные review bytes, UUID попытки, текущую
T-006 todo без runs/startup, зависимости done, C4, configuration, route, цену и
байты прежних acceptance journals. Настоящий run создаётся обычной очередью в
in-place/ask/planFirst. Перед каждым native attach проверяются те же данные,
допускается ровно этот run, единственное ожидаемое изменение задачи — in_progress.
Настоящий execution intent выключается до первого ввода каждой generation:
сценарий не поручает реализацию T-006 и не разрешает авто-продолжение.

Grant не выдаёт model tools или MCP operations, остаётся readOnly, maxSteps 1.
Модель получает два точных тестовых ввода из review. Envelope gate восстанавливает
ожидаемый Chat request из проверенного primary journal тем же formatter, сверяет
весь DTO, точные host pins/scope sources и owner inputs, отвергает дополнительные
inputs/images/answers/rewind/tool requests/interactions. Новые файлы не читаются
для отправки; локальные C4/SHA guards в prompt не включаются.

Обычная доставка task messages теперь явно формирует `UserInput`: только текст
со стандартной Skaro note и непустые ссылки attachments. Внутренние commandId,
internal и privateText из inbox не копируются в durable input. Command ID остаётся
отдельным аргументом send/steer и в прежней note для delivery recovery/dedup.
Это устраняет найденный при просмотре кода конфликт с точным envelope gate.
Четыре затронутых test files (девять тестов) и main TypeScript/lint прошли;
положительная delivery в настоящем T-006 остаётся до согласованного live запуска.

Guard проверяет точный `input-<commandId>` и полный текст со штатной note,
а не только текст после удаления note. Чужая command identity, добавленный текст
в note и любой лишний input-field отклоняются. Сравнение полного Chat DTO допускает
только отсутствие необязательного toolChoice либо его явное undefined,
которое добавляет штатный model loop; реальное значение choice запрещено.
Шесть целевых DTO/budget тестов прошли без создания журналов/run.
Прежний пакет повторно принят read-only проверкой на новом коде:
`extensions-94416b9c-6e5b-4586-9056-e16f1abd4586/proof.json`, run/POST 0.

Перед quotation и dispatch нужен настоящий активный task admission и регистрация
[primary task journal](builtin-agent-task-budget.md). Прежние источники frozen;
только точный собственный journal может меняться. Отдельный guard допускает
предложенные 85→89 intents, сохраняет 393241240 nanoUSD прежних расходов/удержаний,
ceiling 950000000 nanoUSD и общий $1. Он не расширяет старый grant на пять запросов.
Обычный сценарий требует два POST; автоматического retry после ошибки нет.
Transport требует явно включённый VPN `http://127.0.0.1:10809`, без direct fallback.

Driver наблюдает настоящий provider POST, вызывает Stop, требует status exited,
отсутствия прежнего OS owner identity и отказа старому lease. Затем обычный send
должен получить новый admission generation и другой process owner при прежних
run/session/journal. Проверяется сохранение прежнего primary prefix и настоящий
второй ответ «Продолжение принято». Наличие terminal первого хода до Stop
записывается отдельно; если terminal уже существовал до Stop, проверка
останавливается с непройденным результатом, без автоматического повторного POST.
Завершённый первый ход не засчитывается как прерывание активного хода.

В конце обычный cancel возвращает T-006 в todo. Проверяются выход второго owner,
неактивность обоих leases, ровно два owner inputs, один run, выключенный execution,
прежние task/C4/configuration. Реальные run/journal/audit сохраняются.
`task-stop-attempt.json` пишется и при ошибке; passed требует успешного cleanup.
Такую попытку нельзя выдавать за сдачу анимации, merge или полную BA-7.

Разрешение относится к конкретному [пакету](builtin-agent-task-stop-review.md),
task-run и четырём новым запросам. Оно не разрешает реализацию/сдачу T-006,
новые source files, tools или расширение общего $1.

## Найдено настоящими попытками

`extensions-8de75d97-12e8-425c-9e4d-d274c667060f/task-stop-attempt.json`:
настоящий run создан, quotes/POST 0. Worker не найден из-за удвоенного out/main
в app.getAppPath verification entry. Добавлен явный main-only worker directory
для scoped services; обычный packaged путь не меняется. Первый cleanup отказал
только на требовании OS owner, которого startup ещё не создал. Cleanup теперь
различает exited без spawn и положительную приёмку настоящего owner.

`extensions-eee0adf0-9c31-4bd2-b399-8c27b00b3157/task-stop-attempt.json`:
run сохранён, один POST, реальный Stop/OS exit прошёл; новый admission получен.
Второй ввод отклонён до POST: context projection блокировался неизвестным
результатом отменённого model request. Cleanup подтверждён, задача вернулась в todo.

Runtime разрешает fresh owner context при unknown именно model:chat,
model:openai.responses или model:anthropic.messages. Старое состояние unknown,
квитанции и удержания не изменяются; автоматического replay нет. Pending model,
unknown tools/commands и открытые interactions остаются блокирующими. Старый
provider continuation после unknown request не переиспользуется; новый запрос
формируется из точного host context и настоящих refs предыдущей попытки.
Сравнивается provenance sequence неизвестного outcome и последнего подтверждённого
continuation: более поздний успешный conversation можно продолжить, сохраняя
неизвестное списание в budget. Исторические holds не сбрасывают новый conversation
навсегда. Оба случая проверены read-only на настоящем primary journal.

Повтор driver сохраняет единственный настоящий run/primary journal. Он проверяет
exited OS owner, прежний payload/route/settings, один настоящий unknown model
intent и отклонённый второй command без input facts. Разрешён один новый pair
тех же сообщений с суффиксом command IDs retry-1; старый failed command не
переигрывается. Новых source data или разрешений выполнения нет. Budget по-прежнему
считает первый intent вместе с новыми. Завершённый driver не запускается повторно.
Отдельный owner command second-after-main-restart доставляет то же второе
сообщение после выхода main. Счётчик принимает максимум 89 intents, schema tools
остаётся пустой, после результата run возвращается в todo и process exit проверяется.
