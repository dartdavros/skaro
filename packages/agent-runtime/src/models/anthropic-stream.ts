import type { RouteSnapshot } from '@skaro/timeline';
import type { NativeResponse, NativeCall } from './native-types.ts';
import { nativeObject, nativeText, nativeTokens, unknownUsage } from './native-values.ts';
import { ModelHttpError } from './model-error.ts';

/** Native block order/signatures/redacted thinking are retained for exact tool continuation. */
export class AnthropicMessagesStream {
  complete = false;
  private readonly route: RouteSnapshot;
  private readonly events: Record<string, unknown>[] = [];
  private message?: Record<string, unknown>;
  private readonly blocks = new Map<number, Record<string, unknown>>();
  private readonly open = new Set<number>();
  private readonly json = new Map<number, string>();
  private usage: Record<string, unknown> = {};
  constructor(route: RouteSnapshot) {
    this.route = structuredClone(route);
  }
  push(value: unknown): string {
    const event = nativeObject(value);
    this.events.push(structuredClone(event));
    if (event.type === 'ping') return '';
    if (this.complete) throw new Error('Native response already completed');
    if (event.type === 'error') {
      const type = nativeObject(event.error).type;
      if (type === 'overloaded_error') throw new ModelHttpError(529);
      throw new Error('Model stream reported an error');
    }
    if (event.type === 'message_start') {
      if (this.message) throw new Error('Duplicate native message start');
      this.message = structuredClone(nativeObject(event.message));
      this.usage = this.message.usage ? structuredClone(nativeObject(this.message.usage)) : {};
      return '';
    }
    if (!this.message) throw new Error('Native event arrived before message start');
    if (event.type === 'message_delta') {
      const delta = nativeObject(event.delta);
      if (delta.model != null && delta.model !== this.message.model)
        throw new Error('Unapproved native model fallback');
      Object.assign(this.message, structuredClone(delta));
      if (event.usage) Object.assign(this.usage, structuredClone(nativeObject(event.usage)));
      return '';
    }
    if (event.type === 'message_stop') {
      if (
        this.open.size ||
        !['end_turn', 'stop_sequence', 'tool_use'].includes(String(this.message.stop_reason))
      )
        throw new Error('Model response is incomplete or filtered');
      this.complete = true;
      return '';
    }
    if (
      !['content_block_start', 'content_block_delta', 'content_block_stop'].includes(
        String(event.type),
      )
    )
      return '';
    const index = nativeTokens(event.index);
    if (index === null) throw new Error('Invalid native block index');
    if (event.type === 'content_block_start') {
      if (this.blocks.has(index)) throw new Error('Duplicate native content block');
      const block = structuredClone(nativeObject(event.content_block));
      if (!['text', 'thinking', 'redacted_thinking', 'tool_use'].includes(String(block.type)))
        throw new Error('Unsupported native content block or fallback');
      this.blocks.set(index, block);
      this.open.add(index);
      return block.type === 'text' ? nativeText(block.text) : '';
    }
    const block = this.blocks.get(index);
    if (!block || !this.open.has(index)) throw new Error('Native block is not open');
    if (event.type === 'content_block_stop') {
      if (this.json.has(index)) block.input = JSON.parse(this.json.get(index)!);
      this.open.delete(index);
      return '';
    }
    const delta = nativeObject(event.delta);
    switch (delta.type) {
      case 'text_delta':
        if (block.type !== 'text') throw new Error('Native block delta type mismatch');
        block.text = nativeText(block.text) + nativeText(delta.text);
        return nativeText(delta.text);
      case 'thinking_delta':
        if (block.type !== 'thinking') throw new Error('Native block delta type mismatch');
        block.thinking = nativeText(block.thinking) + nativeText(delta.thinking);
        return '';
      case 'signature_delta':
        if (block.type !== 'thinking') throw new Error('Native block delta type mismatch');
        block.signature =
          (block.signature == null ? '' : nativeText(block.signature)) +
          nativeText(delta.signature);
        return '';
      case 'input_json_delta':
        if (block.type !== 'tool_use') throw new Error('Native block delta type mismatch');
        this.json.set(index, (this.json.get(index) ?? '') + nativeText(delta.partial_json));
        return '';
      case 'citations_delta':
        if (block.type !== 'text') throw new Error('Native block delta type mismatch');
        block.citations = [
          ...(Array.isArray(block.citations) ? block.citations : []),
          structuredClone(delta.citation),
        ];
        return '';
      default:
        throw new Error('Unsupported native block delta');
    }
  }
  snapshot(): unknown {
    return {
      events: this.events,
      blocks: [...this.blocks.values()],
      json: [...this.json.values()],
    };
  }
  finish(requestId: string | null): NativeResponse {
    if (!this.complete || !this.message)
      throw new Error('Native response has no completed terminal event');
    const entries = [...this.blocks.entries()].sort(([a], [b]) => a - b);
    if (entries.some(([index], position) => index !== position))
      throw new Error('Native content block gap');
    const output = entries.map(([, block]) => structuredClone(block));
    const calls: NativeCall[] = output
      .filter((block) => block.type === 'tool_use')
      .map((block) => ({
        id: nativeText(block.id),
        name: nativeText(block.name),
        arguments: structuredClone(block.input),
      }));
    if (
      (this.message.stop_reason === 'tool_use') !== calls.length > 0 ||
      new Set(calls.map((call) => call.id)).size !== calls.length
    )
      throw new Error('Incomplete native tool calls');
    const input = nativeTokens(this.usage.input_tokens);
    const read = nativeTokens(this.usage.cache_read_input_tokens);
    const creation = nativeTokens(this.usage.cache_creation_input_tokens);
    return {
      output,
      calls,
      events: structuredClone(this.events),
      provenance: {
        route: this.route,
        actualModel: typeof this.message.model === 'string' ? this.message.model : null,
        upstream: null,
        requestId,
        usage: {
          ...unknownUsage(),
          inputTokens:
            input === null || read === null || creation === null ? null : input + read + creation,
          outputTokens: nativeTokens(this.usage.output_tokens),
          cachedTokens: read,
        },
      },
    };
  }
}
