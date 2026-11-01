# Credential authority сохранённого маршрута

Дата: 01.11.2026. Продолжение BA-7 после настоящего сохранения Connection/Route
в настройках. Main-only `modelSettings.credentialsFor` использует уже открытый
OS vault сервиса настроек: model host не должен пытаться открыть второго
эксклюзивного владельца того же хранилища.

Отдельный `bindConfiguredCredentials` связывает точный configured route snapshot,
актуальную credential reference и ProcessAdmission. Конфигурация проверяется
до/после ожиданий. Порт готовится до native spawn, как требует существующий
startup model host; это не расшифровывает ключ и не создаёт запрос.
Prepared, stale или вышедший process owner не может заимствовать ключ:
настоящий active process admission проверяется при обращении к credential port.

При каждом запросе credential port прежний vault повторно проверяет scope,
reference/binding и активный process admission до расшифровки. Configuration
lease оборачивает эти проверки и потребление ключа. Локальное изменение
маршрута отзывает authority немедленно; независимый writer обнаруживается на
следующей границе. Переданный admission signal и shutdown сервиса также
отзывают порт. Close освобождает configuration lease, не удаляет ключ.

Возвращённые auth/port существуют только в доверенном main для настоящего
коннектора, не публикуются через settings IPC, native RPC, журнал или env.
В native host нужно передавать объединённый signal, чтобы отзыв останавливал
также tools и принадлежащий сессии процесс. Сам порт не запускает процесс и
не заменяет имеющийся native lifecycle.

Это не подтверждение model availability/profile/capabilities, не budget grant
и не разрешение отправлять контекст. `snapshotRoute` с текущим каталогом,
model host durable dispatch, task/chat authorization и request budget остаются
отдельными обязательными gates. Встроенный агент в picker не включён.

## Проверка

Новый режим `node apps/desktop/scripts/verify-builtin-extensions.mjs
--configured-credentials` использует штатные scoped Cat-pilot services,
сохранённый владельцем маршрут и настоящий OS vault. Не создаёт TaskRun,
не изменяет configuration/task/C4 и не отправляет model POST.

На существующем сценарии durable admissions проверяется подготовка порта до
spawn и отказ prepared owner при попытке заимствовать ключ,
привязка двух настоящих native-процессов разных поколений, отказ чужому
поколению до заимствования ключа, отзыв первого authority при handoff и второго
при закрытии сервиса. Реальный ключ ни один consumer не получает. Проверяется
выход обоих процессов и сохранность входов.

Семь затронутых configuration/transaction/Windows DPAPI tests прошли.
Итоговые сборка, desktop main typecheck и lint прошли. Native-прогон принят:
`verification/extensions-8eca11aa-2a7b-4784-916d-b87b571a6780/proof.json`
в userData. Оба порта подготовлены до spawn и сохранены после активации того
же admission; выход двух native-процессов подтверждён. Нулевые model requests
и чтение ключа, configuration/task/C4 не менялись. Ранний строгий вариант
проверки сохранён отдельно как `extensions-73c9d02e-0e49-4928-9897-bf1881cd7306`.

UI здесь не менялся; полный suite не запускался. Новые source-модули — 71 и
99 строк, изменённые service/driver меньше 300. Это принятая host-граница,
не полная BA-7 приёмка модельной задачи или выполнения/сдачи результата.
