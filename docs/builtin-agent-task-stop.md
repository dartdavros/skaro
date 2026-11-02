# Остановка builtin-задачи и новый admission после Stop

Дата: 02.11.2026. Изменение внутреннего task lifecycle BA-7.

Stop отменяет startup, durable owner commands и ещё ожидающий ввод. Для
builtin-задачи он также блокирует приём новых сообщений, attachment и handoff
до завершения остановки. Прерывание native session ограничено пятью секундами;
при превышении срока записывается техническое событие и выполняется detach.
Отзыв admission/credential lease и подтверждение выхода принадлежащих run
процессов используют прежний механизм TaskRunSessions.

После завершения потока событий истекают live approval/question/form/login
interactions, открытые ходы завершаются как interrupted. История, run,
native session ID, checkout и merge cards сохраняются. Следующий допустимый
ввод создаёт новую native transport/admission generation. Неподтверждённый
shutdown оставляет stopError и не разрешает новый writer; повтор Stop может
завершить cleanup. Ошибка не превращается в успешную остановку.

Отдельное поколение отмены проверяется после ожидания integration routing,
history/handoff recovery, чтения задачи и перед постановкой в очередь.
Так отложенный ввод не включает execution intent обратно после Stop.
Обычная успешная доставка не увеличивает поколение отмены: следующий
допустимый ввод не теряется из-за подтверждения предыдущего.

## Проверки и границы

Проверяются чистый stop admission, настоящие SQLite startup settings и
состояние handoff, а также compiled native worker: interrupt/close,
подтверждённый выход OS owner, отказ новому send на закрытом транспорте и
совпадение live/replay. Проекты, task/run и backend не подменяются.

4 файла, 9 целевых тестов прошли, включая настоящий native worker и отказ
send после close. TypeScript main, lint, форматирование и production build
прошли. Изменённые файлы меньше 300 строк. Повторный штатный launch preflight на Cat-pilot принят:
`verification/extensions-12943b0a-ebde-4bb4-b31f-0aaf40fd0513/proof.json` —
отмена и реальный blocker отказаны до run/model host, model POST 0.

Положительная остановка настоящего ActiveRun и его следующий
модельный ход ещё не приняты: последнее разрешение владельца на живую
проверку исключает запуск задач и model POST. UI не изменён.
