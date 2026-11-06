import type { AppDb } from '@skaro/core';

export interface TaskExecutionState {
  enabled: boolean;
  blocked?: string;
  turn?: string;
  fingerprint?: string;
  stalls: number;
  followUp?: { commandId: string; text: string; resumeAfterAnswer?: boolean };
}

/** The task's execution intent outlives individual model turns and application restarts. */
export class TaskExecution {
  private readonly key: string;
  private readonly db: Pick<AppDb, 'getSetting' | 'setSetting'>;
  constructor(db: Pick<AppDb, 'getSetting' | 'setSetting'>, runId: string) {
    this.db = db;
    this.key = `execution.${runId}`;
  }
  read(): TaskExecutionState {
    return this.db.getSetting<TaskExecutionState>(this.key, { enabled: false, stalls: 0 });
  }
  inherit(state: TaskExecutionState): void {
    // A new agent has different turn IDs, but changing it must not reset a blocker or stall bound.
    const { turn: _turn, ...retained } = state;
    if (this.db.getSetting(this.key, null) === null) this.db.setSetting(this.key, retained);
  }
  start(): void {
    this.db.setSetting(this.key, { enabled: true, stalls: 0 });
  }
  /** A chat message is not renewed authorization; retain any existing external blocker. */
  followUp(commandId: string, text: string, waitingForDecision = false): void {
    const state = this.read();
    if (state.followUp?.commandId === commandId) return;
    this.db.setSetting(this.key, {
      ...state,
      enabled: false,
      followUp: {
        commandId,
        text,
        ...(waitingForDecision && {
          resumeAfterAnswer: state.enabled || state.followUp?.resumeAfterAnswer === true,
        }),
      },
    });
  }
  decisionAnswered(): void {
    const state = this.read();
    if (state.followUp?.resumeAfterAnswer)
      this.db.setSetting(this.key, { ...state, enabled: true, followUp: undefined });
  }
  resume(commandId: string, instruction: string): boolean {
    const state = this.read();
    const request = state.followUp;
    if (
      !instruction.trim() ||
      request?.commandId !== commandId ||
      !request.text.includes(instruction)
    )
      return false;
    if (state.enabled) return !state.blocked;
    this.db.setSetting(this.key, { enabled: true, stalls: 0, followUp: request });
    return true;
  }
  stop(): void {
    this.db.setSetting(this.key, { ...this.read(), enabled: false, followUp: undefined });
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
