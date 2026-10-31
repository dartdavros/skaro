# BA-4: защищённые BYOK credentials

Дата: 31.10.2026. Реализация — `apps/desktop/src/main/credentials/`.
Контракты — `packages/timeline/src/builtin-credentials.ts`.
Это привилегированный backend и developer-import; продуктовых настроек BYOK
и подключения к task/chat пока нет. UI не менялся.

## Хранение и привязка

`ModelCredentialVault` работает только в настоящем Electron main после ready.
Используется синхронный safeStorage закреплённого Electron 44: он позволяет
проверить выбранный Linux backend. Windows — DPAPI, macOS — Keychain,
Linux — только `gnome_libsecret`/Secret Service. Неизвестный backend,
`basic_text`, KWallet и запуск с `use-mock-keychain` отклоняются.
Fallback на plaintext отсутствует. macOS/Linux нативно ещё не проверены.

Основание и пределы защиты — [Electron safeStorage](https://www.electronjs.org/docs/latest/api/safe-storage).
DPAPI защищает от других пользователей; приложения того же OS-пользователя
не считаются изолированными от владельца ключа. Vault не заменяет sandbox.

SQLite `userData/credentials/model-credentials.sqlite` содержит ciphertext
и несекретные binding/reference. Ключ, connection ID/revision, endpoint
и credential reference входят в зашифрованный envelope: перестановка строк
или ciphertext не создаёт привязку к другому endpoint. Каталог внутри Git
или `.skaro`, symlink/hardlink файла базы и symlink каталога отклоняются.
Новые файлы на POSIX создаются с mode 0600, каталог — 0700; на Windows
используется доступ профиля пользователя и OS-шифрование.

Отдельная SQLite `.lock` держит exclusive-транзакцию на время владельца.
Основная база при этом сохраняет каждую замену с synchronous FULL.
Другой экземпляр vault не открывается одновременно; завершение процесса
освобождает OS-lock. Ротация — сериализованный CAS по ожидаемым ID/revision.
После revoke новая запись получает новый ID, прежняя ссылка не оживает.

## Lease и секреты в памяти

Host выдаёт порт, заранее связанный с admission, connection, endpoint
и credential reference. Runtime не может расширить binding аргументами.
Проверка admission выполняется до выдачи bytes и перед callback.
Объединённый сигнал включает отмену запроса, отзыв host admission и ротацию.

Ротация/revoke/close отменяют старые callbacks и ждут их завершения до возврата.
Trusted connector обязан соблюдать сигнал; игнорирующий отмену callback
блокирует возврат revoke, а не объявляется остановленным.
Выданный буфер очищается после успеха/ошибки. Входной буфер replace остаётся
собственностью вызывающего; импорт очищает также его копии и TTY chunks.

safeStorage и HTTP headers требуют JavaScript strings. Их немедленное стирание
из managed heap не гарантируется; обнуление byte buffers не означает очистку
всех внутренних копий V8/Node/Electron. Произвольные provider/OS ошибки
не переносятся через credential-порт вместе с headers или error cause.

Коннекторы отвергают echo полного ключа в ответах/native state и удерживают
возможный префикс токена между текстовыми streaming chunks. Ключ не передаётся
в journal, renderer, настройки модели, `.skaro`, Git, shell argv или общий env.
Прямой connector получает bytes только в callback; инструменты — не получают.

## Скрытый локальный импорт

После штатной сборки из корня репозитория:

```powershell
node apps/desktop/scripts/credentials.mjs replace --connection openrouter-owner --revision 1 --endpoint https://openrouter.ai/api/v1
```

Команда требует настоящий TTY и вводит ключ без echo. Ключа нет в argv,
env или временном файле. Node передаёт его Electron через закрытый parent/child
IPC, на stdout возвращается только `{id, revision}`. Между разными V8
используется JSON IPC: advanced serialization оказалась несовместимой.
При отказе/потере host ввод отменяется, raw mode восстанавливается.

Для ротации нужны `--expected-id` и `--expected-revision` текущей ссылки;
для удаления используется `revoke` с теми же binding и expected.
Endpoint не допускает userinfo/query/fragment. Смена endpoint требует
явного replace/rebind. Импорт не создаёт продуктовую Connection/Route.
У работающего владельца vault второй importer получает отказ.

Импортированный по поручению владельца OpenRouter credential хранится
в настоящем userData Skaro. В репозитории его значения и ID не записаны.
Ключи прямых сервисов не импортировались и из подписок CLI не извлекались.

## Проверки

Две targeted-проверки используют настоящий Electron и Windows DPAPI:
round-trip несекретного текста хранения, ciphertext без plaintext/base64,
exclusive owner, CAS, bound port, отмена/ротация, обнуление borrowed bytes,
переоткрытие/revoke и скомпилированный IPC importer. Это не API-авторизация
фиктивным ключом и не fake credential backend.
Фактическая авторизация OpenRouter отдельно проверена настоящим `/key`.
Полные результаты и ограничения — в [моделях](builtin-agent-models.md).
