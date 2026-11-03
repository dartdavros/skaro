import { toolCatalog } from '@skaro/agent-runtime';
import type {
  BuiltinSessionPreparation,
  BuiltinSessionModelDependencies,
} from './builtin-session-models';
import type { ModelToolAdmission } from '@skaro/timeline';
import { prepareBuiltinTaskBrowser } from './builtin-task-browser';

/** Tool availability is derived from actual scoped hosts. Permission and evidence gates stay in runtime. */
export async function productSessionTools(
  deps: BuiltinSessionModelDependencies,
  input: BuiltinSessionPreparation,
) {
  const reads = new Set([
    'get_project_context',
    'get_c4_context',
    'read_task_history',
    'read_chat_history',
  ]);
  const catalog = deps.mcp.describe(input.scope);
  const operations = catalog.map((entry) => ({
    name: entry.name,
    readOnly: reads.has(entry.name),
  }));
  const extensions =
    input.scope.kind === 'task'
      ? await prepareBuiltinTaskBrowser(
          input,
          [
            'browser_navigate',
            'browser_snapshot',
            'browser_take_screenshot',
            'browser_console_messages',
            'browser_click',
            'browser_evaluate',
          ].map((name) => ({ name, readOnly: false })),
        )
      : undefined;
  const modelTools = [
    ...toolCatalog()
      .filter(
        (entry) =>
          input.scope.kind === 'task' ||
          ![
            'inspect_acceptance',
            'plan_checks',
            'assess_checks',
            'review_check_environment',
          ].includes(entry.name),
      )
      .map((entry) => ({
        name: entry.name,
        parameters: entry.inputSchema,
        description: entry.name,
      })),
    ...catalog.map((entry) => ({
      name: `mcp__skaro__${entry.name}`,
      parameters: entry.inputSchema,
      description: entry.description ?? entry.name,
    })),
    ...(extensions?.extensions.tools ?? []).map((entry) => ({
      name: entry.name,
      parameters: entry.inputSchema,
      description: entry.description ?? entry.name,
    })),
  ];
  const allowed = new Set(modelTools.map((item) => item.name));
  const tools: ModelToolAdmission = {
    revision: 'product-model-tools-v1',
    async requireAllowed(name, _args, signal) {
      signal?.throwIfAborted();
      if (!allowed.has(name)) throw new Error('Tool is outside the product session catalog');
    },
    projectResult: async (result) => result,
  };
  return { operations, modelTools, tools, ...(extensions ? { extensions } : {}) };
}
