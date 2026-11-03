# Встроенная сессия в lifecycle чатов

Дата: 02.11.2026. Внутренняя ветка attachment настоящего существующего чата
с `agent=skaro` добавлена в ChatSessions. Новый builtin-чат через product picker
ещё не создаётся; эта работа не закрывает положительную приёмку BA-7.

`createServices` принимает отдельный main-only `builtinChats` authorization port.
Без него startup явно отказывается до model/process admission. Подключение,
ключ или маршрут не дают неограниченное право отправки контекста и расходов.
Task и chat factory используют общую configured model composition, vault,
metadata, owner input, реальные MCP handlers и проверенные tool schemas.

Границы чата:

- Lease принадлежит настоящим LiveChat и saved ChatRecord; проверяются project,
  chat ID, agent, archive/stop state, native session ID и operation generation.
- Import ID берётся из существующего import workflow и перепроверяется при
  каждом requireActive. Смена import scope не наследует прежний допуск.
- Project_chat scope допускает только project/chat/import поля. Task/run поля
  и task verification/acceptance authority отвергаются.
- Сохраняются точные chat/import instructions, cwd и разрешённые readDirs.
  Подготовленная конфигурация не повышает permission mode и не подменяет
  route/model/effort или journal/artifact paths.
- Native ID сохраняется до spawn. Настоящий OS owner регистрируется до допуска
  к работе в существующем chat process registry и durable native lease.
- Cancellation/archive/closing и late startup не публикуют устаревшую сессию.
  Отзыв закрывает configured credentials/route authority; cleanup подтверждает
  выход owned tree. После shutdown operation lifetime не возобновляется.
- Managed Claude/Codex сохраняют свои adapters; инструкции и history sinks
  вынесены в общий `chat-session-options.ts`.

Никакого второго scheduler, fake ChatRecord/LiveChat, backend или ответа модели
не создавалось. Каталог product agents, создание новых builtin task/chat,
настройки их выбора и переход по умолчанию не включены этой веткой.

Целевые проверки: pure chat/import policy DTOs, общие task/file/model/effort
gates, настоящие runtime schemas, native context из реального журнала/AGENTS,
реальные дочерние процессы и OperationLifetime. Шесть файлов, 15 тестов прошли.
Legacy `chats.test.ts` с FakeSession не запускался по правилу владельца о заглушках.
Это ограничивает регрессионную проверку managed chat startup; положительный
прогон текущей ветки в настоящем Electron остаётся необходимым.

UI не менялся. Пользовательский установленный Skaro не закрывался, второй
services host не запускался. Chatballs не использовался; новые model POST
не выполнялись, предыдущий бюджет и исчерпанное разрешение на пять POST сохранены.
