import type { AppDb } from '@skaro/core';
import type { ChatSessions } from './chats';
import type { C4AuditStore } from './c4-audit-store';
import { requireCoordinationDispatch } from './coordination-dispatch';

const PROMPT = `Полный аудит C4
Выполни полный read-only аудит текущего кода, брифа, архитектуры, спецификаций, ADR и C4.
Сначала вызови get_c4_context: audit содержит fingerprint и перечень реальных файлов.
Прочитай источники, проверь current/planned и открытые вопросы. Не изменяй код и документы напрямую, не запускай проект, не создавай задачи.
Если нужно существенное изменение архитектуры, подготовь ОДИН пакет propose_c4. Он сам является запросом решения: после сохранения пакета заверши ход и НЕ создавай дополнительный вопрос или разрешение. Не разбивай связанные документы и модель на отдельные согласования.
Не подменяй неизвестность успехом, не закрывай открытые вопросы за владельца. Техническая синхронизация проходит существующую политику.
В конце вызови finish_c4_audit с исходным fingerprint, evidence (пути реально изученных файлов), outcome unchanged или partial и кратким итогом. Пакет этим инструментом не принимается.
Если данных недостаточно или аудит не завершён, укажи partial. Ошибку не объявляй результатом.`;

export async function startC4Audit(
  db: AppDb,
  store: C4AuditStore,
  chats: ChatSessions,
  closing: () => boolean,
  project: string,
  previous?: string,
) {
  requireCoordinationDispatch(db, project);
  if (closing()) throw new Error('Audit service is closing');
  const current = store.read(project),
    audit = store.begin(project, previous);
  if (current?.id === audit.id) return audit;
  try {
    const settings = await chats.defaults(project);
    if (closing() || store.read(project)?.state !== 'preparing') return store.read(project)!;
    const chat = await chats.create(
      project,
      { ...settings, permissionMode: 'ask' },
      { text: PROMPT, commandId: audit.id },
    );
    db.setSetting(`c4.audit.chat.${chat.id}`, audit.id);
    db.updateChat(chat.id, { title: 'Полный аудит C4' });
    return store.update(audit, { chatId: chat.id });
  } catch (error) {
    return store.update(audit, { state: 'error', error: String(error) });
  }
}
