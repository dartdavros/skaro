# Steer внутри активного model turn

Дата: 01.11.2026. Подготовка BA-7, без изменения UI или включения каталога.
Активный steer требует отдельной capability в сохранённой input policy и
настоящего host formatter. Без них ввод явно отвергается.

Ввод сохраняется в прежней очереди RuntimeSession: точные text/item/command IDs,
исходный turn ID, user message и acknowledgement. Второго turn.started, runtime,
scheduler или task slot нет. Принятый input резервируется до завершения fsync,
чтобы финальный ответ не закрыл ход одновременно с его сохранением.

Текущий запрос/инструмент завершается своим прежним путём. На следующей границе
runtime передаёт host ссылку на сохранённый input и текущий model request.
Host сверяет baseline, policy, route и первичный журнал; peer не подменяет input.
Результат подготовки сохраняется со ссылкой sequence/hash на acknowledgement
до следующего model intent. Порядок уже принятых inputs сохраняется.

Если модель вернула terminal response, но уже есть принятый input, loop
продолжает тот же ход. Ответ относится к commentary, пока ход не завершён.
Пустая финальная граница закрывает приём синхронно; более поздний steer ждёт
terminal event и начинает новый ход. Ограничение maxSteps не увеличивается.
До 32 ожидающих inputs; отмена/ошибка не удаляет подтверждённые owner facts.

Для Chat formatter сохраняет исходные messages и continuation fields, добавляя
точный user text. Native provider formatting остаётся в host. Терминальный
Native response читается main по реальному result ID из того же turn/journal,
а не принимается из RPC. Закрытые items не преобразуются в Chat или display text.
Без совместимого formatter автоматического fallback нет.

## Проверки и ограничения

Два pure contract tests используют настоящий RuntimeJournal и production Chat
formatter: гонка принятого input с финальной границей, sealing и отмена после
acknowledgement. Provider response/HTTP server не подставляются, model effects 0.

Штатный driver `--native-owner-steer` на Cat-pilot проверяет два input в одном
owned runtime и host RPC. Разрешена только локальная подготовка ранее известного
payload. Настоящий reserve отказывает без разрешения на POST; коннектор не
получает запрос. Проверяются exact inputs, source refs, запрет смены permissions,
dedup, один begin/terminal и production live/replay. TaskRun не создаётся.

Принято: `verification/extensions-fd84dfca-ea73-458d-a999-af91cd29ac24/proof.json`
в userData Skaro. Два точных input в одном ходе, один initial и один steering
preparation; request с обоими inputs сохранён до model intent. Смена permissions
во время хода отвергнута, повтор input ID ничего не подготовил. Реальный reserve
отказал: один intent, ноль reservations/POST. Один begin/terminal failed, live/replay
совпали, running items 0; owned runtime завершён, task/C4 не изменены.
Сборка, типы runtime/adapter/desktop, lint, 9 целевых contract/journal и 2
compiled-native проверки прошли. Полный suite/browser UI не запускались: UI не менялся.
Затронутые ordinary input и internal model negative прогоны также повторно приняты:
`extensions-e0acd140-ada6-4451-9fda-6fba338fd080` и
`extensions-8ab509b3-0280-4f97-9ef2-a7024af472c8`. Четыре runtime завершены,
model requests/reservations 0; существующие отказы, restart и replay сохранены.

Полная provider-приёмка
steer во время streaming/tool response, native terminal response и перехода к
следующему ходу ещё открыта. Текущий ledger 80 model intents не расширяется;
прошлый положительный send не переименовывается в приёмку steering.
