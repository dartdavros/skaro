import { expect, it } from 'vitest';
import { liveFailure } from './live-diagnostics';

it('retains stage and bounded HTTP/OS diagnostic fields', () => {
  expect(liveFailure('credential-limits', { name: 'Error', status: 403, code: 12 })).toEqual({
    type: 'failed',
    stage: 'credential-limits',
    name: 'Error',
    status: 403,
    code: 12,
  });
});

it('does not expose arbitrary credential-consumer error fields or names', () => {
  const privateText = 'private consumer detail';
  const result = liveFailure('credential-limits', {
    name: privateText,
    message: privateText,
    stack: privateText,
    cause: privateText,
    code: privateText,
    status: Infinity,
  });
  expect(JSON.stringify(result)).not.toContain(privateText);
  expect(result).toEqual({
    type: 'failed',
    stage: 'credential-limits',
    name: 'Error',
    code: undefined,
    status: undefined,
  });
  expect(liveFailure('credential', null).name).toBe('Error');
});
