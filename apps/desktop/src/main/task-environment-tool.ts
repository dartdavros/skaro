import type { SkaroScope, ToolResult } from '@skaro/mcp-server';
import { errorText } from './session-log';
import { EnvironmentUnavailable } from './task-environments';
import { key } from './task-run-helpers';
import type { TaskRunEngine } from './task-run-engine';

/** `start_environment`: the agent of a task asks Skaro for running services. */
export async function startTaskEnvironment(
  ctx: TaskRunEngine,
  scope: SkaroScope,
): Promise<ToolResult> {
  if (!scope.taskId)
    return { text: 'start_environment works only in a task session.', isError: true };
  const active = ctx.active.get(key(scope.projectId, scope.taskId));
  if (!active || active.run.id !== scope.runId) {
    return { text: 'This session is no longer the current run of the task.', isError: true };
  }
  try {
    const info = await ctx.environments.start(active);
    const urls = Object.entries(info.urls).map(([name, url]) => `- ${name}: ${url}`);
    return {
      text:
        `The environment ${info.name} is running and ready.\n` +
        (urls.length ? `${urls.join('\n')}\n` : '') +
        'It is a disposable copy of the main environment: sign in with the existing accounts ' +
        'the project documents, and change its data freely. COMPOSE_PROJECT_NAME and the ' +
        "environment's variables are set in your shell, so `docker compose ps`, `logs` and " +
        '`exec` address it. Name these addresses in your verification result.',
    };
  } catch (error) {
    if (error instanceof EnvironmentUnavailable) {
      return {
        text:
          `Skaro cannot start an environment for this task: ${error.message} ` +
          'Report this to the user as a blocker; do not start substitute services.',
        isError: true,
      };
    }
    return {
      text:
        `The environment did not start:\n${errorText(error)}\n\n` +
        'If the output shows a defect in the task sources, fix it and call start_environment ' +
        'again. Otherwise report the exact failure to the user as a blocker; do not start ' +
        'substitute services or another copy.',
      isError: true,
    };
  }
}
