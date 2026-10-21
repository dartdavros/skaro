import type { InteractionAnswer } from '@skaro/timeline';

const denied: InteractionAnswer = {
  kind: 'approval',
  choice: 'deny',
  message: 'Interrupted by owner',
};

/** Every permission/elicitation waiter settles on either an answer or cancellation. */
export class AnswerWaiters {
  private readonly pending = new Map<string, (answer: InteractionAnswer) => void>();
  private readonly early = new Map<string, InteractionAnswer>();
  cancelled = false;

  resume(): void {
    this.cancelled = false;
  }

  respond(id: string, answer: InteractionAnswer): void {
    const resolve = this.pending.get(id);
    if (resolve) resolve(answer);
    else if (!this.cancelled) this.early.set(id, answer);
  }

  wait(id: string, signal?: AbortSignal): Promise<InteractionAnswer> {
    if (this.cancelled || signal?.aborted) return Promise.resolve(denied);
    const early = this.early.get(id);
    if (early) {
      this.early.delete(id);
      return Promise.resolve(early);
    }
    return new Promise((resolve) => {
      const finish = (answer: InteractionAnswer) => {
        this.pending.delete(id);
        signal?.removeEventListener('abort', abort);
        resolve(answer);
      };
      const abort = () => finish(denied);
      this.pending.set(id, finish);
      signal?.addEventListener('abort', abort, { once: true });
    });
  }

  cancel(): void {
    this.cancelled = true;
    this.early.clear();
    for (const resolve of [...this.pending.values()]) resolve(denied);
  }
}
