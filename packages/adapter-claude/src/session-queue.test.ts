import { expect, it } from 'vitest';
import type { SDKUserMessage } from '@anthropic-ai/claude-agent-sdk';
import { InputQueue } from './session-queue.ts';
import { ClaudeInterrupt } from './session-interrupt.ts';

const message = (text: string): SDKUserMessage => ({
  type: 'user',
  message: { role: 'user', content: text },
  parent_tool_use_id: null,
});

it('discards a context update that outlives its turn while preserving ordinary queued input', async () => {
  const turns = new ClaudeInterrupt();
  const queue = new InputQueue();
  turns.observe({ t: 'turn.started', turnId: 'original' });
  queue.push(message('context update'), () => turns.currentTurn === 'original');
  turns.observe({ t: 'turn.completed', turnId: 'original', outcome: 'done' });
  queue.push(message('ordinary owner input'));
  queue.end();
  const delivered: SDKUserMessage[] = [];
  for await (const input of queue) delivered.push(input);
  expect(delivered.map((input) => input.message.content)).toEqual(['ordinary owner input']);
});

it('rechecks an active-only input when an already waiting SDK iterator wakes', async () => {
  const turns = new ClaudeInterrupt();
  const queue = new InputQueue();
  const iterator = queue[Symbol.asyncIterator]();
  const waiting = iterator.next();
  turns.observe({ t: 'turn.started', turnId: 'original' });
  queue.push(message('context update'), () => turns.currentTurn === 'original');
  turns.observe({ t: 'turn.completed', turnId: 'original', outcome: 'done' });
  queue.end();
  expect(await waiting).toMatchObject({ done: true });
  expect(turns.currentTurn).toBeUndefined();
});

it('delivers within the original active turn and retires that marker on transport reset', async () => {
  const turns = new ClaudeInterrupt();
  const queue = new InputQueue();
  turns.observe({ t: 'turn.started', turnId: 'original' });
  queue.push(message('current update'), () => turns.currentTurn === 'original');
  const iterator = queue[Symbol.asyncIterator]();
  expect((await iterator.next()).value?.message.content).toBe('current update');
  queue.push(message('late update'), () => turns.currentTurn === 'original');
  turns.reset();
  turns.observe({ t: 'turn.started', turnId: 'another' });
  queue.end();
  expect(await iterator.next()).toMatchObject({ done: true });
});
