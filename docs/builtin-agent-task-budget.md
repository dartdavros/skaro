# Учёт primary task journals в бюджете приёмки

02.11.2026. Подготовка BA-7, положительный task-run ещё не запускался.

Общий acceptance ledger читает прежние verification journals и зарегистрированные
primary journals из `builtin/tasks`. Для регистрации необходимы настоящий текущий
run T-006 Cat-pilot, его native session, активный admission текущего main host и
совпадающий scope в созданном журнале. Путь строится приложением из идентификаторов,
произвольный путь из review-пакета не принимается.

Регистрация сохраняет только append-only checkpoint: run/session, sequence и hash.
Повторные checkpoints одного журнала не умножают расходы. Читатель проверяет
канонические пути, цепочку журнала и каждый зарегистрированный префикс. Потеря,
усечение или подмена зарегистрированной части приводят к отказу. Прежние
неизвестные удержания и расчёт стоимости не изменены. При отсутствии registry
сохраняется прежний набор источников. Проверка истории review также видит эти
журналы; текущий изменяющийся журнал можно исключить только по его точному ID.

Сценарий должен регистрировать настоящий журнал до reservation и перед dispatch.
После отдельного разрешения [живой driver](builtin-agent-task-stop-acceptance.md)
зарегистрировал настоящий T-006 journal перед reservation/dispatch.

Проверено: production build, TypeScript main, lint и семь целевых тестов
контрактов источника, budget guard и reported amounts. Тесты источника проверяют
только DTO/идентичность/префиксы, не создают фиктивных задач, run или журналов.
Настоящая scoped preparation повторена:
`extensions-e3e76675-c778-410b-941c-04429d0a0a50/task-stop-review.json`
в локальном `Skaro/verification`. Ledger остался 85 intents / 393241240 nanoUSD;
T-006, C4 и configuration неизменны, model requests 0. Это историческая preparation.
Поздняя положительная приёмка использовала четыре новых POST; ledger 89 intents /
428414440 nanoUSD, включая прежние holds и две реальные отмены с unknown outcome.
Свежий main подтвердил тот же ledger и неизменность primary/raw bytes, POST 0.
