# Доказательство Chat tools для configured маршрута

Дата: 02.11.2026. Продолжение BA-4/BA-7. После положительного configured plan
добавлено read-only извлечение `RouteCapabilityAssessment` из его настоящего
primary journal. Это наблюдение способности протокола работать с tools;
оно не разрешает выполнение инструментов или автоматическое включение агента.

## Источник и проверка

Main выбирает доверенный journal path, session/input revision, command ID,
точный RouteSnapshot и task scope. `readConfiguredToolEvidence` сверяет текущую
сохранённую конфигурацию до/после await; отсутствующий или изменённый маршрут
отвергается. Прежний reader проверяет цепочку и стабильность настоящего файла.
Второго writer, данных renderer или восстановленной вручную истории нет.

`chatToolEvidence` требует успешный owner turn и реальные provider receipts,
совпадение route/input/scope и однозначность record IDs. Для каждого наблюдения
связывает call ID модели с настоящим tool-request и завершённым executor result:
хешируются исходные name/args, проверяются hashes команды и порядок
model receipt → tool request → tool result → terminal. Acknowledgement,
неисполненный вызов, декларация каталога и текст «проверено» доказательства не дают.

Результат содержит ссылки sequence/hash и имена операций, без текстов сообщений,
аргументов, результатов tools и ключей. `tools` получает supported/verified
после этих проверок. Images, reasoning, parallel tools, cache, native continuation,
compaction и предельные token limits остаются unknown/null. Прежний
`requireRouteCapabilities` принимает только наблюдаемую способность;
запрос непроверенной операции остаётся ошибкой.

Доказательство не сохраняется как глобальный ready flag и не обновляет общие
API profiles. Доступность vault/аккаунта, payload permission, бюджет, текущий
process admission и policy конкретного инструмента проверяются отдельно.
Исторический успех одного маршрута не допускает другой Connection/model/route.

## Проверка на настоящих данных

`verify-model-tool-evidence.mjs REVIEWED_PAYLOAD SHA256` собирает и запускает
только Node consumer настоящей SQLite в read-only режиме и уже завершённого
одобренного Cat-pilot journal. Проектные services, Electron app, vault и сеть
не запускаются. Scope выбирается из реальной регистрации Cat-pilot; fake DB,
provider response, fixtures и альтернативный backend не создаются.

Первоначальный full-services verifier отказал на single-instance lock: установленный
Skaro уже запущен. Этот процесс не останавливался, его проект не открывался.
Для read-only чтения сведений не нужен второй services host, поэтому consumer
выделен отдельно. Это не одновременный запуск двух hosts над owner settings.

Проверяются три настоящие операции inspect_acceptance/plan_checks/assess_checks,
точные route/input/scope, отказ stale route, чужому input revision и отсутствующему
execute_command. Images/reasoning/cache/parallel/compact/native continuation
не принимаются как verified. Approved packet дополнительно проверяется с чужим
hash и реальным путём вне verification; исходные файлы не подменяются.
Сравниваются source SHA256 и настоящие settings до/после; POST/чтений ключа нет.

Принят `verification/tool-evidence-455c4822-d476-4d4e-b5a5-f819f34fb8d5/proof.json`
в userData Skaro. Три реальные операции подтверждены, все перечисленные
отрицательные gates прошли. SQLite открыта read-only, projectServicesStarted=false,
credentialVaultOpened=false, networkRequests=0. Подтверждены references
фактических model receipts/tool results, source bytes и конфигурация неизменны.
Это проверка уже состоявшегося живого прогона, не новые provider calls.

Финальная штатная сборка, runtime/desktop types, lint и десять целевых
route/configuration tests прошли. Финальный Node consumer реально собран
отдельным driver в ignored `release/verification`, чтобы не мешать обычному
`out`; compiled entry удалён после выполнения. API/fixtures не подставлялись,
full suite и browser не запускались: UI не менялся. Модули меньше 300 строк.

UI и task/chat picker не менялись. Принятие этой проверки не является сдачей T-008,
положительной проверкой произвольных shell tools, OS sandbox или полной BA-7.
