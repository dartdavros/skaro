import { randomUUID } from 'node:crypto';
import type { AppDb } from '@skaro/core';
import type {
  ProcessAdmission,
  ProcessAdmissionPort,
  RuntimeProcessIdentity,
  SkaroScope,
} from '@skaro/timeline';
import { processBirth } from '../process-identity';
import { TaskRunProcesses } from '../task-run-processes';
import { AdmissionStore, type AdmissionState } from './admission-state';
import { nativeProcessIdentity as processIdentity } from '@skaro/agent-runtime';

const same = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);

/** A fenced native lease. Task/queue authorization remains with the supplied current host. */
export class NativeAdmissions implements ProcessAdmissionPort {
  private readonly store: AdmissionStore;
  private readonly processes: TaskRunProcesses;
  private readonly initial: AdmissionState;
  private readonly current: (signal: AbortSignal) => Promise<void>;
  private readonly controller = new AbortController();
  get admission(): ProcessAdmission {
    return structuredClone(this.initial.admission);
  }
  get signal(): AbortSignal {
    return this.controller.signal;
  }
  private constructor(
    db: AppDb,
    store: AdmissionStore,
    initial: AdmissionState,
    current: (signal: AbortSignal) => Promise<void>,
  ) {
    this.store = store;
    this.initial = structuredClone(initial);
    this.current = current;
    this.processes = new TaskRunProcesses(db);
  }
  static async prepare(input: {
    db: AppDb;
    ownerKey: string;
    sessionId: string;
    scope: SkaroScope;
    requireCurrent(signal: AbortSignal): Promise<void>;
    signal: AbortSignal;
  }): Promise<NativeAdmissions> {
    const scope = structuredClone(input.scope);
    const ownerKey = input.ownerKey;
    const sessionId = input.sessionId;
    input.signal.throwIfAborted();
    await input.requireCurrent(input.signal);
    input.signal.throwIfAborted();
    const birth = await processBirth(process.pid);
    if (!birth) throw new Error('Native admission host has no OS identity');
    input.signal.throwIfAborted();
    const store = new AdmissionStore(input.db, ownerKey);
    const previous = store.read();
    if (previous && previous.status !== 'exited')
      throw new Error('Previous native admission has no confirmed exit');
    const next: AdmissionState = {
      schema: 1,
      admission: {
        id: randomUUID(),
        sessionId,
        generation: (previous?.admission.generation ?? 0) + 1,
      },
      scope,
      host: { pid: process.pid, birth, platform: process.platform },
      status: 'prepared',
    };
    store.replace(previous, next);
    return new NativeAdmissions(input.db, store, next, input.requireCurrent);
  }
  private own(admission: ProcessAdmission): AdmissionState {
    const value = this.store.read();
    if (
      !value ||
      !same(admission, this.initial.admission) ||
      !same(value.admission, admission) ||
      !same(value.scope, this.initial.scope) ||
      !same(value.host, this.initial.host)
    )
      throw new Error('Native admission is stale or outside its host scope');
    return value;
  }
  /** Called in the genuine native spawn gate; the worker already measured the exact OS birth. */
  recordOwnership(identity: RuntimeProcessIdentity): void {
    this.signal.throwIfAborted();
    const owner = processIdentity.parse(identity);
    if (owner.platform !== process.platform)
      throw new Error('Native admission belongs to another OS');
    const previous = this.own(this.admission);
    if (previous.status === 'active' && same(previous.owner, owner)) return;
    if (previous.status !== 'prepared')
      throw new Error('Native admission cannot own another process');
    this.processes.started(this.store.processKey, owner.pid, false, owner);
    this.store.replace(previous, { ...previous, owner, status: 'active' });
    this.signal.throwIfAborted();
  }
  async admit(identity: RuntimeProcessIdentity, signal: AbortSignal): Promise<ProcessAdmission> {
    signal.throwIfAborted();
    if ((await processBirth(identity.pid)) !== identity.birth)
      throw new Error('Native process exited before admission');
    signal.throwIfAborted();
    this.recordOwnership(identity);
    await this.requireActive(this.admission, signal);
    return this.admission;
  }
  async requireActive(admission: ProcessAdmission, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    this.signal.throwIfAborted();
    const before = this.own(admission);
    if (before.status !== 'active' || !before.owner)
      throw new Error('Native admission is not active');
    await this.current(signal);
    signal.throwIfAborted();
    this.signal.throwIfAborted();
    if ((await processBirth(before.owner.pid)) !== before.owner.birth)
      throw new Error('Native process owner has exited');
    signal.throwIfAborted();
    this.signal.throwIfAborted();
    if (!same(this.own(admission), before))
      throw new Error('Native admission changed during the operation');
  }
  async revoke(admission: ProcessAdmission, reason: string): Promise<void> {
    const previous = this.own(admission);
    if (!['revoked', 'exited'].includes(previous.status))
      this.store.replace(previous, {
        ...previous,
        status: 'revoked',
        reason: reason.slice(0, 256),
      });
    this.controller.abort();
  }
  async confirmExit(admission: ProcessAdmission): Promise<void> {
    const previous = this.own(admission);
    if (previous.status === 'exited') return;
    if (previous.status !== 'revoked')
      throw new Error('Revoke native admission before confirming exit');
    await this.processes.stop(this.store.processKey);
    if (previous.owner && (await processBirth(previous.owner.pid)) === previous.owner.birth)
      throw new Error('Native owner exit was not confirmed');
    const current = this.own(admission);
    if (current.status === 'exited') return;
    if (!same(current, previous))
      throw new Error('Native admission changed during exit confirmation');
    this.store.replace(previous, { ...previous, status: 'exited' });
  }
  /** Explicit startup recovery only; a live previous host cannot be silently replaced. */
  static async recover(db: AppDb, ownerKey: string, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    const store = new AdmissionStore(db, ownerKey);
    const previous = store.read();
    if (!previous || previous.status === 'exited') return;
    if ((await processBirth(previous.host.pid)) === previous.host.birth)
      throw new Error('Previous native admission host is still alive');
    signal.throwIfAborted();
    const revoked = { ...previous, status: 'revoked' as const, reason: 'Previous host exited' };
    store.replace(previous, revoked);
    await new TaskRunProcesses(db).stop(store.processKey);
    signal.throwIfAborted();
    if (revoked.owner && (await processBirth(revoked.owner.pid)) === revoked.owner.birth)
      throw new Error('Recovered native owner exit was not confirmed');
    store.replace(revoked, { ...revoked, status: 'exited' });
  }
}
