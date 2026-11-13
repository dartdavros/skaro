import { expect, it } from 'vitest';
import { incidentFailure } from './incident-failure';
it('keeps provider limits, spend, context, authentication and progress failures distinct', () => {
  for (const [code, cause] of [
    ['rate_limit', 'rate-limit'],
    ['insufficient_quota', 'quota'],
    ['budget_exceeded', 'budget'],
    ['context_length_exceeded', 'context'],
    ['authentication_error', 'authentication'],
    ['no_progress', 'no-progress'],
  ])
    expect(incidentFailure({ code, message: 'The request failed' }).cause).toBe(cause);
  expect(incidentFailure(new Error('Unknown failure')).cause).toBe('external');
});
