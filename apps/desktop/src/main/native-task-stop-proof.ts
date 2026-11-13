import type { AppDb, CoordinationRef, RunRecord } from '@skaro/core';

/** Only the host writes this receipt after attachment, transport and owned-process teardown. */
export function requireNativeTaskStopProof(db: AppDb, run: RunRecord, proof: CoordinationRef) {
  const receipt = db.getSetting<
    { version: number; state: string; epoch: number; requestId: string; runs: string[] } | undefined
  >(`native.task-stop.${run.id}`, undefined, { strict: true });
  const runs = db.listRuns(run.projectId, run.taskId, { includeRetired: true });
  if (
    proof.kind !== 'run' ||
    proof.id !== run.id ||
    receipt?.version !== 1 ||
    receipt.state !== 'verified' ||
    !Number.isSafeInteger(receipt.epoch) ||
    receipt.epoch < 0 ||
    receipt.epoch !== proof.version ||
    typeof receipt.requestId !== 'string' ||
    !receipt.requestId ||
    !Array.isArray(receipt.runs) ||
    JSON.stringify([...receipt.runs].sort()) !== JSON.stringify(runs.map((r) => r.id).sort()) ||
    db.latestRun(run.projectId, run.taskId)?.id !== run.id ||
    runs.some((r) => {
      const processes = db.getSetting<unknown>(`run.${r.id}.processes`, [], { strict: true });
      return !Array.isArray(processes) || processes.length !== 0;
    })
  )
    throw new Error('Native task transport shutdown has not been verified');
}
