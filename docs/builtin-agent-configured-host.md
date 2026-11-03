# Сборка model host из сохранённого маршрута

Актуализация 02.11.2026: положительный configured OpenRouter read-only plan
и restart/redelivery без новых POST приняты в
[живом сценарии](builtin-agent-configured-plan.md#живая-приёмка-после-согласования).
Ниже сохранены отдельные no-POST proofs; они не подменяют эту новую проверку.

Дата: 01.11.2026. Продолжение BA-7. Main-only `prepareConfiguredModelHost`
собирает настоящий коннектор, credential authority и configuration lease до
native spawn. Секреты не входят в binding, runtime config или RPC. Общий vault
сервиса настроек не получает второго эксклюзивного владельца.

## Контракт

Factory требует точный RuntimeModelBinding, существующий process admission,
явный сетевой transport и две обязательные request policy функции: quotation
reservation и разрешение dispatch. Нет разрешающего default или встроенного
автоматического повторения запроса. Отдельный обязательный metadata port
проверяет текущий маршрут до подготовки credential host, перед reservation/POST
и native continuation. Внешний caller по-прежнему отдельно проверяет
readiness/capabilities, контекст и разрешённый бюджет. Catalog evidence
не становится verified от прохождения этого guard.

Коннектор выбирается в одном модуле по connector/API profile/revision;
manufacturer, короткое имя и модель другого подключения не используются.
OpenRouter/DeepSeek работают через Chat, OpenAI Responses/Anthropic Messages —
через Native и прежние continuation formatters. Несовместимый protocol или
маршрут отвергается. Изменение route не переносит закрытые provider items.

Четыре существующих коннектора принимают явный production ModelFetch. Общая
Electron network session использует системный proxy, а проверочный запуск —
точный разрешённый VPN. Callback используется для настоящих fetch/stream,
не для подмены ответов. Legacy standalone connector callers сохраняют прежний
transport; configured factory требует передать его явно.

Каждая input/steer/tool/reserve/complete/continue граница проверяет текущий
process admission до/после ожидания. Configuration wrapper проверяет точный
маршрут и credential reference, в том числе перед streaming text. До POST
request policy даёт отдельное разрешение dispatch, затем vault снова проверяет
binding/reference/process admission перед выдачей ключа. Сам факт наличия
Connection/Route не даёт согласие на отправку контекста или расход.

Native ModelServer остаётся обязательной транспортной границей: он проверяет
primary journal intent, quotation, durable reservation/dispatch и одноразовый
claim. Factory не заменяет эту защиту и не создаёт второй scheduler/loop.
Close отзывает configuration/credential authority; тот же signal передаётся
NativeSessionHost для остановки принадлежащего сессии процесса и tools.

## Проверка и ограничения

Новый режим `--configured-model-preflight` существующего live driver использует
настоящие Cat-pilot services, сохранённые через UI Connection/Route и реальный
каталог OpenRouter. Для GET обязателен `SKARO_VERIFY_PROXY=http://127.0.0.1:10809`.
Настоящий коннектор создаётся, но request reservation явно запрещает все POST:
в этой проверке нет разрешения на отправку нового model payload/расход.

Проверяется подготовка host до native spawn, отказ prepared owner, привязка
активного native process, отказ чужого route, прохождение текущего intent через
RPC до настоящей request policy, отказ без budget reservation, отсутствие
повтора после отказа, live/replay и завершение процесса. TaskRun не создаётся,
изменений task/C4/configuration нет. Это не provider completion/continuation
или приёмка самостоятельного исправления/сдачи задачи.

Девять затронутых configuration/direct contract/DPAPI tests, сборка,
desktop/runtime typecheck и lint прошли. Native-прогон принят:
`verification/extensions-a942cbf9-8205-4141-a8c0-56ce72a3aa0a/proof.json`
в userData Skaro. Один настоящий owned runtime, один model intent, 0 budget
reservations/POST и чтений ключа. Повтор не добавил записей. Канонический
terminal failed ровно один, live/replay совпали, running items после close 0,
admission exited. TaskRun не создан, task/C4/configuration не менялись.

NO GOD: factory 119 строк, connector selector 87, live driver 217; изменённые
файлы меньше 300. UI в этом изменении не менялся; полный suite не запускался.
Продуктовый task/chat picker не включён, живой provider POST здесь не принимался.

## Обычный owner input через configured factory

Дополнительный режим `--configured-owner-input` использует ту же настоящую
сборку host, сохранённый маршрут и active process admission. Начальный send
сохраняется до подготовки, затем steer добавляет второй точный input того же
хода через production `appendChatOwnerInput`. Оба сообщения — локальные
verification instructions, сетевой отправки нет. Никаких ответов модели,
TaskRun, fake API или заменённого окружения не создаётся.

Принят proof `verification/extensions-b828a798-e048-4698-8835-ef1e2f791771/proof.json`
в userData: initial/steering preparations по одному, оба inputs совпали,
steering request сохранён до model intent. Повтор обоих input IDs не вызвал
подготовку или journal append; изменённый текст под прежним ID отвергнут.
Request reservation отказала до POST/чтения ключа; budget reservations 0.
Live/replay совпали, terminal failed ровно один, running items после выхода 0.

После отзыва configured host следующий send отвергнут немедленно; настоящий
native event stream завершился до explicit ожидания `session.close`. Выход
OS owner подтверждён, process admission exited. TaskRun не создан,
task/C4/configuration не менялись. Ранний proof без отдельного ожидания stream
сохранён как `extensions-cbbf7793-78e4-40e7-879f-9a9198d23a63`.

Пять целевых owner-steering/configuration tests, desktop typecheck, lint,
обычная сборка и отдельная сборка финального verification entry прошли.
UI не менялся, полный suite не запускался. Сценарий ещё не подтверждает
steering после настоящего provider response или успешное выполнение задачи.

## Восстановление configured session

Тот же режим расширен настоящим вторым runtime после подтверждённого выхода
первого. Lifecycle отдельного поколения вынесен в `configured-native-session`:
новый host получает свежие sequence/hash primary journal и новый admission,
сохраняя точные route/policy и прежний журнал. Это не fake resume или копия истории.

Принят proof `verification/extensions-98dba986-3262-4cfb-859b-200caa4616f8/proof.json`
в userData. Поколение увеличилось с 1 до 2, оба OS owner завершены. При повторной
доставке прежних send/steer IDs второй runtime вернул старые acknowledgements:
новых journal records, preparations и model intents нет. Один прежний model
intent остался с отказом, 0 budget reservations/POST/чтений ключа. Live/replay
и единственный terminal подтверждены также для восстановленного runtime.
TaskRun не создавался, task/C4/configuration не менялись.

Прогон включает сборку настоящего verification entry; typecheck и lint прошли.
Затронутый обычный configured-turn также повторно принят после выделения
lifecycle: `verification/extensions-aa6754f5-964f-4633-89e1-0074d2f4b314/proof.json`.
NO GOD: scenario 217, generation 117, owner-input helper 139 строк. Это проверка
перезапуска runtime в настоящем main host; холодный перезапуск всего Electron
и успешное продолжение provider-запроса этими нулевыми POST не заявляются.
