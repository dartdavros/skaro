import type { Tool, ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';

export interface ConfigureEnvironmentArgs {
  source?: { project: string; services: string[] };
  expectedSource?: { project: string; services: string[] } | null;
  start?: string;
  expectedStart?: string;
  ports?: string[];
  expectedPorts?: string[];
}

/** Read or update the launch command of the caller's own managed environment. */
export function configureEnvironmentTool(
  handler: (args: ConfigureEnvironmentArgs, scope: SkaroScope) => Promise<ToolResult>,
): Tool<SkaroScope> {
  return {
    name: 'configure_environment',
    description:
      'Read this task environment configuration with no arguments. To change its launch ' +
      'command, pass start and expected_start (the current command returned by this tool). ' +
      'Use this to include a documented service needed for the authorized task, such as a ' +
      'test/admin backend. Skaro saves the command only for this task environment (shared ' +
      'by tasks in a legacy stage checkout); project defaults and other environments stay ' +
      'unchanged. This does not start services: call start_environment afterwards and verify ' +
      'the required service with docker compose ps/exec. Do not ask the user to edit settings ' +
      'by hand. For new documented host access, pass ports (variable names, never numbers) ' +
      'and expected_ports (the current list). Skaro allocates unique ports automatically. ' +
      'Services without allocated host ports remain internal and usable through compose exec. ' +
      'If copying task data needs stopped services of the main checkout, declare source ' +
      '{project, services} and expected_source (the current source, or null). Read the real ' +
      'clone script and Docker labels to identify them. Skaro starts only existing containers ' +
      'belonging to that main checkout, waits for health and never creates or resets source data. ' +
      'Preserve the environment name, existing ports, data, services and readiness; ' +
      'use only the real project setup. Owner restrictions still apply.',
    inputSchema: {
      type: 'object',
      properties: {
        source: {
          type: 'object',
          properties: {
            project: { type: 'string' },
            services: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
          required: ['project', 'services'],
          additionalProperties: false,
        },
        expected_source: {
          type: ['object', 'null'],
          properties: {
            project: { type: 'string' },
            services: { type: 'array', items: { type: 'string' }, minItems: 1 },
          },
          required: ['project', 'services'],
          additionalProperties: false,
          description: 'Previously read source configuration, or null when absent.',
        },
        start: { type: 'string', description: 'Complete replacement launch command.' },
        expected_start: { type: 'string', description: 'Previously read current launch command.' },
        ports: {
          type: 'array',
          items: { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_]*$' },
          description: 'Port variables to add for documented host access; Skaro chooses numbers.',
        },
        expected_ports: {
          type: 'array',
          items: { type: 'string' },
          description: 'Previously read full ports list.',
        },
      },
      additionalProperties: false,
    },
    available: (scope) =>
      (scope.kind === 'task' || scope.kind === 'integration') && scope.taskId !== undefined,
    call: async (args, scope) => {
      if ((scope.kind !== 'task' && scope.kind !== 'integration') || !scope.taskId)
        return { text: 'configure_environment works only in a task session.', isError: true };
      if (Object.keys(args).length === 0) return handler({}, scope);
      const changes: ConfigureEnvironmentArgs = {};
      if (args['source'] !== undefined || args['expected_source'] !== undefined) {
        const source = (
          value: unknown,
        ): value is NonNullable<ConfigureEnvironmentArgs['source']> => {
          if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
          const candidate = value as Record<string, unknown>;
          return (
            typeof candidate['project'] === 'string' &&
            /^[a-z0-9][a-z0-9_-]*$/.test(candidate['project']) &&
            Array.isArray(candidate['services']) &&
            candidate['services'].length > 0 &&
            candidate['services'].every(
              (name) => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(name),
            )
          );
        };
        if (
          !source(args['source']) ||
          (args['expected_source'] !== null && !source(args['expected_source']))
        )
          return {
            text: 'Provide source and expected_source together; source names existing main-checkout services.',
            isError: true,
          };
        changes.source = args['source'];
        changes.expectedSource = args[
          'expected_source'
        ] as ConfigureEnvironmentArgs['expectedSource'];
      }
      if (args['start'] !== undefined || args['expected_start'] !== undefined) {
        if (
          typeof args['start'] !== 'string' ||
          !args['start'].trim() ||
          typeof args['expected_start'] !== 'string' ||
          !args['expected_start'].trim()
        ) {
          return { text: 'Provide non-empty start and expected_start together.', isError: true };
        }
        changes.start = args['start'].trim();
        changes.expectedStart = args['expected_start'];
      }
      if (args['ports'] !== undefined || args['expected_ports'] !== undefined) {
        const names = (value: unknown): value is string[] =>
          Array.isArray(value) &&
          value.every((name) => typeof name === 'string' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
        if (!names(args['ports']) || !names(args['expected_ports']))
          return {
            text: 'Provide ports and expected_ports as lists of variable names.',
            isError: true,
          };
        changes.ports = args['ports'];
        changes.expectedPorts = args['expected_ports'];
      }
      return handler(changes, scope);
    },
  };
}
