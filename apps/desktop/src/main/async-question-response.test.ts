import { expect, it } from 'vitest';
import { Timeline, type AsyncQuestion, type TimelineEvent } from '@skaro/timeline';
import { TaskRunMessages } from './task-run-messages';
import { ChatConversation } from './chat-conversation';

// Exercise only the existing response methods with inert callbacks; no API or agent is launched.
const question: AsyncQuestion = {
  kind: 'question',
  id: 'async-call',
  delivery: 'async',
  questions: [
    { id: '0', header: '', text: 'Какой контур?', multi: false, allowFreeText: true, options: [] },
  ],
};

it.each(['task', 'chat'] as const)(
  'answers a persisted %s card without requiring a still-running agent process',
  async (kind) => {
    const timeline = Timeline.from([
      { t: 'turn.started', turnId: 't1' },
      { t: 'interaction.opened', interaction: question },
      { t: 'turn.completed', turnId: 't1', outcome: 'done' },
    ]);
    const context = { timeline };
    const sent: unknown[] = [];
    const events: TimelineEvent[] = [];
    const base = {
      restore: async () => context,
      skaroEvent: (_context: unknown, event: TimelineEvent) => {
        events.push(event);
        timeline.apply(event);
      },
    };
    const host =
      kind === 'task'
        ? {
            ctx: { history: base, active: new Map() },
            deliver: async (_active: unknown, input: unknown) => {
              sent.push(input);
            },
          }
        : {
            ctx: { history: base },
            send: async (_projectId: string, _chatId: string, input: unknown) => {
              sent.push(input);
            },
          };
    const method =
      kind === 'task' ? TaskRunMessages.prototype.respond : ChatConversation.prototype.respond;
    await method.call(host as never, 'project', 'conversation', question.id, {
      kind: 'question',
      answers: { '0': ['Штатный контур'] },
    });
    expect(sent).toEqual([{ text: 'Штатный контур' }]);
    expect(timeline.state.interactions).toHaveLength(0);
    expect(events).toContainEqual({
      t: 'interaction.closed',
      id: question.id,
      resolution: 'answered',
    });
    expect(timeline.state.items).toContainEqual(
      expect.objectContaining({ kind: 'decision', interaction: question, turnId: '' }),
    );
  },
);
