import { createHash } from 'node:crypto';
import type { AppDb } from '@skaro/core';
import {
  nativeAdmissionState as admissionState,
  type NativeAdmissionState as AdmissionState,
} from '@skaro/agent-runtime';
export type { NativeAdmissionState as AdmissionState } from '@skaro/agent-runtime';

/** Metadata only; process tree ownership remains in the existing TaskRunProcesses registry. */
export class AdmissionStore {
  readonly processKey: string;
  private readonly key: string;
  private readonly db: AppDb;
  constructor(db: AppDb, ownerKey: string) {
    if (!ownerKey || ownerKey.length > 1024)
      throw new Error('Native admission requires an owner key');
    const hash = createHash('sha256').update(ownerKey).digest('hex');
    this.key = `builtin.admission.${hash}`;
    this.processKey = `builtin.${hash}`;
    this.db = db;
  }
  read(): AdmissionState | undefined {
    const raw = this.db.getSetting<unknown>(this.key, undefined);
    if (raw === undefined) return undefined;
    admissionState.parse(raw);
    return structuredClone(raw) as AdmissionState;
  }
  replace(expected: AdmissionState | undefined, next: AdmissionState): void {
    admissionState.parse(next);
    if (!this.db.settings.compareAndSet(this.key, expected, next))
      throw new Error('Native admission changed under another owner');
  }
}
