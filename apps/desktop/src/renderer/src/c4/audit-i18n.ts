import { addMessages } from '@skaro/ui';
const messages = {
  title: ['Полный аудит', 'Full audit'],
  name: ['Полный аудит C4', 'Full C4 audit'],
  stop: ['Остановить', 'Stop'],
  recover: ['Проверить применение', 'Check application'],
  retry: ['Повторить', 'Retry'],
  again: ['Запустить заново', 'Run again'],
  'state.preparing': ['Подготавливаем аудит…', 'Preparing audit…'],
  'state.running': ['Сверяем архитектуру с кодом…', 'Checking architecture against code…'],
  'state.resource': ['Ожидаем ресурсы для аудита', 'Waiting for audit resources'],
  'state.model': ['Ожидаем доступ к модели', 'Waiting for model access'],
  'state.decision': ['Запрошено решение владельца', 'Owner decision requested'],
  'state.applying': ['Применяем согласованные изменения…', 'Applying accepted changes…'],
  'state.done': ['Аудит завершён', 'Audit finished'],
  'state.partial': ['Сверка завершена не полностью', 'Audit is incomplete'],
  'state.error': ['Не удалось завершить аудит', 'Could not finish audit'],
  'state.conflict': ['Согласованный пакет не применён', 'Accepted package was not applied'],
  'state.stopping': ['Останавливаем аудит…', 'Stopping audit…'],
  'state.stopped': ['Аудит остановлен', 'Audit stopped'],
  'state.recovering': ['Проверяем сохранённое состояние…', 'Checking saved state…'],
  'detail.preparing': [
    'Проверяем актуальность проекта и условия запуска.',
    'Checking project state and admission.',
  ],
  'detail.running': [
    'Окно можно закрыть — аудит продолжится. Существенные изменения потребуют вашего решения.',
    'You can close this window. Material changes require your decision.',
  ],
  'detail.resource': [
    'Аудит продолжится после освобождения ресурсов, если вы его не остановите.',
    'Audit will continue when resources are available unless stopped.',
  ],
  'detail.model': [
    'Аудит приостановлен до восстановления доступа. Вы можете его остановить.',
    'Audit is waiting for model access. You can stop it.',
  ],
  'detail.decision': [
    'Изменения ожидают решения; пакет сохранён.',
    'Changes await a decision; the package is saved.',
  ],
  'detail.applying': [
    'Успешный результат появится после проверки документов и модели C4. Повторное согласование не требуется.',
    'Success requires verified documents and C4. No repeated consent is needed.',
  ],
  'detail.unchanged': [
    'Подтверждённых расхождений не обнаружено. Открытые вопросы сохранены.',
    'No confirmed discrepancies. Open questions are preserved.',
  ],
  'detail.applied': [
    'Согласованный пакет применён. Открытые вопросы сохранены.',
    'Accepted package applied. Open questions preserved.',
  ],
  'detail.rejected': [
    'Предложенный пакет отклонён и не применён.',
    'Proposed package rejected and not applied.',
  ],
  'detail.partial': [
    'По части архитектуры недостаточно подтверждённых данных. Открытые вопросы сохранены; неподтверждённые изменения не применены.',
    'Evidence is incomplete. Questions are preserved; unverified changes were not applied.',
  ],
  'detail.stopping': [
    'Дожидаемся безопасной остановки. Сохранённые решения не отменяются.',
    'Waiting for safe shutdown. Saved decisions remain intact.',
  ],
  'detail.stopped': [
    'Автоматического продолжения не будет. Уже подтверждённые изменения и ожидающие решения сохраняются.',
    'No automatic restart. Accepted changes and pending decisions are preserved.',
  ],
  'detail.recovering': [
    'Перед продолжением сверяем фактический результат. Операция с неизвестным исходом не запускается повторно.',
    'Checking the physical result first. Unknown outcomes are not blindly repeated.',
  ],
};
for (const [key, values] of Object.entries(messages))
  for (const [index, locale] of ['ru', 'en'].entries())
    addMessages(locale as 'ru' | 'en', { [`c4.audit.${key}`]: values[index]! });
