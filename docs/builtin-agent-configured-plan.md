# Подготовка живого планирования через configured host

Дата: 02.11.2026. Продолжение BA-7. Сценарий собирает прежний read-only
Cat-pilot plan protocol через сохранённый Route, общий vault authority,
настоящий NativeAdmissions и `prepareConfiguredModelHost`. Выполнение задач,
проверочных команд и submit_result в нём не допускается.

## Состав и границы

Режим `--configured-plan-payload` читает настоящий T-008/acceptance/C4,
настройки маршрута и публичный каталог OpenRouter через VPN. Создаёт локальный
файл с exact criteria IDs/text/revision, состояниями допуска, тремя schemas
inspect_acceptance/plan_checks/assess_checks и прежней инструкцией планирования.
Raw source files, AGENTS.md, история других проектов и ключ в запрос не входят.
Tool results ограничены прежними production projections. Initial request,
route и price ceilings проверяются общим envelope, вынесенным без изменения
из прежнего native plan host.

`--configured-plan-review PATH SHA256` повторно сверяет hash, настоящий маршрут,
criteria/C4, advertised pricing и SHA256 старых primary journals. Ключ и model
runtime не нужны. Hash идентифицирует конкретный файл, но не заменяет отдельное
разрешение владельца на новый живой прогон/расширение счётчика.

`--configured-plan-live PATH SHA256` подготовлен, **не запускался**. Он требует
отдельного согласования. Данные проходят ordinary durable send, процесс получает
admission в настоящем spawn callback. Секрет выдаётся только действующему
process lease. Отдельно проверяются актуальный payload/route/catalog и бюджет
на reservation/dispatch. Штатные tools не могут превратить план в выполнение
или принять критерий без доказательства; итог обязан остаться readyToSubmit=false.
Stable input ID и journal path зависят от reviewed attempt: повтор не создаёт
новый POST после старого failure; автоматической новой попытки нет.

## Бюджет

Настоящий ledger на подготовке: 80 intents, $0.39157154 расходов и удержаний.
Старый guard существующих сценариев (80 intents) не менялся. Предлагаемый
отдельно согласуемый лимит — ещё максимум пять intents, то есть 85 суммарно,
при прежнем общем бюджете до $1 и техническом потолке $0.95 с запасом $0.05.
Исторические journals не сбрасываются: их hashes закреплены в локальном файле
согласования и сверяются перед dispatch. Эти hashes и budget metadata остаются
локально; в provider request попадает только request и допущенные tool projections.
Уникальные `session-configured-UUID.jsonl` учитываются тем же общим ledger.
Unknown billing удерживает reservation по прежним правилам.

Каталог сообщает prompt/completion $0.0000001/$0.0000004 за token, а request fee
не сообщает: она сохранена как null. Первая подготовка явно отказала этому
unknown, не выполнив POST. Уточнён контракт: известные token prices обязательны,
а request отдельно ограничен `max_price.request: 0` в самом запросе, без
превращения unknown в бесплатный тариф. Ненулевая объявленная request fee
отвергается. Семантика price ceiling сверена с
[официальной маршрутизацией OpenRouter](https://github.com/OpenRouterTeam/docs/blob/main/guides/routing/provider-selection.mdx).

## Фактическая проверка

Подготовлен локальный файл в userData:
`verification/extensions-8fa166e4-25e8-4de5-826b-4a17c99f90e9/configured-plan-payload.json`.
Hash: `8573652f3c6c5141e1c9cc51b43f598a910fb16c08636807bf05c07a5bfe7327`.
Девять критериев. Model POST и чтений ключа — 0.
Повторный review принят:
`verification/extensions-0387d7c2-ca92-4aed-85eb-d669bd31bfd7/proof.json`.
Настоящие route/criteria совпали, старые журналы и бюджет сохранены.
Перед запуском проверяется актуальность заново; изменившийся payload требует
нового согласования, другой моделью/проектом не подменяется.

Lint, desktop types, штатная сборка и три целевых budget/price/journal-name
contract tests прошли. Финальные verification entries также реально собраны
штатным driver. Никаких provider replies, fixtures или HTTP-заглушек нет.
Затронутая native steering регрессия принята без POST:
`verification/extensions-b8155cdf-18d1-43f0-bcea-971d381f0de4/proof.json`.
Два точных input одного хода, прежний envelope, redelivery, live/replay и
подтверждённый выход настоящего процесса сохранены; task/C4/configuration неизменны.
Общая configured composition с context/compact/restart также повторно принята:
`verification/extensions-b4f93030-4c21-4400-915c-dc94e1f7e101/proof.json`.
Свежий input второго поколения подготовлен, старые не доставлялись повторно,
оба runtime завершены; новых model POST/резервов и изменений task/C4 нет.
Live completion/tools/continuation и полный product task lifecycle этим
не приняты. UI не менялся, full suite не запускался. Модули разделены по
payload/review/policy/budget/history/turn/driver; каждый меньше 300 строк.

Предыдущие попытки lint/build были остановлены лимитом автоматической проверки
и не выполнялись. После продолжения владельца проверки успешно запущены.
Это не расход OpenRouter и не оценка кода как небезопасного.
