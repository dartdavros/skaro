import type { ToolResult } from './server.ts';

/** Operational exceptions and rejected arguments carry distinct, transport-neutral categories. */
export function operationFailure(
  error: unknown,
  operation: string,
  category: 'service_error' | 'invalid_arguments' = 'service_error',
): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return {
    text: message,
    isError: true,
    structuredContent: {
      failure: {
        category,
        operation,
        message,
        nextStep:
          category === 'invalid_arguments'
            ? 'Correct the tool arguments against its schema and retry.'
            : 'Inspect the operation error and actual environment. Preserve the original failure as evidence; an operational exception alone does not identify a Skaro implementation defect.',
      },
    },
  };
}
