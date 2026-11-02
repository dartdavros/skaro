# Встроенный агент: текущий этап и результаты

Актуально на 02.11.2026. Сейчас BA-7: внутренняя интеграция task/chat lifecycle.
Полная приёмка BA-7 и переход к основному агенту ещё не завершены.
Последнее решение владельца — только локальный код, без новых POST. Живая сдача
T-006/T-008 и расширение счётчика не выполняются; предел остаётся 89 intents.

| Этап | Что реализовано или проверено | Что осталось |
| --- | --- | --- |
| BA-1–BA-3 | Контракты, lifecycle, Windows tools и native process ownership | Полная приёмка, ограничения D-28 и другие платформы |
| BA-4 | Четыре коннектора; живые OpenRouter цепочки, streaming/tools/continuation | Прямые OpenAI/Anthropic/DeepSeek API отложены владельцем |
| BA-5 | Принят поддерживаемый Windows-контур Cat-pilot: context, compact/restart, MCP/browser/media | Платформенные ограничения сохранены в итоговой таблице |
| BA-6 | Проверки и происхождение доказательств; живой read-only model-plan Cat-pilot | Полный цикл реального исправления, повторных проверок и сдачи |
| BA-7 — сейчас | Stop/resume, main restart/history; transactional handoff настоящего run; guards сдачи, task env и MCP preflight | Проверенная задача, замечание/повторная сдача, worktree/environment handoff и capture/merge |
| BA-8 | Реальные настройки Connection/Route и каталог в существующем UI | Product agent catalog/picker, создание builtin-чата, сквозная UI-приёмка |
| BA-9 | Локальный Windows x64 payload и packaged settings/catalog | Остальные платформы, полный выпуск, приёмка перед сменой default |

`bedaf68` — guards сдачи, task environment и browser/MCP integration.
Следующий локальный фикс объединяет operational effects gate и надёжный teardown:
ошибка/deadline host closer не пропускает cleanup/OS exit; 20 целевых тестов,
типы/lint/production build прошли. Новых POST после решения владельца нет.
`f521914` — корректное продолжение после unknown model outcome;
настоящие T-006 Stop/resume, main restart и повторное восстановление истории приняты.
Следом приняты [локальные handoff/submit guards и environment/MCP preflight](builtin-agent-workflow-acceptance.md):
22 целевых теста, production build, POST 0. Полный task workflow ещё не принят.
`cdd1b68` — точная граница UserInput вместо копирования inbox metadata.
Это ещё не включение создания нового чата.

Владелец разрешил ещё до четырёх запросов на точный payload T-006.
Приняты [настоящий Stop/resume и продолжение после main exit](builtin-agent-task-stop-acceptance.md):
четыре новых POST, ledger — 89 intents / $0.42841444 расходов и удержаний;
разрешённый счётчик новых запросов использован полностью, общий $1 сохранён.
Живые проверки — только Cat-pilot. Владелец закрыл прежний установленный
Skaro; single-instance blocker устранён. [Новый launch preflight](builtin-agent-task-launch-preflight.md)
прошёл в штатных scoped services: отмена и реальная зависимость T-008 отказаны
до очереди/run/model host, задачи и настройки неизменны, POST 0.
В штатном окне новой сборки проверены единственные вкладка/карточка Cat-pilot
и сохранённые Connection/Route. После штатного закрытия хеш owner settings
и вкладок совпал, временное переключение трея не сохранено в базу.
Реализована [остановка builtin-задачи](builtin-agent-task-stop.md): teardown
native transport и барьер для отложенного ввода/нового admission.
Владелец выбрал T-006 для следующего сценария. [Локальный review пакет](builtin-agent-task-stop-review.md)
подготовлен без run/POST; задача и C4 неизменны. Добавлен [общий учёт primary task journals](builtin-agent-task-budget.md).
Добавлен [runnable Stop/resume driver](builtin-agent-task-stop-driver.md) с envelope/budget gates;
read-only проверка конкретного пакета прошла, неправильный SHA отклонён.
Получено отдельное разрешение на task-run, данные и до четырёх запросов;
положительные registration/envelope/Stop/resume настоящего task journal приняты.
Обычная доставка формирует точный UserInput без внутренних inbox-полей;
command identity и note для dedup сохраняются. Состав согласуемого пакета не изменён.

## Подробные результаты и доказательства

Дата: 31.10.2026. Статус: BA-1 — контракты; BA-2 — ядро lifecycle;
BA-3 — инструменты и команды Windows, с ограничениями D-28. Полная приёмка
этих этапов ещё не закрыта. BA-4 начат: vault и четыре коннектора в коде,
OpenRouter проверен живыми cases; прямые API отложены владельцем. BA-5 принят
в текущем поддерживаемом контуре Windows: scoped context/skills, длительная
сессия после compact/restart, границы маршрутов, HTTP/internal MCP и настоящий
task browser/media. [Итоговая таблица](builtin-agent-ba5-acceptance.md) фиксирует
доказательства и платформенные ограничения.
BA-6 начат: [run_check и привязка доказательств к входам](builtin-agent-checks.md);
добавлены read-only criteria/completion/C4 projection и evidence preflight
(01.11.2026), host dependency measurements и task-bound command plans.
Живой read-only model-plan на Cat-pilot через включённый VPN принят;
полный цикл исправления и сдача активной задачи ещё не подтверждены.
Полная приёмка открыта. Подготовлен [native inspection bridge](builtin-agent-native-verification.md)
и [native host operations](builtin-agent-native-operations.md) для BA-7;
проверен [общий отзыв native-сессии](builtin-agent-native-lifetime.md).
Продуктовый выбор встроенных задач/чатов ещё не включён. BA-8 начат; в BA-9
предварительно проверен локальный Windows x64 payload, полная приёмка открыта.
Добавлен [native model host](builtin-agent-native-model.md): concurrent negative
preflight и живой native model-plan Cat-pilot приняты; пять запросов через Xray,
реальные tools/streaming/budget/dedup. Это не выполнение или сдача активной задачи.
Принят [durable process admission](builtin-agent-native-admissions.md): поколения,
OS ownership, отзыв и подтверждённый выход; task/chat binding остаётся следующим шагом.
Добавлена [привязка к task-run](builtin-agent-task-admission.md): настоящие
identity/session/handoff gates; положительная приёмка активной builtin-задачи открыта.
Приняты [канонический model turn и поток сообщений](builtin-agent-model-timeline.md):
настоящие streaming deltas, один terminal и совпадение live/replay на Cat-pilot.
Принят [bootstrap каталога MCP](builtin-agent-operation-bootstrap.md) до spawn:
метаданные из штатного реестра, выполнение только после durable process admission.
Принят [обычный owner input](builtin-agent-owner-input.md) до host preparation:
send → durable input → прежний model loop, без повторной доставки после restart.
Добавлен [active steering boundary](builtin-agent-owner-steering.md): два input
одного хода на native Cat-pilot; provider-приёмка steering ещё открыта.
Добавлено [backend-хранилище Connection/Route](builtin-agent-model-configuration.md):
атомарные ревизии и общие connector validators, без включения UI или model admission.
Добавлен [configured model host](builtin-agent-configured-model-host.md): точные
route/credential reference и отзыв устаревшего lease. Положительный configured
read-only model-plan принят 02.11.2026; активная task/chat интеграция открыта.
Исправлена [граница проверочного запуска](builtin-agent-project-scope.md): Cat-pilot
выбирается до startup/recovery/watchers и Docker cleanup, не только внутри сценария.
Добавлены [настройки подключений и маршрутов](builtin-agent-model-settings.md):
main IPC, защищённое хранение и формы существующего раздела «Агенты».
Полная приёмка BA-8 и включение встроенного агента остаются открытыми.
Добавлен [общий credential authority](builtin-agent-configured-credentials.md)
для settings и configured host; подготовка до spawn, два настоящих поколения
процессов, отказы до чтения ключа и отзыв приняты на Cat-pilot, model requests 0.
Добавлен [настоящий каталог OpenRouter](builtin-agent-model-catalog.md):
GET через VPN, schema/cache/dedup и catalog-only capabilities проверены;
picker/loading/refresh и пустой выбор проверены в штатном Electron на Cat-pilot.
Подготовлена [сборка configured model host](builtin-agent-configured-host.md):
четыре настоящих коннектора, явный transport и обязательные request gates;
native turn/RPC и отказ перед POST приняты на Cat-pilot, live/replay совпали,
owned process вышел. Это не положительная provider-приёмка активной задачи.
Через тот же factory приняты обычные durable send/steer одного хода, dedup,
отказ конфликтующему input ID и automatic native close; новых POST нет.
Configured session возобновлена во втором настоящем runtime/admission generation:
старые send/steer IDs не повторили подготовку или intent, replay совпал.
Предварительно проверен [локальный Windows x64 payload](builtin-agent-package-verification.md):
настоящий EXE/ASAR, byte-for-byte worker entries и packaged settings/catalog.
Это не релиз и не закрытие BA-9 остальных платформ/модельной задачи.
Configured host требует отдельную проверку актуальных model metadata до
подготовки и перед reservation/POST; [каталоговый guard](builtin-agent-model-catalog.md#проверка-маршрута-на-границе-host)
не превращает advertised capabilities в verified readiness.
Добавлена [подготовка owner input из primary context](builtin-agent-context-input.md):
настоящий compact и свежий ввод во втором native-поколении сохраняют epoch,
точные owner statements и history refs; reservation/POST остаются запрещены.
Приняты [каталоговые уровни усилия](builtin-agent-model-effort.md) в прежней форме
Route: точные metadata, JSON sync и явный отказ несовместимому уровню проверены
на Cat-pilot; provider reasoning/расход и полная BA-8 ещё не приняты.
Принят [живой configured plan](builtin-agent-configured-plan.md) после отдельного
согласования: пять POST, три настоящих tools, ordinary send, streaming/live-replay
и restart с нулём новых POST. Общий ledger 85 intents / $0.39324124 расходов
и удержаний, пять дополнительных запросов использованы. Выполнение/сдача задачи
и полная BA-7 остаются открытыми.
Из завершённого configured journal извлечено [доказательство Chat tools](builtin-agent-tool-evidence.md):
call ID, исходный hash аргументов и последовательность execution связаны с
настоящими receipts. Verified только tools на точном маршруте; остальные
возможности и допуск нового execution этим не выдаются.
Добавлен [read-only учёт reported usage](builtin-agent-model-usage.md): квитанции
из primary journal, точные decimal суммы и явный unknown; бюджетные удержания
учитываются отдельно. UI расхода и полная приёмка ещё открыты.
Основание: [ADR-0047](adr/0047-builtin-agent.md), решение владельца об основном
агенте Skaro, BYOK и самостоятельном исправлении ошибок до проверенной сдачи.
Текущее продолжение — BA-6/BA-7 и настройки BA-8; встроенный агент пока не
включён в task/chat picker и не становится выбором по умолчанию.
02.11.2026: [внутренняя task-session ветка](builtin-agent-task-session.md)
подключена к TaskRunSessions с общим configured host, process ownership,
отменой startup и durable command IDs. Продуктовое создание/выбор builtin run,
создание/выбор новых чатов, положительные queue/handoff/submit/merge ещё не приняты.
Добавлено [форматирование native owner input](builtin-agent-native-context-input.md)
OpenAI/Anthropic и явный каталог инструментов task host. Прямые API не считаются
принятыми без живых проверок; metadata gate сохраняется.
Подключена [внутренняя chat-session ветка](builtin-agent-chat-session.md):
настоящий ChatRecord, chat/import operation lifetime, process ownership и
общий configured model host. Положительная Electron-приёмка открыта.
Исправлено [восстановление ленты по primary journal](builtin-agent-journal-replay.md):
не переиздаёт старые inputs/terminals, восстанавливает недостающий raw tail,
сохраняет builtin turn IDs и отделяет новый журнал после очистки истории.
Добавлен [main-only запуск новой builtin-задачи](builtin-agent-task-launch.md)
через общую очередь: точные route/права/isolation, durable startup и повтор,
повторные gates перед созданием run и отмена подготовки/пакета доставки.
Положительный Electron task workflow, picker, handoff и сдача ещё не приняты.
Подключён [внутренний handoff builtin ↔ managed](builtin-agent-task-handoff.md):
повторный preflight, прежний process shutdown и атомарная публикация successor,
его настроек, execution intent и pending input. Transactional переходы настоящего
остановленного run к установленным Codex/Claude и обратно приняты отдельно;
managed work turns, worktree/environment и live permissions ещё не приняты.
Уточнён [контракт builtin chat settings](builtin-agent-chat-settings.md):
отдельный точный route/permissions, общий task/chat catalog preflight и отказ
до admission при отсутствии выбора. Product chat creation/picker ещё закрыты.
BA-* — локальные ID плана, не созданные задачи Skaro.
