import { expect, it } from 'vitest';
import { operationFailure } from './tool-failure.ts';

it('distinguishes rejected arguments from operational failures while retaining the original evidence', () => {
  const error = new Error('Unable to open the real project checkout');
  const result = operationFailure(error, 'review_c4');
  expect(result).toMatchObject({
    text: error.message,
    isError: true,
    structuredContent: {
      failure: { category: 'service_error', operation: 'review_c4', message: error.message },
    },
  });
  expect(
    operationFailure('revision must be an integer', 'review_c4', 'invalid_arguments')
      .structuredContent,
  ).toMatchObject({ failure: { category: 'invalid_arguments' } });
  expect(result.structuredContent).not.toHaveProperty('diagnostic');
});
