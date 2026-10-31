import type { ModelResponseProvenance, RouteSnapshot } from '@skaro/timeline';
import type { ModelTool } from './chat-types.ts';

export interface NativeRequest {
  context?: import('../context/request.ts').ContextSelection;
  route: RouteSnapshot;
  /** Provider-native items/messages, preserved as JSON rather than flattened display text. */
  input: readonly Record<string, unknown>[];
  tools?: readonly ModelTool[];
  system?: string;
}
export interface NativeCall {
  id: string;
  name: string;
  arguments: unknown;
}
export interface NativeToolResult {
  id: string;
  text: string;
  isError?: boolean;
}
export interface NativeResponse {
  output: Record<string, unknown>[];
  events: Record<string, unknown>[];
  calls: NativeCall[];
  provenance: ModelResponseProvenance;
}

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
