# Подготовка приёмки Stop/resume на T-006

Дата: 02.11.2026. Владелец выбрал Cat-pilot T-006 для подготовки сценария.
Выбор не разрешает запуск задачи, передачу нового payload или новые POST.
Позднее владелец явно разрешил этот payload, T-006 run и до четырёх дополнительных
запросов в общем $1. [Живой Stop/resume и read-only restart приняты](builtin-agent-task-stop-acceptance.md).

Штатный scoped driver `--task-stop-review` прочитал настоящие task/configuration
и каталог OpenRouter через VPN, сформировал локальный пакет и завершился с
кодом 0. Native process/task-run и model POST не создавались; задача,
C4-review и configuration до/после совпали. Ключ модели не читался.

Пакет в userData:
`verification/extensions-0f40de4e-e26f-4a74-8000-c149611ee7c6/task-stop-review.json`.
SHA256 канонического JSON, как в прежних review envelopes:
`7a4d2c056c2a741547b26428bc13b953a53f32fff22197f93fd2f7ee6543be9d`.
Рядом сохранён proof.json. Это состав wire envelope с ещё не созданными
run/session/command IDs; сам файл не выдаёт разрешение на отправку.
Отдельное согласие владельца получено в чате без изменения review bytes/hash.

## Состав и ожидаемый сценарий

T-006 — todo, 10 критериев, T-003/T-004 — done, прежних run/startup нет.
Пакет содержит инструкции настоящего taskInstructions, заголовок и критерии
задачи, этап и сводки зависимостей, проектные/глобальные инструкции, ссылки на
контекст проекта и точный сохранённый маршрут `openai/gpt-4.1-nano`.
Root AGENTS.md отсутствует, дополнительных source files в wire composition 0.
Служебные SHA/C4 guards находятся отдельно и не предназначены для отправки.
Runtime envelope включает стандартные инструкции о полномочиях, точный host pin,
owner statements, Skaro command notes, context epoch/revision и ссылки sequence/hash/ID
на новый primary journal; после Stop — только результаты этой же новой сессии.
Revision host pin — константа, не локальный task guard hash.

Запланированы настоящий run в in-place/ask/planFirst, первый тестовый ввод,
Stop с подтверждением OS exit/отзыва admission, продолжение того же run/journal
через новый native process/admission и второй тестовый ввод. Завершение
сценария возвращает T-006 в todo; реальные run/journal/messages и audit остаются.
Реализация анимации, изменение source files, команды, tools, сдача, merge и
запуск T-008 в этом сценарии запрещены. Это приёмка lifecycle, не результата T-006.

Предложение бюджета: до 4 дополнительных запросов, счётчик максимум 89.
Baseline — 85 intents / 393241240 nanoUSD расходов и удержаний. Прежние
неизвестные удержания сохраняются; прежний общий лимит $1 не увеличивается,
технический ceiling остаётся 950000000 nanoUSD. Согласованный счётчик 85→89;
все четыре новых запроса использованы в [живой приёмке](builtin-agent-task-stop-acceptance.md).

## Driver и проверки до исполнения

Добавлен [runnable driver](builtin-agent-task-stop-driver.md): обычная task queue,
два native generations, Stop/exit/new admission, сохранение primary prefix и cleanup.
Он регистрирует настоящий task journal перед reservation/dispatch, проверяет полный
сформированный envelope и общий budget. Tools и автоматическая реализация не выдаются.

Read-only `--task-stop-check` принят на точном пакете:
`extensions-afd21c65-3ade-4c89-830c-a3046c8ea803/proof.json`.
Текущие task/route/scope/history совпали, budget прежний, run/POST 0.
Тот же настоящий файл с неверным SHA отклонён до createServices (`AssertionError`).
Никаких fake payload/journal/run для этих проверок не создавалось.

Отдельное согласие владельца получено. Положительные registration/envelope/Stop/resume
проверки настоящего ActiveRun выполнены; полная BA-7 ещё не закрыта.

TypeScript main, lint, CLI syntax, форматирование и production build прошли.
Новые проверки — реальная scoped preparation/check, девять целевых тестов DTO/budget,
без fake API/fixtures/run.
Файлы меньше 300 строк. Полная приёмка BA-7 остаётся открытой.
