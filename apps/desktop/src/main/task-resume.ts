import { assertQuestionsAnswered, type TimelineState } from '@skaro/timeline';
import type { ToolResult } from '@skaro/mcp-server';
import type { TaskExecution } from './task-execution';
import { awaitsDecision } from './task-wait-card';

export function resumeTaskExecution(
  execution: TaskExecution,
  state: TimelineState,
  commandId: string,
  instruction: string,
): ToolResult {
  assertQuestionsAnswered(state);
  if (awaitsDecision(state))
    return { text: 'Answer the pending proposal before continuing.', isError: true };
  return execution.resume(commandId, instruction)
    ? { text: 'Task execution resumed for the current owner instruction.' }
    : {
        text: 'No matching current owner instruction. Answer the message and stop.',
        isError: true,
      };
}
