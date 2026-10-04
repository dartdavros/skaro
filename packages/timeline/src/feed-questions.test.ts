import { expect, it } from 'vitest';
import type { Item } from './model.ts';
import { questionHistory } from './feed-questions.ts';

it('matches repeated card answers to separate native echoes and leaves ordinary messages alone', () => {
  const decision = (id: string, startedAt: number): Item => ({
    id,
    startedAt,
    turnId: 'completed',
    kind: 'decision',
    status: 'done',
    native: { agent: 'skaro', type: 'decision', ref: id },
    interaction: {
      kind: 'question',
      id,
      delivery: 'async',
      questions: [
        {
          id: '0',
          header: '',
          text: 'Продолжать?',
          multi: false,
          allowFreeText: true,
          options: [],
        },
      ],
    },
    answer: { kind: 'question', answers: { '0': ['Да'] } },
  });
  const user = (id: string, startedAt: number): Item => ({
    id,
    startedAt,
    turnId: 'next',
    kind: 'message',
    role: 'user',
    text: 'Да',
    status: 'done',
    native: { agent: 'codex', type: 'userMessage', ref: id },
  });
  const items = [
    user('ordinary', 1),
    decision('a', 20_000),
    user('echo-a', 20_001),
    decision('b', 20_100),
    user('echo-b', 20_101),
  ];
  const result = questionHistory(items);
  expect([...result.cardAnswers.keys()]).toEqual(['echo-a', 'echo-b']);
  expect(result.items.filter((i) => i.kind === 'decision').map((i) => i.turnId)).toEqual(['', '']);
  expect(items.find((i) => i.id === 'a')?.turnId).toBe('completed');
});
