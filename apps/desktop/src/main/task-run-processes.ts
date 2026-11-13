import type { AppDb } from '@skaro/core';
import {
  processBirth,
  processBirthSync,
  stopOwnedProcess,
  type OwnedProcess,
  type ProcessIdentity,
} from './process-identity';

/** Durable ownership of native processes, including recovery after a main-process crash. */
export class TaskRunProcesses {
  private readonly db: AppDb;
  private readonly admissions = new Map<string, Set<Promise<void>>>();
  private readonly stopping = new Map<string, Promise<void>>();
  constructor(db: AppDb) {
    this.db = db;
  }
  private key(runId: string): string {
    return `run.${runId}.processes`;
  }
  started(runId: string, pid: number, allowExited = false, admitted?: ProcessIdentity): void {
    const identity = admitted?.birth ?? processBirthSync(pid);
    if (!identity && allowExited) return;
    if (!identity) throw new Error('The agent process exited before ownership was recorded');
    if (admitted && admitted.platform !== process.platform)
      throw new Error('Unexpected process platform');
    const records = this.db.getSetting<OwnedProcess[] | null>(this.key(runId), []) ?? [];
    this.db.setSetting(this.key(runId), [
      ...records,
      { pid, birth: identity, platform: process.platform },
    ]);
  }
  stop(runId: string): Promise<void> {
    const active = this.stopping.get(runId);
    if (active) return active;
    const work = this.stopRecorded(runId);
    const request: Promise<void> = work.finally(() => {
      if (this.stopping.get(runId) === request) this.stopping.delete(runId);
    });
    this.stopping.set(runId, request);
    return request;
  }
  private async stopRecorded(runId: string): Promise<void> {
    // Output can arrive before the asynchronous OS identity query finishes.
    // Drain admission before reading the durable list, so stop cannot miss that process.
    while (this.admissions.get(runId)?.size) await Promise.all([...this.admissions.get(runId)!]);
    const setting = this.key(runId);
    const records = this.db.getSetting<OwnedProcess[] | null>(setting, []) ?? [];
    if (!records.length) return;
    const checkpoint = `${setting}.stop`;
    const save = (state: 'running' | 'verified' | 'failed') => {
      this.db.setSetting(checkpoint, { state, identities: records, at: Date.now() });
      const run = this.db.getRun(runId);
      if (run) this.db.addEvent(run.projectId, 'resource_process_stop', { run: runId, state });
    };
    save('running');
    try {
      for (const record of records) await stopOwnedProcess(record);
      this.db.setSetting(setting, []);
      save('verified');
    } catch (error) {
      save('failed');
      throw error;
    }
  }
  startedAsync(runId: string, pid: number, allowExited = false): Promise<void> {
    const work = (async () => {
      const birth = await processBirth(pid);
      if (!birth && allowExited) return;
      if (!birth) throw new Error('The process exited before ownership was recorded');
      this.started(runId, pid, allowExited, { birth, platform: process.platform });
    })();
    let pending = this.admissions.get(runId);
    if (!pending) this.admissions.set(runId, (pending = new Set()));
    pending.add(work);
    return work
      .finally(() => {
        pending.delete(work);
        if (!pending.size && this.admissions.get(runId) === pending) this.admissions.delete(runId);
      })
      .then(async () => {
        // Admission failure makes the shell kill its parent. Keep that parent alive
        // until a concurrent verified tree shutdown has stopped its descendants.
        await this.stopping.get(runId);
      });
  }
}
