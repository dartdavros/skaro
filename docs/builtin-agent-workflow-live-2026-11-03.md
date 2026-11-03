# BA-7: настоящий workflow на Cat-pilot, 03.11.2026

**Полная BA-7 не принята.** Разрешённое расширение использовано:
**129 intents / 460686901 nanoUSD ($0.460686901)** расходов и удержаний.
Это весь прежний ledger, а не только сегодняшний provider usage.
Технические $0.95 и общий $1 не превышены. Intent 130 не создан;
новые POST без нового разрешения на число запросов запрещены.

## Разрешения и контур

Владелец явно разрешил штатный переход из planFirst после проверки плана,
затем конкретный пакет/маршрут и локальные коммиты BA-7. Первые отказы
automatic approval review на POST и commit не обходились; разрешения получены
отдельными ответами владельца. Пакет остался неизменным:
`extensions-d03cbb73-a206-4332-b3f0-3ae5c077fd17/task-workflow-review.json`,
canonical SHA256 `600af359e54afa9328a70a418205f04784220a016778f298bb1bbcc3bc969cb1`.

Только connection `openrouter-owner`, `openai/gpt-4.1-nano`,
`https://openrouter.ai/api/v1` через `http://127.0.0.1:10809`, без direct fallback.
Все старые журналы, checkpoint sources и unknown holds сохранены.
Ключ не печатался и не переносился в команды или wire-инструкции.

Live services запускались только после catPilotState, с single-instance lock,
на зарегистрированном Cat-pilot. Второго host поверх приложения, fake backend,
fixtures/seed задач, run или model replies не создавалось. Chatballs не использовался.

## Код и границы

Отдельные workflow mode/models/tools/live/audit модули используют настоящие
TaskRunSessions, configured model host, process ownership и primary journal.
Хост сверяет точный owner input/context/continuation, source/checker revisions,
snapshot маршрута и прежние журналы. Полный ledger проверяется до quote
с новой reservation и повторно перед dispatch. До следующего modelStep
проверяется счётчик: intent 129 допустим, intent 130 не создаётся.
Исторические guards 80/85/89 не изменены.

Grant T-006 ограничивает чтения утверждёнными paths, правки — index и двумя
motion stylesheets, команды — точными flight/background checks. SVG-поддеревья
сохраняются побайтно; допускаются их порядок и две stylesheet links.
Motion styles не добавляют palette/layout или внешние ресурсы.
Schemas сравниваются с настоящими runtime/MCP catalogs.

Новые policy подключались штатными Skaro→Skaro handoffs: старый journal не
переписывался, история и checkout сохранялись. У нового scope свой command ID;
дедупликация predecessor messages не обходилась стиранием истории.
В strict policy используется required tool choice и сужение по настоящим
inspect→plan→check receipts. Заявление модели не открывает следующий этап.
Пример plan arguments получен из настоящих IDs/команды пакета, не является evidence.

Ask сохраняется. Ограниченный stdin→IPC relay принимает только явный owner answer
для точных run/interaction IDs и allow_once/deny. Автоматического подтверждения нет.
Первый wait 120 секунд истёк до передачи ответа владельца; команда не выполнялась.
Поздний ответ не применялся к другому call. Ожидание увеличено до 600 секунд;
положительная приёмка relay и продолжения после выполненного approval ещё отсутствует.

## Реальные результаты

Все пути ниже относительны к userData `Skaro/verification/`.

| Proof/attempt directory | Фактический результат | Ledger intents |
| --- | --- | --- |
| `extensions-ea42f4b0-fb05-416d-af43-5b678011430a` | planFirst выключен штатным handoff; раннее чтение отсутствующего journal остановило startup до POST | 89 |
| `extensions-66d858bc-2b2c-46d3-a0a2-7d96aea4eec5` | 9 model requests, 4 настоящих чтения; неподкреплённое утверждение о проверке трёх браузеров не принято, checks/submit отсутствуют | 98 |
| `extensions-8d95ff1b-d3d0-47de-841f-a277bce58897` | Наблюдатель преждевременно увидел старый stopped-state; новый input/POST не доставлен | 98 |
| `extensions-4e48ef4b-e296-4ef3-98f3-96f99afb1cca` | Настоящий inspect_acceptance; некорректный план и выдуманные revision/paths отклонены | 102 |
| `extensions-fe11212e-7013-47a3-865c-299134ddea96` | Новый scope; штатная очередь отфильтровала уже доставленный command ID из predecessor history; POST нет | 102 |
| `extensions-c37b5574-58a6-4412-9f5e-32982bd8f3a5` | Настоящий inspect; повторные неверные absolute path/startLine=0 отклонены; observation deadline и подтверждённый shutdown | 120 |
| `extensions-b48e756c-34e4-4a46-8795-9dd3bde98b6e` | Настоящий verification plan и approval на baseline run_check; wait истёк, команда не выполнена | 124 |
| `extensions-3c77c1a0-ae96-47ec-893a-24b9207ee50d` | Последние 5 запросов: inspect и некорректные/обрезанные plan arguments; числовой предел остановил продолжение | 129 |

Гонки наблюдателя исправлены: ожидание первого journal и нового command ack
предшествует трактовке stopped-state. Полные provider responses и ошибки остались
в primary; короткий proof не дублирует streaming chunks.

Последний маршрут имел согласованный `max_tokens=1024`. Часть попыток построить
план по отдельной команде на каждый критерий обрезалась; shell quotes/пути также
повторно формировались неверно. Исправление аргументов не выдавалось за выполненный
инструмент. Это отрицательная приёмка данного workflow, не вывод о всех моделях.

## Финальный read-only audit

`extensions-52a574d1-dc1e-420b-af5c-70bfda3399b4/proof.json` получен штатными
scoped services с запретом подготовки model host. Подтверждены весь ledger,
14 source files и три checker revisions, сохранённые ask/in-place/planFirst=false,
все admissions exited и выход записанных OS owners. Дополнительных POST — 0.

Текущий run T-006: `fbb66440-eacb-4887-a67c-9965dd88bd43`,
session `ae3304c3-c307-47d2-a3f5-30829e1a8e8d`, execution выключен.
Primary: `builtin/tasks/fbb66440-eacb-4887-a67c-9965dd88bd43/accb123afc4ea57b918f3394180f89f1477e2c2601fe2fc888e67eed2b4fcf89/journal.jsonl`.
Audit head: sequence 36, hash
`cc40faedb7fc069eb588d0f2e9d093ab6a3d6e2a7c4d6e312b9639d5f6c17f3e`.

T-006 in_progress, все десять критериев не закрыты. T-008 todo и blocked.
Исходники/дизайн Cat-pilot совпадают с пакетом, кроме штатного status T-006;
`css/cat-motion.css` и `css/plane-motion.css` отсутствуют. Проверки, реализация,
сдача, замечание с исправлением, worktree/environment handoff и capture/merge
не приняты. Firefox/WebKit не устанавливались.

## Проверки и продолжение

Main typecheck, lint и 12 целевых тестов в четырёх файлах прошли; production
build выполнена. Полный suite не запускался. Все изменённые code files ≤300 строк,
renderer/UI Skaro не менялся. Положительная browser/provider workflow приёмка
не заявляется. Environment review/evidence после фактической команды остаётся открытым.

Перед новыми POST нужны отдельное разрешение на расширение request count и новый
точный review, если меняются route/output envelope. Не менять нынешний пакет,
не поднимать ceiling, не сбрасывать ledger и не replay unknown POST.
Смена модели/max_tokens не подразумевается остатком денежного бюджета.
