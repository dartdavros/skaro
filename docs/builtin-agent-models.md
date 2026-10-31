# BA-4: коннекторы моделей и текущая приёмка

Дата: 31.10.2026. BA-4 начат и не закрыт. Код —
`packages/agent-runtime/src/models/`; host vault —
[защищённые credentials](builtin-agent-credentials.md).
Прямые сетевые проверки отложены по прямому указанию владельца.

| Область | Что реализовано | Что проверено |
| --- | --- | --- |
| OpenRouter Chat Completions | Схемы параметров, SSE, native IDs/arguments/reasoning_details, usage/cost, upstream policy, каталог | Два настоящих model/tool цикла, ошибки инструмента, interrupt, restart/replay, несовместимый параметр |
| OpenAI Responses | Native input/output items, encrypted reasoning, function_call_output, stateless store:false, usage и каталог | Только схемы запросов и типы; собственного BYOK/live API нет |
| Anthropic Messages | Message/content-block SSE, thinking/signatures, tool_use/result, cumulative usage, каталог с pagination | Только схемы запросов и типы; собственного BYOK/live API нет |
| DeepSeek Chat Completions | Собственные thinking/sampling параметры, reasoning_content, native tool IDs, cache usage, каталог | Только схемы запросов и типы; собственного BYOK/live API нет |

Все четыре API-профиля остаются `implementation: pending`. Часть OpenRouter
проверена на реальном сервисе, но это не проверка всех режимов/маршрутов.
Прямые коннекторы не выдаются за прошедшие контрактную приёмку. Отсутствующие
ключи/ответы не подменялись fake API, fixtures или SDK-заглушками.

## Общие границы и native semantics

HTTP реализован native fetch без дополнительных SDK-зависимостей.
Версия runtime/Node/Electron определяется закреплённой поставкой приложения;
профили API — revision 1, Anthropic version header — `2023-06-01`.
Отдельного незакреплённого SDK или автоматического выбора «совместимого» API нет.
Протоколы реализованы по официальным источникам:
[OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling),
[OpenAI streaming](https://developers.openai.com/api/docs/guides/streaming-responses),
[Anthropic streaming](https://platform.claude.com/docs/en/build-with-claude/streaming),
[DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/),
[OpenRouter reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens).

Коннектор связан с точными connection ID/revision/endpoint и credential lease.
Redirect запрещён; headers фиксированы коннектором. Неизвестные параметры
отклоняются, авторизация не является model option. Direct API не принимает
gateway allowlist/fallback. Модель не выбирается по manufacturer или имени.

Общие части: bounded SSE/JSON, проверка UTF-8, отмена, ограничения payload,
secret echo guard и metadata GET. GET повторяется до трёх попыток только
при 429/502/503/504 с bounded Retry-After/backoff и отменой. POST модели
не повторяется автоматически. Обрыв, отсутствие терминального события,
неполные arguments, max_tokens/filter stop и неизвестные native block deltas
не считаются успешным ответом. Live-проверки GET retry при 429 пока нет.

OpenAI сохраняет финальные output items целиком, включая reasoning items,
в исходном порядке. Tool results связываются по call_id. Anthropic сохраняет
native blocks и подписи, добавляет все tool_result blocks после assistant
message; неизвестный fallback/block не принимается как совместимый.
DeepSeek сохраняет reasoning_content всех предыдущих сообщений. Его схема
не принимает gateway reasoning_details; sampling при thinking отклоняется.
OpenRouter сохраняет reasoning_details и raw native deltas, включая пустые
массивы. Доказательства подписанного reasoning-продолжения пока нет.

Native continuation проверяет точное совпадение RouteSnapshot, IDs и количества
tool results. Смена маршрута не отправляет закрытую историю другому провайдеру.
Usage неизвестных компонентов и стоимость direct API имеют null.
Anthropic input total вычисляется из uncached/cache-read/cache-created только
при наличии всех трёх счётчиков; неполный total не заменяется догадкой.

## Внутренний loop и продуктовый gate

`executeChatTurn` использует настоящий RuntimeSession и его journal/tools.
Model intent сохраняется до запроса, полный native ответ/continuation —
до инструмента, результат инструмента — до следующего запроса. Command IDs
стабильны, конфликтующие ходы запрещены, одновременная доставка дедуплицируется.
Restart/replay использует committed ответы и результаты без повторного billing.
HTTP 4xx rejection, кроме неоднозначного 408, сохраняется как известный отказ;
оборванная/неизвестная генерация остаётся unknown и автоматически не повторяется.

Runtime interrupt/close немедленно отзывают model admission и tools,
ожидают завершения активного model callback до закрытия журнала.
Новый ввод возобновляет admission явно. Контекст/права не меняются посреди хода.

Оба entry, `executeChatTurn` и `executeNativeTurn`, пока внутренние. Native loop
использует тот же durable model-step и executor инструментов, сохраняет native
response до исполнения tools и собирает продолжение через свой connector.
Код direct loop не заменяет отложенную живую приёмку прямых API.
Продуктовые send/steer не подключены к credential/
model host и честно возвращают «no model request was sent». Gate регистрации —
`model-host-not-connected`; `skaro` не включён в UI/default. Native Responses/
Messages loop ещё не связан с продуктовым запуском процесса и RPC host.
Полная host RPC-интеграция, системный контекст и task/chat — следующие работы.

## Настоящая проверка OpenRouter

Владелец разрешил BYOK и общий бюджет до $1, отдельно подтвердил payload:
первые 2 строки AGENTS.md, первые 3 строки package.json и настоящий отказ
чтения .git/HEAD. `live-tool-authority.ts` проверяет exact paths/startLine/
maxLines перед инструментом; наружу передаются только фактические text/error.
Никакие другие файлы, metadata/hash или произвольные пути модель не получает.

| Модель из текущего каталога | Model requests | Реальные tools | Сообщённый upstream | Usage cost USD |
| --- | ---: | ---: | --- | ---: |
| openai/gpt-4.1-nano | 2 | 3 | Azure | 0.0001407 |
| anthropic/claude-haiku-5.5 | 4 | 3 | Claude Platform on AWS | 0.0007106 |

Каждая цепочка завершилась streaming-ответом и обработала настоящий scope
denial. После dispose/open той же сессии replay не добавил записей/эффектов
или model requests. Native deltas из настоящего журнала повторно разбираются
текущим parser и сравниваются с committed message/usage.

Дополнительно прошли:

- interrupt по первому настоящему streaming text: admission отозван, поздних
  tools — 0, незавершённый ответ unknown, автоматического повтора нет;
- несовместимый top_p для выбранного Anthropic route при require_parameters:
  сервис отверг запрос, outcome известен, fallback не включался;
- повторный запуск verification entry использует durable proofs этих cases,
  без новых POST модели.

Три первые попытки закончились без успешной цепочки и сохранены отдельно.
В ходе исправлений удалён автоматически добавленный parallel_tool_calls,
который не заявлен каталогом выбранных endpoint. Причина первого сбоя отдельно
не доказана. Парсер также ошибочно отвергал terminal metadata/пустые delta
после finish_reason; этот отказ воспроизведён живым API и исправлен.
Старые неизвестные исходы не переписаны успешными.
Новая версия cases имеет отдельные IDs и учитывается в общем spend envelope.

Цена ограничена gateway max_price ($0.50/M input, $2/M output), output —
512 tokens, input — 16 KiB плюс консервативный запас шаблона. Каждый request
резервируется как $0.05; общий durable предел всех журналов — 16 requests,
до $0.80 из разрешённого $1. Неизвестные исходы сохраняют резерв.
Это ограничение этих проверок, а не изменение account-wide лимита ключа.
Исходный предел 10 requests расширен в рамках разрешённого $1 после исправлений.

Разница usage ключа между исходной и последней read-only проверкой — около
$0.0011124, включая неуспешные/прерванную попытки. `/key` обновляется с задержкой;
это наблюдение по ключу, не замена request receipts и не гарантия отсутствия
чужого параллельного использования. Стоимость двух успешных цепочек отдельно
сохранена выше. Приёмка не выдана за запуск интерфейса приложения.

Всего отправлено 11 запросов модели, резерв всех попыток — $0.55.
Четыре unknown outcomes (три ранних сбоя и streaming cancel) сохранены отдельно.
Журналы и счётчик резерва не сбрасывались при исправлениях кода.

Повторяемый entry из корня репозитория:

```powershell
node apps/desktop/scripts/verify-openrouter.mjs CREDENTIAL_REFERENCE_ID REVISION
```

Аргументы — несекретная reference, не API key. Entry использует реальный vault,
реальный сервис и readonly scope репозитория. Журналы находятся в настоящем
userData Skaro под `verification/openrouter-ba4`, в Git не копируются.

## Что остаётся открытым

Для последующей [длительной проверки BA-5](builtin-agent-context.md) фиксированный
резерв $0.05 на каждый запрос заменён durable ledger: завершённые запросы
учитываются по USD receipts, неизвестные исходы сохраняют прежние резервы.
Новые резервы рассчитываются до POST по размеру входа и price/output caps;
для расширенного контекста установлен нулевой request fee cap. Общий предел
владельца $1 не менялся: admission останавливается выше $0.95, запас — $0.05.
Дополнительный hard limit — 80 запросов всех журналов. Исторические результаты
BA-4 выше описывают ограничения, действовавшие на момент тех проверок.

Живые прямые OpenAI/Anthropic/DeepSeek отложены владельцем; response decoders,
их continuation/cancel/error/cache semantics ещё не подтверждены сервисом.
Не проверены live signed reasoning, изображения, все routing/fallback режимы,
произвольные compatible endpoints и все платформы/архитектуры.
BA-5–BA-9, продуктовый host и UI/design gates остаются открытыми.
