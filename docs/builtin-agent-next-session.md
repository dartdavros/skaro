# BA-7: передача в следующую сессию

## Решение о выпуске 2.2.14, 03.11.2026 — актуальный приоритет

Владелец остановил live-продолжение и поручил завершить незаконченный код,
пометить Skaro бейджем «В разработке», отключить поля и выпустить приложение.
Продуктовые task/chat hosts закрыты через BUILTIN_PRODUCT_RELEASED=false,
выбор по умолчанию — через BUILTIN_DEFAULT_RELEASED=false. Поля карточки,
редактирование Connection/Route и выбор Skaro в picker отключены.
Проверку UI владелец взял на себя; автоматизацию окна не продолжать.

Для 2.2.14 владелец явно разрешил полный штатный release suite с прежними
изолированными fixtures/HTTP test servers и переиспользование принятой проверки
неизменённых Codex/Claude pins с прежним ограничением Claude. Новых успешных
canary и model calls не заявлять. Детали — release-2.2.14.md.

Код оставшихся BA-3/4/6/7/8/9 сохранён в отдельных модулях; границы описаны
в builtin-agent-product-continuation.md и builtin-agent-release-readiness.md.
Сводный ledger остался 129 / $0.460686901: после расширения бюджета новых POST
не было. Пакет продолжения b1d37450d34e7be50bcf5106af19166d7dc5840f4175cb2116e0cc3c42af8179
подготовлен и проверен без запуска модели; лежит в verification/
extensions-4c66f2fa-b9c1-4679-af27-79d88426e885/task-workflow-continuation-review.json.
Он содержит compiled hashes до последующего закрытия product gate; для нового
live-продолжения требуется свежая проверка сборки и пакета, без изменения
старых артефактов. Техническая реализация нового отдельного guard 129→169
не переписывает исторические guards или holds.

Остальные разделы ниже сохраняют историю BA-7. Они не разрешают снова запускать
live workflow, включать продуктовый gate/default или считать T-006/T-008 сданными.


## Актуальное состояние после live, 03.11.2026 — читать первым

Полная BA-7 **не принята**. Все 40 дополнительных intents использованы:
**129 / 460686901 nanoUSD ($0.460686901)**. Новые POST запрещены до отдельного
расширения request count, хотя денежный предел $1 не достигнут. Технические
$0.95, прежние источники и unknown holds сохраняются. Intent 130 не создан.
Не поднимать guard/ceiling и не переписывать исходный canonical packet.

Владелец явно разрешил переход из planFirst после проверки плана, конкретный
пакет/маршрут и локальные коммиты BA-7. Эти разрешения повторно не запрашивать.
Первоначальные automatic-review отказы разрешены отдельными ответами владельца.

Текущий run T-006 **fbb66440-eacb-4887-a67c-9965dd88bd43**, session
**ae3304c3-c307-47d2-a3f5-30829e1a8e8d**. T-006 in_progress, все 10 критериев
не закрыты; execution выключен, ask, planFirst=false, isolation=in-place.
T-008 todo и blocked. Все admissions exited; recorded OS owners вышли.
Motion CSS отсутствуют, source baseline совпал с пакетом, кроме status T-006.
Старое состояние/лимиты ниже — история, не текущее разрешение на запуск.

Финальный штатный read-only audit:
`extensions-52a574d1-dc1e-420b-af5c-70bfda3399b4/proof.json` в verification.
Основной протокол, primary path/hash, все попытки и ограничения:
[живой workflow 03.11.2026](builtin-agent-workflow-live-2026-11-03.md).

Настоящие inspect/чтения и один verification plan получены. Модель также
делала неподкреплённые утверждения, неверные paths/IDs/quotes и обрезанные планы:
они не приняты, criteria/submit не менялись. Реальный run_check дошёл до ask,
но первый wait истёк до передачи ответа владельца; команда не выполнена.
Поздний ответ не применён к новому call. IPC wait увеличен до 600 секунд;
его положительная приёмка после actual approval остаётся открытой.

В коде есть CLI-only workflow grant/envelope/allowlist/budget gates и read-only
audit. Policy journal неизменяема: новые версии подключались штатным handoff;
command IDs новой сессии привязаны к run. Прежние Stop drivers с ожиданием
одного run не запускать. Initial workflow mode тоже не подходит к текущему state.

Дальше: сначала отдельное решение владельца о новых intents и точном envelope,
если меняются route/max_tokens; затем реальная T-006 до fresh checks/C4/assessment
и сдачи, замечание/повторная сдача, worktree/environment handoff и capture/merge.
Не создавать fake API/fixtures/seed и не подменять отсутствующие engines.
Права на установку Firefox/WebKit по-прежнему не выданы. D-45 сохраняется.

---

## Историческая передача 02.11.2026

Зафиксировано 02.11.2026. Поручение владельца: продолжить работу по плану
в следующей сессии. Последнее уточнение: «post можно, но за рамки 1 доллар
не заходить». Оно заменяет прежнее «Только локальный код, без новых POST».
В этой передаче новые POST, задачи, установки браузеров и live-прогоны не выполнялись.

## Откуда продолжать

- Репозиторий: `C:\Users\drmar\MyProjects\Skaro\skaro`, ветка `codex/release-2.2.13`.
- `bedaf68`: evidence guards submit_result, task command environment,
  настоящий task browser port, transactional handoff и completion preflight.
- `1ae99b0`: единый operational effects gate и retirement task/chat,
  cleanup/подтверждение OS exit даже при ошибке/deadline host closer.
- Production build, main/runtime typecheck, lint и последние 20 целевых тестов
  в 6 файлах прошли. До этого прошли 22 целевых теста в 10 файлах.
  Полный suite не запускался. UI и исходники Cat-pilot не менялись.
- Полная BA-7 ещё не принята. Источники: [план](builtin-agent-plan.md),
  [статус](builtin-agent-progress.md), [приёмка](builtin-agent-workflow-acceptance.md).

Не включать в свои правки/коммиты посторонние `docs/README.md`,
`docs/adr/0048-codex-multi-account.md`, `docs/codex-multi-account-plan.md`.
Не сбрасывать рабочее дерево. В начале перечитать AGENTS.md и актуальный Git status.

## Бюджет и данные

Последний подтверждённый ledger: **89 intents / 428414440 nanoUSD ($0.42841444)**
расходов и удержаний. Общий предел владельца — **$1 на все проверки вместе**.
Технический потолок оставить $0.95; сохраняются прежние unknown holds и источники.
Оставшийся запас относительно технического потолка на момент передачи — $0.52158556.
Перед новым запросом перечитать настоящий ledger: это снимок, не новый баланс.

Продолжение обсуждалось по конкретному пакету до 40 дополнительных OpenRouter
запросов: максимум 129 intents, при более ранней остановке по денежному потолку.
Последнее разрешение POST относится к этому ограниченному продолжению;
не расширять число запросов, данные, маршрут или денежный предел самостоятельно.

Пакет: `%APPDATA%\Skaro\verification\extensions-d03cbb73-a206-4332-b3f0-3ae5c077fd17\task-workflow-review.json`.
Canonical SHA256 (`JSON.stringify` parsed packet):
`600af359e54afa9328a70a418205f04784220a016778f298bb1bbcc3bc969cb1`.
В нём 14 source files, инструкции, 19 критериев T-006/T-008, реальные schemas,
разрешённые изменения и производные tool/browser/C4-результаты. Сверить пакет,
настоящие файлы/задачи/route и границы перед первым dispatch.

Connection `openrouter-owner`, route `800683bf-52f9-41f7-b479-5d73c782a1c0`,
`openai/gpt-4.1-nano`. Использовать сохранённую ссылку на ключ; ключи не печатать,
не переносить в документы/команды/аргументы. Только VPN proxy
`http://127.0.0.1:10809`, без direct fallback. Последний публичный catalog GET
через proxy дал HTTP 200, но это не проверка текущего состояния VPN.

Новый workflow live driver **ещё не подключён**: есть packet/preflight и общие
runtime/task/model ports. Реализовать точные grants/envelope/tool allowlist и
отдельный бюджетный guard 89→129; старые guards на 80/85/89 не переписывать.
До quotation проверять ledger + предложенную reservation, до dispatch повторно
проверять полную сумму и счётчик. Никакого сброса ledger, исключения прежних
журналов, автоматического replay unknown POST или расхода из нового каталога.

## Настоящее состояние и ограничения

- Единственный проект для проверки — Cat-pilot,
  UUID `78bc2cd3-981b-40ed-a395-c6c6bc7da51b`,
  `C:\Users\drmar\MyProjects\TestProject\Test Project`.
- Chatballs исключён также из restore/index/recovery/cleanup. Live services:
  `catPilotState` до `createServices`; Electron — только с
  `SKARO_VERIFICATION_PROJECT` этого Cat-pilot. Второй host поверх Skaro не запускать.
- T-006 todo, 10 незакрытых критериев; зависимости T-003/T-004 done.
  Текущий настоящий run `d4f326b6-29af-40cd-a9e1-43e69fafdf63`, agent Skaro,
  без nativeSessionId, execution остановлен. Перепроверить перед действиями.
- Прежний Stop/resume run `a0d711e0-2d66-47a2-ae23-721ece167fea` сохранён в цепочке.
  После transactional handoffs runs уже пять. Старые Stop/replay drivers,
  рассчитанные на единственный run, повторно не запускать.
- T-008 todo, 9 критериев, заблокирована T-006. Только после штатного завершения
  T-006 — настоящий worktree T-008. Не менять isolation начатого run и не обходить deps.
- Проверочный Skaro был закрыт; не предполагать, что lock сейчас свободен.
- Никаких mock API, fake backend, seed задач/run/model replies или временного HTTP.
  Cat-pilot штатно открывается через `file://`.

## Следующие действия

1. Сверить Git/документы, фактические runs/lease/ledger и пакет. Завершить код
   live binding, сохранив точные права, task input, первичные receipts и process ownership.
   Для планирования учитывать: planFirst сохраняет read-only scope; не обходить его
   скрытым изменением permissionMode/config и не подменять managed AgentId на Skaro.
2. Провести настоящую T-006 с проверками, C4, свежими evidence/assessment и сдачей.
   `apps/desktop/scripts/cat-pilot-flight-check.mjs` измеряет геометрию настоящей
   страницы. Исходный baseline: 1–9 не выполнены, 10 обеспечен фоном; ошибок страницы
   нет. Background check проходит. Не выдавать этот отрицательный baseline за приёмку.
3. Проверить замечание/исправление/повторную сдачу; затем допустимый worktree,
   handoff с сохранением окружения/истории/вопросов и истечением permissions,
   capture/merge. D-45: на merge только configured checks, не новый общий прогон.
4. Для полной T-008 нужны настоящие Firefox/WebKit, сейчас они отсутствуют.
   Предложение установки сохранено рядом как `browser-environment-review.json`;
   уточнение «POST можно» само не разрешает эту установку. Разрешить этот
   зависимый prerequisite при необходимости, не заменять engines Chrome-заглушкой.
5. На изменённый код — сборка и только затронутые тесты; UI — browser-проверка
   штатного проекта. NO GOD ≤300 строк; baseline/design соблюдать.
   BA-8 product picker/новый builtin chat и BA-9 выпуск не считать закрытыми BA-7.

Исторические proof files и расходы сохранять. Не закрывать BA-7 по одному коммиту,
metadata preflight или успешному тесту вспомогательного checker. При исчерпании
разрешённого счётчика/денежного запаса остановить новые POST и честно зафиксировать
остаток приёмки. После коммитов продолжать разрешённую работу по плану.

## Уточнение после повторной сверки

CLI `--task-workflow-check <packet> <canonical hash>` проверен штатными scoped
services. Proof: `extensions-327a63cf-afae-4fcb-922a-77d0e1059a6a/proof.json`.
Источники/checkers/критерии/маршрут совпали, ledger прежний 89 / 428414440 nanoUSD.
Добавлен отдельный guard 89→129 с proposed reservation; живой driver, grants,
envelope и tool allowlist ещё не подключены. Model POST 0, права не менялись.
У текущего T-006 фактически planFirst=true: реализация запрещена session policy.
Отправлен запрос владельцу на явный штатный переход после проверки плана,
с сохранением ask/пакета/бюджета. До ответа не менять planFirst скрытым grant.
Краткий конкретный план записан в builtin-agent-workflow-acceptance.md.

## Текущее продолжение, 03.11.2026

Владелец разрешил штатный переход из planFirst после проверки плана.
Добавлены workflow-mode/models/tools/live для первого ограниченного этапа T-006.
Они ещё не получили живую provider-приёмку: automatic approval review отклонил
live-команду до CreateProcess из-за отсутствия, по его оценке, явного разрешения
на конкретный payload во внешний OpenRouter. Обход/повтор не выполнялся.
Владельцу отправлен отдельный точный запрос на пакет/hash/адресат/модель/бюджет.
До ответа live не запускать; решение о planFirst повторно не запрашивать.
Read-only proof `extensions-8d013bb3-bf94-4385-8fe1-a1d0ff756941/proof.json`
подтвердил прежние run/planFirst/ask и ledger 89 / 428414440 nanoUSD.
Новых POST, runtime owners, handoff runs и изменений Cat-pilot нет.
Driver останавливает наблюдение при реальном ask approval, не отвечает за владельца;
продолжение такого решения требует сохранения его точного scope/ID и primary.
Остальная BA-7 остаётся открытой, включая положительные evidence/environment review,
замечание/повторную сдачу, worktree/environment handoff и capture/merge.
