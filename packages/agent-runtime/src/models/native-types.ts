import type { NativeCall, NativeToolResult, NativeRequest, NativeResponse } from '@skaro/timeline';
export type { NativeCall, NativeToolResult, NativeRequest, NativeResponse } from '@skaro/timeline';

export function requireToolResults(
  calls: readonly NativeCall[],
  results: readonly NativeToolResult[],
): void {
  if (
    !calls.length ||
    new Set(calls.map((call) => call.id)).size !== calls.length ||
    new Set(results.map((result) => result.id)).size !== results.length ||
    results.length !== calls.length ||
    results.some((result) => !calls.some((call) => call.id === result.id))
  )
    throw new Error('Native tool result identities do not match the response');
}
export function requireSameRoute(request: NativeRequest, response: NativeResponse): void {
  if (JSON.stringify(request.route) !== JSON.stringify(response.provenance.route))
    throw new Error('Native continuation cannot cross routes');
}
