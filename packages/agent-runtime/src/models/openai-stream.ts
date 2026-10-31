import type { RouteSnapshot } from '@skaro/timeline';
import type { NativeResponse, NativeCall } from './native-types.ts';
import { nativeObject, nativeText, nativeTokens, unknownUsage } from './native-values.ts';

/** response.completed is authoritative; display deltas never replace native output items. */
export class OpenAIResponsesStream {
  complete = false;
  private readonly route: RouteSnapshot;
  private readonly events: Record<string, unknown>[] = [];
  private response?: Record<string, unknown>;
  private sequence = -1;
  constructor(route: RouteSnapshot) {
    this.route = structuredClone(route);
  }
  push(value: unknown): string {
    const event = nativeObject(value);
    if (this.complete) throw new Error('Native response already completed');
    if (event.sequence_number !== undefined) {
      const sequence = nativeTokens(event.sequence_number);
      if (sequence === null || sequence <= this.sequence)
        throw new Error('Invalid native event sequence');
      this.sequence = sequence;
    }
    this.events.push(structuredClone(event));
    if (['error', 'response.failed', 'response.incomplete'].includes(String(event.type)))
      throw new Error('Model response is incomplete or filtered');
    if (event.type === 'response.completed') {
      this.response = structuredClone(nativeObject(event.response));
      if (this.response.status !== 'completed' || !Array.isArray(this.response.output))
        throw new Error('Model response is incomplete or filtered');
      this.complete = true;
    }
    return event.type === 'response.output_text.delta' ? nativeText(event.delta) : '';
  }
  snapshot(): unknown {
    return { events: this.events, response: this.response };
  }
  finish(requestId: string | null): NativeResponse {
    if (!this.complete || !this.response)
      throw new Error('Native response has no completed terminal event');
    const output = (this.response.output as unknown[]).map((item) =>
      structuredClone(nativeObject(item)),
    );
    const calls: NativeCall[] = [];
    for (const item of output)
      if (item.type === 'function_call') {
        if (item.status != null && item.status !== 'completed')
          throw new Error('Incomplete native tool call');
        calls.push({
          id: nativeText(item.call_id),
          name: nativeText(item.name),
          arguments: JSON.parse(nativeText(item.arguments)),
        });
      }
    if (new Set(calls.map((call) => call.id)).size !== calls.length)
      throw new Error('Duplicate native tool call identity');
    const raw = this.response.usage ? nativeObject(this.response.usage) : {};
    const cached = raw.input_tokens_details ? nativeObject(raw.input_tokens_details) : {};
    const reasoning = raw.output_tokens_details ? nativeObject(raw.output_tokens_details) : {};
    return {
      output,
      events: structuredClone(this.events),
      calls,
      provenance: {
        route: this.route,
        actualModel: typeof this.response.model === 'string' ? this.response.model : null,
        upstream: null,
        requestId,
        usage: {
          ...unknownUsage(),
          inputTokens: nativeTokens(raw.input_tokens),
          outputTokens: nativeTokens(raw.output_tokens),
          cachedTokens: nativeTokens(cached.cached_tokens),
          reasoningTokens: nativeTokens(reasoning.reasoning_tokens),
        },
      },
    };
  }
}
