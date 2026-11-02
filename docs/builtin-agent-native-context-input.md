# Native owner input прямых API

Дата: 02.11.2026. Продолжение BA-7: main-only `createContextNativeInput`
для OpenAI Responses и Anthropic Messages. Форматирование подключено
в `BuiltinTaskModels`; живые вызовы прямых API остаются отложенными владельцем.

## Контекст и продолжение

Chat и native formatter используют общий reader подтверждённого owner input.
Сверяются настоящий primary journal, session/command/input/turn IDs, timestamp,
mode, точный текст и текущий route. Подмена, image input, отмена,
закрытое/остановленное состояние отвергаются. Reader не открывает второго
writer, credential vault или транспорт.

Native request получает существующий protected context frame: точные AGENTS,
решения и owner statements, текущие source/history references и compact epoch.
Выход — native input items/messages и system instructions, без перевода
Responses items или Anthropic blocks в Chat Completions.

`continueNativeConversation` переиспользуется прямыми коннекторами,
восстановлением контекста и steering. Responses сохраняет исходные output
items и `call_id`; Messages — исходные blocks, `tool_use_id`, thinking/signature
поля. Результаты инструментов должны точно соответствовать calls; неполный
набор не превращается в продолжение. Другая route/profile не допускается.

Native continuation checkpoint теперь хранит context selection и system frame.
Тот же route/source revision/epoch позволяет сохранить native items и добавить
актуальный frame с owner statements и новыми references. Compact, смена
источников/маршрута и старый checkpoint без context selection дают свежую
provider conversation с общим проверенным контекстом. Старые records не меняются.
Это не разрешение повторить effect без результата.

Steering добавляет точный текст на существующей границе model/tool шага.
При гонке с terminal response сначала сохраняется его native output, затем
ввод; незавершённые tool calls терминальным ответом не считаются.

## Инструменты и выбор параметров

Task authorization явно задаёт `modelTools`. Их имена и schemas сверяются
с настоящим runtime catalogue и зарегистрированными scoped extensions.
Нельзя добавить неизвестный handler, дубликат или подменённую schema.
Пустой список остаётся пустым; все инструменты автоматически не добавляются.
Те же schemas передаются Chat и native formatter и входят в input revision.
Process/tool/acceptance admission по-прежнему проверяет само выполнение.

Task effort сравнивается с реальным параметром API: `reasoning_effort`
для OpenAI/DeepSeek и `effort` для Anthropic/OpenRouter. Чужой параметр
не засчитывается и скрытая подмена effort не выполняется.

## Проверено и остаётся

Целевой прогон шести файлов: 15 тестов прошли. Настоящие RuntimeSession,
journal и scoped AGENTS проверяют ввод обоих API, точные строки, native body,
повторное открытие, отмену и отказ подмене. Pure schema admission проверяет
настоящие tool schemas; затронутые direct API/body/context/steering contracts
тоже прошли. Успешный ответ провайдера, backend или ActiveRun не подставлялись.

Живые native tool chains, native continuation после ответа прямого провайдера,
streaming/cancellation/restart прямых API ещё не приняты. Общий metadata gate
пока реализован для OpenRouter; новый formatter не обходит этот отказ для
прямых API. Никаких новых model POST, ключей или затрат здесь нет.
