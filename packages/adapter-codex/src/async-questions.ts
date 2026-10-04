import { arr, obj, str, type Emit, type Obj, type ProjectionContext } from '@skaro/timeline';

/** Codex 0.159 async question deliveries are agentMessage items, not server requests. */
export class AsyncQuestions {
  private readonly seen = new Set<string>();
  private readonly open = new Set<string>();
  private readonly emit: Emit;
  private readonly ctx: ProjectionContext;

  constructor(ctx: ProjectionContext, emit: Emit) {
    this.ctx = ctx;
    this.emit = emit;
  }

  item(item: Obj, turnId: string): boolean {
    if (item['type'] !== 'agentMessage' || item['delivery'] !== 'async') return false;
    const itemId = str(item['id']);
    const questions = arr(item['questions']).flatMap((value, index) => {
      const question = obj(value);
      const title = str(question?.['title']);
      if (!title?.trim()) return [];
      return [
        {
          id: String(index),
          header: '',
          text: title,
          multi: false,
          allowFreeText: true,
          options: arr(question?.['options']).flatMap((value) =>
            typeof value === 'string' && value.trim() ? [{ label: value }] : [],
          ),
        },
      ];
    });
    if (!itemId || !questions.length) return false;
    if (this.seen.has(itemId)) return true;
    this.seen.add(itemId);
    const id = `async-${itemId}`;
    this.open.add(id);
    // Keep the agent's question at its native position, including after it is answered.
    this.emit({
      t: 'item.upsert',
      item: {
        id: itemId,
        turnId,
        kind: 'message',
        role: 'agent',
        phase: 'commentary',
        text: str(item['text']) ?? questions.map((q) => q.text).join('\n\n'),
        status: 'done',
        startedAt: this.ctx.now(),
        endedAt: this.ctx.now(),
        native: { agent: 'codex', type: 'async_question', ref: itemId },
      },
    });
    this.emit({
      t: 'interaction.opened',
      interaction: { kind: 'question', id, itemId, delivery: 'async', questions },
    });
    return true;
  }

  answered(): void {
    for (const id of this.open) this.emit({ t: 'interaction.closed', id, resolution: 'answered' });
    this.open.clear();
  }
}
