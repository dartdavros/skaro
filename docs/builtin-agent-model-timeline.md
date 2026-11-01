# Канонический model turn и поток сообщений

Дата: 01.11.2026. Внутренний native modelTurn теперь публикует прежние события
Timeline через primary journal: turn.started, message upsert/append и terminal
turn.completed. Новых UI компонентов, текстов состояния, иконок или layout нет.
Это слой model lifecycle, не включение продуктового send/steer или каталога.

Turn ID детерминирован из session/command ID. Начало имеет отдельный durable
record с request hash. Terminal event и итог команды записываются одной записью,
поэтому повтор подтверждённого command ID не дублирует ход или завершение.
При ошибке сохраняется failed; реальный отзыв model admission даёт interrupted.
Второй конкурирующий ход остаётся отказом до собственного lifecycle.

Настоящие streaming deltas группируются по model request ID и батчам 50 ms,
записываются до projection. Каждая модельная реплика получает свой message ID,
первый fragment делает upsert, следующие — append. Tool-call ответы относятся
к commentary, терминальная реплика — к final, по существующим фазам модели.
Завершённая реплика ссылается на sequence/hash настоящего provider result.
Текст не является доказательством принятой задачи или выполненного инструмента.

При восстановлении используются реальные уже сохранённые fragments. Если
успешный Chat response сохранён, но хвост streaming batch не успел записаться,
он может быть дополнен точным content из этого настоящего result. Несовпадение
prefix/response отвергается. Исторические записи до этой реализации не
переписываются. Для Native показываются фактически сохранённые text deltas;
закрытые provider items/reasoning не превращаются в выдуманное display-содержание.

Остановка ждёт model turn вместе с завершением IO. Частичный текст при
неподтверждённом запросе остаётся failed/interrupted, автоматического повторного
POST нет. Disk/journal error не маскируется успешным terminal event.

## Проверки

Настоящий native preflight на Cat-pilot:
`verification/extensions-daea7fa4-e795-4598-a0b8-58162f1834ec/proof.json`
в userData Skaro. Failed model admission дал один begin/terminal, agent messages
0, model requests/reservations 0. Native event stream совпал с новым replay
настоящего primary journal через production SkaroProjector и Timeline.
После close running items нет; два настоящих runtime завершены, task/C4 неизменны.

Целевые journal/async-selection/direct-contract tests (12) и compiled-native
tests (2) прошли. Проверка journal дополняет прежний interrupt/resume case
assertion о modelAdmissionRevoked; fake provider не использовался.
Сборка, типы и lint прошли. Полный suite и browser UI не запускались:
UI не менялся, продуктовый builtin UI ещё не включён.

Положительная streaming/live-replay проверка прошла отдельным v2 turn
на ранее разрешённом payload Cat-pilot, через Xray и тот же ledger до $1.
Журнал: `verification/openrouter-ba4/session-nativeplan.jsonl` в userData;
command ID `nativeplan-7b3a42fd6305e343-v2`. Пять реальных запросов, один
agent message, один terminal done; production live/replay совпали. После close
running items нет, native process завершён. Повтор command ID не отправил POST.
Проверены настоящие inspect/plan/assess tools, task/C4 не изменены;
readyToSubmit остаётся false, check processes 0. Это не приёмка выполнения задачи.
v1 остаётся историческим положительным model-port proof; его не переписывают
и не пересчитывают как новое прохождение terminal/message событий.

## Дальше

Продуктовые send/steer должны использовать этот lifecycle и существующую очередь,
сохранять точные owner inputs/answers и не принимать завершение модели за
completion задачи. Нужны ещё task/chat startup, model request preparation,
continuation и положительная active-task execution/submission приёмка.
