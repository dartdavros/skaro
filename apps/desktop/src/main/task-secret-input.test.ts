import { expect, it } from 'vitest';
import {
  assertQuestionsAnswered,
  emptyTimeline,
  isAsyncQuestion,
  persistsAfterTurn,
  validateQuestionAnswer,
} from '@skaro/timeline';
import { secretInteraction } from './task-secret-input';
import { withoutSecrets } from './session-log';

it('opens protected fields that block continuation and remain answerable after the turn ends', () => {
  const interaction = secretInteraction([
    { id: 'api_key', header: 'API-ключ', question: 'Введите API-ключ интеграции.' },
    { id: 'folder_id', header: 'Каталог', question: 'Введите ID каталога.' },
  ]);
  expect(isAsyncQuestion(interaction)).toBe(true);
  expect(persistsAfterTurn(interaction)).toBe(true);
  expect(() =>
    assertQuestionsAnswered({ ...emptyTimeline(), interactions: [interaction] }),
  ).toThrow('Answer the open questions');
  expect(interaction.questions.every((q) => q.secret && q.allowFreeText && !q.options.length)).toBe(
    true,
  );
  expect(() => validateQuestionAnswer(interaction, { kind: 'question', answers: {} })).toThrow(
    'Answer every question',
  );
  // Redaction is determined by the card metadata before any owner value exists.
  expect(
    withoutSecrets(interaction, { kind: 'question', answers: { api_key: [], folder_id: [] } }),
  ).toEqual({
    kind: 'question',
    answers: { api_key: ['•••'], folder_id: ['•••'] },
  });
});
