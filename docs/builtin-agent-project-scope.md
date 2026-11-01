# Проверочный запуск ограничен Cat-pilot до старта служб

Дата: 01.11.2026. Уточнение обязательного правила владельца: запрет использовать
Chatballs распространяется и на фоновые службы обычного Skaro, а не только
на выбранную задачу в verification driver.

## Причина изменения

Для визуальной сверки BA-8 был запущен обычный `electron-vite preview` с реальным
профилем. Такой старт восстанавливает сохранённый workspace и запускает graph/
workflow recovery всех зарегистрированных проектов. Это не гарантировало
исключение Chatballs и нарушало требуемую границу проверки. После замечания
владельца собственный Electron preview остановлен по подтверждённому PID и пути.
Файлы Chatballs для проверки или отката не читались. Отсутствие фоновых обращений
или изменений этим запуском не утверждается; он не считается приёмкой BA-8.

Прежние drivers выбирали Cat-pilot для своих действий, но общий createServices
тоже мог запускать глобальную индексацию/recovery. Их исторические доказательства
подтверждают конкретные операции, но не отсутствие фоновых обращений к другим
проектам. Исправление не переписывает эти proof files и не скрывает ограничение.

## Граница нового запуска

`catPilotState` читает только ID зарегистрированного Cat-pilot из реальной базы
и ограничивает AppState до создания служб. Все live service drivers используют
эту точку. Для штатного Electron предусмотрен `SKARO_VERIFICATION_PROJECT`:
переданный ID должен принадлежать Cat-pilot. Отсутствующая/другая регистрация
даёт отказ до project services. Обычный пользовательский старт не меняется.

Scoped shell registry перечисляет/пейджит только выбранный проект. Projects
не создаёт context/watcher для чужого ID. Background recovery через projectRecords
видит только Cat-pilot; durable commands чужих owners остаются нетронутыми.
Stale runtime reset ограничен project_id, а не всеми задачами реальной базы.
Bootstrap начинает на существующем экране настроек, не восстанавливает старые
задачи/чаты. Workspace, bounds и settings navigation этой проверки сохраняются
только в памяти, open_tabs владельца не перезаписываются.

Graph индексирует только выбранный registry scope и использует отдельный файл
очереди: глобальный jobs.json не читается/не перезаписывается. Background workers
получают scope до создания очередей. Pager каталога читает scoped registry и
использует отдельный производный `registry-<projectId>.db`; общий `registry.db`
не мигрирует и не перезаписывает. Это тот же штатный индекс, не подставные cards.

Docker cleanup получает только контейнеры/records Cat-pilot до finished/stop
callbacks. Явные чужие TaskKey отвергаются. Close не останавливает другие проекты,
global Docker prune в scoped-запуске не выполняется. Это фильтр штатного контура,
а не fake backend, seed профиль или копия проекта.

## Проверки

Контракты используют настоящий SQLite с чистыми metadata DTO, без checkout,
fake runtime/API и чужих каталогов: registry/pager, scoped reset, отсутствие
foreign history, сохранность workspace/open_tabs, запрет смены scope и чужого
ProjectContext. Отдельно проверяются чистые фильтры environment ownership.
Сборка, desktop typecheck, lint, 3 scope/CAS и 2 затронутых default core tests
прошли. NO GOD: AppDb 300 строк, TaskEnvironments 295; pruning и ownership scope
вынесены в отдельные модули. Полный suite не запускался.

Штатный scoped proof: `verification/extensions-fac04ccf-e0d1-4af1-ad8c-e41ef3ac45f2/proof.json`
в userData. Реестр/вкладки — только Cat-pilot, восстановленных foreign histories 0;
observer увидел только `78bc2cd3-981b-40ed-a395-c6c6bc7da51b`.
Native boundary повторён: `extensions-851dad72-657c-44bb-a526-61d02aad9a8f`,
два input одного хода, replay совпал, runtime завершён, model requests 0,
task/C4/configuration неизменны.

Настоящий Electron запущен с project scope; визуально проверен существующий
экран «Настройки → Агенты», единственная вкладка Cat-pilot. Восстановления
Chatballs нет. Следующее уточнение заменяет отказ каталога настоящим scoped
индексом. Отдельный SQLite contract проверяет единственный проект в page,
отказ update чужой card и неизменность общего индекса. Общая home-навигация
всех проектов этим ограниченным запуском не принимается.
В повторном штатном Electron визуально проверена home-страница: единственная
карточка Cat-pilot, фоновых ошибок каталога в startup/shutdown log нет.
