import { expect, it } from 'vitest';
import { OPENROUTER_EFFORTS, openRouterEfforts } from '@skaro/agent-runtime/openrouter-effort';

// Pure DTO contracts; no API response or substituted provider.
it('distinguishes omitted, unrestricted and mandatory effort metadata without inventing defaults', () => {
  expect(openRouterEfforts()).toEqual([]);
  expect(openRouterEfforts({})).toEqual([]);
  expect(openRouterEfforts({ reasoning: {} })).toEqual([]);
  expect(openRouterEfforts({ reasoning: { supportedEfforts: null } })).toEqual([
    ...OPENROUTER_EFFORTS,
  ]);
  expect(
    openRouterEfforts({ reasoning: { supportedEfforts: null, mandatory: true } }),
  ).not.toContain('none');
  expect(
    openRouterEfforts({ reasoning: { supportedEfforts: ['high', 'low', 'future-value'] } }),
  ).toEqual(['low', 'high']);
  expect(openRouterEfforts({ reasoning: { supportedEfforts: [], defaultEffort: 'high' } })).toEqual(
    [],
  );
});
