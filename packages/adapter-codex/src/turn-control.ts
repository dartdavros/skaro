import type { TimelineEvent } from '@skaro/timeline';

type Completed = Extract<TimelineEvent, { t: 'turn.completed' }>;

/** Serializes turn-changing actions and waits for the native interrupt to finish. */
export class TurnControl {
  active: string | undefined;
  private queue: Promise<unknown> = Promise.resolve();
  private restart:
    | {
        id: string;
        cancelled: boolean;
        complete: (event: Completed) => void;
        continuing?: Completed;
      }
    | undefined;

  run<T>(action: () => Promise<T>): Promise<T> {
    const result = this.queue.then(action);
    this.queue = result.catch(() => undefined);
    return result;
  }

  observe(event: TimelineEvent): TimelineEvent {
    if (event.t === 'turn.started') this.active = event.turnId;
    if (event.t !== 'turn.completed') return event;
    if (this.active === event.turnId) this.active = undefined;
    const restart = this.restart;
    if (restart?.id !== event.turnId) return event;
    restart.complete(event);
    if (event.outcome !== 'interrupted' || restart.cancelled) return event;
    restart.continuing = event;
    return { ...event, continuing: true };
  }

  cancelRestart(): void {
    if (this.restart) this.restart.cancelled = true;
  }

  async resumeWithPermissions(
    interrupt: (turnId: string) => Promise<void>,
    resume: () => Promise<void>,
    ended: (event: Completed) => void,
  ): Promise<void> {
    const id = this.active;
    if (!id) return;
    let complete!: (event: Completed) => void;
    const completed = new Promise<Completed>((resolve) => (complete = resolve));
    const restart: NonNullable<typeof this.restart> = { id, cancelled: false, complete };
    let resuming = false;
    this.restart = restart;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      // Install the waiter before requesting interruption: completion can precede the RPC reply.
      const stopped = Promise.race([
        completed,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Codex did not finish interrupting the turn')),
            15_000,
          );
        }),
      ]);
      const [, event] = await Promise.all([interrupt(id), stopped]);
      if (event.outcome === 'interrupted' && !restart.cancelled) {
        resuming = true;
        try {
          await resume();
        } catch (error) {
          ended({
            t: 'turn.completed',
            turnId: id,
            outcome: 'failed',
            error: { category: 'other', message: String(error) },
          });
          throw error;
        }
      }
    } finally {
      if (restart.continuing && !resuming) ended(restart.continuing);
      clearTimeout(timer);
      if (this.restart === restart) this.restart = undefined;
    }
  }
}
