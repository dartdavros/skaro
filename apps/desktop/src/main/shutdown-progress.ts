import { SHUTDOWN_STAGES, type ShutdownStage, type ShutdownState } from '../shared/shutdown';

/** Immutable snapshots are retained so a renderer reload cannot lose a pending exit. */
export class ShutdownProgress {
  state: ShutdownState | undefined;
  private readonly publish: (state: ShutdownState) => void;
  constructor(publish: (state: ShutdownState) => void) {
    this.publish = publish;
  }

  begin(): ShutdownState {
    if (!this.state) {
      this.state = { startedAt: Date.now(), revision: 1, stage: 'agents', completed: [] };
      this.publish(this.state);
    }
    return this.state;
  }

  advance(stage: ShutdownStage): void {
    const current = this.begin();
    const index = SHUTDOWN_STAGES.indexOf(stage);
    if (index <= SHUTDOWN_STAGES.indexOf(current.stage)) return;
    this.state = {
      ...current,
      revision: current.revision + 1,
      stage,
      completed: current.completed,
    };
    this.publish(this.state);
  }

  complete(stage: ShutdownStage): void {
    const current = this.state;
    if (!current || current.stage !== stage || current.completed.includes(stage)) return;
    this.state = {
      ...current,
      revision: current.revision + 1,
      completed: [...current.completed, stage],
    };
    this.publish(this.state);
  }
}
