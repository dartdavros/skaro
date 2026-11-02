import { isDeepStrictEqual } from 'node:util';
import { toolCatalog } from '@skaro/agent-runtime';
import type { ModelTool, RuntimeExtensionHost } from '@skaro/timeline';

/** Schemas come from the actual runtime/extension registry. A catalogue is never execution permission. */
export function configuredTaskTools(
  selected: readonly ModelTool[],
  extensions: Pick<RuntimeExtensionHost, 'tools'>,
): readonly ModelTool[] {
  const available = [
    ...toolCatalog(),
    ...extensions.tools.map(({ name, inputSchema }) => ({ name, inputSchema })),
  ];
  if (
    !Array.isArray(selected) ||
    selected.length > 128 ||
    new Set(selected.map((tool) => tool.name)).size !== selected.length ||
    selected.some(
      (tool) =>
        !available.some(
          (entry) =>
            entry.name === tool.name && isDeepStrictEqual(entry.inputSchema, tool.parameters),
        ),
    )
  )
    throw new Error('Task model tools must narrow the actual runtime catalogue');
  return structuredClone(selected);
}
