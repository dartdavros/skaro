# Native session admission lifetime

Дата: 01.11.2026. Внутренний native host принимает общий `signal`, который
отзывает всю сессию. Это отдельная граница от signal конкретного inspection
или extension port: отказ порта сам по себе не обязан завершать runtime.

Общий signal остаётся в main и не сериализуется. Он проверяется до создания
worker, в spawn gate до callback ownership, до/после host inspection/operation
и перед каждой новой рабочей командой. Уже отозванный lease не запускает новый
процесс. Close/interrupt остаются допустимыми cleanup operations.
После callback сохранения ownership допуск проверяется ещё раз: callback
может синхронно отозвать lease, и spawn gate в этом случае не открывается.

Отзыв запускает существующий native close: отзывает RPC, отменяет работу,
закрывает host ports с ожиданием pending calls, завершает owned process tree
и worker. Если закрытие не подтверждено, ошибка не становится успешным выходом.
Проверка OS birth защищает от остановки переиспользованного PID. Listener
удаляется при окончательном close. Старый session object не может возобновить
работу, даже если для того же journal появился другой host с новым lease.

Обычный `SessionOptions.signal` сохраняет прежнюю роль отмены startup; общий
host signal действует и после startup. Managed Claude/Codex не получают
новую семантику неявно. Их native entry не принимает builtin host ports.

## Проверка

```powershell
pnpm build
node apps/desktop/scripts/verify-builtin-extensions.mjs --native-lifetime
```

Driver использует реальный зарегистрированный Cat-pilot, T-008, прежний
acceptance service и настоящие compiled workers. Несуществующий runId служит
отрицательным scope для execution: активный TaskRun не создаётся и не подменяется.

После чтения 9 критериев driver отзывает общий lease во время следующей
настоящей инспекции. Он ждёт автоматического завершения native event iterator
до собственного вызова close, затем подтверждает выход по OS identity.
Позднее чтение и send старого instance должны дать отказ до нового journal
record. Повторный запуск с отозванным lease запрещён до ownership callback.

Новый lease допускает настоящий restart того же journal, explicit resume
и чтение прежних критериев. Старый instance остаётся отозванным. Второй отзыв
тоже должен автоматически завершить процесс. Проверяются durable результат
отменённой инспекции, task/C4 до/после и отсутствие check/model processes.

Первоначально принято: `verification/extensions-d2926f2c-9da9-4638-af0c-884c64429748/proof.json`
в userData Skaro, primary journal — `native-lifetime.jsonl`. Автоматический
выход двух настоящих runtime подтверждён OS identity, первый отзыв произошёл
in-flight. Старый объект и отозванный lease отвергнуты до dispatch; новый lease
восстановил тот же journal. Cancelled result сохранён, task/C4 не изменены,
check processes/model requests 0. Сборка, desktop types/lint/format и две
compiled-native admission/shutdown регрессии прошли.

Расширенная приёмка с отменой внутри настоящего ownership callback:
`verification/extensions-52566e8f-46e7-4feb-85d6-2886df158e79/proof.json`.
После записи OS owner lease отзывается до gate: процесс завершён, primary
journal не создан. Затем повторены in-flight revoke и fresh-host restart;
выход всех трёх runtime подтверждён, task/C4 не изменены, model/check processes 0.
Итоговая сборка, desktop types/lint/format и две compiled-native регрессии прошли.
Прежние inspection/plan/replay и operations сценарии на общем lease transport
также приняты: `extensions-7d2af741-ce29-4835-8c3f-d27819fc3514/proof.json` и
`extensions-8f007699-d52b-427d-8b4f-ea5792b92629/proof.json` в userData verification.

## Границы

Это in-memory host lease и native lifecycle, не новая таблица TaskRun, scheduler
или durable generation authority. Привязка сигнала к реальным task/chat/queue
ещё не включена; при восстановлении нужен заново допущенный host. Сохранение
OS ownership по-прежнему требует настоящего callback host до spawn gate.
Отзыв не откатывает уже выполненные внешние эффекты и не является OS sandbox.
Неизвестные исходы не разрешают автоматический повтор.

Модель, credentials, продуктовая сдача и UI здесь не подключаются. Общая BA-6
и сквозная BA-7 приёмка остаются открытыми.
