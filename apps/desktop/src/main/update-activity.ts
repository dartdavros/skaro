import type { MethodName, EventName, Events } from '../shared/ipc';

/** Blocks the gap between readiness, backup and the explicit installer launch. */
export class UpdateActivity {
  private inFlight = 0;
  private locked = false;
  private unverified = false;
  private readonly taskStates = new Map<string, string>();
  private readonly chatStates = new Map<string, string>();
  private readonly running: () => boolean;
  constructor(running: () => boolean) {
    this.running = running;
  }

  busy(): boolean {
    return (
      this.inFlight > 0 ||
      this.running() ||
      [...this.taskStates.values(), ...this.chatStates.values()].some((s) => s !== 'idle')
    );
  }

  enterApply(): void {
    if (this.locked || this.busy()) throw new Error('UPDATE_BUSY');
    this.locked = true;
  }
  release(): void {
    this.locked = false;
  }
  quarantine(value: boolean): void {
    this.unverified = value;
  }

  observe<E extends EventName>(event: E, payload: Events[E]): void {
    if (event !== 'task.events' && event !== 'chat.events') return;
    const value = payload as Events['task.events'] | Events['chat.events'];
    const key = `${value.projectId}:${'taskId' in value ? value.taskId : value.chatId}`;
    const states = event === 'task.events' ? this.taskStates : this.chatStates;
    for (const item of value.events) {
      if (item.t === 'status') states.set(key, item.state);
    }
  }

  /** All renderer work is accounted for, including asynchronous import writes and merges. */
  async invoke<T>(method: MethodName, action: () => T | Promise<T>): Promise<T> {
    if (
      method.startsWith('updates.') ||
      method === 'app.checkUpdate' ||
      method.startsWith('window.')
    )
      return action();
    if (this.locked) throw new Error('UPDATE_APPLYING');
    if (
      this.unverified &&
      ((method.startsWith('agents.') &&
        method !== 'agents.list' &&
        method !== 'agents.openConfigDir') ||
        [
          'tasks.run',
          'task.send',
          'task.respond',
          'task.merge',
          'tasks.merge',
          'chat.create',
          'chat.send',
          'chat.respond',
          'chat.proposal',
          'import.start',
        ].includes(method))
    )
      throw new Error('UPDATE_BUNDLE_UNVERIFIED');
    this.inFlight++;
    try {
      return await action();
    } finally {
      this.inFlight--;
    }
  }
}
