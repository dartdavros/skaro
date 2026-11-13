import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Services } from '../app-services';
import { sessionHandlers } from '../session-handlers';
import { eventually } from './resource-workflow-observation';

/** Partial is a genuine terminal result, not a manufactured package or a complete acceptance. */
export async function observeArchiagentC4(s: Services, project: string, directory: string) {
  const started = JSON.parse(await readFile(join(directory, 'c4-audit-started.json'), 'utf8'));
  const audit = await sessionHandlers(s)['c4.audit'](project);
  assert(
    audit && audit.id === started.id && audit.state === 'partial' && audit.result === 'partial',
  );
  assert(audit.chatId && !audit.packageId && audit.summary);
  const records = await s.c4.records(project);
  assert.equal(records.filter((record) => record.scope.chatId === audit.chatId).length, 0);
  const artifacts = await s.projects.get(project).load();
  assert.equal(artifacts.c4?.revision, 4);
  assert.equal(artifacts.c4.questions.length, 9);
  const chat = await s.chats.open(project, audit.chatId);
  assert.equal(chat.timeline.turns.at(-1)?.outcome, 'done');
  return {
    audit,
    modelRevision: artifacts.c4.revision,
    questions: artifacts.c4.questions.map((q) => q.id),
    newPackageCreated: false,
    fullAcceptanceComplete: false,
    observationModelCalls: 0,
    nativeTurnUsage: chat.timeline.turns.at(-1)?.usage,
  };
}

/** A fresh real audit of accepted Cat-pilot sources. It may report unchanged; never force a proposal. */
export async function verifyArchiagentC4(s: Services, project: string, directory: string) {
  const handlers = sessionHandlers(s);
  const previous = await handlers['c4.audit'](project);
  const started = await handlers['c4.auditStart'](project, previous?.id);
  await writeFile(join(directory, 'c4-audit-started.json'), JSON.stringify(started, null, 2));
  const final = await eventually(
    () => handlers['c4.audit'](project),
    (audit) =>
      !!audit &&
      audit.id === started.id &&
      ['decision', 'done', 'partial', 'error', 'conflict', 'stopped'].includes(audit.state),
    'genuine joint C4 audit outcome, no automatic model retry',
    480000,
  );
  assert(final);
  if (final.state === 'decision') {
    assert(final.packageId);
    const review = await handlers['c4.review'](project, final.packageId);
    await writeFile(join(directory, 'c4-owner-review.json'), JSON.stringify(review, null, 2));
    return {
      audit: final,
      ownerReview: join(directory, 'c4-owner-review.json'),
      ownerDecisionRequired: true,
      packageApplied: false,
    };
  }
  assert.equal(final.state, 'done', final.error ?? 'Audit did not finish');
  assert.equal(final.result, 'unchanged');
  return { audit: final, ownerDecisionRequired: false, technicalAuditUnchanged: true };
}
