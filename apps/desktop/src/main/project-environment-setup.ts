import type { SetupEnvironmentArgs, SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { Projects } from './projects';
import { errorText } from './session-log';

/** Caller authorization stays at the chat/task boundary; storage validates and compares the revision. */
export async function setupProjectEnvironment(
  projects: Projects,
  args: SetupEnvironmentArgs | undefined,
  scope: SkaroScope,
): Promise<ToolResult> {
  try {
    const context = projects.get(scope.projectId);
    const result = await context.store.setupEnvironment(args);
    if (args) context.invalidate(['config.yaml']);
    return {
      text:
        JSON.stringify(result, null, 2) +
        '\n\n' +
        (args
          ? 'Project environment saved. No services were started or verified. In the task call ' +
            'start_environment, then check real services, migrations and required tests before dependent implementation.'
          : result.environment
            ? 'Project environment exists. Tasks can read or adjust their overrides with configure_environment.'
            : 'No project environment exists. Inspect the real documented setup and call setup_environment ' +
              'with environment and expected_revision from this read. Do not edit .skaro directly or start substitute services.'),
    };
  } catch (error) {
    return { text: `Cannot set up project environment: ${errorText(error)}`, isError: true };
  }
}
