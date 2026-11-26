import { expect, test } from '@playwright/test';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';
import { sessionLimit } from '../src/renderer/src/limits/session-limit';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env.SKARO_FOLLOW_UP_PROFILE;
const project = process.env.SKARO_VERIFICATION_PROJECT;
test.skip(!profile || !project, 'Requires the real registered Cat-pilot and managed Codex account');

test('restored Codex feeds display the current provider quota', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.bar')).toBeVisible();
    const targets = await page.evaluate(async (id) => {
      const projects = await window.skaro.invoke('projects.list');
      if (projects.length !== 1 || projects[0]?.id !== id)
        throw new Error('Wrong verification scope');
      const tasks = await window.skaro.invoke('tasks.list', id);
      const chats = await window.skaro.invoke('chats.list', id);
      return {
        tasks: tasks.find((t) => t.agent === 'codex' && t.status === 'done')?.id,
        chat: chats.find((c) => c.agent === 'codex' && !c.archived && !c.live)?.id,
      };
    }, project!);
    for (const section of ['tasks', 'chat'] as const) {
      expect(targets[section], 'Existing Cat-pilot Codex history').toBeTruthy();
      await page.evaluate(
        async ({ project, section, targets }) => {
          await window.skaro.invoke('app.setSetting', 'ui.workspace', {
            view: 'project',
            sections: { [project]: section },
            openTasks: { [project]: targets.tasks },
            openChats: { [project]: targets.chat },
          });
        },
        { project: project!, section, targets },
      );
      await page.reload();
      const feed = page
        .locator(section === 'tasks' ? '.task-conversation' : '.main')
        .filter({ has: page.locator('.banners') });
      await expect(feed.locator('.banners')).toBeAttached();
      await page
        .locator('button')
        .filter({ has: page.locator('.limit-gauge') })
        .click();
      const picker = page.locator('.limits-body .agent').filter({ hasText: 'Codex' });
      await picker.click();
      await expect(picker).toHaveClass(/\bon\b/);
      await expect(page.locator('.checked')).not.toBeEmpty({ timeout: 45_000 });
      await page.keyboard.press('Escape');
      await expect(page.locator('.limits-body')).toHaveCount(0);
      const snapshot = await page.evaluate(() => window.skaro.invoke('agents.limits', 'codex'));
      expect(snapshot.windows.some((w) => w.remainingPercent !== null)).toBe(true);
      const limit = sessionLimit(snapshot, Date.now());
      const banner = feed
        .locator('.banners .banner')
        .filter({ hasText: /лимит Codex|Codex usage limit/i });
      await expect(banner).toHaveCount(limit ? 1 : 0);
      if (limit) await expect(banner).toBeVisible();
      await page.screenshot({ path: info.outputPath(section + '.png') });
    }
  } finally {
    await app.close();
  }
});
