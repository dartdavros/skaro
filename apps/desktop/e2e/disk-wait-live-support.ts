import { expect, type Page } from '@playwright/test';
import { statfs } from 'node:fs/promises';
import type { SkaroApi, ChatSettings } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };

/** A separate normal checkout cannot contend with an unrelated legacy in-place task. */
export async function prepareDiskWaitTask(
  page: Page,
  p: string,
  t: string,
  settings: ChatSettings,
  verification: { chat: string; profile: string; policy: unknown; screenshot: string },
) {
  await page.evaluate(
    ({ p, t, settings }) =>
      window.skaro.invoke('task.setSettings', p, t, {
        agent: settings.agent,
        model: settings.model,
        effort: settings.effort,
        permissionMode: 'full',
        planFirst: false,
        isolation: 'worktree',
      }),
    { p, t, settings },
  );
  await reserveLiveDisk(page, verification.profile, verification.policy);
  await page.evaluate(
    ({ p, t }) =>
      window.skaro.invoke('task.send', p, t, {
        text: 'Проверка владельца: ответь только DISK_WAIT_TASK_READY. Никаких инструментов, файлов, окружений и submit_result. После ответа жди владельца.',
      }),
    { p, t },
  );
  await openDiskWaitOwner(page, p, verification.chat, t, 'tasks');
  await expect(page.locator('.empty-text')).toContainText('Ожидает места на диске', {
    timeout: 60000,
  });
  await expect(page.locator('.task-description .chip')).toHaveText('Ожидает места на диске');
  const initial = await page.evaluate(({ p, t }) => window.skaro.invoke('task.open', p, t), {
    p,
    t,
  });
  expect(initial.task.resourceWait?.reason).toBe('budget_disk');
  await page.screenshot({ path: verification.screenshot });
  await page.evaluate(
    (value) => window.skaro.invoke('app.setSetting', 'resources.policy.v1', value),
    verification.policy,
  );
  await expect
    .poll(
      async () => {
        const view = await page.evaluate(({ p, t }) => window.skaro.invoke('task.open', p, t), {
          p,
          t,
        });
        return view.timeline?.items.some(
          (i) =>
            i.kind === 'message' && i.role === 'agent' && i.text.includes('DISK_WAIT_TASK_READY'),
        );
      },
      { timeout: 180000 },
    )
    .toBe(true);
  await page.evaluate(({ p, t }) => window.skaro.invoke('task.interrupt', p, t), { p, t });
  const view = await page.evaluate(({ p, t }) => window.skaro.invoke('task.open', p, t), { p, t });
  return {
    initialWait: initial.task.resourceWait,
    messages: view.timeline?.items.filter((i) => i.kind === 'message').map((i) => i.id) ?? [],
  };
}

/** A real configured reserve over the measured free disk, without large files or fake metrics. */
export async function reserveLiveDisk(page: Page, profile: string, policy: unknown) {
  const disk = await statfs(profile, { bigint: true });
  await page.evaluate(
    ({ policy, reserve }) =>
      window.skaro.invoke('app.setSetting', 'resources.policy.v1', {
        ...(policy && typeof policy === 'object' ? policy : {}),
        reserveDiskBytes: reserve,
      }),
    { policy, reserve: Number(disk.bavail * disk.bsize) + 1024 ** 3 },
  );
}

export async function openDiskWaitOwner(
  page: Page,
  p: string,
  c: string,
  t: string,
  section: 'chat' | 'tasks',
) {
  await page.evaluate(
    ({ p, c, t, section }) =>
      window.skaro.invoke('app.setSetting', 'ui.workspace', {
        view: 'project',
        sections: { [p]: section },
        openChats: { [p]: c },
        openTasks: { [p]: t },
      }),
    { p, c, t, section },
  );
  await page.reload();
  await page.locator('.bar').first().waitFor();
}
