import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';

export interface SetupEnvironmentArgs {
  environment: Record<string, unknown>;
  expectedRevision: string;
}

const stringMap = { type: 'object', additionalProperties: { type: 'string' } };
const names = { type: 'array', items: { type: 'string' }, uniqueItems: true };
export function setupEnvironmentTool(
  handler: (args: SetupEnvironmentArgs | undefined, scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  const available = (scope: SkaroScope) =>
    (scope.kind === 'project_chat' && !!scope.chatId && !scope.importId) ||
    (scope.kind === 'task' && !!scope.taskId && !!scope.runId);
  return {
    name: 'setup_environment',
    description:
      'Read the project environment and revision with no arguments. If absent, inspect the real ' +
      'project documentation, Compose/dev and data-copy scripts, then register its complete initial ' +
      'environment with environment and expected_revision. This writes only the environment section ' +
      'of the main project config through Skaro; it never edits source code or starts services. ' +
      'Existing environments cannot be replaced here. Use configure_environment for task overrides. ' +
      'Use {name}, {root}, {worktree} and declared port placeholders; Skaro owns COMPOSE_PROJECT_NAME ' +
      'and allocates ports. create copies real main data into isolated task data, never seeds or resets ' +
      'the source. start must build/restart the real services, run documented migrations and wait for ' +
      'dependencies. ready is an optional HTTP readiness URL that covers database/cache, not just liveness. ' +
      'Do not invent scripts, services, credentials or data. Follow owner restrictions. Saving is not ' +
      'verification: in the task call start_environment and verify required services before implementation ' +
      'that depends on them. In project chat report saved but unverified until a task verifies the launch. ' +
      'Do routine authorized setup yourself; do not ask the owner to manually edit .skaro/config.yaml.',
    inputSchema: {
      type: 'object',
      properties: {
        expected_revision: { type: 'string', description: 'Revision from the preceding read.' },
        environment: {
          type: 'object',
          properties: {
            start: { type: 'string', minLength: 1 },
            create: { type: 'string', minLength: 1 },
            ready: { type: 'string', minLength: 1 },
            ports: names,
            env: stringMap,
            urls: stringMap,
            source: {
              type: 'object',
              properties: { project: { type: 'string' }, services: { ...names, minItems: 1 } },
              required: ['project', 'services'],
              additionalProperties: false,
            },
          },
          required: ['start', 'ports', 'env', 'urls'],
          additionalProperties: false,
        },
      },
      additionalProperties: false,
    },
    available,
    call: async (args, scope) => {
      if (!available(scope))
        return {
          text: 'setup_environment requires a project chat or current task.',
          isError: true,
        };
      if (!Object.keys(args).length) return handler(undefined, scope);
      if (
        !args['environment'] ||
        typeof args['environment'] !== 'object' ||
        Array.isArray(args['environment']) ||
        typeof args['expected_revision'] !== 'string'
      )
        return {
          text: 'Provide environment and expected_revision from setup_environment together.',
          isError: true,
        };
      return handler(
        {
          environment: args['environment'] as Record<string, unknown>,
          expectedRevision: args['expected_revision'],
        },
        scope,
      );
    },
  };
}
