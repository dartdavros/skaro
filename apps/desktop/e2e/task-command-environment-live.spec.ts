import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_LIFECYCLE_PROFILE'];
const project = process.env['SKARO_VERIFICATION_PROJECT'];
const root = process.env['SKARO_E2E_WRITE_PROJECT_ROOT'];
test.skip(!profile || !project || !root, 'Requires the registered Cat-pilot profile');

test('a stopped task accepts a feed command and starts its real environment', async () => {
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
    const stopId = randomUUID();
    await page.evaluate(
      ({ project, task, stopId }) =>
        window.skaro.invoke('task.park', project, task, 'stopped', stopId),
      { ...owner, stopId },
    );
    parked = true;
    expect((await run()).task.stage).toBe('stopped');
    const commandId = randomUUID();
    const text =
      'Возобнови задачу по этой команде. Через resume_task подтверди текущую команду, затем ' +
      'запусти штатное окружение задачи через start_environment и выполни node --check js/controls.js. ' +
      'Это узкая проверка Skaro. Не меняй файлы, конфигурацию, данные или критерии, не вызывай submit_result. ' +
      'После этих двух проверок сообщи их результаты и жди.';
    await page.evaluate(
      ({ project, task, commandId, text }) =>
        window.skaro.invoke('task.send', project, task, { commandId, text }),
      { ...owner, commandId, text },
    );
    await expect
      .poll(
        async () => {
          const view = await run();
          const items = view.timeline?.items ?? [];
          const echo = items.find(
            (item) =>
              item.kind === 'message' &&
              item.role === 'user' &&
              item.text.includes(`command_id: ${commandId}\n`) &&
              item.text.includes(text),
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
      await app
        .evaluate(({ powerMonitor }) => powerMonitor.emit('shutdown'))
        .catch(() => undefined);
      await app.close();
      const after = await readFile(source, 'utf8');
      const restored = after.replace(/^status: stopped(?=\r?$)/m, 'status: in_progress');
      if (restored === original && restored !== after) await writeFile(source, restored);
      expect(restored).toBe(original);
    }
  }
});
