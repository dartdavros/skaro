# Durable native process admissions

Дата: 01.11.2026. `NativeAdmissions` реализует ProcessAdmissionPort поверх
существующих AppDb settings и TaskRunProcesses. Это процессный допуск,
не новая task/queue таблица и не разрешение выполнить или сдать задачу.
Продуктовый task/chat host должен передать собственный `requireCurrent`.

## Состояние и владение

Host выбирает стабильный ownerKey. Его hash задаёт ключ metadata и ключ
существующего реестра процессов. Metadata schema 1 содержит scope, token ID,
session ID, монотонное generation, OS identity host, OS identity runtime,
состояние и ограниченную причину отзыва. Ключей модели и raw ошибок здесь нет.
Strict schema проверяет сохранённую запись; runtime не получает запись storage
или API compare-and-set. Host/state schema переиспользует закреплённый zod
из agent-runtime, новых зависимостей или install не добавлено.

`DbSettings.compareAndSet` — одна SQLite INSERT/UPDATE с условием прежнего
JSON значения. Независимый writer не может перезаписать уже изменённый token.
Ожидаемое undefined означает отсутствие строки; существующее malformed значение
не принимается за пустую строку. Прежние getSetting/setSetting не меняют поведения.
Доступ к settings выделен в тот же публичный table API, что commands/shell.

При prepare host проверяет актуальность области и свою настоящую OS identity.
Предыдущий lease должен иметь подтверждённый exited. CAS сохраняет prepared
с новым ID и generation+1; prepared ещё не разрешает операции. Native spawn
callback сохраняет настоящего runtime owner в TaskRunProcesses до перехода
metadata в active. Ошибка callback не открывает существующий spawn gate.
Синхронный callback использует identity, измеренную настоящим native worker;
асинхронный admit также заново проверяет OS birth.

requireActive проверяет точный token, scope, host, active state, requireCurrent
и OS birth runtime; после await заново проверяет metadata. Изменение допуска
во время проверки не возвращает положительного ответа. Нельзя только текстом
проекта, args инструмента или старым token выбрать другое поколение/область.

## Отзыв, handoff и recovery

Revoke сначала сохраняет revoked, затем отзывает общий signal сессии.
Штатный native lifecycle закрывает порты и owned runtime. confirmExit требует
отзыва, использует существующий TaskRunProcesses.stop, подтверждает OS birth
и сохраняет exited. Два одновременных confirmExit одного lease идемпотентны.
Новый prepare до подтверждения exited запрещён даже после физического выхода.
После нового generation старый объект не может отозвать его или подтвердить
выход вместо него. Старые журналы и failed attempts не переписываются.

Explicit recover применяется только после настоящего выхода предыдущего host:
живой host не заменяется. Recovery сохраняет revoked, останавливает записанное
дерево прежним механизмом и подтверждает exited до следующего поколения.
Смена/переиспользование PID не доказывает принадлежность — сравнивается OS birth.
Сбой после записи process owner, но до active metadata, оставляет owner в
прежнем реестре для recovery. Ошибка CAS/OS/read не считается успешным handoff.

## Проверка

```powershell
pnpm build
node apps/desktop/scripts/verify-builtin-extensions.mjs --native-admissions
```

CAS contract test использует два настоящих соединения SQLite: claim отсутствующей
строки, конкурентный отказ, смену active, отказ stale writer и совместимость
обычного setSetting. Нет fixture проекта, задачи, TaskRun или подставного API.

Native driver использует зарегистрированный Cat-pilot T-008 и настоящий
acceptance port. Намеренно неактивный run scope оставляет execution blocked;
это реальная отрицательная инспекция, не fabricated active TaskRun. Каждый
запуск сохраняет собственный metadata ownerKey verification, настоящий PID/birth
и generation. Task/C4 и тексты критериев не меняются, модель не вызывается.
Проверяются prepared refusal, живой host recovery refusal, ownership до
inspection, отзыв с автоматическим exit, обязательный confirmExit, новое
generation и отказ старому владельцу отозвать преемника.

Принято: `verification/extensions-73598842-7915-46c9-ba24-afb44b2aa4c3/proof.json`
в userData Skaro, journal `native-durable-admission.jsonl`. Два настоящих runtime
завершены с проверкой OS birth; generation 1 → 2, итоговый state exited,
stale owner не отозвал преемника, concurrent confirmExit идемпотентен.
Task/C4 не изменены, model requests 0. Сборка, desktop types/lint/format,
CAS contract test на двух SQLite connections и этот штатный native driver прошли.

## Незакрытые границы

Положительная recovery после настоящего аварийного выхода host должна быть
проверена отдельно. Текущая проверка live-host отказа её не заменяет.
Привязка requireCurrent к активным task/chat/queue, environment, модели и
completion ещё не включена. Процессный active не означает task execution
allowed, C4-review current или readyToSubmit. Верификационный driver сохраняет
эти различия и не включает новый пункт в каталоге агентов или UI.
