# BA-7: настоящая приёмка T-006 Stop/resume

02.11.2026. Владелец разрешил review payload SHA256
`7a4d2c056c2a741547b26428bc13b953a53f32fff22197f93fd2f7ee6543be9d`,
запуск T-006 и до четырёх дополнительных запросов в общем лимите $1.
Использованы настоящий Cat-pilot, штатные services/queue/native workers,
сохранённый openrouter-owner / openai/gpt-4.1-nano и VPN 127.0.0.1:10809.

## Принято: Stop и новый native admission

Доказательство в userData Skaro:
`verification/extensions-417c52a6-4080-4ba1-a78b-40609734b684/proof.json`.
Рядом `task-stop-attempt.json`: passed и cleanupConfirmed — true.

- Единственный настоящий run: `a0d711e0-2d66-47a2-ae23-721ece167fea`.
- Primary session: `510f68de-0766-437d-83d5-5d0ad2bf85af`; run/session/journal
  сохранились между Stop и продолжением, прежний префикс цепочки совпал.
- Первый model turn ещё не имел terminal перед Stop. Его OS owner 29600
  завершён, admission generation 4 — exited, старый lease отказан.
- Продолжение получило другой owner 27848 / admission generation 5.
  Настоящий ответ модели — «Продолжение принято», затем owner также завершён,
  admission exited и lease отказан.
- T-006 возвращена в todo; task body, критерии, C4 и model configuration
  совпали с состоянием до попытки, execution выключен. История сохранена.
- Tools/commands/source edits/submit_result/merge/T-008 не допускались.

Эта успешная попытка использовала два POST. Перед ней один запрос выявил
дефект context resume; его unknown outcome и удержание сохранены. Итого три
из четырёх дополнительных запросов, общий ledger 88 intents / 427782940 nanoUSD
расходов и удержаний. Это не фактический счёт провайдера и не сброс старых holds.

## Принято: новый main и восстановление истории без POST

`verification/extensions-0b054601-46a9-46dd-8ba0-562f6b19cf4d/proof.json`.
Старый main уже вышел. Новый scoped main восстановил настоящий task history
дважды штатным paged history loader. Четыре primary items совпали с прямой
проекцией primary chain, три turn IDs/outcomes встретились ровно один раз;
три настоящих owner inputs сохранены (включая первую неудачную попытку).
Primary и raw bytes, task/C4/config/execution/admission и ledger не изменились.
Новых native admissions, model host preparations и model POST — 0.

Локально на настоящем историческом префиксе проверен fresh conversation после
unknown request. На позднем успешном результате того же журнала проверено
переиспользование подтверждённого conversation; старый unknown не заставляет
навсегда сбрасывать новую подтверждённую историю. Это read-only formatter
проверка на реальных записях, без второго writer и вымышленных journal records.

## Найденные и исправленные причины отказов

Первая попытка создала run, но не native OS owner: verification app.getAppPath
удваивал out/main. Quotes/POST 0. Scoped services теперь получают явный путь
штатных compiled workers; обычный packaged путь не меняется.

Следующая попытка прошла настоящий Stop, но отклонила второй input до POST:
unknown model outcome блокировал context projection. Fresh owner context теперь
отличает такой model outcome от неизвестного tool/command effect. Последние,
pending model requests и открытые interactions остаются блокирующими. Старые
POST не переигрываются, unknown не объявляется completed, billing не обнуляется.
Новый provider conversation после unknown начинается из точного context;
позднейший подтверждённый continuation остаётся пригодным для продолжения.

Повтор сохранил прежний run/journal и отправил те же разрешённые тексты с новыми
command IDs. Старый rejected command без input facts не был переигран. Неудачные
попытки остались в `extensions-8de75d97-12e8-425c-9e4d-d274c667060f` и
`extensions-eee0adf0-9c31-4bd2-b399-8c27b00b3157`.

## Принято: модельное продолжение после выхода main

`verification/extensions-8eadcf11-893d-4917-98aa-346f92a71b38/proof.json`,
рядом `task-main-restart-attempt.json`: passed/cleanupConfirmed true.
Предыдущий main 29720 вышел. Новый main 24368 возобновил прежний run и session,
получил настоящий OS owner 26336 / admission generation 6, передал то же
согласованное второе сообщение и получил «Продолжение принято». Выполнен один
POST, после Stop owner вышел, lease отозван, T-006 todo, execution выключен,
task/C4/configuration совпали. Команды, tools, правки и сдача не выдавались.
Старые inputs/POST не переигрывались: новый ввод имеет отдельный command ID
second-after-main-restart. В primary теперь четыре реальных owner inputs:
первая неудачная попытка, повторный pair и один ввод после выхода main.

Итого использованы все четыре дополнительных запроса: ledger 89 intents /
428414440 nanoUSD ($0.42841444) расходов и удержаний. Прежние unknown holds
сохранены. Общий $1 не превышен; техническое разрешение на новые POST исчерпано.

Финальный новый main выполнил read-only проверку:
`verification/extensions-74e8979c-5ab6-4bbf-a3d5-5ecedf227b8c/proof.json`.
Все прежние main/native owners завершены, шесть primary items восстановлены
одинаково дважды, четыре turn IDs/outcomes встретились ровно один раз, четыре
owner inputs сохранены. Primary/raw bytes, task/C4/config/execution/admission и
итоговый ledger 89 / 428414440 nanoUSD не изменились; model POST/admissions 0.

Main/runtime TypeScript, lint, 12 целевых тестов и production build прошли.
Полный suite не запускался. UI в этом изменении не менялся; product picker и
Electron task-view этим не приняты. Полная BA-7 остаётся открытой: проверенная
реализация задачи, handoff/permissions, submit_result/merge и связанные UI gates.
Модельное продолжение после выхода main принято в указанном ограниченном scope;
полный product workflow, handoff и сдача остаются отдельными критериями BA-7.
