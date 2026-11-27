import type { SkaroScope, ToolResult } from '@skaro/mcp-server';
import { errorText } from './session-log';
import { EnvironmentUnavailable } from './task-environments';
import { key } from './task-run-helpers';
import { checkoutKey } from './task-stage';
import type { TaskRunEngine } from './task-run-engine';
import { ResourceAdmissionUnavailable } from './resource-manager';
import { EnvironmentNotDispatched } from './environment-dispatch-error';
import { inPlaceEnvironmentResult } from './task-environment-mode';
import { isTaskParked } from '@skaro/core';

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
  const task = await ctx.project(scope.projectId).store.readTask(scope.taskId);
  if (isTaskParked(task.status))
    return {
      text: 'Call resume_task with the current owner instruction before starting services.',
      isError: true,
    };
  const shared = inPlaceEnvironmentResult(ctx.project(scope.projectId).root, active.run);
  if (shared) return shared;
  try {
    const info = await ctx.environments.start(checkoutKey(active), { waitForResources: false });
    const { variables } = await ctx.environments.describe(checkoutKey(active));
    ctx.continuation.execution(active).clearBlock();
    const urls = Object.entries(info.urls).map(([name, url]) => `- ${name}: ${url}`);
    return {
      text:
        `The environment ${info.name} is running and ready.\n` +
        (urls.length ? `${urls.join('\n')}\n` : '') +
        (info.portBindings
          ? `Allocated host access: ${JSON.stringify(info.portBindings)}. ` +
            'Other services are internal; use docker compose exec for tests.\n'
          : '') +
        'It is a disposable copy of the main environment: sign in with the existing accounts ' +
        'the project documents, and change its data freely. Apply the following current environment ' +
        'variables to every shell command used for verification (compose ps/logs/exec). An already ' +
        'attached shell may predate initial setup or port changes. Do not reuse stale bindings.\n' +
        `shell_environment: ${JSON.stringify(variables)}\n` +
        'Use the addresses returned by this call for host access; a port ' +
        'may have been replaced since the shell was attached. Name these addresses in your verification result.',
    };
  } catch (failure) {
    const error = failure instanceof EnvironmentNotDispatched ? failure.cause : failure;
    if (error instanceof ResourceAdmissionUnavailable)
      return {
        text: `Environment cannot acquire its current ownership lock: ${error.reason}. Wait for the existing owner or cleanup to settle. Do not retry in a loop or start substitute services.`,
        isError: true,
      };
    if (error instanceof EnvironmentUnavailable) {
      return {
        text:
          `Skaro cannot start an environment for this task: ${error.message} ` +
          'If the project environment is absent, read setup_environment and register the documented real setup, ' +
          'then retry start_environment. Report an actual missing prerequisite as a blocker; do not start substitute services.',
        isError: true,
      };
    }
    return {
      text:
        `The environment did not start:\n${errorText(error)}\n\n` +
        'If copying needs stopped main-checkout services, read the clone script and existing Docker labels, ' +
        'declare source with configure_environment (source/expected_source), and call start_environment again. ' +
        'Skaro starts only existing declared containers and waits for health; no source data or accounts are created or reset. ' +
        'If the output shows a defect in the task sources, fix it and retry. If the known repair ' +
        'requires separate owner consent, immediately ask for that exact permission through the ' +
        'structured question tool and wait. Repair documented inputs in the task checkout yourself. ' +
        'For an external prerequisite, report the exact missing input and evidence. ' +
        'Do not start substitute services or another copy.',
      isError: true,
    };
  }
}
