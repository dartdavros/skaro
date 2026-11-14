import { expect, test } from '@playwright/test';
import { readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env.SKARO_DECISION_LIVE_PROFILE;
const proofFile = process.env.SKARO_DECISION_RECOVERY_PROOF;
const scope = process.env.SKARO_VERIFICATION_PROJECT;
test.skip(
  !profile || !proofFile || !scope,
  'Requires the genuine Cat-pilot decision workflow proof',
);

test('saves a real approval promptly, retires both presentations and preserves Stop', async ({
  browserName: _,
}, info) => {
  test.setTimeout(240000);
  expect(relative(resolve(profile!, 'verification'), resolve(proofFile!))).toMatch(
    /^decision-recovery-[\da-f-]+[\\/]proof\.json$/,
  );
  const proof = JSON.parse(readFileSync(proofFile!, 'utf8'));
  expect(proof.passed).toBe(true);
  expect(proof.project).toBe(scope);
  expect(proof.ui.stoppedReadinessVerified).toBe(true);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.bar').first().waitFor();
    expect(
      (await page.evaluate(() => window.skaro.invoke('projects.list'))).map((p) => p.id),
    ).toEqual([scope]);
    const tab = page.getByRole('tab').filter({ hasText: 'Cat-pilot' });
    if (await tab.count()) await tab.click();
    else
      await page
        .getByRole('button', { name: /Cat-pilot/ })
        .first()
        .click();
    const entryId = `coordinator:${proof.ui.decision}`;
    await expect
      .poll(async () =>
        (
          await page.evaluate((project) => window.skaro.invoke('decisions.list', project), scope!)
        ).some((d) => d.id === entryId),
      )
      .toBe(true);
    await page.getByRole('button', { name: /^(Требуют ответа|Needs your reply)/ }).click();
    const decision = page.locator(`[data-project-decision="${entryId}"]`);
    await expect(decision).toBeVisible();
    await page.screenshot({ path: info.outputPath('pending-decision.png') });
    const started = Date.now();
    await decision.getByRole('button', { name: /^(Разрешить|Allow)$/ }).click();
    await expect(decision).toContainText(/Ответ сохранён|Reply saved/);
    const replyMs = Date.now() - started;
    expect(replyMs).toBeLessThan(10000);
    expect(
      (
        await page.evaluate((project) => window.skaro.invoke('decisions.list', project), scope!)
      ).some((d) => d.id === entryId),
    ).toBe(false);
    const view = await page.evaluate(
      ({ project, task }) => window.skaro.invoke('task.open', project, task),
      proof.ui,
    );
    expect(view.timeline?.interactions.some((i) => i.id === entryId)).toBe(false);
    expect(view.timeline?.turns.length).toBe(proof.ui.turns);
    await page.screenshot({ path: info.outputPath('decision-saved.png') });
    const db = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
    try {
      const row = db
        .prepare('SELECT value FROM settings WHERE key=?')
        .get(`execution.${proof.ui.run}`);
      expect(JSON.parse(String(row?.value)).enabled).toBe(false);
    } finally {
      db.close();
    }
    expect(errors).toEqual([]);
    writeFileSync(
      info.outputPath('decision-proof.json'),
      JSON.stringify({ passed: true, replyMs, stopped: true, decision: entryId, errors }, null, 2),
    );
  } finally {
    try {
      const page = await app.firstWindow();
      await page.evaluate(
        ({ project, incident }) => window.skaro.invoke('incidents.cancel', project, incident),
        proof.ui,
      );
      const policy = await page.evaluate(
        (project) => window.skaro.invoke('incidents.policy', project),
        scope!,
      );
      await page.evaluate(
        ({ project, policy, revision }) =>
          window.skaro.invoke('incidents.setPolicy', project, policy, revision),
        { project: scope!, policy: proof.ui.policy, revision: policy.revision },
      );
    } finally {
      // Use the existing graceful end-session path even when the real profile has pending work.
      await app.evaluate(({ powerMonitor }) => powerMonitor.emit('shutdown'));
      await app.close();
    }
  }
});
