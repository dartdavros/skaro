import { expect, it } from 'vitest';
import type { Interaction } from '@skaro/timeline';
import {
  readQuestionDraft,
  saveQuestionDraft,
  questionDraftKey,
  forgetQuestionDraft,
} from './question-drafts';
it('retains only non-secret drafts for the same source epoch and exact question', () => {
  const question: Extract<Interaction, { kind: 'question' }> = {
    kind: 'question',
    id: 'protocol',
    questions: [
      {
        id: 'public',
        text: 'Public observation',
        options: [],
        header: 'Protocol',
        multi: false,
        allowFreeText: true,
      },
      {
        id: 'private',
        text: 'Private observation',
        options: [],
        header: 'Protocol',
        multi: false,
        allowFreeText: true,
        secret: true,
      },
    ],
  };
  const key = questionDraftKey('real-source-epoch', question);
  saveQuestionDraft(key, question, {
    picked: { public: ['public selection'], private: ['private selection'] },
    custom: { private: 'private value' },
    customOn: { private: true },
  });
  expect(readQuestionDraft(key)).toEqual({
    picked: { public: ['public selection'] },
    custom: {},
    customOn: {},
  });
  expect(questionDraftKey('another-epoch', question)).not.toBe(key);
  forgetQuestionDraft(key);
  expect(readQuestionDraft(key).picked).toEqual({});
});
