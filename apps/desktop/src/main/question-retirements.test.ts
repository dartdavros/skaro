import { expect, it } from 'vitest';
import { AppDb } from '@skaro/core';
import { Timeline, type Interaction } from '@skaro/timeline';
import { QuestionRetirements } from './question-retirements';
import { QuestionAnswers } from './question-answers';
it('projects only exact owner-cancelled questions out after recovery without answers, permissions, deletion or mutation of history', () => {
  const db = AppDb.open(':memory:');
  try {
    const question: Extract<Interaction, { kind: 'question' }> = {
      id: 'async-old',
      kind: 'question',
      delivery: 'async',
      questions: [
        {
          id: 'q',
          header: '',
          text: 'Старый вопрос',
          multi: false,
          allowFreeText: true,
          options: [],
        },
      ],
    };
    const timeline = Timeline.from([{ t: 'interaction.opened', interaction: question }]);
    new QuestionRetirements(db, 'live.chat').cancel(
      question,
      'Owner explicitly cancelled the obsolete request.',
    );
    expect(new QuestionAnswers(db, 'live.chat').project(timeline.state).interactions).toEqual([]);
    expect(timeline.state.interactions).toEqual([question]);
    expect(db.getSetting('question.answers.live.chat', null)).toBeNull();
    const renewed = {
      ...question,
      questions: [{ ...question.questions[0]!, text: 'Новый вопрос' }],
    };
    timeline.apply({ t: 'interaction.opened', interaction: renewed });
    expect(new QuestionAnswers(db, 'live.chat').project(timeline.state).interactions).toEqual([
      renewed,
    ]);
    expect(new QuestionAnswers(db, 'live.other').project(timeline.state).interactions).toEqual([
      renewed,
    ]);
    expect(() =>
      new QuestionRetirements(db, 'live.chat').cancel(
        { ...question, delivery: undefined },
        'reason',
      ),
    ).toThrow('exact saved async');
  } finally {
    db.close();
  }
});
