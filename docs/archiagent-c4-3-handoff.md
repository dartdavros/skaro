# C4-3 — передача фактов в AG-1

Дата: 13.11.2026. AG-1 этим документом не запускается и не объявляется завершённым.
Источник — [отчёт C4-3](archiagent-c4-3.md), не иллюстративные данные макета.

## Контур и версия

- Windows, установленный Codex, настоящий зарегистрированный Cat-pilot
  `78bc2cd3-981b-40ed-a395-c6c6bc7da51b` и штатный production Electron.
- Skaro: незакоммиченное рабочее дерево поверх
  `22f3d4fb0ec12c3cfd0e49d650869f1ee13175ea`; это не отдельный релиз.
- Node v24.9.0, Electron 44.4.5. Итоговые SHA-256 71 code files / main
  и runtime state: `c43-final-abae604c-f1c1-4e6f-b94e-fcb9fe7f6261/source-and-state.json`
  в verification. Активных/retained scoped holdings на закрытии — 0.
- Scope задаётся до createServices; восстановление вкладок/индексация/workflow
  и cleanup Chatballs не запускались. Новых fake API, server, seed/checkout
  fixtures и искусственных runtime-моделей не создавалось.
- Оригинальные прочие изменения рабочего дерева сохранены. Полного suite,
  коммита, переключения default или публикации релиза не было.

## Подтверждённые результаты

| Область | Настоящие свидетельства |
| --- | --- |
| Запуск/Stop | C4 не создаёт новый run при открытии; явный native аудит, один run после навигации, Stop и stopped после перезапуска. Реальные 24 px / solid Square 12 px проверены в приложении. |
| Один пакет/решение | `c43-ui-3698512a-61a7-4f71-b525-248626e5f805`: exact diff, иконки действий, «Позже», прежние ID/revision/fingerprint после перезапуска, без записи исходников. |
| Согласованное применение | Только разрешённые пять файлов `.skaro/` и штатный history/4.json. Модель 4; исходный payload неизменен. Code/README/tasks/brief/ADR не менялись. Все 9 вопросов остаются открытыми; контекст трёх обновлён по разрешённому пакету. |
| Crash/повтор | `c43-accepted-recovery-e524ad82-aa47-49c5-922e-9d8d71ce35f2`: accepted после выхода, штатное доведение до applied, исходный owner receipt done и IPC succeeded, один verified event, второй перезапуск без изменения bytes/mtime. |
| Протоколы/история | В том же каталоге `protocol-preservation.json`: все 24 прежних run rows, 2 настоящие bindings impact-v1 и legacy default неизменны. Старый пакет и два прежних вопроса задач сохранены. |
| Native/resource recovery | `process-recovery.json`: проверенная остановка PID/birth прежнего audit chat, освобождены только 4 связанных retained leases, их старые consumers убраны. Новые запуски не обходят locks. |
| Ошибка UI | `c43-transport-406bb525-8181-490d-aefd-81cdc724c7d3`: настоящий записанный PID/birth клиента завершён, реальный error/«Повторить», сохранение после обычного restart без model retry, нового пакета и записи исходников. |

Свидетельства находятся в `C:/Users/drmar/AppData/Roaming/Skaro/verification/`.
Полный состав согласованного пакета и immutable before/after:
`c43-package-review-2fcaa711-d0aa-4225-852d-610f7afa681f/`.
Долговечные копии обеих БД:
`c43-application-fefb6170-828c-4086-ace0-3946a22e9c09/`.
В отчёте приведены integrity/fsync/SHA-256 и результаты прозрачного NTFS-сжатия:
около 834 МиБ освобождены без удаления файлов и изменения их логических байтов.

## Целевые проверки

`pnpm build`, main TypeScript, Svelte-check 0 errors / 0 warnings,
целевые ESLint/Prettier и NO GOD scan. 10 тестовых файлов / 27 passed:
`c4-audit-policy`, `c4-audit-store`, `c4-audit-process-recovery`,
`c4-decision-recovery`, `decision-projection`, `decision-replies`,
`session-command-catalogue`, `project-activity`,
`builtin-chat-session-policy`, `owner-command-block`.
Это protocol DTO / SQLite metadata tests, не подмена живого backend.
После окончательного detach повторены 5 непосредственно затронутых файлов /
8 passed. Новых code edits после финальной сборки не выполнялось.

## Границы, которые AG-1 обязан сохранить

- Первая аварийная попытка пропустила рубеж до самой первой физической записи.
  Её assertion не прошёл. Подтверждён обрыв после записи до завершения исходного
  ответа, затем повторный выход того же accepted до нового dispatch writer.
  Не объявлять это пройденным сценарием до первой физической записи и не
  откатывать реальную модель ради его искусственного воспроизведения.
- Реальные package records текущего проекта — package-v1. Сохранность двух
  настоящих impact-v1 запусков проверена; отдельный существующий pending/accepted
  impact-v1 owner package для живой migration не создавался. Его routing и
  fail-closed guard проверены metadata tests. Не подменять этот факт фикстурой.
- Сценарии macOS/Linux, других adapters, hardware power loss и специально
  созданного конфликта пользовательских файлов не заявлены.
- Native недоступность проверяется только настоящим клиентом. Его бесконечные
  или длительные reconnect не являются терминальной ошибкой аудита; timeout
  драйвера — не результат provider. При resource budget_disk/lock лимиты
  не обходятся и holdings не снимаются без подтверждения владельца процесса.
  В успешном error прогоне использован контролируемый выход собственного
  native PID/birth на обычном соединении; он не выдаётся за outage provider.
- После терминального error/stopped нет автоматического model retry. Новая
  попытка — явное действие владельца с актуальным ID. История сохраняется.
- Global/default включение, общие совместные AC/RC/C4 сценарии, управляемый
  rollout и релиз остаются задачами AG-1 и отдельного release workflow.
