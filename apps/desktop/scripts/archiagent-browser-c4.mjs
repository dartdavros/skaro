import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, project } from './archiagent-browser-session.mjs';

export async function verifyBrowserC4(browser, directory) {
  const { invoke, page } = browser;
  const audit = await invoke('c4.audit', project);
  assert.equal(audit.state, 'partial');
  await browser.openProject();
  await page.locator('.project-nav').getByRole('button', { name: 'C4', exact: true }).click();
  await page.locator('[data-c4-audit]').click();
  const background = page.getByRole('dialog', { name: 'Фоновая работа', exact: true });
  await expect(background.locator(`[data-c4-audit-row="${audit.id}"]`)).toContainText(
    'Сверка завершена не полностью',
  );
  await browser.screenshot('joint-c4-partial');
  await page.keyboard.press('Escape');
  const source = JSON.parse(await readFile(join(directory, 'material-prepare-proof.json'), 'utf8'));
  assert(source.passed && source.material.state === 'pending');
  const entries = (await invoke('decisions.list', project)).filter(
    (d) => d.kind === 'proposal' && d.item.id === source.material.packageId,
  );
  assert.equal(entries.length, 1);
  const entry = entries[0];
  await page.locator('[data-decision-button]').click();
  const queue = page.getByRole('dialog', { name: 'Требуют ответа', exact: true });
  const card = queue.locator(`[data-project-decision="${entry.id}"]`);
  for (const name of ['Открыть', 'Отклонить', 'Применить']) {
    await expect(card.getByRole('button', { name, exact: true })).toBeVisible();
    await expect(card.getByRole('button', { name, exact: true }).locator('svg')).toHaveCount(1);
  }
  await browser.screenshot('joint-material-queue');
  await card.getByRole('button', { name: 'Открыть', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: entry.item.proposal.title, exact: true }),
  ).toBeVisible();
  await browser.screenshot('joint-material-review');
  await page.keyboard.press('Escape');
  if (await queue.isVisible())
    await queue.getByRole('button', { name: 'Позже', exact: true }).click();
  return {
    partialAudit: { id: audit.id, chatId: audit.chatId, state: audit.state },
    material: {
      id: entry.id,
      revision: entry.revision,
      packageId: entry.item.id,
      task: entry.origin.id,
    },
    materialApplied: false,
  };
}

export async function assertBrowserC4(browser, baseline) {
  const audit = await browser.invoke('c4.audit', project);
  assert.equal(audit.id, baseline.partialAudit.id);
  assert.equal(audit.state, 'partial');
  const entry = (await browser.invoke('decisions.list', project)).find(
    (d) => d.id === baseline.material.id,
  );
  assert.equal(entry?.revision, baseline.material.revision);
  assert(entry?.kind === 'proposal' && entry.item.state === 'pending');
}
