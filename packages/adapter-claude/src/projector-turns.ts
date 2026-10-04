import { arr, bool, num, obj, str, type Obj } from '@skaro/timeline';
import { categoryFromText } from './projector-helpers.ts';
import type { ClaudeProjectionState } from './projector-state.ts';

export class ClaudeTurnsProjection {
  private readonly state: ClaudeProjectionState;
  constructor(state: ClaudeProjectionState) {
    this.state = state;
  }
  onResult(msg: Obj): void {
    const usage = obj(msg['usage']);
    if (usage) {
      // The largest context window among the models of the turn is the main model's.
      const window = Math.max(
        0,
        ...Object.values(obj(msg['modelUsage']) ?? {}).map(
          (m) => num(obj(m)?.['contextWindow']) ?? 0,
        ),
      );
      this.state.emit({
        t: 'usage',
        inputTokens:
          (num(usage['input_tokens']) ?? 0) +
          (num(usage['cache_read_input_tokens']) ?? 0) +
          (num(usage['cache_creation_input_tokens']) ?? 0),
        outputTokens: num(usage['output_tokens']) ?? 0,
        ...(window > 0 ? { contextWindow: window } : {}),
        ...(window > 0 && this.state.contextTokens > 0
          ? { contextUsedPct: Math.round((this.state.contextTokens / window) * 1000) / 10 }
          : {}),
      });
    }

    // Outcome by is_error and assistant.error, not by subtype (auth errors come as subtype "success").
    const terminal = str(msg['terminal_reason']);
    const interrupted = terminal === 'aborted_streaming' || terminal === 'aborted_tools';
    const isError = bool(msg['is_error']) ?? false;
    let outcome: 'done' | 'interrupted' | 'failed' = interrupted
      ? 'interrupted'
      : isError
        ? 'failed'
        : 'done';
    let error = this.state.turnError;
    if (outcome === 'failed' && !error) {
      const text = str(msg['result']) ?? arr(msg['errors']).filter(Boolean).join('\n');
      error = { category: categoryFromText(text, num(msg['api_error_status'])), message: text };
    }
    if (outcome !== 'failed') error = undefined;
    if (!this.state.turnOpen) this.state.startTurn();

    const last = this.state.turnMessages.at(-1);
    const lastItem = last ? this.state.items.get(last) : undefined;
    if (lastItem?.kind === 'message' && outcome === 'done')
      this.state.upsert({ ...lastItem, phase: 'final' });

    for (const item of this.state.items.values()) {
      if (item.turnId !== this.state.turnId || item.status !== 'running') continue;
      if (item.kind === 'command' && item.background) continue;
      this.state.upsert({
        ...item,
        status: outcome === 'interrupted' ? 'interrupted' : 'done',
        endedAt: this.state.ctx.now(),
      });
    }
    if (outcome === 'failed' && error === undefined) outcome = 'failed';
    this.state.emit({ t: 'turn.completed', turnId: this.state.turnId, outcome, error });
    this.state.turnOpen = false;
  }

  onRateLimit(msg: Obj): void {
    const info = obj(msg['rate_limit_info']);
    const status = str(info?.['status']);
    const resetsAt = num(info?.['resetsAt']);
    // "allowed_warning" also comes far below any limit (a weekly window at 44%); only a
    // surpassed threshold means the limit is really close.
    const close = status === 'allowed_warning' && num(info?.['surpassedThreshold']) !== undefined;
    this.state.emit({
      t: 'limits',
      state: status === 'rejected' ? 'exhausted' : close ? 'warning' : 'ok',
      resetsAt: resetsAt ? new Date(resetsAt * 1000).toISOString() : undefined,
    });
  }
}
