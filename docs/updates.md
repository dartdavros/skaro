# Обновления Skaro и агентов

Сценарий согласован владельцем 30.09.2026. D-23 остаётся обязательным:
обновляется проверенный комплект приложения, адаптеров и закреплённых агентов.
Номер комплекта повышается даже при изменении только агента; отображаемая версия
Skaro хранится отдельно (подтверждено владельцем).

## Интерфейс

Baseline сценария — текущие `updates/UpdateButton.svelte`,
`updates/UpdatesModal.svelte` и штатные Modal, Button, Banner, Progress
в `packages/ui/src/components/`. Пути `updates/` — относительно
`apps/desktop/src/renderer/src/`. Правила: [UI baseline](ui-baseline.md).
Старый HTML-макет удалён; согласованные требования ниже сохраняются.

- Слева от настроек, с интервалом 6 px: круглая кнопка 28×28 px,
  `var(--sk-accent)`, белая lucide Download 16 px. Hover — существующий accent-hover.
  Label и tooltip: «Доступны обновления». Без анимации и счётчика.
- Кнопка появляется только при совместимом обновлении Skaro либо установленного
  агента. Новая версия неустановленного агента сама по себе её не вызывает.
- Клик открывает модалку «Обновления», ширина 440 px, отступы/шапка/закрытие
  штатного Modal. Открытие ничего не загружает.
- Только изменившиеся компоненты, порядок Skaro, Codex, Claude Code. В каждой
  строке название, текущая → новая версия, ссылка «Описание релиза».
- Footer: «Позже», основная «Обновить». После загрузки —
  «Перезапустить и применить». Загрузка использует штатный серый Progress.
  Ошибка — штатный Banner error и «Повторить». Во время активной работы
  применение отключено; пояснение в существующем warning Banner:
  «Дождитесь завершения задач, чатов и импорта». Перезапуск только по клику.
- Текст error Banner: «Не удалось загрузить обновление». Техническая причина
  сохраняется в main state и журнале процесса. При ошибке проверки feed список
  компонентов может быть пустым: используется тот же Banner, без нового UI-блока.
- Ручная проверка остаётся в «Настройки → О программе», открывает ту же модалку
  при наличии обновления. Ошибка проверки не означает «последняя версия».

## Контракт релиза

Публичный стабильный GitHub Release `skarodev/skaro`, tag `v<bundleVersion>`,
asset `skaro-release.json`, platform feeds electron-builder и установщики.
Метаданные публикуются только вместе с полностью проверенными артефактами.
Формат и генератор лежат в исходниках desktop; произвольный npm latest не используется.
Метаданные содержат schema, bundleVersion, skaroVersion, закреплённые package/shown
версии Codex/Claude, версии адаптеров и platform packages с SHA512 integrity.
Встроенный SDK Claude должен точно совпадать с его pin.

Будущие бинарники загружаются только для уже установленных агентов в их отдельные
version folders и не используются старыми адаптерами. Старые версии сохраняются.
App payload проверяется SHA512 механизмом electron-updater. Проверка при старте,
раз в 6 часов и вручную использует одно состояние main → IPC → renderer.

Перед применением повторно проверяются активная работа и выполняющиеся IPC-операции.
Новые операции на время применения блокируются. Сохраняется предыдущая копия
приложения; userData, проекты, авторизация и выбранные модели не переписываются.
После рестарта встроенные метаданные и установленные pins сверяются с pending
комплектом. Только после успешной сверки обновление подтверждается; кэши нового
процесса создаются заново, агенты перечитывают состояние, модели и настройки.
Статус перечитывается при старте, модели/команды/config — при первом запросе
соответствующего экрана или рабочего сценария. Сохранённый выбор модели не меняется.
При несовпадении уже установленного комплекта запуск агентов блокируется до
успешной сверки или восстановления сохранённой копии приложения.

## Подготовка артефактов

`apps/desktop/scripts/bundle-metadata.mjs` строит `build/skaro-bundle.json` из
реальных pins и package.json адаптеров. Файл входит в resources приложения;
запущенный packaged main сверяет его с `app.getVersion()` и compiled pins.

- `SKARO_BUNDLE_VERSION`: техническая stable semver версия нового комплекта.
- `SKARO_PRODUCT_VERSION`: отображаемая версия Skaro. При agent-only релизе
  сохраняется прежняя, а bundle version повышается.
- `pnpm --filter @skaro/desktop package` создаёт локальный unpacked комплект;
  `pnpm dist` создаёт установщики. Оба скрипта передают technical version в
  electron-builder и всегда используют `--publish never`.
  Упаковщик повторно создаёт resource metadata непосредственно перед запуском
  electron-builder, чтобы предыдущая сборка с другими версиями не попала в пакет.
- `SKARO_RELEASE_ARCH=x64|arm64` и `release:manifest platform` проверяют настоящий
  feed/installer в `apps/desktop/release`, SHA512 и размер payload, получают
  metadata точных npm package versions и создают manifest текущей платформы.
- `release:manifest merge` требует все шесть платформ и одинаковый комплект
  pins/SDK/адаптеров, затем создаёт `skaro-release.json`. Любой пропуск — ошибка.

Manifest schema 1 определяется в `src/main/update-release.ts`. `platforms` содержит
`win32-x64`, `win32-arm64`, `darwin-x64`, `darwin-arm64`, `linux-x64`, `linux-arm64`.
У каждой платформы: имя `feed`, `payload.{name,sha512,size}` и `agents` с точными
`agent/version/shownVersion/name/npmVersion/binary/pathDirs/tarball/integrity`.
Tarball разрешён только с HTTPS npm registry; SDK должен равняться Claude pin.
NSIS использует `latest-<arch>.yml`, macOS ZIP — `latest-<arch>-mac.yml`, AppImage —
`latest-linux.yml` либо `latest-linux-arm64.yml`. Feeds и payload относятся к
одному tag `v<bundleVersion>`; версия, имена assets, hashes и sizes сверяются.

`.github/workflows/release-artifacts.yml` запускается вручную. Установщики
создаются на native Windows/macOS/Linux x64/arm64 runners и сохраняются как
Actions artifacts. Workflow не создаёт GitHub Release и не публикует assets.
Владелец подтверждает реальные canary/model проверки pins через `agents_verified`.
Полный существующий suite содержит HTTP test servers и fixtures: отдельный
`test_fixtures_allowed` по умолчанию false требует явного разрешения владельца
на такой release-прогон; без обоих подтверждений сборка релиза не начинается.

Signing secrets: `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD`, `MAC_CSC_LINK` /
`MAC_CSC_KEY_PASSWORD` и `MAC_IDENTITY`. `CSC_LINK` — поддерживаемый electron-builder
certificate/base64. Для notarization: `APPLE_API_KEY` — содержимое настоящего
`.p8`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`; workflow записывает ключ в runner
temp file и передаёт его путь. Windows и macOS release jobs прекращаются без
credentials. Локальный macOS ad-hoc build остаётся только dev-пакетом.

## Восстановление

`userData/updates/pending.json` хранит manifest, prepared agent IDs, пути
проверенного app payload, applying flag и backup path. Запись заменяется атомарно.
Перед apply в `userData/updates/previous/<bundle>-<uuid>/` копируется прежний
app directory, `.app` либо AppImage; профили и проекты не входят в миграцию.
После успешной сверки journal сохраняется как `applied-<bundle>-<uuid>.json`.
Старые версии агентов и backup автоматически не удаляются.

Если installer не завершился, старый процесс приложения после нового запуска
предлагает повторную загрузку; electron-updater заново инициализирует cache.
Если установленный bundle не совпадает с manifest или нужных бинарников нет,
это не считается успехом: агентские операции блокируются, ошибка остаётся в
main state. Автоматического отката userData или бесконтрольной смены адаптеров нет.
Восстановление сохранённой копии приложения — отдельное ручное действие.

## Ограничения проверки и выпуска

- Dev checkout не заменяется установщиком. Проверка feed доступна, применение —
  только в штатно установленном NSIS / подписанном macOS app / AppImage.
- macOS требует настоящую подпись, notarization и ZIP помимо DMG. Ad-hoc подпись
  dev/CI не подтверждает готовность автообновления.
- При отсутствии настоящего feed/релиза end-to-end загрузка и применение не
  считаются проверенными. Заглушки и временные серверы не используются.
- Подготовка release artifacts не публикует релиз. Публикация и внешние signing
  credentials остаются отдельным действием владельца.

## Локальная проверка 30.09.2026

- Production build main/preload/renderer, desktop main types, renderer
  svelte-check, core types, targeted ESLint и Prettier прошли.
- 10 чистых unit tests проверяют stable versions, agent-only список, manifest
  compatibility, recovery identity и блокировку работы/применения. Серверы,
  backend mocks и файлы с поддельными бинарниками в этих тестах не используются.
- В настоящем Electron прошли два узких e2e: startup/window/preload isolation
  и единое состояние обновлений с live GitHub feed. Использован штатный пустой
  profile, без seed-данных. В доступном GitHub Release нет update assets:
  индикатор скрыт, ручная проверка работает.
- Настоящий Windows unpacked package проверен отдельным e2e: technical
  `0.0.1`, displayed `0.0.0`. Это локальный проверочный комплект, не релиз.
  Повторная упаковка выявила устаревший resource metadata; startup сверка
  отказала в запуске несовпадающего комплекта. Упаковщик исправлен и пакет
  пересобран с заново полученными версиями.
- На настоящих установленных Codex 0.159.2 и Claude Code 2.1.285 проверены
  чтение marker, no-op installPackage и отказ перезаписывать бинарник при
  несовпадении integrity. Реальные registry metadata обоих pins доступны
  на всех шести release platforms.
- Визуально проверен штатный Settings/About в Electron при отсутствии update
  feed. Модалка с доступными компонентами, загрузка, ready/error/busy и реальное
  применение не проверены end-to-end: подходящего опубликованного комплекта нет.
  Структура модалки сверена по исходникам baseline и штатных UI-компонентов.
- Existing `installer.test.ts` не запускался: automatic approval review
  отклонил его временный HTTP server/fixtures по правилу владельца. Владелец
  затем разрешил файловые/Git fixtures, сохранив запрет HTTP-заглушек;
  этот suite успешной проверкой не считается.
- 02.10.2026: отдельные два файловых теста `installer-marker.test.ts` проверили
  marker/package/version/integrity и отказ перезаписывать установленный pin.
  Тестовый файл бинарника не исполняется; серверы и замена fetch не используются.
- 02.10.2026: повторная проверка настоящего Electron подтвердила единое состояние
  обновлений и защиту dev checkout. Настоящие загрузка/применение остаются открытыми.
- `mock-bridge.ts` разделён на фасад и модули по областям IPC; preview не запускался
  и не использовался для проверки runtime-функций.
