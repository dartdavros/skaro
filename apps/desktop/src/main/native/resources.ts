import type { SessionOptions, TimelineEvent } from '@skaro/timeline';

type Holding = { release(evidence: string): void };
export const resourceMethod = (method: string) =>
  ['send', 'steer', 'respond', 'compact', 'runModelTurn', 'deliverInput', 'invokeTool'].includes(
    method,
  );
/** Model waits and process ownership have separate lifetimes, both cancelled before shutdown. */
export class NativeResources {
  private readonly admission: SessionOptions['resourceAdmission'];
  private readonly controller = new AbortController();
  private readonly signal: AbortSignal;
  private process?: Holding;
  private turn?: Holding;
  private work?: Holding;
  private readonly commands = new Set<string>();
  private pending?: Promise<void>;
  private readonly turns = new Set<string>();
  get idle(): boolean {
    return !this.turn && !this.pending && !this.commands.size;
  }
  private readonly connectionId?: string;
  constructor(options: SessionOptions, connectionId?: string) {
    this.connectionId = connectionId;
    this.admission = options.resourceAdmission;
    this.signal = AbortSignal.any([
      this.controller.signal,
      ...(options.signal ? [options.signal] : []),
    ]);
  }
  async start(): Promise<void> {
    try {
      this.process = await this.admission?.process(this.signal);
      // Do not create a provider thread while its first turn is still waiting for admission.
      if (this.admission) await this.acquireTurn();
    } catch (error) {
      this.closed(); // No worker or native process has been created yet.
      throw error;
    }
  }
  before(method: string): Promise<void> {
    if (!resourceMethod(method)) return Promise.resolve();
    this.signal.throwIfAborted();
    if (this.turn || !this.admission) return Promise.resolve();
    return (this.pending ??= this.acquireTurn().finally(() => {
      this.pending = undefined;
    }));
  }
  private async acquireTurn() {
    const held = await this.admission!.turn(this.signal, this.connectionId, !this.work);
    if (this.signal.aborted) {
      held.release('model_dispatch_cancelled');
      held.work?.release('worker_dispatch_cancelled');
      this.signal.throwIfAborted();
    }
    this.turn = held;
    this.work ??= held.work;
  }
  event(event: TimelineEvent): void {
    if (event.t === 'limits')
      this.admission?.limits?.(event.state, event.resetsAt, this.connectionId);
    if (event.t === 'item.upsert' && event.item.kind === 'command') {
      if (event.item.status === 'running' || event.item.background?.state === 'running')
        this.commands.add(event.item.id);
      else this.commands.delete(event.item.id);
      if (!this.turn && !this.commands.size) this.releaseWork('native_commands_completed');
    }
    if (event.t === 'turn.started') this.turns.add(event.turnId);
    if (event.t === 'turn.completed') {
      this.turns.delete(event.turnId);
      if (!event.continuing && !this.turns.size) this.suspend('native_turn_completed');
    }
    if (
      event.t === 'interaction.opened' &&
      ['approval', 'question', 'form', 'login'].includes(event.interaction.kind)
    )
      this.suspend('native_waiting_for_input');
  }
  private suspend(evidence: string): void {
    this.turn?.release(evidence);
    this.turn = undefined;
    if (!this.commands.size) this.releaseWork(evidence);
  }
  private releaseWork(evidence: string): void {
    this.work?.release(evidence);
    this.work = undefined;
  }
  stop(): void {
    this.controller.abort(new Error('Native resource owner stopped'));
  }
  /** Only after owned process trees, worker and host ports have actually closed. */
  closed(): void {
    this.suspend('native_transport_closed');
    this.releaseWork('native_commands_stopped');
    this.process?.release('native_processes_closed');
    this.process = undefined;
  }
}
