# Подготовка приёмки Stop/resume на T-006

Дата: 02.11.2026. Владелец выбрал Cat-pilot T-006 для подготовки сценария.
Выбор не разрешает запуск задачи, передачу нового payload или новые POST.

Штатный scoped driver `--task-stop-review` прочитал настоящие task/configuration
и каталог OpenRouter через VPN, сформировал локальный пакет и завершился с
кодом 0. Native process/task-run и model POST не создавались; задача,
C4-review и configuration до/после совпали. Ключ модели не читался.

Пакет в userData:
`verification/extensions-9f95dbfa-5126-40b7-bbfa-dfd5b7395e9d/task-stop-review.json`.
SHA256 канонического JSON, как в прежних review envelopes:
`b9135426bf242173e488db75e6c9b8fd83b6c8b8550fd97d2bc9fa6160092a95`.
Рядом сохранён proof.json. Это review composition, ещё не исполняемый wire request.

## Состав и ожидаемый сценарий

T-006 — todo, 10 критериев, T-003/T-004 — done, прежних run/startup нет.
Пакет содержит инструкции настоящего taskInstructions, заголовок и критерии
задачи, этап и сводки зависимостей, проектные/глобальные инструкции, ссылки на
контекст проекта и точный сохранённый маршрут `openai/gpt-4.1-nano`.
Root AGENTS.md отсутствует, дополнительных source files в wire composition 0.
Служебные SHA/C4 guards находятся отдельно и не предназначены для отправки.

Запланированы настоящий run в in-place/ask/planFirst, первый тестовый ввод,
Stop с подтверждением OS exit/отзыва admission, продолжение того же run/journal
через новый native process/admission и второй тестовый ввод. Завершение
сценария возвращает T-006 в todo; реальные run/journal/messages и audit остаются.
Реализация анимации, изменение source files, команды, tools, сдача, merge и
запуск T-008 в этом сценарии запрещены. Это приёмка lifecycle, не результата T-006.

Предложение бюджета: до 4 дополнительных запросов, счётчик максимум 89.
Baseline — 85 intents / 393241240 nanoUSD расходов и удержаний. Прежние
неизвестные удержания сохраняются; прежний общий лимит $1 не увеличивается,
технический ceiling остаётся 950000000 nanoUSD. Нового разрешения ещё нет.

## Что требуется до исполнения

- Runnable driver с проверкой review/hash, текущего T-006, route и scope;
  наблюдением двух настоящих admission generations и подтверждением cleanup.
- [Учёт primary task journal](builtin-agent-task-budget.md) добавлен; driver
  должен регистрировать настоящий журнал перед reservation/dispatch. Положительная
  регистрация требует будущего согласованного task-run.
- Envelope/budget gates и отдельное согласие владельца на конкретный состав
  данных и расширение счётчика. До этого provider POST остаётся запрещён.

TypeScript main, lint, CLI syntax, форматирование и production build прошли.
Новые проверки — реальная scoped preparation, без fake API/fixtures/run.
Файлы меньше 300 строк. Полная приёмка BA-7 остаётся открытой.
