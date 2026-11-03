# Фактический расход из primary journal

Дата: 02.11.2026. Продолжение backend-части BA-8. `reportModelUsage` строит
read-only projection уже проверенного primary journal. Это основа отображения
расхода; новый UI или IPC, проверка аккаунта и новая модельная отправка
этим изменением не включаются.

## Квитанции и неизвестные значения

Источник — model effect intent и соответствующий `effect-result` с provenance
в каноническом `${effectId}:result`. Continuation копии, command acknowledgements
и повторная доставка ввода не создают новых квитанций. У каждой записи есть
точный RouteSnapshot и ссылки sequence/hash на intent и результат; route другой
модели/подключения не подменяется. Журнал предварительно читается прежним
`readRuntimeJournal` с проверкой chain и стабильности файла.

Возвращаются только whitelisted route, reported model/upstream/request ID,
tokens и стоимость. Тела сообщений, tool results, native items и произвольные
поля response в отчёт не входят. Некорректные/отсутствующие token counts остаются
null. Нет вывода стоимости из имени модели, каталожного тарифа или числа токенов.

Отсутствующая квитанция и отсутствующая cost отличаются от нулевой стоимости.
`costsUnreported` отмечает такие intents; reported totals содержат только
полученные суммы и группируются по валюте. Это частичные факты, не итоговая
стоимость всей работы при неизвестных записях. Строковые decimal/exponent
значения суммируются через BigInt без потери точности двоичной арифметики.
Валюты не конвертируются. Отдельный бюджетный ledger сохраняет прежний учёт
расходов **и** резервов: квитанции не освобождают неизвестные удержания сами.
BYOK расход не выдаётся за подписочные окна Claude/Codex.

## Настоящая проверка

Режим `node apps/desktop/scripts/verify-builtin-extensions.mjs --model-usage-report`
читает только три исторических Cat-pilot planning journals:
`session-nativeinput.jsonl`, `session-nativeplan.jsonl`, `session-plans.jsonl`.
Он не открывает checkout другого проекта, не отправляет запросы в API и
не изменяет исходные журналы. Глобальный бюджет прежних проверок читается
отдельно, чтобы не объявлять стоимость этих трёх сессий стоимостью всех тестов.
Services запускаются с Cat-pilot scope до startup.

Первый proof `verification/extensions-f7cc9de0-9e05-43da-94f7-2765135e73b2/proof.json`
в userData: 28 model intents, 26 квитанций, две стоимости не сообщены.
Reported USD по трём журналам: `0.00137498`, `0.0032018`, `0.0025187`.
Это сохранённые факты предыдущих прогонов, не 28 новых запросов.
Глобальный ledger остался 80 intents / $0.39157154 расходов и удержаний.
Canonical chains, receipt references, deterministic replay и неизменность
старых source hashes проверены; model/catalog requests и чтений ключа — 0.
Финальная whitelist-версия повторно принята с теми же результатами:
`verification/extensions-d08a98bb-68bd-4e9d-84c6-3e9d7661e850/proof.json`.

Арифметику проверяет один значимый contract test: decimal/exponent суммы,
нулевая квитанция и отказ некорректным/отрицательным значениям. Ответ модели,
provider API и журнал с выдуманными результатами не создаются. Финальная штатная
сборка, runtime/desktop types, lint и test прошли. Финальный verification entry
также собран driver. Full suite не запускался, UI не менялся.
NO GOD: projection 96 строк, decimal helper 27, driver 73.
Provider direct/live admission, UI расхода и полная BA-8 приёмка остаются открыты.
