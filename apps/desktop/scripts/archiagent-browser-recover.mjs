/* global document */
import assert from 'node:assert/strict';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { browserSession, expect, project } from './archiagent-browser-session.mjs';
import { assertBrowserC4 } from './archiagent-browser-c4.mjs';

const directory = resolve(process.argv[2] ?? '');
await copyFile(
  join(directory, 'browser-recovery-proof.json'),
  join(directory, `browser-recovery-previous-${randomUUID()}.json`),
).catch((error) => {
  if (error.code !== 'ENOENT') throw error;
});
const previous = JSON.parse(await readFile(join(directory, 'browser-shared-proof.json'), 'utf8'));
assert(previous.projectId === project && previous.error.includes('128 !== 0'));
const proof = {
  projectId: project,
  startedAt: new Date().toISOString(),
  errors: [],
  priorFailedAttempt: 'browser-shared-proof.json',
};
const browser = browserSession(directory, proof, 'browser-recovery-proof.json'),
  invoke = browser.invoke;
const tasks = ['T-010', 'T-011'];
let policy, savedPolicy;
try {
  await browser.launch();
  await assertBrowserC4(browser, previous.realC4);
  const inspection = JSON.parse(
    await readFile(join(directory, 'inspect-proof.json'), 'utf8'),
  ).inspection;
  const resource = inspection.resources.find(
    (r) => r.kind === 'environment' && r.owner.id === tasks[0],
  );
  savedPolicy = await invoke('incidents.policy', project);
  const open = (await invoke('incidents.list', project)).filter(
    (r) =>
      r.state === 'open' &&
      r.subject.id === resource.id &&
      r.protocol?.ownerPolicyRevision === savedPolicy.revision &&
      r.protocol.subscriptions.length === 2,
  );
  assert.equal(open.length, 1, 'Resume exactly the genuine pending browser incident');
  const incident = open[0],
    id = `coordinator:${incident.protocol.decisionId}`;
  assert.equal(savedPolicy.revision, incident.protocol.ownerPolicyRevision);
  assert.equal(savedPolicy.mode, 'confirm');
  const preflight = JSON.parse(await readFile(join(directory, 'preflight.json'), 'utf8'));
  const original = preflight.policies?.find((r) => r.key === `coordination.policy.${project}`);
  assert(original, 'Read the real policy saved before acceptance');
  policy = JSON.parse(original.value);
  const views = await Promise.all(tasks.map((t) => invoke('task.open', project, t)));
  const message = views[0].timeline.items.findLast(
    (i) =>
      i.kind === 'message' &&
      i.role === 'user' &&
      i.text?.includes('read-only browser-приёмке AG-1'),
  );
  const marker = message?.text.match(/AG1_BROWSER_[0-9a-f]{8}/)?.[0];
  assert(marker);
  const turns = views.map((v) => v.timeline.turns.length);
  const decisions = (await invoke('decisions.list', project)).filter((d) => d.id === id);
  assert.equal(decisions.length, 1);
  proof.pending = { incident: incident.id, decision: id, marker, before: decisions[0] };
  await browser.openProject();
  await browser.page
    .getByText('Аудит штатного окружения Cat-pilot и допуска ресурсов RC-2', { exact: true })
    .first()
    .click();
  const pending = browser.page
    .locator('.task-conversation .pending-actions .fd-card')
    .filter({ has: browser.page.getByRole('button', { name: 'Разрешить', exact: true }) });
  await expect(pending).toHaveCount(1);
  const scroller = browser.page.locator('.task-conversation .feed-wrap .scroller');
  const range = () =>
    browser.page.locator('.task-conversation [data-history-index]').evaluateAll((nodes) => {
      const indexes = nodes.map((node) => Number(node.getAttribute('data-history-index')));
      return { min: Math.min(...indexes), max: Math.max(...indexes), shown: indexes.length };
    });
  await scroller.evaluate((node) => {
    node.scrollTop = node.scrollHeight;
  });
  await expect.poll(async () => (await range()).min).toBeGreaterThan(0);
  proof.historyBottom = await range();
  await scroller.evaluate((node) => {
    node.scrollTop = 0;
  });
  await expect
    .poll(async () => {
      const current = await range();
      if (current.min !== 0) return false;
      const geometry = await pending.evaluate((node) => {
        const r = node.getBoundingClientRect(),
          c = document.querySelector('.task-conversation .composer').getBoundingClientRect();
        return { top: r.top, bottom: r.bottom, composer: c.top };
      });
      proof.historyTop = { range: current, geometry };
      return geometry.top >= 0 && geometry.bottom <= geometry.composer;
    })
    .toBe(true);
  await browser.screenshot('joint-recovered-history');
  await browser.page.locator('[data-decision-button]').click();
  const card = browser.page
    .getByRole('dialog', { name: 'Требуют ответа', exact: true })
    .locator(`[data-project-decision="${id}"]`);
  await expect(card).toHaveCount(1);
  await browser.screenshot('joint-recovered-decision');
  await card.getByRole('button', { name: 'Разрешить', exact: true }).click();
  await expect
    .poll(
      async () => {
        const v = await invoke('task.open', project, tasks[0]);
        return v.timeline.items.some(
          (i) =>
            i.kind === 'message' &&
            i.role === 'agent' &&
            i.text?.trim() === `${marker}_${tasks[0]}` &&
            v.timeline.turns.find((t) => t.id === i.turnId)?.outcome === 'done',
        );
      },
      { timeout: 240000 },
    )
    .toBe(true);
  assert.equal((await invoke('task.open', project, tasks[1])).timeline.turns.length, turns[1]);
  const resolved = (await invoke('incidents.list', project)).find((r) => r.id === incident.id);
  assert.equal(resolved.state, 'resolved');
  assert.equal(resolved.protocol.attempts, 1);
  await assert.rejects(
    invoke('task.respond', project, tasks[0], id, { kind: 'approval', choice: 'allow_once' }),
  );
  for (let i = 0; i < tasks.length; i++)
    assert.deepEqual(
      (await invoke('task.open', project, tasks[i])).task.criteria,
      views[i].task.criteria,
    );
  await assertBrowserC4(browser, previous.realC4);
  proof.result = {
    oneEffect: true,
    stoppedTaskPreserved: tasks[1],
    nativeContinuation: tasks[0],
    materialPendingPreserved: true,
  };
  await browser.screenshot('joint-recovered-applied-once');
  assert.deepEqual(proof.errors, []);
  proof.passed = true;
} catch (error) {
  proof.error = error.stack ?? String(error);
  process.exitCode = 1;
  await browser.screenshot('joint-recovery-failure').catch(() => undefined);
} finally {
  try {
    for (const task of tasks) await invoke('task.interrupt', project, task);
    if (policy) {
      const current = await invoke('incidents.policy', project);
      assert.equal(
        current.revision,
        savedPolicy.revision,
        'Do not overwrite a concurrent policy edit',
      );
      await invoke('incidents.setPolicy', project, policy, current.revision);
    }
  } catch (error) {
    proof.cleanupError = String(error);
    proof.passed = false;
    process.exitCode = 1;
  }
  await writeFile(join(directory, 'browser-recovery-proof.json'), JSON.stringify(proof, null, 2));
  await browser.close();
  console.log(
    JSON.stringify({ passed: proof.passed, error: proof.error, cleanupError: proof.cleanupError }),
  );
}
