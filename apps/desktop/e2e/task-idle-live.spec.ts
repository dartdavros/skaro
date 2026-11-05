import { _electron as electron, expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_IDLE_VERIFY_PROFILE'];
test.skip(!profile, 'Requires the real registered Cat-pilot profile and a stopped Skaro');

test('opening a completed real task remains idle without a project reload loop', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(120_000);
  const db = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
  const project = db
    .prepare('SELECT id FROM projects WHERE name=? COLLATE NOCASE')
    .get('Cat-pilot');
  db.close();
  expect(project).toBeDefined();
  const projectId = String(project!['id']);
  const app = await electron.launch({
    args: [join(__dirname, '..')],
    env: {
      ...process.env,
      SKARO_USER_DATA: profile!,
      SKARO_VERIFICATION_PROJECT: projectId,
    },
  });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await expect(page.locator('.bar')).toBeVisible();
    const projects = await page.evaluate(() => window.skaro.invoke('projects.list'));
    expect(projects.map((entry) => entry.id)).toEqual([projectId]);
    // Pick an existing completed task with real history. No task or result is fabricated.
    const taskId = await page.evaluate(async (id) => {
      const tasks = await window.skaro.invoke('tasks.list', id);
      const task = tasks.find((entry) => entry.status === 'done');
      if (!task) throw new Error('Cat-pilot needs an existing completed task');
      return task.id;
    }, projectId);
    const initial = await page.evaluate(
      ({ projectId, taskId }) =>
        window.skaro.invoke('task.open', projectId, taskId, { paged: true }),
      { projectId, taskId },
    );
    expect(initial.run).toBeDefined();
    await page.evaluate(
      async ({ projectId, taskId }) => {
        await window.skaro.invoke('app.setSetting', 'ui.workspace', {
          view: 'project',
          sections: { [projectId]: 'tasks' },
          openTasks: { [projectId]: taskId },
          openChats: {},
        });
      },
      { projectId, taskId },
    );
    await page.reload();
    await expect(page.getByText(initial.task.title, { exact: true }).first()).toBeVisible();
    const proof = await page.evaluate(
      async ({ projectId, taskId }) => {
        let projectChanges = 0;
        let taskChanges = 0;
        const offProject = window.skaro.on('project.changed', (event) => {
          if (event.projectId === projectId) projectChanges++;
        });
        const offTask = window.skaro.on('task.changed', (event) => {
          if (event.projectId === projectId && event.taskId === taskId) taskChanges++;
        });
        try {
          for (let i = 0; i < 25; i++)
            await window.skaro.invoke('task.open', projectId, taskId, { paged: true });
          await new Promise((resolve) => setTimeout(resolve, 5000));
          return {
            projectId,
            taskId,
            opens: 25,
            observedIdleMs: 5000,
            projectChanges,
            taskChanges,
          };
        } finally {
          offProject();
          offTask();
        }
      },
      { projectId, taskId },
    );
    expect(proof.projectChanges).toBe(0);
    expect(proof.taskChanges).toBe(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: info.outputPath('cat-pilot-idle.png') });
    await info.attach('runtime-proof', {
      body: JSON.stringify(proof, null, 2),
      contentType: 'application/json',
    });
    console.log('Actual Electron runtime proof:', proof);
  } finally {
    await app.close();
  }
});
