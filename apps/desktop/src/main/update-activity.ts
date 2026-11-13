import type { MethodName } from '../shared/ipc';
import { updateObservation } from './update-observations';

/** Blocks the gap between readiness, backup and the explicit installer launch. */
export class UpdateActivity {
  private inFlight = 0;
  private locked = false;
  private unverified = false;
  private readonly running: () => boolean;
  constructor(running: () => boolean) {
    this.running = running;
  }

  busy(): boolean {
    return this.inFlight > 0 || this.running();
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

  /** Track effects, including import writes and merges; observations do not reserve activity. */
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
    if (updateObservation(method)) return action();
    this.inFlight++;
    try {
      return await action();
    } finally {
      this.inFlight--;
    }
  }
}
