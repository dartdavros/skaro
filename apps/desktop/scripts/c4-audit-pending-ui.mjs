import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export function auditPackageHistory(projectId) {
  const db = new DatabaseSync(join(process.env.APPDATA, 'Skaro', 'workspace.db'), {
    readOnly: true,
  });
  try {
    return db
      .prepare('SELECT id,owner,state,metadata,payload FROM records WHERE project=? ORDER BY id')
      .all(projectId)
      .map(({ id, owner, state, metadata, payload }) => ({
        id,
        owner,
        state,
        protocol: JSON.parse(metadata).protocol ?? 'package-v1',
        metadataHash: createHash('sha256').update(metadata).digest('hex'),
        payloadHash: createHash('sha256').update(payload).digest('hex'),
      }));
  } finally {
    db.close();
  }
}

/** Read and defer the one genuine pending package. This helper never answers a decision. */
export async function verifyPendingAudit({
  page,
  invoke,
  projectId,
  expected,
  directory,
  expect,
  suffix = '',
}) {
  const audit = await invoke('c4.audit', projectId);
  assert.equal(audit.id, expected.id);
  assert.equal(audit.state, 'decision');
  assert.equal(audit.packageId, expected.packageId);
  const entries = (await invoke('decisions.list', projectId)).filter(
    (entry) => entry.origin.id === audit.chatId,
  );
  assert.equal(entries.length, 1, 'One audit must have one shared decision');
  const entry = entries[0];
  assert.equal(entry.kind, 'proposal');
  assert.equal(entry.item.proposal.type, 'architecture');
  assert.equal(entry.item.id, audit.packageId);
  const review = await invoke('c4.review', projectId, entry.item.id);
  const before = await invoke('c4.reviewModel', projectId, entry.item.id, 'before');
  const after = await invoke('c4.reviewModel', projectId, entry.item.id, 'after');
  assert.deepEqual(
    after.questions.map((q) => q.id),
    before.questions.map((q) => q.id),
  );
  for (const group of ['elements', 'relationships', 'views'])
    for (const value of before[group])
      assert.equal(after[group].find((next) => next.id === value.id)?.state, value.state);
  await page.locator('[data-c4-audit]').click();
  const background = page.getByRole('dialog', { name: 'Фоновая работа', exact: true });
  const row = background.locator(`[data-c4-audit-row="${audit.id}"]`);
  await row.getByRole('button', { name: 'Открыть решение', exact: true }).click();
  const queue = page.getByRole('dialog', { name: 'Требуют ответа', exact: true });
  const card = queue.locator(`[data-project-decision="${entry.id}"]`);
  await expect(card).toHaveCount(1);
  await card.scrollIntoViewIfNeeded();
  await writeFile(
    join(directory, `pending-card${suffix}.json`),
    JSON.stringify(
      { text: await card.innerText(), buttons: await card.locator('button').allTextContents() },
      null,
      2,
    ),
  );
  for (const name of ['Открыть', 'Отклонить', 'Применить']) {
    const button = card.getByRole('button', { name, exact: true });
    await expect(button).toBeVisible();
    await expect(button.locator('svg')).toHaveCount(1);
  }
  await page.screenshot({
    path: join(directory, `pending-decision${suffix}.png`),
    animations: 'disabled',
  });
  await card.getByRole('button', { name: 'Открыть', exact: true }).click();
  const viewer = page.getByRole('dialog', { name: entry.item.proposal.title, exact: true });
  await expect(viewer).toBeVisible();
  await page.screenshot({
    path: join(directory, `package-review${suffix}.png`),
    animations: 'disabled',
  });
  await page.keyboard.press('Escape');
  await page.locator('[data-decision-button]').click();
  await queue.getByRole('button', { name: 'Позже', exact: true }).click();
  const saved = (await invoke('decisions.list', projectId)).filter(
    (value) => value.origin.id === audit.chatId,
  );
  assert.equal(saved.length, 1);
  assert.equal(saved[0].id, entry.id);
  assert.equal(saved[0].revision, entry.revision);
  const result = {
    audit,
    decisionId: entry.id,
    revision: entry.revision,
    fingerprint: review.fingerprint,
    documents: review.documents.map((d) => d.path),
    modelRevision: { before: before.revision, proposed: after.revision },
    questions: after.questions.length,
    existingStatesPreserved: true,
  };
  await writeFile(
    join(directory, `pending-review${suffix}.json`),
    JSON.stringify({ ...result, review }, null, 2),
  );
  return result;
}
