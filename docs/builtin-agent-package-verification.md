# Локальная проверка Windows payload встроенного runtime

Дата: 01.11.2026. Предварительная проверка поставки BA-1/BA-9 на Windows x64.
Это локальный unpacked комплект версии из текущего package.json (`0.0.0`),
не опубликованный релиз, установщик или приёмка остальных платформ.

## Настоящий artifact

Штатный `scripts/package.mjs --win --x64 --dir` с `--publish never` создал
`apps/desktop/release/builtin-verification-6c86a24/win-unpacked` в отдельном
каталоге. Номер версии, release manifest и managed pins не менялись.
Electron-builder завершил упаковку и обновление ASAR integrity resource EXE.
Установка приложения в систему не выполнялась.

Новый `scripts/verify-builtin-package.mjs` читает настоящий EXE/ASAR:

- PE machine — Windows x64, не вывод по имени каталога;
- девять main/worker/preload/renderer entries присутствуют и совпадают SHA512
  с текущими `out` файлами, включая native/runtime/credential/command workers;
- все файлы текущего `out`, включая renderer assets, дополнительно сверены
  с ASAR; proof содержит их количество и hash отсортированного дерева;
- package main/version соответствуют resource bundle metadata и исходным pins;
- временных `out/main/verify-*`, корневых `.git/.skaro/.env/verification`
  и проектного состояния в archive нет;
- записаны SHA512 настоящих EXE и ASAR, без замены archive тестовыми данными.

Proof: `win-unpacked/builtin-runtime-proof.json` внутри указанного локального
каталога. Сам verifier не запускает worker или модель и честно фиксирует
`runtimeExecutionChecked: false`. В первом чтении inspector передал POSIX path
Windows ASAR API; после `path.normalize` тот же настоящий archive проверен.
Присутствие файлов само по себе не доказывает исполнение дочернего runtime.

## Запуск настоящего EXE

Packaged приложение запущено с реальными userData, backend/services и
`SKARO_VERIFICATION_PROJECT` зарегистрированного Cat-pilot до startup.
Для каталога задан `SKARO_VERIFY_PROXY=http://127.0.0.1:10809`.
Ни seed-профиля, ни fake API, ни альтернативного renderer server нет.

Первый диагностический запуск через PowerShell `&` закрыл stdout GUI-процесса:
`SKARO_TRACE` получил EPIPE. После закрытия error dialog процесс остался жив
и удерживал single-instance lock; он не считается успешной приёмкой.
Подтверждённые PID только этого проверочного EXE были завершены. Повтор выполнен
через Start-Process с отдельными постоянными stdout/stderr handles; штатная
single-instance activation показала окно. Trace-код/продуктовый UI ради проверки
не изменялись, ошибка не скрыта как успешный первый старт.

Computer Use подтвердил process path настоящего `win-unpacked/Skaro.exe` и
renderer URL внутри `resources/app.asar/out/renderer/index.html`. Единственная
вкладка — Cat-pilot. Настройки прочитали реальный Connection и прежнюю reference
ключа; форма маршрута загрузила настоящий каталог OpenRouter и показала
`OpenAI: GPT-4.1 Nano` для сохранённого точного ID. Форма отменена без сохранения.
Model POST, запуск/сдача задачи и изменение выбора агентов не выполнялись.

Последний правильный main PID — 4272, startup log:
`%TEMP%/skaro-builtin-packaged-stdout-v2.log`; stderr того же запуска пуст
на момент проверки ready и после закрытия. Кнопка закрытия завершила именно
этот scoped-процесс штатно: trace содержит `runs and mcp server closed`,
`will quit` и `quit, exit code 0`; PID отсутствует. Разрешённое владельцем
отключение сворачивания в трей применялось только в памяти scoped AppState.

## Граница результата

Упаковка, ASAR verifier и lint прошли. Это настоящая Windows x64 упаковка и
browser-проверка packaged настроек. Full suite не запускался. Отдельные macOS/
Linux/arm64, installer/update rollback, runtime spawn из ASAR, provider lifecycle,
самостоятельная работа и сдача задачи остаются незакрытыми критериями.
Встроенный агент в picker не включён; прежние альтернативы и default сохранены.
