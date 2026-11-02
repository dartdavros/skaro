# Driver настоящего T-006 Stop/resume

02.11.2026. Код подготовлен. Живой запуск не выполнялся и не разрешён.

`--task-stop-live REVIEW_PATH CANONICAL_SHA256` использует только зарегистрированный
Cat-pilot и обычные `TaskRuns.launchBuiltin`, `interrupt`, `send`, `cancel`.
Main-only authorization подключается только в этом CLI mode. Product picker,
обычный запуск приложения и разрешения других задач не меняются.
Для подготовки есть `--task-stop-review`, для read-only проверки конкретного
пакета — `--task-stop-check REVIEW_PATH CANONICAL_SHA256`.

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

До явного согласия на конкретный [пакет](builtin-agent-task-stop-review.md),
task-run и расширение счётчика исполнять live mode запрещено. Владелец ранее
выбрал подготовку сценария; прежние разрешённые пять новых POST уже использованы.
