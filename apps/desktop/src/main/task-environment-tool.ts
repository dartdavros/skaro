import type { SkaroScope, ToolResult } from '@skaro/mcp-server';
import { errorText } from './session-log';
import { EnvironmentUnavailable } from './task-environments';
import { key } from './task-run-helpers';
import { checkoutKey } from './task-stage';
import type { TaskRunEngine } from './task-run-engine';
import { ResourceAdmissionUnavailable } from './resource-manager';
import { EnvironmentNotDispatched } from './environment-dispatch-error';

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
    if (ctx.deps.coordinators) {
      await ctx.incidents
        .report(
          active,
          errorText(error),
          {
            cause: 'environment',
            code:
              error instanceof ResourceAdmissionUnavailable
                ? 'environment_waiting_resource'
                : 'environment_start_failed',
            condition: 'environment-ready',
          },
          'controller',
        )
        .catch((reportError: unknown) => {
          // A secondary diagnostic failure must not turn a known start failure into an unknown effect.
          ctx.history.notice(active, 'other', 'error', errorText(reportError));
        });
    }
    if (error instanceof ResourceAdmissionUnavailable)
      return {
        text: `Environment is waiting for measured resources: ${error.reason}. Skaro recorded the checkpoint and will recheck admission after releasing the worker. Do not retry in a loop or start substitute services.`,
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
        'If the output shows a defect in the task sources, fix it and retry. Otherwise use report_task_blocker ' +
        'with the exact failure, not a question asking the owner to do routine startup. Do not start ' +
        'substitute services or another copy.',
      isError: true,
    };
  }
}
