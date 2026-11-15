import { expect, it } from 'vitest';
import { claudeUserMessage } from './session-input.ts';
import { InputQueue } from './session-queue.ts';
import { ClaudeInterrupt } from './session-interrupt.ts';

const ordinaryId = '00000000-0000-0000-0000-000000000001';
const contextId = '00000000-0000-0000-0000-000000000002';

it('preserves ordinary querying input without sending internal delivery flags to the SDK', () => {
  const message = claudeUserMessage({ text: 'Authorized owner instruction' }, ordinaryId);
  expect(message).toMatchObject({
    type: 'user',
    message: { role: 'user', content: [{ type: 'text', text: 'Authorized owner instruction' }] },
    parent_tool_use_id: null,
    uuid: ordinaryId,
  });
  expect(message).not.toHaveProperty('shouldQuery');
  expect(message).not.toHaveProperty('onlyActiveTurn');
});

it('keeps an already yielded context update transcript-only if the native turn ends before admission', async () => {
  const turns = new ClaudeInterrupt();
  const queue = new InputQueue();
  turns.observe({ t: 'turn.started', turnId: 'original' });
  queue.push(
    claudeUserMessage({ text: 'C4 package applied', onlyActiveTurn: true }, contextId),
    () => turns.currentTurn === 'original',
  );
  const iterator = queue[Symbol.asyncIterator]();
  const delivered = await iterator.next();
  // The SDK owns this message now: a JavaScript queue predicate can no longer recall it.
  turns.observe({ t: 'turn.completed', turnId: 'original', outcome: 'done' });
  queue.end();
  expect(delivered.value).toMatchObject({
    message: { content: [{ type: 'text', text: 'C4 package applied' }] },
    shouldQuery: false,
  });
  expect(delivered.value).not.toHaveProperty('onlyActiveTurn');
  expect(await iterator.next()).toMatchObject({ done: true });
});
