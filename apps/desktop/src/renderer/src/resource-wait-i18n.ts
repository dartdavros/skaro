import { addMessages } from '@skaro/ui';

addMessages('ru', {
  'resource.wait.disk': 'Ожидает места на диске',
  'resource.wait.other': 'Ожидает ресурсов',
  'resource.wait.amount': '{path} · нужно {requested}, доступно {available}',
  'resource.wait.measurement':
    'Свободно {free}; резерв системы {reserve}; зарезервировано операциями {reserved}',
  'resource.wait.unknown': 'неизвестно',
  'resource.wait.bytes': 'Б',
  'resource.wait.mib': 'МиБ',
  'resource.wait.gib': 'ГиБ',
  'resource.wait.budget_disk': 'Недостаточно места с учётом резерва системы и текущих операций',
  'resource.wait.unknown_disk': 'Не удалось определить доступное место на диске',
  'resource.wait.budget_cpuMillis': 'Ожидает свободных ресурсов процессора',
  'resource.wait.budget_model': 'Ожидает свободного слота модели',
  'resource.wait.budget_build': 'Ожидает свободного слота выполнения команд',
  'resource.wait.budget_environment': 'Ожидает свободного слота окружения',
  'resource.wait.budget_review': 'Ожидает свободного слота проверки',
  'resource.wait.resource_locked': 'Ресурс занят другой операцией',
  'resource.wait.older_request': 'Ожидает более раннего запроса в очереди',
  'resource.wait.account_slots': 'Ожидает свободного слота учётной записи',
  'resource.wait.account_quota_unknown_or_blocked': 'Квота учётной записи недоступна или исчерпана',
  'resource.wait.metrics_stale': 'Ожидает свежего измерения доступных ресурсов',
});

addMessages('en', {
  'resource.wait.disk': 'Waiting for disk space',
  'resource.wait.other': 'Waiting for resources',
  'resource.wait.amount': '{path} · needs {requested}, available {available}',
  'resource.wait.measurement':
    'Free {free}; system reserve {reserve}; reserved by operations {reserved}',
  'resource.wait.unknown': 'unknown',
  'resource.wait.bytes': 'B',
  'resource.wait.mib': 'MiB',
  'resource.wait.gib': 'GiB',
  'resource.wait.budget_disk': 'Insufficient space after the system reserve and current operations',
  'resource.wait.unknown_disk': 'Available disk space could not be determined',
  'resource.wait.budget_cpuMillis': 'Waiting for available CPU capacity',
  'resource.wait.budget_model': 'Waiting for a model slot',
  'resource.wait.budget_build': 'Waiting for a command execution slot',
  'resource.wait.budget_environment': 'Waiting for an environment slot',
  'resource.wait.budget_review': 'Waiting for a review slot',
  'resource.wait.resource_locked': 'Resource is held by another operation',
  'resource.wait.older_request': 'Waiting behind an earlier queued request',
  'resource.wait.account_slots': 'Waiting for an account slot',
  'resource.wait.account_quota_unknown_or_blocked': 'Account quota is unavailable or exhausted',
  'resource.wait.metrics_stale': 'Waiting for fresh resource measurements',
});
