import { untilCancelled } from './task-session-cancellation';

const deadlineMessage =
  'Task shutdown is still unconfirmed. Stop again to terminate the recorded task process.';

interface Attempt {
  work: Promise<void>;
  expired: boolean;
  finishing: boolean;
  forcing?: Promise<void>;
  terminate: () => Promise<void>;
}

/** Each caller has a deadline. The original stop retains ownership until its actual cleanup ends. */
export class TaskStopAttempts {
  private readonly pending = new Map<string, Attempt>();
  private readonly deadlineMs: number;
  constructor(deadlineMs = 45_000) {
    this.deadlineMs = deadlineMs;
  }

  has(key: string) {
    return this.pending.has(key);
  }

  async run(
    key: string,
    stop: () => Promise<void>,
    terminate: () => Promise<void>,
    ownerStop: boolean,
    recovered: () => void,
  ) {
    let attempt = this.pending.get(key);
    if (!attempt) {
      const started: Attempt = {
        work: Promise.resolve(),
        expired: false,
        finishing: false,
        terminate,
      };
      this.pending.set(key, started);
      started.work = Promise.resolve()
        .then(stop)
        .finally(async () => {
          started.finishing = true;
          try {
            await started.forcing;
          } finally {
            this.pending.delete(key);
          }
        })
        .then(() => {
          if (started.expired) recovered();
        });
      attempt = started;
    } else if (ownerStop && attempt.expired && !attempt.finishing && !attempt.forcing) {
      const current = attempt;
      current.forcing = Promise.resolve()
        .then(current.terminate)
        .finally(() => {
          delete current.forcing;
        });
    }
    const wait = attempt.forcing ? Promise.all([attempt.work, attempt.forcing]) : attempt.work;
    const deadline = AbortSignal.timeout(this.deadlineMs);
    try {
      await untilCancelled(Promise.resolve(wait), deadline);
    } catch (error) {
      if (deadline.aborted && error === deadline.reason) {
        attempt.expired = true;
        throw new Error(deadlineMessage, { cause: error });
      }
      throw error;
    }
  }
}
