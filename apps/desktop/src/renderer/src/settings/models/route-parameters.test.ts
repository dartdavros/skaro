import { expect, it } from 'vitest';
import { effortParameters, withEffort, unsupportedEffort } from './route-parameters';

it('updates only explicit effort while preserving other parameters and invalid manual input', () => {
  const source = '{"max_tokens":2048,"temperature":0,"reasoning_effort":"low"}';
  expect(effortParameters(withEffort(source, 'max'))).toEqual({
    max_tokens: 2048,
    temperature: 0,
    reasoning_effort: 'max',
  });
  expect(effortParameters(withEffort(source, ''))).toEqual({ max_tokens: 2048, temperature: 0 });
  for (const text of ['{', 'null', '[]', '"manual"']) {
    expect(effortParameters(text)).toBeUndefined();
    expect(withEffort(text, 'high')).toBe(text);
  }
});

it('rejects explicitly unadvertised effort without rejecting an unavailable catalog or rewriting JSON', () => {
  const model = { reasoning: { supportedEfforts: ['low'] } };
  const text = '{"max_tokens":1024,"reasoning_effort":"high"}';
  expect(unsupportedEffort(model, text)).toBe(true);
  expect(unsupportedEffort(model, withEffort(text, 'low'))).toBe(false);
  expect(unsupportedEffort(undefined, text)).toBe(false);
  expect(unsupportedEffort({}, text)).toBe(true);
  expect(unsupportedEffort(model, '{')).toBe(false);
  expect(effortParameters(text)?.reasoning_effort).toBe('high');
});
