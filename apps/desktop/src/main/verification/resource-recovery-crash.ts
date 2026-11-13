import { app } from 'electron';
import { watch, existsSync, writeFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { join } from 'node:path';
import type { AppDb } from '@skaro/core';
import { ResourceLifecycle } from '../resource-lifecycle';
import { recordKey, type RetainedCheckout } from '../worktree-retention-model';
import { recoveryTarget, type RecoveryCase } from './resource-recovery-case';

/** Observe actual deleted payload and the genuine checkpoint, never manufacture a lifecycle row. */
export function watchRecoveryCleanup(db: AppDb, scenario: RecoveryCase, directory: string) {
  const resource = recoveryTarget(db, scenario);
  let triggered = false;
  const observe = () => {
    if (
      triggered ||
      existsSync(join(scenario.target, 'index.html')) ||
      !existsSync(join(scenario.target, '.git'))
    )
      return;
    const step = new ResourceLifecycle(db).read(resource, 'worktree.remove');
    const fence = db.resources.cleanup.read(resource.id);
    const proof = db.getSetting<RetainedCheckout | null>(
      recordKey(scenario.target),
      null,
    )?.trackedClean;
    if (
      !step ||
      step.state !== 'running' ||
      !fence ||
      fence.externalPending ||
      !proof ||
      proof.operationId !== step.id ||
      proof.generation !== resource.generation ||
      fence.pid !== process.pid
    )
      return;
    triggered = true;
    const checkpoint = {
      project: scenario.project,
      resource,
      step,
      fence,
      proof,
      pid: process.pid,
      boundary:
        'Actual index.html removed; Git identity present; checkpoint running; no external executor pending',
      at: new Date().toISOString(),
    };
    const path = join(directory, 'cleanup-checkpoint.json');
    writeFileSync(path, JSON.stringify(checkpoint, null, 2));
    const fd = openSync(path, 'r+');
    try {
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    app.exit(76);
  };
  const watcher = watch(scenario.target, { recursive: true }, observe),
    timer = setInterval(observe, 10);
  return () => {
    watcher.close();
    clearInterval(timer);
  };
}
