# Живая проверка отказов нового builtin launch

Дата: 02.11.2026. Проверена main-only очередь BA-7 на зарегистрированном
Cat-pilot, без выполнения задачи и передачи данных модели.

Владелец разрешил штатно закрыть установленный Skaro и запустить scoped
проверку без model POST и запуска задач. Окно старого приложения сворачивалось
в трей; владелец выбрал «Выход». Отсутствие прежнего процесса подтверждено
перед созданием нового service host. Single-instance lock не обходился.

Сценарий `verify-builtin-extensions.mjs --task-launch-preflight` создаёт
штатные службы через catPilotState до createServices. Используются реальные
AppDb, проект, TaskRuns, queue, Connection/Route и каталог OpenRouter через
VPN proxy `http://127.0.0.1:10809`. API/backend не подменяются.

Проверена настоящая T-008 со всё ещё незавершённой зависимостью T-006:

- Отменённый заранее ввод отказан до постановки в очередь.
- Отмена после начала metadata admission также не поставила задачу в очередь.
- Реальный dependency blocker отказал после проверки выбранного маршрута.
- Несуществующий route ID отказан без fallback.

Сравнены до/после: задача, список run, durable startup, C4-review,
свободные слоты и model configuration. Всё неизменно. Callback допуска
model host настроен только на отказ и ни разу не вызван: preparations 0,
model POST 0, новых run 0. Это проверка реальных запретов, не успешная
модельная задача, не handoff и не сдача/merge.

Proof в настоящем userData:
`verification/extensions-b8c8ce6e-3977-4337-990d-a8c9fa5954ee/proof.json`.
Observed project IDs содержит только `78bc2cd3-981b-40ed-a395-c6c6bc7da51b`.

Затем проверено настоящее окно новой production-сборки с
`SKARO_VERIFICATION_PROJECT`: единственная вкладка и карточка Cat-pilot,
сохранённое подключение `openrouter-owner`, индикатор сохранённого ключа и
маршрут `openai/gpt-4.1-nano`. Проектные задачи/чаты не запускались.

Проверочный PID 22156 завершён штатной кнопкой окна. Ранее разрешённое
временное выключение close-to-tray осталось в памяти AppState; сохранённое
значение в SQLite по-прежнему `true`. Хеш owner workspace/bounds/settings
navigation, open_tabs и model configuration до/после совпал:
`9e475d86b2b8b3f64e90604ae57986fea2d6c09f956978bae18fe38f181bbfe5`.
Отдельный `scoped-ui-proof.json` сохранён рядом с proof.json; это запись
наблюдений Windows UI и настоящего read-only сравнения SQLite, не model proof.

TypeScript main, lint, форматирование, синтаксис CLI и production build прошли;
сам live driver собран Vite и завершился с кодом 0.
Положительная сквозная приёмка BA-7 остаётся открытой.
