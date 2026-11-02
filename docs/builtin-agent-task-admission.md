# Builtin task admission binding

Обновление 02.11.2026: добавлена [внутренняя task-session ветка](builtin-agent-task-session.md).
Она использует этот admission в настоящем TaskRunSessions attachment;
создание/выбор нового builtin run и положительная продуктовая приёмка открыты.

Дата: 01.11.2026. TaskRuns предоставляет внутренний `builtinAdmission` для
реального текущего builtin run. Каталог агентов, task/chat startup выбора
встроенного агента, модельный send/steer и сдача здесь не включаются.

Factory требует точные kind/projectId/taskId/runId без лишних scope-полей.
Он проверяет настоящий engine.active, выбранный agent=skaro и saved RunRecord
с теми же project/task/run. Несуществующий run не превращается в ActiveRun;
для managed Claude/Codex допуск встроенного runtime не создаётся.

`requireCurrent` связывает каждый process lease с тем же объектом ActiveRun,
сохранённым RunRecord и native session ID. Closing, handoff/switching, retired
run, смена агента/сессии или удаление из engine.active дают отказ. Проверка
повторяется после asynchronous prepare; late подготовленный lease отзывается
и подтверждает отсутствие владельца до публикации. Второй lease того же
ActiveRun не присоединяется поверх первого.

Process admission не дублирует TaskExecution или completion. Task status,
возможность run_check, C4 и достаточность evidence по-прежнему проверяют
существующие acceptance/completion gates. Возвращённый lease не делает task
execution allowed и не разрешает модельный POST без отдельного model admission.

ActiveRun хранит только ссылку на принадлежащий host lease. TaskRunSessions
отзывает его при startup failure, неожиданном выходе runtime, detach и handoff;
подтверждает остановку перед освобождением ссылки. При builtin handoff cleanup
идёт через отозванный native host/owned process tree, а не через новые команды
уже отозванному session object. Managed path с отсутствующим lease сохраняет
прежние calls и не получает дополнительного await перед критическими действиями.
После await cleanup повторно проверяется, что session ещё тот же.

## Проверка

```powershell
node apps/desktop/scripts/verify-builtin-extensions.mjs --task-admission
```

Настоящий task controller зарегистрированного Cat-pilot читает T-008, затем
получает запрос с намеренно отсутствующим runId. Он отвергает запрос до prepare
lease. Отдельно отвергнуты отсутствующие task/run, project_chat и лишний importId.
Сравниваются реальные RunRecords, admission metadata, task и C4 до/после.
Нет созданного TaskRun, fabricated ActiveRun, fake agent или model POST.

Принят proof в userData Skaro:
`verification/extensions-035b1264-4af0-4649-a8a5-2538b07a5ced/proof.json`.
Он подтверждает именно отрицательные task gates и отсутствие записи lease;
не заменяет положительную приёмку активной builtin-задачи.

## Следующие границы

Положительный startup/handoff/queue сценарий настоящего builtin ActiveRun
ещё не принят. Skaro остаётся вне активного product agent catalog до следующей
интеграции и design gate BA-8. Продуктовые ports нужно собирать после реального
допуска OS owner; catalog discovery до допуска не должно давать права execute.
Исторические proof managed agents не объявляются приёмкой нового builtin path.
