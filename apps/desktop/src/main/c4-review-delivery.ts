import type { TaskRunEngine } from './task-run-engine';
import { C4SemanticStore, type C4SemanticJob } from './c4-semantic-store';
import { background } from './background/client';
import { c4Packages } from './c4-coordination-binding';
import { saveC4PackagePolicy } from './c4-package-policy';
import { queueOwnerMessage } from './owner-commands';
import { TaskExecution } from './task-execution';
import { requireC4ReviewEvidence } from './c4-review-evidence';
import { publishC4ReviewNotice } from './c4-review-notice';

/** Saved review first, then recoverable history/inbox delivery with stable identities. */
export async function deliverC4Review(
  ctx: TaskRunEngine,
  job: C4SemanticJob,
  fresh: () => Promise<void>,
) {
  const store = new C4SemanticStore(ctx.deps.db);
  if (job.state !== 'verified' || job.delivered) return;
  if (store.current(job.runId)?.id !== job.id) {
    store.update(job, { delivered: true });
    return;
  }
  await fresh();
  await requireC4ReviewEvidence(job);
  if (job.packageId) {
    const record = (await background(ctx.deps.dataDir, 'c4.list', job.projectId, job.taskId)).find(
      (r) => r.item.id === job.packageId,
    );
    if (!record) throw new Error('C4 proposal disappeared');
    saveC4PackagePolicy(ctx.deps.db, record, job.id, job.verdict!.category !== 'optional');
    await c4Packages(ctx.deps.db)!.publish(record);
  }
  await fresh();
  await publishC4ReviewNotice(ctx, job);
  await fresh();
  ctx.deps.db.settings.atomic(() => {
    const execution = new TaskExecution(ctx.deps.db, job.runId);
    if (
      !execution.read().enabled ||
      execution.intentVersion() !== job.intent ||
      store.current(job.runId)?.id !== job.id
    )
      throw new Error('C4 continuation authority changed');
    const saved = store.get(job.id)!;
    if (saved.delivered) return;
    if (
      job.verdict!.implementation === 'aligned' &&
      ['aligned', 'optional'].includes(job.verdict!.category)
    )
      queueOwnerMessage('task.send', job.projectId, job.taskId, {
        internal: true,
        commandId: `continue-c4-${job.id}`,
        text: 'Skaro completed independent C4 verification for the saved fingerprint. Recheck current inputs, then submit the existing authorized result. Accepted implementation needs no extra architecture approval. Do not repeat the review or modify unrelated files.',
      });
    store.update(saved, { delivered: true });
    ctx.deps.db.addEvent(job.projectId, 'c4_independent_review_finished', {
      task: job.taskId,
      run: job.runId,
      review: job.id,
      category: job.verdict!.category,
    });
  });
}
