# Публичный каталог моделей в настройках

Дата: 01.11.2026. Продолжение BA-4/BA-8. Для сохранённого OpenRouter Connection
main читает настоящий публичный `/models`, проверяет ответ и возвращает
whitelisted `models.catalog` IPC. Ни ключ, ни task/context/project payload
в этот запрос не входят. Direct API catalogs пока не подключены: их живые
проверки отложены владельцем, ручной ввод точного ID сохраняется.

## Источник и достоверность

Поля нормализуются по [документации OpenRouter](https://openrouter.ai/docs/api/api-reference/models/list-all-models-and-their-properties).
Для каждого ID сохраняются connectionId, имя, объявленные параметры, limits
и цены prompt/completion за token, request за запрос в USD. Отсутствующая,
отрицательная или некорректная цена — null, а не бесплатная модель. Полный
service response/description/произвольные поля в renderer не возвращаются.

Capabilities помечены `evidence: catalog`, не `verified`. Отсутствие сведений
остаётся unknown. Manufacturer/family не выводятся из префикса ID или названия.
Заявленные tools/images/reasoning и token limits не подтверждают доступность
модели в аккаунте либо на конкретном upstream. Дубликаты IDs или неверная
schema приводят к отказу; синтетические модели не добавляются.

Сохранённый маршрут не меняется после обновления каталога. Исчезнувший ID
остаётся в форме с явным сообщением, другой ID автоматически не выбирается.
Сохранение настроек по-прежнему не даёт model admission.

## Main и сеть

Каталог ограничен точными ID/revision текущего Connection. Удаление, смена
endpoint/profile/reference или revision во время GET не принимаются как
успешный новый snapshot. Параллельные чтения одного подключения объединяются;
кэш живёт 60 секунд, explicit refresh делает новое чтение. Копии результата
изолируют main cache от изменений вызывающего. Shutdown отменяет pending GET.

Используется отдельная непостоянная Electron network session без cookies и
HTTP cache. Обычный запуск использует системный proxy. В проверочном scope
обязателен `SKARO_VERIFY_PROXY`; разрешённый владельцем loopback proxy
валидируется до GET, session proxy resolution должно точно ему соответствовать.
DIRECT fallback отсутствует. Настройки сети основного окна/ОС не меняются;
proxy не передаётся tool executor или shell commands.

Переиспользован production GET helper с прежними bounds, redirect rejection
и ограниченными metadata retries. Model POST этим helper не выполняется.
Transport injection используется для настоящего Electron fetch; тестовые
ответы, временный сервер или fake backend не подставляются.

## UI и проверки

В прежней форме Route используется общий Select со сведениями настоящего
сервиса, Button «Обновить», TextField для ручного ID и общий LoadingIndicator.
Async state вынесен в controller; старый ответ другого Connection не заменяет
новый. Область статуса имеет min-height, field сохраняет высоту при смене
loading/error/ready. Модельные запросы не запускаются выбором или refresh.

Настоящий Electron proof: `verification/model-catalog-d7047a0b-f509-4f52-9fbd-ad8ee400307e/proof.json`
в userData. Read-only база, project services не создавались, vault не открывался.
Два фактических GET через `127.0.0.1:10809`: первое параллельное чтение/dedup,
кэш без GET, затем explicit refresh. В обоих запросах нет Authorization header;
получены 452 модели, включая сохранённый ID. Проверены stale revision до сети,
точная connection scope, catalog-only evidence и отказ после закрытия service.
Настройки неизменны, model requests 0. Это настоящий metadata API, не provider
приёмка completion/continuation и не расход/баланс.

Desktop/runtime typecheck, Svelte-check (0 ошибок/предупреждений), lint,
сборка и 7 целевых configuration/direct contract tests прошли. В настоящем
scoped Electron на Cat-pilot проверены загрузка, ready, открытый каталог имён
с точными IDs, explicit refresh и отключение «Сохранить» при пустом выборе.
Геометрия формы при обновлении сохранена, общий spinner занимает выделенное
место. Черновик отменён: сохранённый `openai/gpt-4.1-nano` остался прежним.
Ошибка реальной сети и исчезновение модели из настоящего каталога визуально
не воспроизводились; заглушки для этих состояний не создавались.

Первый дополнительный UI-клик был остановлен лимитом автоматической проверки
действий; после явного продолжения владельца проверка успешно завершена.
Это не модельный бюджет и не отказ OpenRouter. Model POST не выполнялись.
Все изменённые source files меньше 300 строк, новые UI-компоненты меньше 180;
полный suite не запускался.
Полная BA-8 приёмка effort/routing/feed/расхода и модельной задачи остаётся открытой.

## Проверка маршрута на границе host

Configured factory теперь требует metadata port без разрешающего default.
Он вызывается до подготовки credential authority, перед budget reservation,
перед POST и перед native continuation. Реализация OpenRouter в существующем
catalog service сверяет текущий сохранённый snapshot, точную пару Connection/
model ID и formatter parameters, включая default max_tokens. Известные output/
context limits не допускают больший output ceiling; это не подсчёт размера
входного контекста. Неизвестный лимит остаётся неизвестным.

Для Chat tools проверяются advertised tools/tool_choice. Reasoning проверяется
как параметр, без вывода о конкретных effort levels или provider readiness.
Каталоговый guard не заменяет verified capabilities, payload approval,
process admission или бюджет и не отправляет запрос проверки модели.
Прямым API нужен собственный metadata port; OpenRouter catalog им не подставляется.

Семантика max_tokens/max_completion_tokens и reasoning сверена с
[официальными параметрами OpenRouter](https://openrouter.ai/docs/api_reference/parameters).
Первый настоящий прогон выявил документированное другое имя токенного лимита
у выбранной модели; исправлено сопоставление API aliases, требования не сняты.

Принят GET proof `verification/model-catalog-a1c3acfa-83af-441a-9947-359cd419d6bd/proof.json`
в userData: 452 настоящие модели, configured route принят, stale route и
missing model отвергнуты. Необъявленный reasoning у выбранной модели отвергнут.
Сохранённые настройки неизменны, vault не открыт, два GET через VPN,
0 model POST. Три pure DTO contract tests проверяют identity, aliases/defaults,
output ceilings и tools; ответы API или сервер не подставляются.

Через тот же guard принят настоящий configured owner-input/restart:
`verification/extensions-495576a4-1d33-440c-94ee-1c63b26608b3/proof.json`.
Два runtime/admission поколения, точные send/steer без повторной подготовки,
live/replay и подтверждённый выход сохранены. Model POST/reservations и чтения
ключа — 0; задача T-008, C4, TaskRuns и конфигурация неизменны.
Финальная штатная сборка, desktop/runtime types и lint прошли; 13 целевых
route/configuration/catalog tests прошли, три изменённых catalog cases
повторены после уточнения aliases/tool_choice. UI не менялся, full suite
не запускался. Все изменённые source files меньше 300 строк.
