import type { TimelineEvent } from '@skaro/timeline';

type Completed = Extract<TimelineEvent, { t: 'turn.completed' }>;

/** Serializes turn-changing actions and waits for the native interrupt to finish. */
export class TurnControl {
  active: string | undefined;
  private completed: string | undefined;
  private started: string | undefined;
  private readonly starting = new Map<string, Set<(started: boolean) => void>>();
  private readonly ending = new Map<string, Set<() => void>>();
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

  /** Resolve this inside the command queue; a completion racing an earlier command must win. */
  steer(
    onlyActiveTurn: boolean,
    deliver: (turnId: string) => Promise<void>,
    start: () => Promise<void>,
  ): Promise<void> {
    return this.run(() => {
      const turn = this.active;
      return turn ? deliver(turn) : onlyActiveTurn ? Promise.resolve() : start();
    });
  }

  observe(event: TimelineEvent): TimelineEvent {
    if (event.t === 'turn.started') {
      this.active = event.turnId;
      this.started = event.turnId;
      for (const ready of this.starting.get(event.turnId) ?? []) ready(true);
      this.starting.delete(event.turnId);
    }
    if (event.t !== 'turn.completed') return event;
    this.completed = event.turnId;
    for (const ready of this.ending.get(event.turnId) ?? []) ready();
    this.ending.delete(event.turnId);
    for (const ready of this.starting.get(event.turnId) ?? []) ready(false);
    this.starting.delete(event.turnId);
    if (this.active === event.turnId) this.active = undefined;
    const restart = this.restart;
    if (restart?.id !== event.turnId) return event;
    restart.complete(event);
    if (event.outcome !== 'interrupted' || restart.cancelled) return event;
    restart.continuing = event;
    return { ...event, continuing: true };
  }

  /** The RPC reply may arrive before turn/started; do not treat accepted work as idle. */
  accepted(turnId: string | undefined): void {
    if (turnId && this.completed !== turnId && !this.active) this.active = turnId;
  }

  /** Accepted turn/start can precede native activation. Stop only after its start or end. */
  whenStarted(id: string): Promise<boolean> {
    if (this.active !== id) return Promise.resolve(false);
    if (this.started === id) return Promise.resolve(true);
    return new Promise((resolve, reject) => {
      const ready = (started: boolean) => {
        clearTimeout(timer);
        resolve(started);
      };
      const pending = this.starting.get(id) ?? new Set();
      pending.add(ready);
      this.starting.set(id, pending);
      const timer = setTimeout(() => {
        pending.delete(ready);
        if (!pending.size) this.starting.delete(id);
        reject(new Error('Codex did not confirm the accepted turn start'));
      }, 15_000);
    });
  }

  /** The server can reject an interrupt just before its completion notification is delivered. */
  whenCompleted(id: string): Promise<void> {
    if (this.completed === id) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const ready = () => {
        clearTimeout(timer);
        resolve();
      };
      const pending = this.ending.get(id) ?? new Set();
      pending.add(ready);
      this.ending.set(id, pending);
      const timer = setTimeout(() => {
        pending.delete(ready);
        if (!pending.size) this.ending.delete(id);
        reject(new Error('Codex did not confirm the turn completion'));
      }, 15_000);
    });
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
