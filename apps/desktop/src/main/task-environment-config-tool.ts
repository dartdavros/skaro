import type { ConfigureEnvironmentArgs, SkaroScope, ToolResult } from '@skaro/mcp-server';
import { errorText } from './session-log';
import { checkoutKey } from './task-stage';
import type { TaskRunEngine } from './task-run-engine';

/** Called behind taskTool's current-session and handoff guard. */
export async function configureTaskEnvironment(
  ctx: TaskRunEngine,
  args: ConfigureEnvironmentArgs,
  scope: SkaroScope,
): Promise<ToolResult> {
  try {
    const active = ctx.requireActive(scope.projectId, scope.taskId!);
    const config = await ctx.environments.configure(checkoutKey(active), args);
    return {
      text:
        JSON.stringify(config, null, 2) +
        '\n\n' +
        (args.start === undefined && args.ports === undefined && args.source === undefined
          ? 'Include required documented services with start and expected_start. For documented ' +
            'host access add port variable names with ports and expected_ports; Skaro chooses numbers. ' +
            'Test/admin services used through exec need no host port. If data copying needs stopped main-checkout ' +
            'services, declare source {project, services} and expected_source (the current source or null). ' +
            'Skaro starts only these existing containers, without creating or resetting source data. ' +
            'Do this routine preparation yourself through Skaro.'
          : 'Skaro saved the configuration for this environment. Services have not been started ' +
            'by this call. Call start_environment now, then verify the required services and tests.'),
    };
  } catch (error) {
    return { text: `Cannot configure this task environment: ${errorText(error)}`, isError: true };
  }
}
