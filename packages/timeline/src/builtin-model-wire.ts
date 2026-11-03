import type { ModelResponseProvenance, RouteSnapshot } from './builtin-model.ts';

export interface ModelContextSelection {
  revision: string;
  epoch: number;
}
export interface ModelTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ChatToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ChatToolCall[];
  reasoning?: string;
  reasoning_content?: string;
  reasoning_details?: Record<string, unknown>[];
  refusal?: string;
}
export interface ChatRequest {
  context?: ModelContextSelection;
  route: RouteSnapshot;
  messages: readonly ChatMessage[];
  tools?: readonly ModelTool[];
  toolChoice?: 'auto' | 'required' | 'none';
  price: { prompt: number; completion: number; request?: number };
}
export interface ChatResponse {
  message: ChatMessage;
  native: Record<string, unknown>[];
  provenance: ModelResponseProvenance;
  finishReason: 'stop' | 'tool_calls';
}
export interface NativeRequest {
  context?: ModelContextSelection;
  route: RouteSnapshot;
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
export type RuntimeModelRequest =
  { kind: 'chat'; value: ChatRequest } | { kind: 'native'; value: NativeRequest };
export type RuntimeModelResponse =
  { kind: 'chat'; value: ChatResponse } | { kind: 'native'; value: NativeResponse };
