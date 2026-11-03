# Owner input из настоящего контекста runtime

Дата: 01.11.2026. Продолжение BA-7. Main-only `createContextChatInput`
подготавливает Chat request из подтверждённого ввода и реального primary journal.
Это formatter после process/input RPC admission; он не разрешает POST, бюджет,
инструменты или выполнение задачи и не включает Skaro в product picker.

## Граница подготовки

Чтение идёт через прежний `readRuntimeJournal`: настоящий файл, hash chain,
session ID и стабильность чтения проверяются, второй writer не открывается.
Сверяются command/input/turn IDs, timestamp, mode и точный текст подтверждённого
owner input. Image input, закрытое/остановленное состояние и чужой route
отвергаются. Revision formatter фиксирует его конфигурацию, route/price и maxSteps.
Сохранённый Connection сам по себе не разрешает model preparation/отправку.

Общие context formatters принимают узкий read-only view `records/state`;
прежние RuntimeSession callers работают без изменения поведения. Используется
тот же protected frame с точными scoped instructions и owner decisions,
source/history refs, рабочими заметками и epoch compact. После нового input
runtime явно возобновляет состояние прежним input fact, без повторения старого
эффекта. Закрытые provider items продолжаются только по прежним условиям
совпадения route/epoch/protected frame; иначе создаётся свежий контекст.
Steer использует общий Chat formatter и сохраняет существующую последовательность.

## Настоящий native-прогон

`SKARO_VERIFY_PROXY=http://127.0.0.1:10809` и
`node apps/desktop/scripts/verify-builtin-extensions.mjs --configured-context-input`.
Сервисы запускаются scoped на Cat-pilot до startup; task T-008 используется
read-only. Context собирается штатным runtime из корня настоящего проекта,
без seed pins, fake history, подменённого backend или API response.

Принят `verification/extensions-e7683f02-21a9-4332-a9e4-ff77eb537156/proof.json`
в userData Skaro. Первое поколение делает настоящий compact (epoch 1), durable
send/steer и подготовку через production context port. Сверены exact instructions,
owner text и history refs настоящего checkpoint. Request попадает в запрещающий
reservation gate: успешного ответа модели не изображается.

Второе настоящее runtime/admission поколение возвращает прежние input IDs без
подготовки и append, затем принимает **новый** owner input. Его request содержит
прежние send/steer и новый текст в protected frame, сохраняет epoch 1 и доходит
до того же запрещающего budget gate. Повтор нового ID также не добавляет записей.
Два model intents, 0 reservations/dispatch/POST/чтений ключа. Live/replay обоих
ходов совпали, terminal failed каждого ровно один, running items нет,
оба OS owner завершены. TaskRun не создан; task/C4/configuration неизменны.

Штатная сборка, runtime/desktop types, lint и пять целевых context/steering tests
прошли. Сравнение live journal с проверенным read-only view добавлено в
существующий значимый context test; provider output не подставлялся.
Финальный verification entry также собран штатным driver. Файлы меньше 300 строк,
UI не менялся, full suite не запускался.

Это локальная подготовка и возобновление работы до POST, не положительная
provider continuation, холодный restart всего Electron или приёмка выполнения/
сдачи активной задачи. Новый context payload не отправлялся в OpenRouter.
