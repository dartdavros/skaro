import { expect, it } from 'vitest';
import { toolCatalog } from '@skaro/agent-runtime';
import { admittedChatTools } from '../../../../packages/agent-runtime/src/models/model-tools';

const catalogue = toolCatalog().map(({ name, inputSchema }) => ({
  name,
  description: name,
  parameters: inputSchema,
}));

it('can narrow a real tool catalogue without changing the reviewed schemas', () => {
  const before = JSON.stringify(catalogue);
  expect(
    admittedChatTools(catalogue, {
      selectChatTools: (tools) => tools.filter((tool) => tool.name === 'inspect_acceptance'),
    })?.map((tool) => tool.name),
  ).toEqual(['inspect_acceptance']);
  expect(admittedChatTools(catalogue, { selectChatTools: () => [] })).toEqual([]);
  expect(admittedChatTools(catalogue)).toBe(catalogue);
  expect(JSON.stringify(catalogue)).toBe(before);
});

it('rejects duplicate or changed tools rather than expanding a model phase', () => {
  expect(() =>
    admittedChatTools(catalogue, {
      selectChatTools: (tools) => [tools[0]!, tools[0]!],
    }),
  ).toThrow('only narrow');
  expect(() =>
    admittedChatTools(catalogue, {
      selectChatTools: (tools) => [{ ...tools[0]!, name: 'unadmitted_tool' }],
    }),
  ).toThrow('only narrow');
  expect(() =>
    admittedChatTools(catalogue, {
      selectChatTools: (tools) => [{ ...tools[0]!, parameters: { type: 'object' } }],
    }),
  ).toThrow('only narrow');
});
