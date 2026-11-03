import { expect, it } from 'vitest';
import { toolCatalog } from '@skaro/agent-runtime';
import { admittedChatTools } from '../../../../packages/agent-runtime/src/models/model-tools';

const catalogue = toolCatalog().map(({ name, inputSchema }) => ({
  name,
  description: name,
  parameters: inputSchema,
}));

it('can asynchronously narrow a real tool catalogue without changing reviewed schemas', async () => {
  const before = JSON.stringify(catalogue);
  expect(
    (
      await admittedChatTools(catalogue, {
        selectChatTools: async (tools) =>
          tools.filter((tool) => tool.name === 'inspect_acceptance'),
      })
    )?.map((tool) => tool.name),
  ).toEqual(['inspect_acceptance']);
  expect(await admittedChatTools(catalogue, { selectChatTools: () => [] })).toEqual([]);
  expect(await admittedChatTools(catalogue)).toBe(catalogue);
  expect(JSON.stringify(catalogue)).toBe(before);
});

it('rejects duplicate or changed tools rather than expanding a model phase', async () => {
  await expect(
    admittedChatTools(catalogue, {
      selectChatTools: async (tools) => [tools[0]!, tools[0]!],
    }),
  ).rejects.toThrow('only narrow');
  await expect(
    admittedChatTools(catalogue, {
      selectChatTools: (tools) => [{ ...tools[0]!, name: 'unadmitted_tool' }],
    }),
  ).rejects.toThrow('only narrow');
  await expect(
    admittedChatTools(catalogue, {
      selectChatTools: (tools) => [{ ...tools[0]!, parameters: { type: 'object' } }],
    }),
  ).rejects.toThrow('only narrow');
});
