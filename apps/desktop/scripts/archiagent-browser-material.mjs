import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import { browserSession, expect, project } from './archiagent-browser-session.mjs';

const directory = resolve(process.argv[2] ?? '');
const approved = 'skaro-c4-d6141b85-3491-4060-b75c-5751a0dcb5f0';
const review = JSON.parse(await readFile(join(directory, 'material-owner-review.json'), 'utf8'));
assert.equal(review.packageId, approved);
assert.equal(review.identity, '3080b5d119488187fcaf9491bfb3fde7ab9bfd5e2e4d05d2a3c99b1c963e3e9d');
const root = 'C:/Users/drmar/MyProjects/TestProject/Test Project';
const accepted = async () => ({
  architecture: createHash('sha256')
    .update(await readFile(join(root, '.skaro/architecture.md')))
    .digest('hex'),
  model: JSON.parse(await readFile(join(root, '.skaro/c4/model.json'), 'utf8')),
  adr: await readdir(join(root, '.skaro/adr')),
});
const proof = {
  projectId: project,
  packageId: approved,
  startedAt: new Date().toISOString(),
  errors: [],
};
const browser = browserSession(directory, proof, 'browser-material-reject-proof.json'),
  invoke = browser.invoke;
try {
  const before = await accepted();
  assert.equal(before.model.revision, 4);
  assert.equal(before.model.questions.length, 9);
  await browser.launch();
  const view = await invoke('task.open', project, 'T-015'),
    turns = view.timeline.turns.length;
  const entries = (await invoke('decisions.list', project)).filter(
    (d) => d.kind === 'proposal' && d.item.id === approved,
  );
  assert.equal(entries.length, 1);
  const entry = entries[0];
  await browser.openProject();
  await browser.page.locator('[data-decision-button]').click();
  const card = browser.page
    .getByRole('dialog', { name: 'Требуют ответа', exact: true })
    .locator(`[data-project-decision="${entry.id}"]`);
  await expect(card).toHaveCount(1);
  await browser.screenshot('material-before-reject');
  await card.getByRole('button', { name: 'Отклонить', exact: true }).click();
  await expect
    .poll(
      async () =>
        (await invoke('task.open', project, 'T-015')).timeline.items.find(
          (i) => i.kind === 'proposal' && i.id === approved,
        )?.state,
    )
    .toBe('rejected');
  assert(!(await invoke('decisions.list', project)).some((d) => d.id === entry.id));
  await assert.rejects(
    invoke('decisions.answer', project, entry.id, entry.revision, {
      kind: 'proposal',
      action: { action: 'reject' },
    }),
  );
  assert.deepEqual(await accepted(), before);
  assert.equal((await invoke('task.open', project, 'T-015')).timeline.turns.length, turns);
  await browser.screenshot('material-rejected-once');
  proof.before = before;
  proof.decision = entry;
  proof.turns = turns;
  await browser.close();
  await browser.launch();
  const restored = await invoke('task.open', project, 'T-015');
  assert.equal(
    restored.timeline.items.find((i) => i.kind === 'proposal' && i.id === approved)?.state,
    'rejected',
  );
  assert.equal(restored.timeline.turns.length, turns);
  assert(
    !(await invoke('decisions.list', project)).some(
      (d) => d.kind === 'proposal' && d.item.id === approved,
    ),
  );
  assert.deepEqual(await accepted(), before);
  proof.result = {
    oneDecision: true,
    replayRejected: true,
    restartPreserved: true,
    stoppedTaskPreserved: true,
    modelRevision: 4,
    openQuestions: 9,
    architectureApplied: false,
  };
  assert.deepEqual(proof.errors, []);
  proof.passed = true;
} catch (error) {
  proof.error = error.stack ?? String(error);
  proof.passed = false;
  process.exitCode = 1;
} finally {
  await writeFile(
    join(directory, 'browser-material-reject-proof.json'),
    JSON.stringify(proof, null, 2),
  );
  await browser.close();
  console.log(JSON.stringify({ passed: proof.passed, error: proof.error }));
}
