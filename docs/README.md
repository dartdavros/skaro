# Документация Skaro v2

Актуальный дизайн уже реализован в коде. Источник UI и правила его изменения —
[ui-baseline.md](ui-baseline.md). Старые HTML-макеты удалены; восстанавливать
прежний интерфейс из исторических заданий дизайнеру нельзя.

## Актуальные документы

| Документ                                                       | О чём                                                                                   |
| -------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| [product.md](product.md)                                       | Продуктовая концепция, основной сценарий, MVP и отложенные возможности                  |
| [architecture.md](architecture.md)                             | Целевая архитектура, процессы, артефакты, агенты, MCP и слияние                         |
| [implementation-plan.md](implementation-plan.md)               | Статус реализации по исходникам, остаток работы и ограничения проверки                  |
| [ui-baseline.md](ui-baseline.md)                               | Принятый дизайн в коде, точки входа и правила дальнейших UI-правок                      |
| [c4.md](c4.md)                                                 | Действующий контракт модели C4, документов, просмотра и согласования изменений          |
| [project-graph.md](project-graph.md)                           | Полноценный граф на Sigma.js; C4 и граф в основном меню после задач                     |
| [project-graph-index.md](project-graph-index.md)               | Проект модели графа, анализаторов кода, происхождения связей, индекса и IPC             |
| [project-graph-scenarios.md](project-graph-scenarios.md)       | Проект воспроизведения C4-сценариев, управления шагами и анимации связей                |
| [project-graph-plan.md](project-graph-plan.md)                 | План реализации, design gates, зависимости, проверки и критерии готовности графа        |
| [project-graph-preview.md](project-graph-preview.md)           | Визуальное превью живой карты Chatballs: реальные компоненты, данные и границы проверки |
| [project-graph-controls.md](project-graph-controls.md)         | Утверждённая компоновка фильтров, пути/влияния, проигрывателя и алертов                 |
| [project-graph-verification.md](project-graph-verification.md) | Проведённые проверки графа, реальные данные, артефакты и непроверенные сценарии         |
| [agent-output.md](agent-output.md)                             | Протоколы агентов, каноническая модель, отображение и результаты прототипа              |
| [ADR-0047](adr/0047-builtin-agent.md)                          | Целевая архитектура основного встроенного агента, BYOK и самостоятельные проверки       |
| [builtin-agent-plan.md](builtin-agent-plan.md)                 | План встроенного runtime, OpenAI/Anthropic/DeepSeek/OpenRouter, design gates и приёмка    |
| [builtin-agent-contracts.md](builtin-agent-contracts.md)       | Фактические контракты BA-1, регистрация, поставка, маршруты, host-порты и версии |
| [builtin-agent-runtime.md](builtin-agent-runtime.md)           | Ядро lifecycle BA-2: процесс, журнал, восстановление и незакрытая приёмка |
| [builtin-agent-tools.md](builtin-agent-tools.md)               | Инструменты BA-3, права, Windows Job Object и ограничения D-28 |
| [builtin-agent-models.md](builtin-agent-models.md)             | Коннекторы BA-4, живая приёмка OpenRouter, прямые API без live-проверки |
| [builtin-agent-credentials.md](builtin-agent-credentials.md)   | OS credential vault, bound leases, ротация и скрытый developer-import |
| [builtin-agent-verification.md](builtin-agent-verification.md) | Фактические проверки этапов встроенного агента и незакрытые критерии |
| [sidebar-layout.md](sidebar-layout.md)                         | Согласованное расположение, размеры и поведение панелей                                 |
| [task-environments.md](task-environments.md)                   | Сохранение worktree, защита окружений и реальная browser-проверка                       |
| [task-replanning.md](task-replanning.md)                       | Перекомпоновка не начатых задач одним пакетом из общего чата                            |
| [completion-process.md](completion-process.md)                 | Единый процесс завершения, параллельные задачи, восстановление и CI                     |
| [task-merging.md](task-merging.md)                             | Слияния с сохранением локальных правок, очередь и ограничения восстановления            |
| [agent-handoff.md](agent-handoff.md)                           | Смена агента задачи/приёмки с сохранением рабочей копии, контекста и истории            |
| [agent-limits.md](agent-limits.md)                             | Остаток пятичасового и недельного лимита подписки агентов                               |
| [project-planning.md](project-planning.md)                     | Сохранённая декомпозиция, проверка полноты и продолжение планирования                   |
| [updates.md](updates.md)                                       | Обновления Skaro/агентов, release-контракт и границы выполненных проверок               |
| [decisions.md](decisions.md)                                   | Журнал принятых и предложенных решений                                                  |

Наличие описания целевого поведения не подтверждает его реализацию.
Незакрытые сценарии и design gates отмечены в плане.

## Исторические задания дизайнеру

Эти документы сохраняют историю решений; они не являются текущим baseline
или списком UI-работ. Их старые палитра, размеры, расположение и ссылки на
удалённые макеты не переопределяют интерфейс в коде.

| Документ                                                 | Исторический контекст                                          |
| -------------------------------------------------------- | -------------------------------------------------------------- |
| [design-brief-agent-feed.md](design-brief-agent-feed.md) | Первая итерация агентской ленты и взаимодействий               |
| [design-brief-2.md](design-brief-2.md)                   | Вторая итерация ленты и настроек                               |
| [design-brief-3.md](design-brief-3.md)                   | Спецификации, импорт, существующие проекты и отказ от «Обзора» |

Документация v1 (CLI + web, фазовая модель) — в [archive/v1/](archive/v1/).
Код v1 — в ветке `legacy/v1`.
