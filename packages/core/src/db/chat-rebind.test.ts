import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { AppDb } from './appdb.ts';

// SQLite metadata transactions only: no checkout, task/run, native process or model reply.
it('atomically publishes chat settings with the new journal and rolls both back on failure', () => {
  const db = AppDb.open(':memory:');
  try {
    const project = db.addProject({ name: 'Metadata transaction', path: '/metadata-only' });
    const chat = db.createChat({
      projectId: project.id,
      agent: 'skaro',
      title: 'Metadata',
      logPath: 'unused',
    });
    const previous = randomUUID(),
      next = randomUUID();
    db.updateChat(chat.id, { nativeSessionId: previous });
    expect(() =>
      db.chats.rebind(chat.id, previous, next, () => {
        db.setSetting('transaction-marker', 'uncommitted');
        throw new Error('Abort publication');
      }),
    ).toThrow('Abort publication');
    expect(db.getChat(chat.id)?.nativeSessionId).toBe(previous);
    expect(db.getSetting('transaction-marker', null)).toBeNull();
    db.chats.rebind(chat.id, previous, next, () =>
      db.setSetting('transaction-marker', 'committed'),
    );
    expect(db.getChat(chat.id)?.nativeSessionId).toBe(next);
    expect(db.getSetting('transaction-marker', null)).toBe('committed');
    expect(() => db.chats.rebind(chat.id, previous, randomUUID(), () => {})).toThrow('changed');
    db.updateChat(chat.id, { archived: true });
    expect(() => db.chats.rebind(chat.id, next, randomUUID(), () => {})).toThrow('changed');
  } finally {
    db.close();
  }
});
