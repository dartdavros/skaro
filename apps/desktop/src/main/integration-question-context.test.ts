import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { Timeline, questionMessageReferences, type Interaction } from '@skaro/timeline';
import { composeTaskTimeline, scopeTimeline } from '../shared/task-timeline';
import { integrationQuestionReferences } from './integration-question-context';
import { supersedeQuestionInput } from './question-cancellation';
import { QuestionAnswers } from './question-answers';

it('keeps the native question epoch of its integration source and retires it across a composed history restore', async () => {
  // Canonical timeline DTOs and real SQLite metadata only; no substituted backend or native runtime.
  const db = AppDb.open(':memory:');
  try {
    const question: Extract<Interaction, { kind: 'question' }> = {
      kind: 'question',
      id: 'worker:req-0',
      questions: [
        {
          id: 'choice',
          text: 'Inspect the current candidate?',
          header: '',
          multi: false,
          allowFreeText: true,
          options: [],
        },
      ],
    };
    const candidate = Timeline.from([
      { t: 'turn.started', turnId: 'worker:original-turn' },
      { t: 'interaction.opened', interaction: question },
    ]);
    const scoped = scopeTimeline(candidate.state, 'integration-current');
    const unrelated = Timeline.from([{ t: 'turn.started', turnId: 'later-unrelated-turn' }]).state;
    const composed = composeTaskTimeline(undefined, [
      { id: 'current', seq: 1, live: true, timeline: scoped },
      { id: 'other', seq: 1, live: true, timeline: unrelated },
    ]);
    const captured = questionMessageReferences(composed, [scoped, unrelated]);
    const references = integrationQuestionReferences(captured, 'current');
    expect(references).toEqual(questionMessageReferences(candidate.state));
    let interrupted = false;
    await supersedeQuestionInput(
      {
        db,
        owner: 'integration.current',
        state: candidate.state,
        emit: (event) => candidate.apply(event),
        flush: () => undefined,
        interrupt: async () => {
          interrupted = true;
        },
      },
      { text: 'Cancel that obsolete request', supersededQuestions: references },
    );
    expect(interrupted).toBe(true);
    expect(candidate.state.interactions).toEqual([]);
    const restored = Timeline.from([
      { t: 'turn.started', turnId: 'worker:original-turn' },
      { t: 'interaction.opened', interaction: question },
    ]);
    const projected = new QuestionAnswers(db, 'integration.current').project(restored.state);
    expect(scopeTimeline(projected, 'integration-current').interactions).toEqual([]);
    expect(
      new QuestionAnswers(db, 'integration.other').project(restored.state).interactions,
    ).toEqual([question]);
    const reused = Timeline.from([
      { t: 'turn.started', turnId: 'worker:new-turn' },
      { t: 'interaction.opened', interaction: question },
    ]);
    expect(
      new QuestionAnswers(db, 'integration.current').project(reused.state).interactions,
    ).toEqual([question]);
  } finally {
    db.close();
  }
});
