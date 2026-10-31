import type { ModelResponseProvenance, RouteSnapshot } from '@skaro/timeline';

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
export interface ModelTool {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface ChatRequest {
  context?: import('../context/request.ts').ContextSelection;
  route: RouteSnapshot;
  messages: readonly ChatMessage[];
  tools?: readonly ModelTool[];
  toolChoice?: 'auto' | 'required' | 'none';
  /** Explicit pricing ceiling in USD per million tokens, enforced by the gateway too. */
  price: { prompt: number; completion: number; request?: number };
}
export interface ChatResponse {
  message: ChatMessage;
  /** Exact ordered native deltas; continuation never reconstructs reasoning from display text. */
  native: Record<string, unknown>[];
  provenance: ModelResponseProvenance;
  finishReason: 'stop' | 'tool_calls';
}
