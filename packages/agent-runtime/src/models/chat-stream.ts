import type { ModelResponseProvenance } from '@skaro/timeline';
import type { ChatMessage, ChatToolCall } from './chat-types.ts';
import { ModelHttpError } from './model-error.ts';

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Invalid model object');
  return value as Record<string, unknown>;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid model text delta');
  return value;
}
function tokens(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

/** Only one choice, preserving native tool IDs, argument order and signed reasoning blocks. */
export class ChatCompletionStream {
  readonly message: ChatMessage = { role: 'assistant', content: null };
  readonly native: Record<string, unknown>[] = [];
  private readonly calls = new Map<number, ChatToolCall>();
  private readonly reasoning = new Map<number, Record<string, unknown>>();
  finishReason?: 'stop' | 'tool_calls';
  actualModel: string | null = null;
  upstream: string | null = null;
  requestId: string | null = null;
  usage: ModelResponseProvenance['usage'] = {
    inputTokens: null,
    outputTokens: null,
    cachedTokens: null,
    reasoningTokens: null,
    cost: null,
  };
  push(value: unknown): string {
    const chunk = object(value);
    if (chunk.error) {
      const code = object(chunk.error).code;
      if (typeof code === 'number' && Number.isInteger(code) && code >= 400 && code <= 599)
        throw new ModelHttpError(code);
      throw new Error('Model stream reported an error');
    }
    this.native.push(structuredClone(chunk));
    for (const key of ['id', 'model', 'provider'] as const) {
      const part = chunk[key];
      if (part === undefined || part === null) continue;
      const field = key === 'id' ? 'requestId' : key === 'model' ? 'actualModel' : 'upstream';
      if (this[field] !== null && this[field] !== part)
        throw new Error('Model stream provenance changed');
      this[field] = text(part);
    }
    if (chunk.usage) {
      const usage = object(chunk.usage);
      const prompt = usage.prompt_tokens_details ? object(usage.prompt_tokens_details) : {};
      const completion = usage.completion_tokens_details
        ? object(usage.completion_tokens_details)
        : {};
      this.usage = {
        inputTokens: tokens(usage.prompt_tokens),
        outputTokens: tokens(usage.completion_tokens),
        cachedTokens: tokens(prompt.cached_tokens),
        reasoningTokens: tokens(completion.reasoning_tokens),
        cost:
          typeof usage.cost === 'number' && Number.isFinite(usage.cost) && usage.cost >= 0
            ? { amount: String(usage.cost), currency: 'USD' }
            : null,
      };
    }
    if (!Array.isArray(chunk.choices) || chunk.choices.length > 1)
      throw new Error('Invalid model choices');
    if (!chunk.choices.length) return '';
    const choice = object(chunk.choices[0]);
    if (choice.index !== 0) throw new Error('Unexpected model choice index');
    const delta = object(choice.delta);
    const hasData = Object.entries(delta).some(
      ([key, part]) =>
        key !== 'role' &&
        part !== null &&
        part !== '' &&
        part !== undefined &&
        !(Array.isArray(part) && part.length === 0),
    );
    if (this.finishReason && hasData) throw new Error('Model data arrived after completion');
    const output = delta.content == null ? '' : text(delta.content);
    if (output) this.message.content = (this.message.content ?? '') + output;
    for (const key of ['reasoning', 'reasoning_content', 'refusal'] as const)
      if (delta[key] != null) this.message[key] = (this.message[key] ?? '') + text(delta[key]);
    if (delta.role != null && delta.role !== 'assistant')
      throw new Error('Invalid model response role');
    if (delta.tool_calls != null) {
      if (!Array.isArray(delta.tool_calls)) throw new Error('Invalid model tool calls');
      for (const part of delta.tool_calls) this.tool(object(part));
      this.message.tool_calls = [...this.calls.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, call]) => call);
    }
    if (delta.reasoning_details != null) {
      if (!Array.isArray(delta.reasoning_details)) throw new Error('Invalid reasoning details');
      for (const part of delta.reasoning_details) this.detail(object(part));
      this.message.reasoning_details = [...this.reasoning.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, detail]) => detail);
    }
    if (choice.finish_reason != null) {
      if (!['stop', 'tool_calls'].includes(String(choice.finish_reason)))
        throw new Error('Model response is incomplete or filtered');
      this.finishReason = choice.finish_reason as 'stop' | 'tool_calls';
    }
    return output;
  }
  private tool(part: Record<string, unknown>) {
    const index = tokens(part.index);
    if (index === null || index > 100) throw new Error('Invalid tool call index');
    const current = this.calls.get(index) ?? {
      id: '',
      type: 'function',
      function: { name: '', arguments: '' },
    };
    if (part.type != null && part.type !== 'function')
      throw new Error('Unsupported model tool type');
    if (part.id != null) {
      if (current.id && current.id !== part.id) throw new Error('Model tool ID changed');
      current.id = text(part.id);
    }
    if (part.function != null) {
      const fn = object(part.function);
      if (fn.name != null) current.function.name += text(fn.name);
      if (fn.arguments != null) current.function.arguments += text(fn.arguments);
    }
    this.calls.set(index, current);
  }
  private detail(part: Record<string, unknown>) {
    const index = tokens(part.index);
    if (index === null) throw new Error('Unindexed streaming reasoning is unsupported');
    const current = this.reasoning.get(index) ?? {};
    for (const [key, value] of Object.entries(part)) {
      if (value === null && current[key] !== undefined) continue;
      if (['text', 'summary', 'data', 'signature'].includes(key) && typeof value === 'string')
        current[key] = (current[key] == null ? '' : text(current[key])) + value;
      else {
        if (current[key] != null && current[key] !== value)
          throw new Error('Native reasoning metadata changed');
        current[key] = value;
      }
    }
    this.reasoning.set(index, current);
  }
  requireComplete(): 'stop' | 'tool_calls' {
    if (!this.finishReason) throw new Error('Model stream ended without completion');
    const calls = [...this.calls.values()];
    if (
      (this.finishReason === 'tool_calls') !== calls.length > 0 ||
      calls.some((call) => !call.id || !call.function.name)
    )
      throw new Error('Incomplete model tool calls');
    if (new Set(calls.map((call) => call.id)).size !== calls.length)
      throw new Error('Duplicate model tool call identity');
    return this.finishReason;
  }
}
