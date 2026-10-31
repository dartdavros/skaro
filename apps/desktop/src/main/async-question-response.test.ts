import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { AttachmentStore } from '@skaro/core';
import { Timeline, replayRunLog, validateQuestionAnswer } from '@skaro/timeline';
import { projectorFor, readRunLog } from './session-log';

const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const chatId = process.env['SKARO_QUESTION_CHAT'];

// Replay a recorded real native question. No generated project, fixture, fake host or API.
it.skipIf(!profile || !chatId)(
  'keeps the real question pending across native turn completion and snapshot restoration',
  async () => {
    const db = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
    try {
      const chat = db.prepare('SELECT * FROM chats WHERE id=?').get(chatId!);
      if (!chat) throw new Error('The real chat is missing from the copied profile');
      const attachments = new AttachmentStore(join(profile!, 'attachments'));
      const events = replayRunLog(
        await readRunLog(join(profile!, String(chat['log_path'])), true),
        Number(chat['created_at']),
        await projectorFor(String(chat['agent'])),
        attachments.context().attachImage,
      );
      const opened = events.findIndex(
        (event) => event.t === 'interaction.opened' && event.interaction.kind === 'question',
      );
      expect(opened).toBeGreaterThanOrEqual(0);
      const completed = events.findIndex(
        (event, i) => i > opened && event.t === 'turn.completed' && !event.continuing,
      );
      expect(completed).toBeGreaterThan(opened);
      const timeline = Timeline.from(events.slice(0, completed + 1));
      expect(timeline.state.status).toBe('waiting');
      const restored = Timeline.restore(structuredClone(timeline.state));
      expect(restored.state.interactions).toEqual(timeline.state.interactions);
      expect(restored.state.status).toBe('waiting');
      const question = restored.state.interactions.find((i) => i.kind === 'question')!;
      expect(() => validateQuestionAnswer(question, { kind: 'question', answers: {} })).toThrow(
        'Answer every question',
      );
    } finally {
      db.close();
    }
  },
);
