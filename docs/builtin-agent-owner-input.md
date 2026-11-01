# Owner input и подготовка model turn

Дата: 01.11.2026. Подготовка BA-7, без включения каталога или нового UI.
Обычный `send` и `steer` в отсутствие активного хода используют host model port,
если его input policy явно настроена. Без неё остаётся прежний наблюдаемый отказ.
Добавление к активному ходу требует отдельного
[steering capability и formatter](builtin-agent-owner-steering.md); полная
provider-приёмка этого пути остаётся открытой.

## Сохранение и допуск

RuntimeSession использует прежнюю очередь команд. Аcknowledgement содержит
точный owner input, его command/item/turn IDs и канонический user message вместе
с turn.started в одной durable записи. `send` возвращает acknowledgement;
результат модели приходит обычными Timeline событиями. Успех доставки ввода
не означает успех запроса, инструмента или сдачу задачи.

Отдельная input revision сохраняется в model policy. Main читает фактический
input из primary journal, проверяет hash, baseline, route, scope/admission и
актуальное состояние. RPC передаёт только command ID; peer не заменяет текст.
Host собирает request, не отправляя POST. Подготовленный запрос сохраняется со
ссылкой sequence/hash на исходный input. Только после этого обычный model loop
проходит intent, quotation/reservation и проверку перед настоящим POST.
Ключи остаются в credential host. Images без проверенного маршрута отвергаются.

Повтор command ID возвращает прежний acknowledgement без новой подготовки
или запроса, включая restart. Подмена содержимого при том же ID отвергается.
Конкурентный model turn/context change не создаёт второго исполнителя.
Ожидаемый отказ некорректной команды возвращается отдельным reply и не убивает
здоровый runtime; IO/journal failure остаётся фатальной ошибкой процесса.
Ошибки подготовки завершают тот же ход failed; отмена — interrupted.

Signal поколения захватывается до durable записи input. Interrupt отзывает его
сразу при dispatch и повторно на своей границе очереди: более ранний queued input
не может восстановить отозванный запрос. Close/dispose ждут и preparation,
и model work. Ошибка фоновой записи передаётся владельцу процесса, а не скрывается
успешной доставкой. При restart незавершённый model lifecycle получает один
interrupted с сохранением частичных items. Ввод, POST и tools не повторяются.

## Проверки и остаток

Driver `--native-owner-input` использует настоящий vault/коннектор и Cat-pilot.
Согласование payload отсутствует, поэтому preparation обязана отказать до
model intent/POST. Проверяются ordinary send, точный input, повтор доставки,
подмена ID, images/пустой input, restart без redelivery и production live/replay.
Отдельный `--native-input-plan` использует только прежний согласованный payload,
через Xray, с общей суммой до $1 и максимум пятью новыми model intents.

Принят preflight: `verification/extensions-732ce75b-1d00-4ec1-a57b-4dc9df08979c/proof.json`
в userData Skaro: один preparation, ноль model requests, два runtime с
подтверждённым выходом, task/C4 неизменны. После конфликта ID сессия продолжила
обрабатывать команды. Live/replay совпали, один terminal failed, running items 0.
Неуспешные прогоны a7d02223/0c1f08e8 сохранены: они выявили ошибочное завершение
runtime при ожидаемом отказе команды. Transport исправлен, assertions сохранены.

Положительный ordinary send также принят: `verification/openrouter-ba4/session-nativeinput.jsonl`,
ход `owner-ab9e061e7b7d32f262602083bfdbaf33d6cd8199fa926333c90641788ee300be`.
Пять настоящих запросов через Xray, один preparation, три штатных verification
tools и streaming text; один terminal done, live/replay совпали. Повтор input ID
не отправил POST; runtime завершился, task/C4 неизменны, readyToSubmit false.
Это проверка модельного планирования, не выполнения или сдачи активной задачи.

Сборка, типы runtime/adapter/desktop, lint, 7 journal/recovery и 2 compiled-native
проверки прошли. Полный suite и browser UI не запускались: UI не менялся.
Pure lifecycle test
создаёт настоящий begin через ModelTurnTimeline, закрывает журнал и проверяет
однократное восстановление без provider response, fake API или model intent.
Полная приёмка active steer, task/chat startup и выполнения активной задачи открыта.
