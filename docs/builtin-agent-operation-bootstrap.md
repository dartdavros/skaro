# Каталог MCP до запуска native runtime

Дата: 01.11.2026. Подготовка BA-7: устранена циклическая зависимость между
построением extension descriptors и допуском ещё не запущенного процесса.

Привилегированный host читает `McpHttpServer.describe(scope)` из настоящего
реестра handlers. HTTP tools/list и admitted internal catalog используют тот же
metadata projector: availability, имя, описание и JSON schema. Snapshot — копия;
его изменение не меняет реестр. Метод не создаёт HTTP grant, процесс, TaskRun
или право вызова и не передаётся через RPC runtime.

`prepareSkaroOperations` связывает эти метаданные с исходным scoped port,
точным admission и allowlist до spawn. Прежний `bindSkaroOperations` сохраняет
проверку active admission при чтении каталога и использует тот же binder.
`execute` по-прежнему проверяет действующий lease до/после handler, availability
и schema исходного реестра. Подготовленный, отозванный и устаревший допуск
не разрешают операцию. Descriptors не становятся capability на выполнение.

Revision включает описание вместе со схемой и policy: изменение текста,
отправляемого модели, тоже меняет сохранённую policy. Сессии с прежней revision
не переписываются; resume с другим каталогом требует явного нового контекста.

## Приёмка

Штатный driver `--native-admissions` на зарегистрированном Cat-pilot теперь
проверяет bootstrap двух настоящих поколений runtime. До spawn каталог доступен
только host, active catalog/execute отвергаются. После сохранения OS ownership
каталоги совпадают, runtime вызывает настоящий read-only `get_project_context`.
После отзыва direct catalog/execute запрещены, оба runtime завершаются.
Task T-008/C4 сравниваются до/после; модель не вызывается, ActiveRun не создаётся.

Принято: `verification/extensions-5fec4b85-3656-4316-b030-5b1e14970285/proof.json`
в userData Skaro. Два поколения, обе проверки handler и запреты до spawn/после
revoke прошли; подтверждён выход обоих runtime, task/C4 неизменны, model requests 0.
Сборка, desktop main typecheck, lint, 6 journal и 2 compiled-native проверки прошли.
Полный suite и browser UI не запускались: интерфейс не менялся.
Положительный запуск продуктовой builtin-задачи и task/chat model startup
остаются отдельными незакрытыми пунктами.
