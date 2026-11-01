# Backend-конфигурация Connection и Route

Дата: 01.11.2026. Подготовка BA-1/BA-4/BA-7. Main services предоставляют
`modelConfiguration`: чтение, атомарный update и построение route snapshot по
текущему каталогу. IPC и UI не добавлены, выбор агента по умолчанию не изменён.

## Хранение и валидация

Несекретный документ schema 1 хранится в прежней таблице settings AppDb.
Общая revision служит compare-and-set; разные SQLite writers не перезаписывают
прочитанные друг другом изменения. Connection/Route имеют собственные ревизии:
изменённая запись требует следующую, неизменённая сохраняет прежнюю. Удалённые
IDs оставляют revision history, поэтому повторное создание не возвращает старую
идентичность. Согласованное удаление маршрута и подключения атомарно.

Возвращается точный committed snapshot, а не последующее чтение другого writer.
Неизвестная schema, нарушенные ссылки/ревизии и повреждённый JSON дают отказ.
Opt-in strict read не меняет прежний fallback обычных settings. Автоматической
миграции или сброса повреждённых настроек нет. Документ ограничен 1 MiB.

Connection содержит только credential reference, точные endpoint/profile и
upstream policy. Ключи остаются в существующем OS vault. Connection settings
пока допускают только пустой объект: произвольные headers/env не реализованы
и не сохраняются. Endpoint — HTTPS без userinfo/query/fragment.

Четыре connector profiles используют общие для configuration и request body
validators. Параметры не отбрасываются молча, неизвестные keys отвергаются.
Сохраняются исходные route parameters; defaults по-прежнему добавляет connector.
Anthropic thinking budget и DeepSeek sampling/thinking проходят прежние
семантические ограничения. Direct routes не приобретают gateway fallback.
Общее правило нерасширения connection routing переиспользуется в provenance.

## Конфигурация не является допуском

Сохранение не проверяет ключ внешним API и не помечает capability/profile как
verified. Credential binding/revision проверяет прежний vault при доступе;
изменение connection metadata само не перепривязывает или не импортирует ключ.
Product startup обязан отдельно проверить текущую конфигурацию, credential,
profile readiness, model availability и capabilities до model admission.

Snapshot требует точную пару connectionId/modelId текущего каталога; модель того
же имени у другого подключения не подставляется. Исчезновение модели оставляет
сохранённый ID и даёт явный отказ, без fallback или удаления настроек. В snapshot
не входит credential reference. Продуктовый startup и управление соединениями
пока не включены; требуется дальнейшая host-интеграция и утверждённый дизайн.

## Проверки

Три contract tests используют настоящие AppDb/SQLite connections: persisted
updates и stale writers, границы routing/params/secrets, удаление/recreation IDs,
повреждение JSON/schema. Pure Model DTO остаётся unknown; он не объявляется
настоящим catalog/API response. Production OpenRouter formatter проверяется
локально, provider response или HTTP server не подставляется.

Сборка, desktop/runtime typecheck, lint и 17 целевых configuration/route/direct/
CAS/steering проверок прошли; финальный configuration case повторён после
добавления production OpenRouter body assertion. NO GOD: изменённые файлы меньше
300 строк. Полный suite/browser UI не запускались, UI не менялся.

Штатные main services и чтение реальной конфигурации проверены на Cat-pilot:
`verification/extensions-b1aa0c2f-af30-4e21-8753-36012cc64a55/proof.json` в userData.
Повтор native steering preflight завершён; конфигурация, task/C4 неизменны,
owned runtime завершён, model requests/reservations 0. Новых расходов нет.
