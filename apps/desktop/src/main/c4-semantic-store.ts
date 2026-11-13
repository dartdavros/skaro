import type { AppDb } from '@skaro/core';
import type { C4ImpactObservation } from './c4-impact-observation';
import type { C4SemanticVerdict } from './c4-semantic-result';
import { memoryVersion } from './project-memory-sources';
import { c4SemanticFingerprint, parseC4SemanticVerdict } from './c4-semantic-result';

export interface C4SemanticJob {
  version: 1;
  id: string;
  projectId: string;
  taskId: string;
  runId: string;
  intent: number;
  dispatchRevision: number;
  fingerprint: string;
  contextHash: string;
  observation: C4ImpactObservation;
  packageId?: string;
  worker?: string;
  delivered?: boolean;
  state: 'queued' | 'running' | 'verified' | 'failed' | 'uncertain';
  verdict?: C4SemanticVerdict;
  error?: string;
  reviewer?: {
    worker: string;
    nativeSessionId: string;
    agent: string;
    log: string;
    logHash: string;
  };
}
const key = (id: string) => `c4.coordination.review.${id}`;
const current = (run: string) => `c4.coordination.current.${run}`;
export class C4SemanticStore {
  private readonly db: AppDb;
  constructor(db: AppDb) {
    this.db = db;
  }
  get(id: string): C4SemanticJob | undefined {
    const job = this.db.getSetting<C4SemanticJob | undefined>(key(id), undefined, { strict: true });
    if (
      job &&
      (job.version !== 1 ||
        job.id !== id ||
        job.id !==
          C4SemanticStore.id(
            job.projectId,
            job.runId,
            job.fingerprint,
            job.intent,
            job.packageId,
          ) ||
        job.fingerprint !== c4SemanticFingerprint(job.observation, job.contextHash) ||
        !['queued', 'running', 'verified', 'failed', 'uncertain'].includes(job.state))
    )
      throw new Error('Invalid C4 semantic job');
    return job;
  }
  current(run: string) {
    const id = this.db.getSetting<string | undefined>(current(run), undefined, { strict: true });
    const job = id ? this.get(id) : undefined;
    if (job && job.runId !== run) throw new Error('C4 review pointer addresses another run');
    return job;
  }
  request(job: C4SemanticJob) {
    if (
      job.state !== 'queued' ||
      job.id !==
        C4SemanticStore.id(job.projectId, job.runId, job.fingerprint, job.intent, job.packageId) ||
      job.fingerprint !== c4SemanticFingerprint(job.observation, job.contextHash) ||
      job.observation.impact.projectId !== job.projectId ||
      job.observation.impact.taskId !== job.taskId ||
      job.observation.impact.runId !== job.runId
    )
      throw new Error('Invalid C4 review request identity');
    if (!this.db.settings.compareAndSet(key(job.id), undefined, job)) {
      const saved = this.get(job.id)!;
      if (
        saved.fingerprint !== job.fingerprint ||
        saved.runId !== job.runId ||
        saved.packageId !== job.packageId
      )
        throw new Error('C4 review identity changed');
      job = saved;
    }
    this.db.setSetting(current(job.runId), job.id);
    return job;
  }
  update(
    before: C4SemanticJob,
    patch: Partial<
      Pick<C4SemanticJob, 'state' | 'verdict' | 'error' | 'reviewer' | 'worker' | 'delivered'>
    >,
  ) {
    const next = { ...before, ...patch };
    const transitions = {
      queued: ['queued', 'running', 'failed'],
      running: ['running', 'verified', 'failed', 'uncertain'],
      verified: ['verified'],
      failed: ['failed'],
      uncertain: ['uncertain'],
    };
    if (
      !transitions[before.state].includes(next.state) ||
      (before.state === 'verified' && (patch.verdict || patch.reviewer || patch.worker))
    )
      throw new Error('Invalid C4 review transition');
    if (next.state === 'verified') {
      if (
        !next.verdict ||
        !next.reviewer?.nativeSessionId ||
        next.reviewer.worker !== next.worker ||
        !/^[a-f0-9]{64}$/.test(next.reviewer.logHash)
      )
        throw new Error(
          'Verified C4 review needs the independent native completion and durable log',
        );
      parseC4SemanticVerdict(JSON.stringify(next.verdict), next.fingerprint, next.observation);
    }
    if (!this.db.settings.compareAndSet(key(before.id), before, next))
      throw new Error('C4 semantic job changed');
    return next;
  }
  static id(project: string, run: string, fingerprint: string, intent: number, packageId?: string) {
    return memoryVersion([project, run, fingerprint, intent, packageId]);
  }
}
