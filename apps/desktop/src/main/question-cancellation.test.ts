import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { Timeline, questionMessageReferences, type Interaction } from '@skaro/timeline';
import { supersedeQuestionInput, cancelQuestionRequests } from './question-cancellation';
import { QuestionAnswers } from './question-answers';

const request: Extract<Interaction, { kind: 'question' }> = {
  kind: 'question',
  id: 'secrets',
  delivery: 'async',
  questions: ['env', 'ssh'].map((id) => ({
    id,
    text: id,
    header: id,
    secret: true,
    multi: false,
    allowFreeText: true,
    options: [],
  })),
};

it('retires the exact async item when a paged header no longer contains its original item or turn', async () => {
  const db = AppDb.open(':memory:');
  try {
    const question = { ...request, id: 'async-native-item', itemId: 'native-item' };
    const timeline = Timeline.from([
      { t: 'turn.started', turnId: 'original' },
      {
        t: 'item.upsert',
        item: {
          id: 'native-item',
          turnId: 'original',
          kind: 'message',
          role: 'agent',
          text: 'Which option?',
          status: 'done',
          startedAt: 1,
          native: { agent: 'codex', type: 'async_question', ref: 'native-item' },
        },
      },
      { t: 'interaction.opened', interaction: question },
      { t: 'turn.completed', turnId: 'original', outcome: 'done' },
      { t: 'turn.started', turnId: 'later' },
    ]);
    const header = { ...timeline.state, items: [], turns: timeline.state.turns.slice(-1) };
    const refs = questionMessageReferences(header);
    await supersedeQuestionInput(
      {
        db,
        owner: 'live.paged',
        state: timeline.state,
        emit: (event) => timeline.apply(event),
        flush: () => undefined,
      },
      { text: 'Cancel the old request', supersededQuestions: refs },
    );
    expect(timeline.state.interactions).toEqual([]);
    expect(new QuestionAnswers(db, 'live.paged').project(header).interactions).toEqual([]);
    const renewed = { ...header, interactions: [{ ...question, itemId: 'new-native-item' }] };
    expect(new QuestionAnswers(db, 'live.paged').project(renewed).interactions).toHaveLength(1);
  } finally {
    db.close();
  }
});

it('retires the visible multi-secret request on owner text, immediately and after recovery, without accepting fields', async () => {
  const db = AppDb.open(':memory:');
  try {
    const timeline = Timeline.from([
      { t: 'turn.started', turnId: 'request' },
      { t: 'interaction.opened', interaction: request },
    ]);
    const references = questionMessageReferences(timeline.state);
    timeline.apply({ t: 'turn.completed', turnId: 'request', outcome: 'interrupted' });
    timeline.apply({ t: 'turn.started', turnId: 'unrelated' });
    let flushed = false;
    const input = await supersedeQuestionInput(
      {
        db,
        owner: 'live.chat',
        state: timeline.state,
        emit: (event) => timeline.apply(event),
        flush: () => {
          flushed = true;
        },
      },
      {
        text: 'Generate env locally; use the existing SSH key',
        commandId: 'owner-new',
        supersededQuestions: references,
      },
    );
    expect(flushed).toBe(true);
    expect(timeline.state.interactions).toEqual([]);
    expect(input.text).toContain('fields were cancelled, not filled');
    expect(db.getSetting('question.answers.live.chat', null)).toBeNull();
    expect(db.commands.pending()).toEqual([]);
    const restored = Timeline.from([{ t: 'interaction.opened', interaction: request }]);
    expect(new QuestionAnswers(db, 'live.chat').project(restored.state).interactions).toEqual([]);
    expect(new QuestionAnswers(db, 'live.other').project(restored.state).interactions).toEqual([
      request,
    ]);
  } finally {
    db.close();
  }
});

it('does not cancel newer or reused native requests, or treat internal answer delivery as owner cancellation', async () => {
  const db = AppDb.open(':memory:');
  try {
    const native = { ...request, delivery: undefined, id: 'req-0' };
    const timeline = Timeline.from([
      { t: 'turn.started', turnId: 'old' },
      { t: 'interaction.opened', interaction: native },
    ]);
    const refs = questionMessageReferences(timeline.state);
    timeline.apply({ t: 'turn.completed', turnId: 'old', outcome: 'interrupted' });
    timeline.apply({ t: 'turn.started', turnId: 'new' });
    timeline.apply({ t: 'interaction.opened', interaction: native });
    let interrupted = 0;
    const context = {
      db,
      owner: 'active.run',
      state: timeline.state,
      emit: (event: Parameters<Timeline['apply']>[0]) => timeline.apply(event),
      flush: () => undefined,
      interrupt: async () => {
        interrupted++;
      },
    };
    await supersedeQuestionInput(context, { text: 'old queued reply', supersededQuestions: refs });
    await supersedeQuestionInput(context, {
      text: 'internal',
      internal: true,
      supersededQuestions: questionMessageReferences(timeline.state),
    });
    expect(interrupted).toBe(0);
    expect(timeline.state.interactions).toEqual([native]);
    await cancelQuestionRequests(context, [native], 'Owner cancelled');
    expect(interrupted).toBe(1);
    expect(timeline.state.interactions).toEqual([]);
    const restored = Timeline.from([
      { t: 'turn.started', turnId: 'later' },
      { t: 'interaction.opened', interaction: native },
    ]);
    expect(new QuestionAnswers(db, 'active.run').project(restored.state).interactions).toEqual([
      native,
    ]);
  } finally {
    db.close();
  }
});
