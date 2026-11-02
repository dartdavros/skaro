# Model host и актуальная конфигурация маршрута

Актуализация 02.11.2026: через тот же wrapper приняты настоящий configured
provider/tool loop и повторный native запуск без POST; факты и ограничения —
[configured plan](builtin-agent-configured-plan.md#живая-приёмка-после-согласования).

Дата: 01.11.2026. Main-only `bindConfiguredModelHost` требует точный configured
route snapshot и credential reference того коннектора, который он оборачивает.
Это configuration gate, а не подтверждение profile/capability, ключа или бюджета.

`configuredRouteSnapshot` описывает только сохранённую идентичность.
`snapshotRoute` по-прежнему дополнительно требует точную модель текущего каталога.
Так configuration lease не подменяет модель синтетической записью каталога.

Lease связывает route/connection revisions, endpoint, profile, parameters,
upstream policy и точную credential reference. Произвольный другой reference
отвергается. Копии входов не дают вызывающему изменить допущенный snapshot.
Локальный commit затронутой конфигурации сразу abort-ит старый lease; общая
revision без изменения маршрута его не отзывает. Независимый SQLite writer
обнаруживается повторным чтением на следующей host-границе; межпроцессный
мгновенный notifier не заявлен.

Wrapper сохраняет прежние reserve/complete, model input/steer, tool policies и
native continuation. Current gate проверяется до/после await и перед передачей
streaming text. Изменение конфигурации отзывает signal незавершённого запроса.
Исходный connector/credential/budget gate не заменяется. Ошибка/отмена запроса
не разрешает повтор POST и не превращается в подтверждённый результат.

Возвращённый signal нужно передавать также в NativeSessionHost вместе с task
lease, чтобы штатный lifecycle отзывал tools и owned process tree. Close
освобождает configuration lease; отзыв original host также закрывает его.
Точная credential reference остаётся в main, не входит в journal/provenance/RPC.

## Проверки и ограничения

Десять целевых configuration/route contract tests прошли на настоящих SQLite
connections. Проверены wrong credential reference, неизменённый route при общем
commit, отзыв после изменения route другим writer и немедленный отзыв после
локального изменения connection/credential revision. Доступность модели этими
pure metadata inputs не заявляется. Сборка, desktop typecheck и lint прошли.

Штатный Cat-pilot preflight: `verification/extensions-177a0b19-fe8a-4433-8193-8e5d315fefd0/proof.json`
в userData. Main прочитал реальную конфигурацию и reference настоящего vault;
configured host получил `unconfigured-refused` до запуска его операций.
Отдельный native input preparation preflight сохранил два input в одном ходе,
прошёл replay и завершил runtime. Его reserve по-прежнему запрещал POST.
Model requests/reservations 0, конфигурация/task/C4 не изменены. Это не
положительная приёмка configured provider session или активной задачи.
Полный suite/browser UI не запускались: UI не менялся.
