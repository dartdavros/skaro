import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SkaroApi } from '../src/shared/ipc';
import { closeLiveApp, launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_LIFECYCLE_PROFILE'];
const project = process.env['SKARO_VERIFICATION_PROJECT'];
const root = process.env['SKARO_E2E_WRITE_PROJECT_ROOT'];
test.skip(!profile || !project || !root, 'Requires the registered Cat-pilot profile');

test('the task composer stops work and resumes it on owner text in the real environment', async () => {
  test.setTimeout(240_000);
  const owner = { project: project!, task: 'T-010' };
  const tasks = join(root!, '.skaro', 'tasks');
  const source = join(
    tasks,
    (await readdir(tasks)).find((name) => name.startsWith('T-010-'))!,
  );
  const original = await readFile(source, 'utf8');
  expect(original).toMatch(/^status: in_progress\r?$/m);
  const app = await launchApp(profile!, { openSavedProject: false });
  const page = await app.firstWindow();
  const db = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
  const environment = db.prepare('SELECT value FROM settings WHERE key=?');
  const run = () =>
    page.evaluate(({ project, task }) => window.skaro.invoke('task.open', project, task), owner);
  let parked = false;
  try {
    await expect(page.locator('.bar')).toBeVisible();
    expect(
      (await page.evaluate(() => window.skaro.invoke('projects.list'))).map((p) => p.id),
    ).toEqual([owner.project]);
    const before = await run();
    const worktree = before.run?.worktree;
    expect(worktree).toBeTruthy();
    const expected = await readFile(join(worktree!, 'index.html'), 'utf8');
    expect(before.run?.live).toBeFalsy();
    await page.evaluate(async ({ project, task }) => {
      await window.skaro.invoke('tabs.set', { projects: [project], active: project });
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        view: 'project',
        sections: { [project]: 'tasks' },
        openTasks: { [project]: task },
        openChats: {},
      });
    }, owner);
    await page.reload();
    const composer = page.locator('.task-conversation .composer');
    const draft = composer.locator('textarea');
    const stop = composer.locator('button.stop');
    const send = composer.locator('button.send');
    await expect(stop).toBeEnabled({ timeout: 30_000 });
    await expect(
      page.locator('.task-description button', { hasText: /^(Пауза|Возобновить|Остановить)$/ }),
    ).toHaveCount(0);
    await draft.fill('Черновик');
    await expect(send).toBeEnabled();
    await expect(stop).toHaveCount(0);
    await draft.clear();
    await expect(stop).toBeEnabled();
    await stop.click();
    await expect(send).toBeDisabled();
    parked = true;
    expect((await run()).task.stage).toBe('stopped');
    const marker = `COMPOSER_${randomUUID().slice(0, 8)}`;
    const message =
      `Доступно ли штатное окружение этой задачи? ${marker}. ` +
      'Проверь через start_environment и выполни node --check js/controls.js. ' +
      'Это узкая проверка Skaro. Не меняй файлы, конфигурацию, данные или критерии. ' +
      'Не вызывай resume_task и submit_result. Сообщи результаты этих двух проверок.';
    await draft.fill(message);
    await expect(send).toBeEnabled();
    expect((await run()).task.stage).toBe('stopped');
    await draft.press('Enter');
    await expect
      .poll(
        async () => {
          const view = await run();
          const items = view.timeline?.items ?? [];
          const echo = items.find(
            (item) => item.kind === 'message' && item.role === 'user' && item.text.includes(marker),
          );
          const current = echo ? items.filter((item) => item.turnId === echo.turnId) : [];
          const launched = current.some(
            (item) =>
              item.kind === 'tool' &&
              item.name.endsWith('start_environment') &&
              item.status === 'done',
          );
          const allocations = JSON.parse(
            String(environment.get('environments')?.value ?? '[]'),
          ) as { projectId: string; taskId: string; ports: { UI_PORT?: number } }[];
          const port = allocations.find(
            (item) => item.projectId === owner.project && item.taskId === owner.task,
          )?.ports.UI_PORT;
          const ready =
            launched && port
              ? await fetch(`http://localhost:${port}/`, { signal: AbortSignal.timeout(2000) })
                  .then(async (response) => response.ok && (await response.text()) === expected)
                  .catch(() => false)
              : false;
          return {
            status: view.task.stage,
            run: view.run?.id,
            startup: ready,
            modelResume: current.some(
              (item) => item.kind === 'tool' && item.name.endsWith('resume_task'),
            ),
            check: current.some(
              (item) =>
                item.kind === 'command' &&
                item.command.includes('node --check js/controls.js') &&
                item.exitCode === 0,
            ),
          };
        },
        { timeout: 170_000 },
      )
      .toEqual({
        status: 'in_progress',
        run: before.run?.id,
        startup: true,
        modelResume: false,
        check: true,
      });
  } finally {
    db.close();
    try {
      if (parked)
        await page.evaluate(
          ({ project, task }) => window.skaro.invoke('task.interrupt', project, task),
          owner,
        );
    } finally {
      try {
        await closeLiveApp(app);
      } finally {
        const after = await readFile(source, 'utf8');
        const restored = after.replace(/^status: stopped(?=\r?$)/m, 'status: in_progress');
        if (restored === original && restored !== after) await writeFile(source, restored);
        expect(restored).toBe(original);
      }
    }
  }
});
