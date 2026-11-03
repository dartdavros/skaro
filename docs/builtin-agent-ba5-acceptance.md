# BA-5: итоговая приёмка

Дата: 31.10.2026. BA-5 принят в текущем поддерживаемом контуре Windows.
Последующее указание владельца: новые живые проверки выполнять на Cat-pilot.
Ниже сохранены исторические результаты BA-5 на Chatballs; актуальный Cat-pilot
browser evidence описан в [продолжении BA-6](builtin-agent-checks.md).
Объём — внутренний runtime на Windows, без включения продуктового агента.
Основание критериев — [BA-5 плана](builtin-agent-plan.md#ba-5-контекст-compact-browsermcpskills).

## Проверенные границы

| Критерий BA-5 | Фактическое доказательство |
| --- | --- |
| Scoped инструкции, ревизии, paging, skills | Настоящие AGENTS/план/ADR, stale revision и установленный SKILL.md; context regression |
| Длительная сессия после compact/restart | 39 настоящих OpenRouter requests, два compact, три процесса restart, точные заметки/решение, replay без POST |
| Смена маршрута на безопасной границе | Четыре API-профиля; открытый настоящий вопрос блокирует смену; после ответа chat/native projection сохраняет решение и ответ, continuation сброшен; restart |
| Новое поручение владельца между ходами | Настоящая сохранённая модельная сессия принимает «добей этот этап»; старый system frame отклонён, исходные records сохранены, новых model intents нет |
| HTTP MCP и внутренние операции | Настоящие createServices/AppState и зарегистрированный проект Skaro; один действующий каталог/handlers для обоих путей |
| Scope, подтверждения и недоступность MCP | submit_result вне project_chat scope, чужие args отвергнуты; allow_once до intent, dedup; отозванный HTTP grant даёт наблюдаемый unknown без повторного вызова |
| Отсутствие отдельной отправки журналов | HTTP token не попал в runtime journal; публичная история исключает closed native state; новые проверки не вызывают модельные API |
| Browser в штатном окружении задачи | Chatballs T-171: navigation, readiness PostgreSQL/Redis, screenshot, console без ошибок/предупреждений, подтверждённый выход MCP процесса |
| Media artifact bridge | Настоящий PNG 119 790 bytes сохранён host; SHA256 проверен, base64 в journal отсутствует; screenshot просмотрен |

`McpHttpServer.operations` связывает внутренний port с теми же tool definitions,
availability и handlers, которые использует настоящий HTTP server. Новый workflow
сдачи, слияния или C4 не создаётся. Host admission проверяется до и после вызова.
Консервативный readOnly=false для проверенного чтения позволяет проверить
настоящую цепочку allow_once, не выполняя изменения проектных данных.

## Browser и media

Используются существующие Docker-контейнеры задачи Chatballs T-171, настоящий
worktree и сохранённые volumes. PostgreSQL и Redis проходят readiness 200.
Новые seed-данные, mock API, временный HTTP backend и учётные записи не создаются.
Официальный taskBrowserServer/Playwright MCP работает через runtime allowlist
и точные подтверждения. Browser-проверка отделена от запуска createServices:
штатная startup idle-cleanup останавливает неактивное окружение задачи.

Первый запуск остановился на connection refused после этой cleanup. Два следующих
получили реальный navigation timeout 45 секунд. Контрольный штатный MCP smoke
и Chrome открыли тот же backend. Причина в runtime: очищенное env исключало
нужные Chrome Windows profile/cache paths. В MCP возвращены только HOME,
USERPROFILE, APPDATA, LOCALAPPDATA; model credentials и произвольный env
не наследуются. После исправления navigation и readiness прошли.
Далее schema validation правильно отклонила screenshot без обязательного
`scale`, до effect intent. Драйвер исправлен по настоящему каталогу: scale=css,
без filename, чтобы официальный MCP вернул image вместе с файлом в outputDir.
Все четыре неудачные попытки сохранены; таймауты и проверки не ослаблялись.

Итоговый proof: `verification/extensions-6196f2cf-3dc8-4670-ba84-23e211d8ed53/proof.json`.
Файл изображения — `images/e1870f1d973348b235019d8079972a9a8b932d5dbd86a73af22aeb87c63fefe5.png`
в том же каталоге. Визуально подтверждена настоящая форма входа Chatballs;
вход, изменение аккаунтов и бизнес-операции не выполнялись. Console: 0 errors,
0 warnings. Это приёмка browser integration, не всех сценариев Chatballs.
HTTP/routes/owner proof: `verification/extensions-ccaa5871-310d-4758-8395-eae33e8f1220/proof.json`.

Изображения MCP сохраняются host в приватные PNG/JPEG artifacts с SHA256,
размером и MIME. В journal возвращается metadata/reference, не base64 или
удалённый URL. Действуют предел размера, проверка кодировки и сигнатуры,
отказ для symlink/изменённого существующего файла и отмены. Это artifact bridge,
а не заявленная проверка vision конкретного модельного API.

## Воспроизведение

После штатной сборки, при закрытом основном Skaro:

```powershell
node apps/desktop/scripts/verify-builtin-extensions.mjs
node apps/desktop/scripts/verify-builtin-extensions.mjs --browser CAT_PILOT_PROJECT_ROOT
```

Первый режим запускает настоящие службы Skaro с его текущим userData, включая
обычную startup/recovery и остановку idle environments. Второй запускает только
runtime и официальный task browser на настоящем file:// index.html Cat-pilot.
Это независимые сценарии. Proof и журналы сохраняются в userData под
`verification/extensions-UUID/`, не в Git. Секреты и model credentials в CLI
не передаются. Нужен зарегистрированный текущий проект и настоящий long-session
proof BA-5 для проверки owner frame, подготовленные журналы не используются.

## Границы результата

Native compaction опциональна по исходному плану; принят локальный compact.
Живые прямые OpenAI/Anthropic/DeepSeek и их signed reasoning/vision остаются
отложенной владельцем приёмкой BA-4. Проверка route boundaries не выдаётся
за обращение к этим API. Подключение runtime к task/chat host lifecycle — BA-7;
настройки/UI — BA-8. До этого bundled агент не включается по умолчанию.

macOS/Linux stdio пока явно отвергаются из-за непроверенного process-tree
backend; это сохраняемое платформенное ограничение BA-3 и будущей BA-9,
не заявленная успешная проверка другой OS. OS sandbox по-прежнему не заявлен.

Штатная сборка, TypeScript desktop/runtime/MCP, ESLint и Prettier прошли.
Шесть целевых regression-сценариев в трёх файлах прошли: context, настоящий
MCP и compiled native worker. Последние MCP/native проверки выполнены после
финальной сборки. Полный suite не запускался. Изменённые исходники меньше
300 строк; UI не менялся.
Новых запросов моделей при закрытии этапа — 0; бюджет BA-4/BA-5 не увеличен.
