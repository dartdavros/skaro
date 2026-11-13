import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Services } from '../app-services';
import { CompletionStore, criteriaRevision } from '../completion-store';
import { C4SemanticStore } from '../c4-semantic-store';
import { requireC4ReviewEvidence } from '../c4-review-evidence';
import {
  c4SemanticContext,
  c4SemanticContextHash,
  c4SemanticTaskBody,
} from '../c4-semantic-context';
import { setCriteria, taskSections, withSummary } from '../task-body';
import { serializeTaskMutation } from '../project-task-mutations';

/** Repair only formatting lost by the old host summary writer, from the exact verified input. */
export async function restoreArchiagentTaskFormatting(
  s: Services,
  project: string,
  directory: string,
) {
  const context = s.projects.get(project),
    result = new CompletionStore(s.db, project).result('T-016');
  assert(result?.c4?.semanticReceipt && result.c4.scope);
  const review = result.c4,
    job = new C4SemanticStore(s.db).get(review.semanticReceipt!)!;
  await requireC4ReviewEvidence(job);
  assert(job.reviewer);
  const records = (await readFile(job.reviewer.log, 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  let original: string | undefined;
  for (const raw of records) {
    const line = raw.line ?? raw;
    if (line.method !== 'turn/start') continue;
    for (const input of line.params?.input ?? []) {
      if (typeof input.text !== 'string') continue;
      const block = input.text.split('\n\n').find((part: string) => part.startsWith('{"owner":'));
      if (!block) continue;
      const snapshot = JSON.parse(block);
      if (
        snapshot.owner.projectId === project &&
        snapshot.owner.taskId === result.taskId &&
        c4SemanticContextHash(snapshot.accepted) === review.semanticContextHash
      )
        original = snapshot.accepted.taskBody;
    }
  }
  assert(original && !/```|~~~/.test(original), 'This bounded case has no fenced-code whitespace');
  return serializeTaskMutation(context, async () => {
    const task = await context.store.readTask(result.taskId),
      sections = taskSections(task.body);
    assert.equal(task.status, 'review');
    assert.equal(sections.criteria.length, 3);
    assert(
      sections.criteria.every((c) => c.done),
      'Preserve only the already accepted native verdicts',
    );
    assert.equal(criteriaRevision(task), result.criteria);
    const semantic = c4SemanticTaskBody(task.body);
    if (semantic === original) return { repaired: false, acceptedInputRestored: true };
    assert.equal(semantic.replace(/\n{3,}/g, '\n\n'), original.replace(/\n{3,}/g, '\n\n'));
    const body = withSummary(
      setCriteria(
        original,
        sections.criteria.map((c) => c.done),
      ),
      sections.summary!,
    );
    assert.deepEqual(
      taskSections(body),
      sections,
      'No criterion, requirement, note or result is changed',
    );
    assert.equal(criteriaRevision({ ...task, body }), result.criteria);
    const artifacts = await context.store.load();
    const restored = {
      ...artifacts,
      tasks: artifacts.tasks.map((t) => (t.id === task.id ? { ...t, body } : t)),
    };
    assert.equal(
      c4SemanticContextHash({
        ...c4SemanticContext(restored, task.id, review.scope!),
        preservation: review.preservation,
      }),
      review.semanticContextHash,
    );
    await context.store.updateTask(task.id, { body });
    context.invalidate();
    const sha = (text: string) => createHash('sha256').update(text).digest('hex');
    const proof = {
      task: task.id,
      repaired: true,
      acceptedInputRestored: true,
      before: sha(task.body),
      after: sha(body),
      nativeCriteriaPreserved: sections.criteria,
      review: job.id,
      acceptedHead: result.head,
    };
    await writeFile(
      join(directory, 'task-summary-format-repair.json'),
      JSON.stringify(proof, null, 2),
    );
    return proof;
  });
}
