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
  private waiters = 0;
  private turnEpoch = 0;
  private ended = false;
  private idleListener?: () => void;
  private readonly turns = new Set<string>();
  get idle(): boolean {
    return !this.turn && !this.pending && !this.waiters && !this.commands.size && !this.turns.size;
  }
  private readonly connectionId?: string;
  constructor(
    options: Pick<SessionOptions, 'resourceAdmission' | 'signal'>,
    connectionId?: string,
  ) {
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
      this.requireOpen();
      // Do not create a provider thread while its first turn is still waiting for admission.
      if (this.admission) await this.acquireTurn();
    } catch (error) {
      this.closed(); // No worker or native process has been created yet.
      throw error;
    }
  }
  onIdle(listener: () => void): void {
    this.idleListener = listener;
  }
  /** Each waiter rechecks its own intent after shared admission; strict updates cannot lend a grant. */
  async before(method: string, onlyActiveTurn = false): Promise<boolean> {
    if (!resourceMethod(method)) return true;
    this.requireOpen();
    const epoch = this.turnEpoch;
    const current = () => this.turns.size > 0 && this.turnEpoch === epoch;
    if (onlyActiveTurn && !current()) return false;
    this.waiters++;
    try {
      for (;;) {
        this.requireOpen();
        if (onlyActiveTurn && !current()) return false;
        if (this.turn || !this.admission) return true;
        // An ordinary caller joining a strict acquisition must retry if that strict grant expires.
        if (!this.pending) {
          const pending = this.acquireTurn(onlyActiveTurn ? current : undefined).finally(() => {
            if (this.pending === pending) this.pending = undefined;
          });
          this.pending = pending;
        }
        await this.pending;
      }
    } finally {
      this.waiters--;
      this.notifyIdle();
    }
  }
  private requireOpen(): void {
    this.signal.throwIfAborted();
    if (this.ended) throw new Error('Native resource owner is closed');
  }
  private async acquireTurn(current?: () => boolean) {
    const previousWork = this.work;
    const held = await this.admission!.turn(this.signal, this.connectionId, !previousWork);
    const discard = (evidence: string) => {
      try {
        held.release(evidence);
      } finally {
        held.work?.release(evidence);
      }
    };
    if (this.signal.aborted || this.ended) {
      discard('model_dispatch_cancelled');
      this.requireOpen();
    }
    if (current && !current()) {
      discard('active_turn_ended_before_dispatch');
      return;
    }
    // Work may have completed while acquiring the model lease; acquire its new envelope explicitly.
    if (previousWork && !this.work) {
      discard('worker_ownership_changed_before_dispatch');
      return;
    }
    this.turn = held;
    if (this.work && held.work && held.work !== this.work)
      held.work.release('worker_ownership_already_held');
    else this.work ??= held.work;
  }
  private notifyIdle(): void {
    if (this.ended || !this.idle) return;
    try {
      this.idleListener?.();
    } catch (error) {
      console.error('Native idle notification failed:', error);
    }
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
    if (event.t === 'turn.started' && !this.turns.has(event.turnId)) {
      this.turns.add(event.turnId);
      this.turnEpoch++;
    }
    if (event.t === 'turn.completed') {
      if (this.turns.delete(event.turnId)) this.turnEpoch++;
      if (!event.continuing && !this.turns.size) this.suspend('native_turn_completed');
    }
    if (
      event.t === 'interaction.opened' &&
      ['approval', 'question', 'form', 'login'].includes(event.interaction.kind)
    )
      this.suspend('native_waiting_for_input');
    this.notifyIdle();
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
    this.ended = true;
    this.turnEpoch++;
    this.turns.clear();
    this.suspend('native_transport_closed');
    this.releaseWork('native_commands_stopped');
    this.process?.release('native_processes_closed');
    this.process = undefined;
  }
}
