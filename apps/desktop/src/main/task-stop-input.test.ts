import { describe, expect, it } from 'vitest';
import type { ChatRequest, UserInput } from '@skaro/timeline';
import { withSkaroNote } from '@skaro/timeline';
import { taskAgentInput } from './task-agent-input';
import { longContextConfig } from './credentials/long-context-config';
import { TASK_STOP_MESSAGES } from './verification/task-stop-review';
import {
  requireTaskStopInput,
  requireTaskStopRequest,
  taskStopOwnerInput,
  requireTaskStopInputs,
  taskStopMainRestartInput,
} from './verification/task-stop-input';

// Pure input/request DTO contracts. No primary journal, task/run or provider is manufactured.
const policy = {
  attemptId: '4806ca85-4723-4828-87c3-69b56a0baae9' as const,
  wireComposition: { ownerMessages: TASK_STOP_MESSAGES },
};

describe('reviewed task Stop envelope', () => {
  it('bounds a reviewed-message retry to one genuine prior first input and one new pair', () => {
    const input = (phase: number, round: number) => {
      const owner = taskStopOwnerInput(policy, phase, round);
      return { id: `input-${owner.commandId}`, input: taskAgentInput(owner) };
    };
    const first = input(0, 0),
      retry = input(0, 1),
      second = input(1, 1);
    expect(() => requireTaskStopInputs(policy, [first, retry])).not.toThrow();
    expect(() => requireTaskStopInputs(policy, [first, retry, second])).not.toThrow();
    const restart = taskStopMainRestartInput(policy);
    const restarted = { id: `input-${restart.commandId}`, input: taskAgentInput(restart) };
    expect(() => requireTaskStopInputs(policy, [first, retry, second, restarted])).not.toThrow();
    expect(() =>
      requireTaskStopInputs(policy, [first, retry, second, restarted, restarted]),
    ).toThrow();
    for (const value of [
      [retry],
      [first, second],
      [first, retry, second, second],
      [first, input(1, 0), retry],
    ])
      expect(() => requireTaskStopInputs(policy, value)).toThrow();
    expect(() => taskStopOwnerInput(policy, 0, 2)).toThrow();
  });
  it('accepts only the exact command identity, note and owner text for the current attempt/phase', () => {
    const owner = taskStopOwnerInput(policy, 0);
    const input = taskAgentInput(owner);
    const id = `input-${owner.commandId}`;
    expect(() => requireTaskStopInput(policy, 0, id, input)).not.toThrow();
    for (const changed of [
      { ...input, text: withSkaroNote('unreviewed extra data', owner.text) },
      { ...input, text: `${input.text}\nextra data` },
      { ...input, images: ['C:/owner/attachment.png'] },
      { ...input, privateText: 'inbox-reference' },
    ])
      expect(() => requireTaskStopInput(policy, 0, id, changed as UserInput)).toThrow();
    expect(() => requireTaskStopInput(policy, 0, `${id}-other`, input)).toThrow();
    expect(() => requireTaskStopInput(policy, 1, id, input)).toThrow();
    expect(() => taskStopOwnerInput(policy, 2)).toThrow();
  });
  it('accepts an absent optional tool choice while rejecting any real choice or extra wire data', () => {
    const expected: ChatRequest = {
      route: longContextConfig(process.cwd()).route,
      messages: [{ role: 'user', content: TASK_STOP_MESSAGES[0] }],
      price: { prompt: 0.5, completion: 2, request: 0 },
      tools: [],
    };
    expect(() => requireTaskStopRequest(expected, expected)).not.toThrow();
    expect(() =>
      requireTaskStopRequest({ ...expected, toolChoice: undefined }, expected),
    ).not.toThrow();
    for (const changed of [
      { ...expected, toolChoice: 'required' },
      { ...expected, toolChoice: 'none' },
      { ...expected, extra: 'unreviewed' },
      { ...expected, tools: undefined },
      { ...expected, messages: [...expected.messages, { role: 'user', content: 'extra' }] },
    ])
      expect(() => requireTaskStopRequest(changed as ChatRequest, expected)).toThrow();
  });
});
