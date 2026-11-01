import type { Tool } from './server.ts';

/** Metadata from the registered handlers; no invocation, grant, process or task state change. */
export function operationCatalogue<S>(tools: readonly Tool<S>[], scope: S) {
  return tools
    .filter((tool) => !tool.available || tool.available(scope))
    .map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: structuredClone(tool.inputSchema),
    }));
}
