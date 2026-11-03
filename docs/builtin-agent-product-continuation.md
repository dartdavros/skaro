# Реализация остатка BA-3–BA-9, 03.11.2026

Поручение владельца: реализовать весь оставшийся код без остановок. Лимит
BYOK для обычных task/chat — необязательная опция. Проверочный бюджет остаётся
отдельным: 129 intents, $0.460686901 расходов/holds, технический потолок $0.95,
общий $1. Подготовка нового пакета разрешена, новый POST ещё не разрешён.
Default и публикация — только после полной приёмки.

## Реализуемые границы

- Прямые каталоги OpenAI/Anthropic/DeepSeek используют штатный metadata GET
  и тот же защищённый vault. Отсутствующие цены и capabilities остаются unknown.
  Результат каталога не считается проверкой inference или tool readiness.
- Обычный запуск использует реальные TaskRunSessions/ChatSessions, admissions,
  сохранённый Connection/Route, обычные scope/permissions и текущие MCP handlers.
  Scoped verification не наследует продуктовый grant и необязательный бюджет.
- Обычный BYOK не требует заданного лимита. Заданный USD cap удерживает
  неизвестную стоимость; для него нужны полные, enforceable gateway price
  ceilings. Прямой API с неизвестными ценами не получает фиктивную оценку.
  Cap относится к native-сессии; новый явный handoff создаёт новую сессию.
- Отправка owner input сейчас текстовая. Каталоговые vision capabilities
  не включают продуктовую загрузку изображений через этот formatter.
- Публичная история чата доступна постранично, без private reasoning.
  Смена настроек требует idle/закрытых interactions и подтверждённого выхода
  прежнего process owner; новый journal и настройки публикуются атомарно.
- Учёт расхода читает настоящие primary receipts и сохраняет ссылки после
  очистки ленты. Известные суммы, неполные данные и отсутствующие журналы
  различаются. Это не баланс аккаунта и не подписочные окна.
- Перед новым модельным запросом durable limiter останавливает три подряд
  повторных неизменных tool result или шесть последовательных ошибок.
  Checkpoints сохраняются при resume; новое реальное owner input снимает стоп.
- POSIX команды используют отдельную session/process group; sh/bash выбираются
  явно, потеря runtime custody останавливает группу. Это не filesystem/network
  sandbox. Демон, сменивший session/group, не получает гарантию containment.
  Положительная macOS/Linux приёмка требует этих настоящих платформ.
- Проверки сохраняют измерения host-selected бинарников/worker. Неизмеренная
  зависимость остаётся unresolved. `review_check_environment` всегда запрашивает
  явное allow_once, включая full: для точных receipts, criteria revision,
  commands/observations и dependency hashes. Это подтверждение допущений,
  а не доказательство dependency closure или успешной сдачи.

## UI в существующем baseline

Список агентов и существующие picker/AgentModal показывают Skaro с текущей
иконкой приложения. npm download/login/config блоки к bundled runtime не
применяются. Route остаётся точным набором параметров; его effort изменяется
в прежней форме маршрута, без тихой подмены в task/chat.

В существующем AgentModal после model fields расположен штатный TextField
«Лимит сессии, USD (необязательно)». Пустое поле не задаёт лимит. В прежней
модалке лимитов выбор Skaro показывает расход проекта через штатные Row/Banner:
ответы/запросы, известные input/output tokens, стоимость по квитанциям.
Новые страницы, палитра, иконки и отдельные оболочки не добавляются.

## Источники API

- [OpenAI List models](https://developers.openai.com/api/reference/resources/models/methods/list):
  membership/identity; цены и inference readiness не выводятся из имени модели.
- [Claude List models](https://platform.claude.com/docs/en/api/models/list):
  cursor pagination и явно возвращаемые capabilities/limits.
- [DeepSeek List models](https://api-docs.deepseek.com/api/list-models/):
  только объявленные modalities, limits и effort levels.
- [Node detached child processes](https://nodejs.org/api/child_process.html#optionsdetached):
  отдельная POSIX session/process group; её границы не являются OS sandbox.

## Статус проверки

Рабочий документ. Итоговые команды, результаты, живые ограничения и packet
hash фиксируются после локальных проверок. До этого полная BA-7/BA-8/BA-9
не считается принятой. Никаких fake API, project seeds или model replies.
