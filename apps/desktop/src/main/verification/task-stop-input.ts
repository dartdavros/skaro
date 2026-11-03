import assert from 'node:assert/strict';
import type { ChatRequest, UserInput } from '@skaro/timeline';
import { taskAgentInput } from '../task-agent-input';
import type { TaskStopReview } from './task-stop-review';

type InputPolicy = Pick<TaskStopReview, 'attemptId'> & {
  wireComposition: Pick<TaskStopReview['wireComposition'], 'ownerMessages'>;
};

export function taskStopOwnerInput(reviewed: InputPolicy, index: number, round = 0) {
  assert(index === 0 || index === 1);
  assert(round === 0 || round === 1);
  const commandId = `task-stop-${reviewed.attemptId}-${index === 0 ? 'first' : 'second'}${round ? '-retry-1' : ''}`;
  return { commandId, text: reviewed.wireComposition.ownerMessages[index]! };
}

export function requireTaskStopInput(
  reviewed: InputPolicy,
  index: number,
  id: string,
  input: UserInput,
  round = 0,
) {
  const owner = taskStopOwnerInput(reviewed, index, round);
  assert.equal(id, `input-${owner.commandId}`);
  assert.deepEqual(input, taskAgentInput(owner));
}

export function requireTaskStopInputs(
  reviewed: InputPolicy,
  inputs: readonly { id: string; input: UserInput }[],
) {
  const restart = taskStopMainRestartInput(reviewed);
  if (inputs.at(-1)?.id === `input-${restart.commandId}`) {
    assert.equal(inputs.length, 4);
    assert.deepEqual(inputs.at(-1)?.input, taskAgentInput(restart));
    return requireTaskStopInputs(reviewed, inputs.slice(0, -1));
  }
  const retry = inputs.some((input) => input.id.endsWith('-retry-1'));
  const sequence = retry
    ? [
        [0, 0],
        [0, 1],
        [1, 1],
      ]
    : [
        [0, 0],
        [1, 0],
      ];
  assert(inputs.length >= 1 && inputs.length <= sequence.length);
  inputs.forEach((input, index) => {
    const [phase, round] = sequence[index]!;
    requireTaskStopInput(reviewed, phase!, input.id, input.input, round!);
  });
}

export function taskStopMainRestartInput(reviewed: InputPolicy) {
  return {
    commandId: `task-stop-${reviewed.attemptId}-second-after-main-restart`,
    text: reviewed.wireComposition.ownerMessages[1],
  };
}

/** Chat loop may explicitly retain an absent optional choice; no wire choice is authorized. */
export function requireTaskStopRequest(request: ChatRequest, expected: ChatRequest) {
  const { toolChoice, ...body } = request;
  assert.equal(toolChoice, undefined);
  assert.deepEqual(body, expected);
}
