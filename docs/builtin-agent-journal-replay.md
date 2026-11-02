# Восстановление builtin-ленты без повторной публикации

Дата: 02.11.2026. Продолжение BA-7 после task/chat attachment.

Проблема: новый процесс runtime отдаёт ready со всем primary journal.
Task/chat к этому моменту уже восстановлен из host raw log. Повторная
публикация старых turn.started/turn.completed могла повторить orchestration;
новый segment также менял уже существующие turn IDs. Если вместо повтора
просто отбросить весь ready, потеряется хвост, не попавший в host log до crash.

## Реализация

- Перед spawn считывается последняя **фактически скопированная** запись того же
  session ID из настоящего raw log. Открытый writer сначала дожидается записи;
  известная ошибка диска блокирует resume.
- Эфемерный `journalReplay` содержит session ID, sequence и hash. Он проходит
  через native worker и не сохраняется как runtime config/model permission.
- Runtime transport сверяет границу с настоящим primary journal в ready.
  Несовпадение или чужая сессия дают отказ с подтверждённым cleanup.
  Старые записи без публикации готовят projector; только недостающий хвост
  и новые records попадают в raw log и live events.
- Builtin turn IDs и projector sequence сохраняются между process segments.
  И синхронный replayRunLog, и штатный background replay используют те же
  правила. Managed agents сохраняют прежнее разделение turn IDs по segments.
- Неполная последняя строка host-копии сохраняется байт в байт. Перед новым
  segment добавляется separator; пропущенные полные записи восстанавливаются
  из primary journal. Truncate и переписывание подписанного журнала не нужны.
- После очистки истории новый native ID получает отдельный каталог журнала
  и артефактов. Старый session file не открывается под новым native ID.
  Имена native sessions хешируются только для безопасного имени каталога;
  реальный session ID и scope остаются в primary journal и admission.

## Проверка

Регрессионный тест запускает настоящие отдельные процессы Skaro runtime:
два обычных owner inputs, реальный restart и redelivery прежнего command ID.
Ни model host, ни provider response, ни backend не подставляются; model POST=0.

Проверено: готовая копия не переиздаёт старые inputs/terminals; новый ход даёт
ровно свои события. Два process segments восстанавливаются в ту же ленту
через replayRunLog и настоящий background replayHistory, без новых префиксов
turn IDs. Torn-tail проверка использует байты реально полученных записей:
старый префикс сохранён, недостающая запись доставлена из primary journal.
Чужой hash отклоняется, включая настоящий restart с отказом; OS owners завершены.
Отдельный compiled native-worker case проверяет, что неверная replay boundary
не теряется при передаче и отказывается до допуска дочернего runtime.

Целевой прогон пяти файлов — 19 тестов прошли: новый replay regression,
runtime processes, compiled native worker, durable journal recovery и run history.
Main TypeScript и lint изменённых файлов прошли. Изменённые файлы меньше
300 строк; UI и полный test suite не затрагивались.

Это приёмка delivery/replay, не сдача активной задачи, положительный handoff
между агентами, browser UI или живой цикл исправления. Product picker и создание
нового builtin run/chat ещё не включены. Установленный Skaro не закрывался,
новые provider запросы не выполнялись, Chatballs не использовался.
