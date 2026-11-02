import { expect, it } from 'vitest';
import { toolCatalog } from '@skaro/agent-runtime';
import { configuredTaskTools } from './builtin-model-tools';

it('selects real runtime schemas without introducing tools or permitting schema substitution', () => {
  const real = toolCatalog().find((entry) => entry.name === 'read_file')!;
  const selected = [{ name: real.name, description: real.name, parameters: real.inputSchema }];
  const actual = configuredTaskTools(selected, { tools: [] });
  expect(actual).toEqual(selected);
  expect(actual).not.toBe(selected);
  actual[0]!.parameters.properties = {};
  expect(toolCatalog().find((entry) => entry.name === real.name)!.inputSchema).toEqual(
    real.inputSchema,
  );
  expect(configuredTaskTools([], { tools: [] })).toEqual([]);
  for (const invalid of [
    [...selected, ...selected],
    [{ ...selected[0]!, name: 'unknown_handler' }],
    [{ ...selected[0]!, parameters: { type: 'object', additionalProperties: true } }],
  ])
    expect(() => configuredTaskTools(invalid, { tools: [] })).toThrow('actual runtime catalogue');
});
