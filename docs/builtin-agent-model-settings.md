# Настройки подключений и маршрутов моделей

Дата: 01.11.2026. Частичный результат BA-8, по решению владельца использовать
существующие элементы системы и визуальный язык. В разделе «Настройки → Агенты»
переиспользованы Section/Row, Button, Modal, Select, TextField, ConfirmDialog,
общий LoadingIndicator и текущие tokens. Новая навигация, логотип и отдельный
экран агента не добавлены. Claude Code/Codex сохраняют прежние настройки.

## Границы реализации

Connection поддерживает четыре существующих connector profiles, точный HTTPS
endpoint, новый ключ либо привязку уже сохранённой credential reference.
Редактирование не читает ключ обратно. Пустой ввод сохраняет прежний binding;
смена endpoint/revision требует повторного ввода. Секрет очищается перед IPC и
при закрытии формы, не сохраняется в controller snapshot или configuration.

Route хранит connectionId, точный modelId, проверяемые параметры запроса и
прежнюю upstream policy. Формы отправляют обычные `$state.snapshot` DTO:
реактивные Svelte Proxy не передаются в Electron structured clone.
Сохранение маршрута не является проверкой доступности модели, profile или
capabilities и не отправляет модельный запрос. Автоматического fallback нет.

Это пока ручные параметры JSON с общей семантической проверкой коннектора.
Последующее [чтение каталога OpenRouter](builtin-agent-model-catalog.md)
добавляет выбор из сведений сервиса. Direct catalogs, отдельный effort picker,
редактирование gateway policy, отображение фактического расхода и подключение
task/chat picker ещё не реализованы. Текст об оплате по API-тарифам не является балансом или
подписочным окном. Встроенный runtime остаётся выключен в продуктовом picker.

## Main, IPC и защищённое хранение

Четыре whitelisted IPC метода читают настройки, сохраняют Connection/Route
и удаляют конкретную запись. Main валидирует schema, ожидаемую revision,
identity, endpoint, profile и параметры до сохранения. Generic settings API
не позволяет записывать `builtin.*`. Ошибки IPC не включают входные значения.
Read возвращает metadata references и состояние OS protection, без ключей
или encrypted blobs. Произвольные headers/env запрещены общим контрактом.

Main-only service последовательно выполняет изменения. Перед ротацией или
удалением ключа CAS сохраняет durable intent с предыдущей и запланированной
metadata, без секрета. Vault получает заранее выбранную следующую reference;
после успешной записи тот же intent завершается. Остальные configuration
writers отказывают, пока credential transaction не разрешена.

После сбоя совпадение реальной metadata с next завершает commit, с previous
отменяет intent; неизвестный исход даёт явный отказ. Импорт не повторяется,
ключ не расшифровывается ради recovery. Ревизии/tombstones не откатываются.
Начало операции отзывает configuration leases; точная credential binding
по-прежнему проверяется vault перед доступом. Закрытие service освобождает
его OS storage lifetime lock.

## Проверки и незакрытые критерии

Десять целевых tests на настоящих SQLite/Windows DPAPI прошли: CAS и revisions,
pending recovery до/после vault mutation, ротация, удаление, private credential
IPC и scoped project index. Storage roundtrip использует не credential, а
явный текстовый marker; API/backend/project seed или model response нет.
Ключ владельца в этом тесте не используется и не изменяется.

Отдельный read-only Electron host проверил настоящую configuration и metadata
владельческого vault: bad key/header/schema, stale revision и удаление
несуществующего подключения отвергнуты; настройки неизменны, ключ не читался,
project services не создавались, модельных запросов 0. Driver:
`apps/desktop/scripts/verify-model-settings-readonly.mjs`.

Штатный browser-контур — настоящий Electron с `SKARO_VERIFICATION_PROJECT`
зарегистрированного Cat-pilot, до startup всех служб. Заглушек и копии проекта
нет. Проверены пустые состояния, disabled route без Connection, форма ключа
и привязка существующего `openrouter-owner` без возврата ключа в renderer.
Сохранение этого реального подключения отдельно разрешено владельцем.
При первом сохранении Route обнаружен отказ structured clone реактивной
upstream policy; добавлен snapshot на границе renderer IPC. После пересборки
маршрут успешно сохранён через настоящий UI. Повторное сохранение существующего
Connection без замены ключа также прошло. В home-каталоге виден только Cat-pilot.
Согласованные Connection и маршрут `openai/gpt-4.1-nano` остались в реальных
настройках; агенты задач и их модель по умолчанию не переключались.

После штатного выхода отдельный read-only процесс подтвердил configuration
с одним Connection и одним Route, прежнюю credential reference, допуск и
закрытие точного configuration lease, отказ чужой credential revision и
пять отрицательных IPC cases. Model requests 0, настройки этой проверкой
не менялись. Сохранён proof в userData:
`verification/model-settings-c722d573-d1a9-474f-80ed-e29d3a4a9fc3/proof.json`.

Desktop/runtime typecheck, Svelte-check (0 ошибок/предупреждений), итоговая
сборка и lint прошли. NO GOD: каждый новый
модуль меньше 300 строк, UI-компоненты меньше 180. Полный suite не запускался.
Полная BA-8 приёмка с работающей задачей и всеми состояниями остаётся открытой.
