# Явные настройки builtin chat-session

Дата: 02.11.2026. Внутренний контракт BA-7; создание и picker ещё не включены.

Builtin chat-session требует отдельную запись `builtin.chat.<chatId>.settings`:
agent `skaro`, точный route ID, явный permissionMode `ask`/`full` и совместимый
effort, если он выбран. Отсутствие записи даёт отказ до native admission.
Managed chat settings и project defaults не используются как запасной выбор.

Чат работает в основной копии проекта. `auto`, task isolation и planFirst
в его DTO запрещены. Общий parser отвечает только за agent/route/effort/права;
task и chat отдельно проверяют собственные workflow-настройки.

Общий route preflight для task/chat проверяет сохранённые Connection/Route,
актуальный каталог и точный API parameter effort. Он не читает ключ и не
выдаёт model POST, budget или tool admission. Прямые API остаются закрыты
каталоговым gate, пока нет предусмотренного ими metadata-контракта.

Перед подготовкой, публикацией и возвратом сессии сверяются текущая запись
настоящего чата, live owner, native session ID, архив/stop/closing и точные
настройки. Изменение настроек во время подготовки отзывает начатый host через
прежний cleanup. Старые native admissions и credentials не переиспользуются
в обход проверки текущего поколения.

## Проверки и границы

- 5 файлов, 11 тестов прошли: строгие task/chat DTO, реальные SQLite settings,
  сохранность managed preferences, отсутствие fallback, task/chat policy и
  каталоговые DTO-контракты. Проект/чат/run и API-ответы не создавались.
- TypeScript main, lint, форматирование и production build прошли.
  Все изменённые файлы меньше 300 строк. UI не изменён.
- Положительная chat-session в штатном Electron не принята. Новая запись
  чата не создаётся до согласованной интеграции product agent catalog/types:
  текущий managed-only summary/settings ещё не отображает builtin.
- Живые проверки допустимы только на Cat-pilot. Дополнительных model POST
  не было; ledger и ранее согласованные ограничения остаются прежними.
