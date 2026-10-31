import type { AppDb } from '@skaro/core';

interface Execution {
  enabled: boolean;
  blocked?: string;
  turn?: string;
  fingerprint?: string;
  stalls: number;
}

/** The task's execution intent outlives individual model turns and application restarts. */
export class TaskExecution {
  private readonly key: string;
  private readonly db: Pick<AppDb, 'getSetting' | 'setSetting'>;
  constructor(db: Pick<AppDb, 'getSetting' | 'setSetting'>, runId: string) {
    this.db = db;
    this.key = `execution.${runId}`;
  }
  read(): Execution {
    return this.db.getSetting<Execution>(this.key, { enabled: false, stalls: 0 });
  }
  start(): void {
    this.db.setSetting(this.key, { enabled: true, stalls: 0 });
  }
  stop(): void {
    this.db.setSetting(this.key, { ...this.read(), enabled: false });
  }
  block(reason: string): void {
    this.db.setSetting(this.key, { ...this.read(), blocked: reason });
  }
  clearBlock(): void {
    this.db.setSetting(this.key, { ...this.read(), blocked: undefined });
  }
  /** A duplicated terminal event cannot schedule another turn; repeated stalls cannot loop. */
  next(turn: string, fingerprint: string): 'continue' | 'duplicate' | 'stalled' {
    const state = this.read();
    if (state.turn === turn) return 'duplicate';
    const stalls = state.fingerprint === fingerprint ? state.stalls + 1 : 0;
    this.db.setSetting(this.key, { ...state, turn, fingerprint, stalls });
    return stalls >= 2 ? 'stalled' : 'continue';
  }
}
