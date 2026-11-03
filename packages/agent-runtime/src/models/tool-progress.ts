import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { RuntimeJournal } from '../journal.ts';
import type { CommandResult } from '../model.ts';

export const NO_TOOL_PROGRESS =
  'Repeated tool calls made no progress; explicit owner input is required';
export class ModelNoProgressError extends Error {
  constructor() {
    super(NO_TOOL_PROGRESS);
    this.name = 'ModelNoProgressError';
  }
}
const progressState = z.strictObject({
  kind: z.literal('model-tool-progress'),
  schema: z.literal(1),
  seen: z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(512),
  unchanged: z.number().int().min(0).max(20000),
  failures: z.number().int().min(0).max(20000),
  blocked: z.boolean(),
});
type State = z.infer<typeof progressState>;
const empty = (): State => ({
  kind: 'model-tool-progress',
  schema: 1,
  seen: [],
  unchanged: 0,
  failures: 0,
  blocked: false,
});
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value ?? null;
}

/** Content fingerprints exclude provider call IDs; checkpoints retain no arguments or output text. */
export class ModelToolProgress {
  private state: State;
  constructor(state?: unknown) {
    this.state = state === undefined ? empty() : progressState.parse(state);
  }
  static restore(journal: Pick<RuntimeJournal, 'records'>, turn: string) {
    const record = journal.records.findLast((item) =>
      item.id.startsWith(`model-progress:${turn}:`),
    );
    return new ModelToolProgress(record?.result.value);
  }
  snapshot(): State {
    return structuredClone(this.state);
  }
  reset(): void {
    this.state = empty();
  }
  requireProgress(): void {
    if (this.state.blocked) throw new ModelNoProgressError();
  }
  observe(name: string, args: unknown, result: CommandResult): void {
    const hash = createHash('sha256')
      .update(JSON.stringify(canonical([name, args, result])))
      .digest('hex');
    const seen = this.state.seen.includes(hash);
    if (!seen) {
      this.state.seen.push(hash);
      if (this.state.seen.length > 512) this.state.seen.shift();
    }
    this.state.unchanged = seen ? this.state.unchanged + 1 : 0;
    this.state.failures = result.error ? this.state.failures + 1 : 0;
    // Allow corrections, but bound identical results and repeatedly changing invalid arguments.
    this.state.blocked ||= this.state.unchanged >= 3 || this.state.failures >= 6;
  }
  async checkpoint(journal: RuntimeJournal, turn: string, boundary: string) {
    await journal.append(`model-progress:${turn}:${boundary}`, [], { value: this.snapshot() });
  }
}
