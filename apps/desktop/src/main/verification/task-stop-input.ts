import assert from 'node:assert/strict';
import type { ChatRequest, UserInput } from '@skaro/timeline';
import { taskAgentInput } from '../task-agent-input';
import type { TaskStopReview } from './task-stop-review';

type InputPolicy = Pick<TaskStopReview, 'attemptId'> & {
  wireComposition: Pick<TaskStopReview['wireComposition'], 'ownerMessages'>;
};

export function taskStopOwnerInput(reviewed: InputPolicy, index: number) {
  assert(index === 0 || index === 1);
  const commandId = `task-stop-${reviewed.attemptId}-${index === 0 ? 'first' : 'second'}`;
  return { commandId, text: reviewed.wireComposition.ownerMessages[index]! };
}

export function requireTaskStopInput(
  reviewed: InputPolicy,
  index: number,
  id: string,
  input: UserInput,
) {
  const owner = taskStopOwnerInput(reviewed, index);
  assert.equal(id, `input-${owner.commandId}`);
  assert.deepEqual(input, taskAgentInput(owner));
}

/** Chat loop may explicitly retain an absent optional choice; no wire choice is authorized. */
export function requireTaskStopRequest(request: ChatRequest, expected: ChatRequest) {
  const { toolChoice, ...body } = request;
  assert.equal(toolChoice, undefined);
  assert.deepEqual(body, expected);
}
