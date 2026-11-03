# Каталоговые уровни усилия в маршруте

Дата: 01.11.2026. Продолжение BA-4/BA-8 по решению владельца использовать
существующие UI-элементы и визуальный язык системы. Изменена прежняя форма Route,
без новой страницы, панели, иконок, цветов или изменения выбора агентов.

## Данные и допуск

Parser сохраняет `reasoning.supported_efforts`, default и mandatory flags
настоящего OpenRouter catalog. Отсутствующее поле отличается от `null`:
первое не объявляет selector, второе допускает все поддержанные gateway values.
`mandatory: true` исключает `none`. Неизвестные будущие значения сохраняются
в metadata, но не предлагаются неподдерживающим их formatter.
Семантика взята из [официальной документации OpenRouter](https://github.com/OpenRouterTeam/docs/blob/main/guides/best-practices/reasoning-tokens.mdx).

Общий browser-safe модуль перечисляет wire values, включая `max`, и пересекает
их с точными advertised levels. Нет вывода по manufacturer/family/короткому имени
и нет подстановки «ближайшего» уровня. Host catalog guard отвергает конкретный
необъявленный effort перед reservation/POST. Это catalog evidence, не verified
provider readiness, проверка ключа или разрешение расхода.

## Существующая форма

`RouteEffort` использует общий Select и прежние label/style classes; каталог
принадлежит общей форме и читается двумя subviews, повторного GET нет.
Поле присутствует также при loading/unknown и сохраняет высоту. У модели без
advertised levels оно отключено. Служебные defaults не записываются в JSON;
«По умолчанию сервиса» удаляет только `reasoning_effort`. Остальные parameters
сохраняются. Это параметр явного BYOK Route, не изменение defaults Claude/Codex.

Ручной JSON остаётся исходным значением; invalid JSON selector не переписывает.
При известном несовместимом уровне используется **существующая** reserved error
область формы, сохранение отключено. Значение остаётся для исправления.
Недоступный каталог не удаляет выбор и не объявляет несовместимость доказанной;
сохранение настроек по-прежнему не является разрешением model execution.

## Фактические проверки

Принят GET proof `verification/model-catalog-c7519b4c-434c-4120-bfa2-7f205ae6ff10/proof.json`
в userData Skaro: 452 настоящие модели, 207 с advertised effort levels.
Проверены exact connection scope, mandatory без none, cache/dedup/refresh,
неизменность конфигурации. Два GET через VPN, без Authorization/открытия vault,
project services и model POST. API responses или сервер не подставлялись.

Computer Use в штатном собранном Electron с scope Cat-pilot до startup подтвердил:

- у сохранённой Nano нет advertised levels, selector отключён;
- у временно выбранной Terra Pro список совпал с реальными metadata;
- выбор high добавил только reasoning_effort, service default удалил только его;
- для Nano ручной high сохранился в черновике, ошибка появилась в прежней области,
  «Сохранить» отключилось; исправление вернуло доступность без сдвига layout;
- оба черновика отменены, SHA256 настоящей настройки Connection/Route до и после
  совпал. Более дорогая модель использовалась только как несохранённый UI draft.

Первый main PID 396 и финальный 15312 штатно завершились с code 0; stderr пуст.
Логи `%TEMP%/skaro-effort-ui-stdout.log` и `skaro-effort-final-ui-stdout.log`.
Трей временно отключался только в памяти scoped AppState по отдельному разрешению
владельца. Сохранённая настройка не менялась.

Штатная финальная сборка, runtime/desktop types, Svelte-check (0 ошибок и
предупреждений), lint и целевые contract/configuration/JSON tests прошли.
Всего девять относящихся cases; изменённые случаи повторены отдельно.
NO GOD: форма 124 строки, effort subview 45, parser 123, остальные source files
меньше 300. Full suite не запускался. Provider execution с reasoning, прямые API,
routing/feed/расход и полная приёмка BA-8 остаются открытыми.
