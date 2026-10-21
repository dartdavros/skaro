import { expect, it } from 'vitest';
import { AnswerWaiters } from './answer-waiters.ts';

it('settles permission waits on the SDK abort signal and ignores an old early answer after Stop', async () => {
  const answers = new AnswerWaiters();
  const controller = new AbortController();
  const waiting = answers.wait('permission', controller.signal);
  controller.abort();
  expect(await waiting).toMatchObject({ kind: 'approval', choice: 'deny' });
  answers.respond('early', { kind: 'approval', choice: 'allow_once' });
  answers.cancel();
  expect(await answers.wait('early')).toMatchObject({ choice: 'deny' });
  answers.resume();
  const next = answers.wait('early');
  answers.respond('early', { kind: 'approval', choice: 'deny', message: 'Fresh answer' });
  expect(await next).toMatchObject({ message: 'Fresh answer' });
});
