# AC-4 — единая очередь решений и долговечный журнал

Дата: 13.11.2026. Статус: **завершён, локальная приёмка 9/9** в указанных ниже границах.
Реализация и результаты остаются в рабочем дереве.
Коммита и релиза нет. AC-5, RC-4, C4-3 и AG-1 этим этапом не запускаются.

## Основание и реализация

Владелец прямо утвердил [макет](archiagent-coordination-ac4-design-proposal.md):
«Дизайн согласован, делай AC-4 по этому макету». Исходный
[design gate audit](archiagent-coordination-ac4-design-gate.md) сохранён как история.

- TitleBar содержит проектную кнопку «Требуют ответа · N». Одна проектная
  Modal доступна поверх документов, C4, графа, плана, задач, чата и параметров.
  Home/Settings не показывают проектную очередь. Переход из фоновой работы
  заменяет содержимое общего проектного окна; TitleBar остаётся доступной.
- Карточки вопросов, разрешений, плана, форм, входа, предложений и слияния
  переиспользуют компоненты ленты и прежние исполнители действий. PendingActions
  остаются над вводом вне истории и файлов. Очередь не запускает исполнителя
  чтением источника и не восстанавливает процессы ради счётчика.
- Источники читают канонические task/chat/integration histories без attachment,
  continuation и checkout. Инкрементальный read model обновляет изменившихся owners.
  ID содержит источник, run и собственный turn запроса, включая integration turn;
  повтор native `req-0` в другом ходе не получает прежнюю квитанцию. Название
  источника и cwd не создают новую ревизию самого решения.
- Окно и исходная лента входят в общий gate: проверка актуальности и типа ответа,
  общий in-flight promise и SQLite CAS перед прежним executor. Подтверждённая
  квитанция не выполняет эффект повторно; неизвестный частичный исход запрещает
  слепой повтор. Завершённая квитанция исключает вопрос из активной очереди и
  при сбое до flush истории. Нетерминальные действия слияния отделены от confirm/cancel.
- Секретные ответы отсутствуют в проекциях, журнале и открытых квитанциях.
  Безопасные черновики хранятся только в ограниченной памяти renderer;
  secret-поля исключены. Закрытие и навигация не являются ответом.
- Controller approvals проверяют pending, policy revision и deadline на host;
  UI обновляет счётчик по deadline без расширения прав. Нативные разрешения
  без живого исполнителя не восстанавливаются активными. Для integration нужны
  фактически подключённый канал и его собственный открытый turn; сохранённое
  имя worker и разрешения предшественника не являются живым каналом.
- Фоновое окно разделяет временные «Сейчас»/«Недавно» и SQLite-журнал проекта.
  Подтверждённые исходы cleanup, cache eviction, снятия блокера и восстановления
  окружения имеют ссылки на задачу/ресурс. Технические попытки не становятся
  отдельными уведомлениями. Архив подключён до recovery, пагинация — keyset,
  проект задаётся ID, завершённый live/archive job не дублируется.
  Непроектная работа показывается без приписывания активному проекту.

Новые components меньше 180 строк; изменённые code files не превышают 300.
AppServices — 298, IPC — 300, AppDb — 299; страницы собирают отдельные subviews.
Modal сохраняет прежний внешний вид; для проектных окон backdrop начинается
под TitleBar, Escape закрывает верхний диалог. Несогласованных UI-отклонений нет.

## Проверки

Целевой пакет — **8 файлов / 22 passed**, без полного suite:

```text
pnpm exec vitest run
  apps/desktop/src/main/decision-replies.test.ts
  apps/desktop/src/main/decision-projection.test.ts
  apps/desktop/src/main/project-activity.test.ts
  apps/desktop/src/main/background-work.test.ts
  apps/desktop/src/main/managed-buildkit-cache.test.ts
  apps/desktop/src/renderer/src/feed/question-drafts.test.ts
  packages/core/src/db/events-page.test.ts
  packages/core/src/db/coordination.test.ts
```

Проверены реальный SQLite CAS, конкурентные/поздние ответы, неопределённый исход,
секреты, native expiry projection, разные turn namespaces, стабильная ревизия,
безопасный draft, scope и keyset ledger, отбор подтверждённых событий, сохранение
failed вместо success и identity live/archive job. Unit inputs — protocol metadata
и настоящий SQLite; они не являются live fixtures/проектом или backend для показа UI.

Backend TypeScript, Svelte-check (0 errors / 0 warnings), scoped ESLint, формат
и `git diff --check` прошли. Штатная `pnpm build` прошла; полный suite не запускался.
Предупреждения Rollup о комментариях зависимостей Zod не являются ошибкой сборки.

## Настоящий Cat-pilot и границы

Electron запускается с `SKARO_VERIFICATION_PROJECT=78bc2cd3-981b-40ed-a395-c6c6bc7da51b`
до создания служб. Профиль настоящий, Cat-pilot зарегистрирован; Chatballs
исключён из restoration, индексации и cleanup. Вопросы задаёт подписанный Codex
существующей аудит-задачи T-010, run `98acf467-7822-4742-98d7-bff44f459b1e`.
Не создаются fake API/backend, HTTP-сервер, fixture project или подставные события.
Агенту запрещены команды, правки файлов, submit_result и реализация задачи.

Живой прогон `decisions-ui-9ff4bb7b-f1e7-405d-9d43-2aed15aba865` подтвердил семь
экранов, один decision ID, навигацию, безопасный draft при закрытии, reload,
настоящий crash/restart собственного Electron, late rejection, оба пути ответа,
конкуренцию ленты и окна (`joined`, SQLite receipt `done`, один ход), журнал и
пагинацию, закрепление при прокрутке истории. Renderer errors: 0.
Desktop Modal — 720×629; штатный минимальный viewport — 960×600, footer видим,
скролл только внутри тела. Размеры ниже минимального окна продукта не выдаются
за реальную приёмку; такие проверки старого макета остаются историей дизайна.

Проверка ошибки использует настоящий конкурирующий SQLite writer reservation:
только BEGIN IMMEDIATE и ROLLBACK, без INSERT/UPDATE/COMMIT. Запрос и выбор
сохраняются; повтор выполняется после снятия блокировки. API не подменяется.
Быстрому отказу записи не добавляется искусственная UI-задержка ради снимка отправки.

Нативное approval expiry проверено целевым protocol contract; новый live grant
для команд ради этой проверки не выдавался. Новый вход, реальное слияние и
применение C4 в Cat-pilot не выполнялись: карточки и executors переиспользованы,
эта приёмка не заменяет AC-5/AG-1 и специализированные проверки этих workflow.
Глобальная навигация чужих проектов и все desktop-платформы не принимались.

Предыдущие непрошедшие driver attempts сохранены как failure, не объявлены
приёмкой. Исправлены селектор завершённой карточки и проверка краткого статуса;
явный Stop закономерно отменяет native question и не подменяет crash/restart.


## Итоговое evidence и приёмка

Основной итоговый live proof: `decisions-ui-8d66fec4-a6ea-4d94-b2d5-c1b5cf39655f/proof.json`
в `C:/Users/drmar/AppData/Roaming/Skaro/verification/` (`passed: true`, renderer errors 0).
Он продолжает именно вопрос из указанного `resumedFrom` после настоящего crash,
не создаёт его повторно. Проверка сохранения: фактическая конкуренция SQLite,
состояние ошибки и прежний выбор, Modal 629 px, rollback, успешный «Повторить».
Неверный тип ответа отвергнут до claim; поздний повтор — `decision_stale`.
Вторая настоящая карточка отвечена через ленту одновременно с очередью:
`concurrentResult: joined`, receipt `done`, один исходный turn без дополнительного.

Контрольный новый запуск `decisions-ui-cc1a95e2-3e63-4f74-9774-9eb9d40abf99`:
активных решений 0, долговечный журнал 11 строк в первой странице, чужие scope
отвергнуты; `passed: true`, renderer errors 0. Состояния просмотрены на настоящих
скриншотах, не только по DOM-assertions. Повторный запуск после последнего уточнения integration guard —
`decisions-ui-41c025a8-2d61-4f99-a9e4-59e3f873b1db`: очередь 0, журнал 11 строк,
foreign scope отказ, `passed: true`, renderer errors 0. Все проверочные Electron
закрыты; ответы не вернулись в активную очередь.

| Критерий AC-4 | Наблюдаемое основание |
| --- | --- |
| Согласованный дизайн | Прямое утверждение, компоненты baseline, визуальная сверка |
| Один ID на всех экранах / единый эффект | 7 разделов, те же ID и source, прежний executor |
| Конкурентный, двойной, поздний ответ | Реальная гонка `joined` + SQLite CAS contracts + stale rejection |
| Видимость / восстановление | Закрепление вне scroller, пагинация, reload, crash/restart, финальный пустой counter |
| Отложить / scope | Позже/Esc/Home сохраняют запрос, draft живёт при закрытии/навигации, foreign IPC отказ |
| Native expiry | Contract с реальной проекцией и attached-channel/current-turn/worker namespace guard; новый live grant не выдавался |
| Фактические фоновые исходы / долговечность | События реального ledger, включая записи старше TTL, keyset и повторный старт |
| Состояния и компоновка | Реальные loading/ready/waiting/error/retry/answered, общий spinner, стабильная геометрия и 960×600 |
| Сборка / целевые проверки / структура | pnpm build, 22 теста, types, Svelte, lint, format, NO GOD |


Check logs и `build-hashes.json` сохранены в `checks/` основного итогового proof;
копии логов сверены SHA-256. После последнего уточнения namespace отдельно
повторён `decision-projection.test.ts`: 6/6 passed. Итоговая `pnpm build` завершилась
успешно, backend types и scoped lint без ошибок; renderer после последней UI-правки
прошёл Svelte-check с 0 errors / 0 warnings. Повторная browser-проверка относится
к именно этой сборке. SHA-256 основного `proof.json`:
`7112b915cfc2357fa38f9e7583d333d252855fd5369ea842701ab1a6af4d1be4`.
