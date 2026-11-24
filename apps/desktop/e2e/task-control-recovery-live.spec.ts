import { expect, test, type ElectronApplication } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { launchApp } from './launch';
import { crashAtCheckpoint } from './task-control-crash';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env.SKARO_LIFECYCLE_PROFILE;
const project = process.env.SKARO_VERIFICATION_PROJECT;
test.skip(!profile || !project, 'Requires the genuine Cat-pilot profile');

test('recovers an interrupted card read and retains owner control across a host restart', async ({
  browserName: _,
}, info) => {
  test.setTimeout(240_000);
  const db = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
  const task = 'T-010'; // Existing Cat-pilot resource-admission verification task.
  const owner = { project: project!, task };
  let app: ElectronApplication | undefined;
  try {
    expect(db.prepare('SELECT name FROM projects WHERE id=?').get(project!)?.name).toMatch(
      /^cat-pilot$/i,
    );
    app = await launchApp(profile!, { openSavedProject: false });
    let page = await app.firstWindow();
    await expect(page.locator('.bar')).toBeVisible();
    expect(
      (await page.evaluate(() => window.skaro.invoke('projects.list'))).map((p) => p.id),
    ).toEqual([project]);
    const readControl = () =>
      page.evaluate(
        ({ project, task }) => window.skaro.invoke('task.controls', project, task),
        owner,
      );
    const before = await readControl();
    expect(['in_progress', 'paused', 'stopped']).toContain(before?.stage);
    expect(before?.lifecyclePending).toBe(false);
    const start = Date.now();
    const claim = db.prepare(
      "SELECT id FROM coordination_operations WHERE project_id=? AND scope_key=? AND state='dispatching' AND created_at>=?",
    );
    const interrupted = await crashAtCheckpoint(
      app,
      project!,
      () =>
        page.evaluate(
          ({ project, task }) => window.skaro.invoke('task.open', project, task, { paged: true }),
          owner,
        ),
      () => claim.get(project!, `observation:task:${task}`, start)?.id as string | undefined,
    );
    app = undefined;
    expect(
      db
        .prepare('SELECT state FROM coordination_operations WHERE project_id=? AND id=?')
        .get(project!, interrupted!)?.state,
    ).toBe('dispatching');

    app = await launchApp(profile!, { openSavedProject: false });
    page = await app.firstWindow();
    await expect(page.locator('.bar')).toBeVisible();
    expect(
      db
        .prepare('SELECT evidence FROM coordination_operations WHERE project_id=? AND id=?')
        .get(project!, interrupted!)?.evidence,
    ).toContain('session_view_not_returned');
    const restored = await page.evaluate(
      ({ project, task }) => window.skaro.invoke('task.open', project, task, { paged: true }),
      owner,
    );
    expect(restored.run?.live).toBe(false);
    expect(restored.timeline?.interactions.filter((i) => i.kind !== 'merge') ?? []).toEqual([]);
    await page.evaluate(
      ({ project, task }) =>
        window.skaro.invoke('app.setSetting', 'ui.workspace', {
          view: 'project',
          sections: { [project]: 'tasks' },
          openTasks: { [project]: task },
          openChats: {},
        }),
      owner,
    );
    await page.reload();
    const panel = page.locator('.desc-col');
    await expect(panel.getByText(task, { exact: true })).toBeVisible();
    if (before?.stage === 'in_progress') {
      await panel.getByRole('button', { name: /^(Пауза|Pause)$/i }).click();
      await expect.poll(async () => (await readControl())?.stage).toBe('paused');
    }
    if (before?.stage !== 'stopped')
      await panel.getByRole('button', { name: /^(Остановить|Stop)$/i }).click();
    await expect.poll(async () => (await readControl())?.stage).toBe('stopped');
    await expect(
      panel.getByRole('button', { name: /Возобновить|Продолжить|Resume/i }),
    ).toBeVisible();
    await page.screenshot({ path: info.outputPath('stopped-task.png') });
    const request = randomUUID();
    const pause = () =>
      page.evaluate(
        ({ project, task, request }) =>
          window.skaro.invoke('task.park', project, task, 'paused', request),
        { ...owner, request },
      );
    const stale = await pause();
    expect(stale.status).toBe('stopped');
    expect(await pause()).toEqual(stale);

    // Bound the genuine agent turn to an acknowledgement in this verification task.
    const commandId = randomUUID();
    const reply = `Продолжение принято ${commandId.slice(0, 8)}`;
    await page.evaluate(
      ({ project, task, commandId, reply }) =>
        window.skaro.invoke('task.send', project, task, {
          commandId,
          resumeTask: true,
          text: `Проверка возобновления Skaro. Ответь только «${reply}». Не выполняй команды, не меняй файлы, не используй инструменты и не сдавай задачу.`,
        }),
      { ...owner, commandId, reply },
    );
    await expect
      .poll(async () => (await readControl())?.stage, { timeout: 90_000 })
      .toBe('in_progress');
    const entry = () =>
      JSON.parse(
        String(
          db
            .prepare('SELECT value FROM collection_records WHERE collection=? AND id=?')
            .get(`task.lifecycle.v1.${project}`, task)?.value,
        ),
      );
    expect(entry()).toMatchObject({ commandId, phase: 'settled', target: 'in_progress' });
    await expect(page.getByText(reply, { exact: true }).last()).toBeVisible({
      timeout: 90_000,
    });
    const proof = () =>
      page.evaluate(
        async ({ project, task, commandId, reply }) => {
          const { timeline } = await window.skaro.invoke('task.open', project, task);
          const echoes = timeline?.items.filter(
            (item) =>
              item.kind === 'message' &&
              item.role === 'user' &&
              item.native.type !== 'owner_command' &&
              item.text.includes(`command_id: ${commandId}\n`),
          );
          const turn = echoes?.[0]?.turnId;
          return {
            echoes: echoes?.length,
            reply:
              !!turn &&
              timeline?.items.some(
                (item) =>
                  item.turnId === turn &&
                  item.kind === 'message' &&
                  item.role === 'agent' &&
                  item.text.trim() === reply,
              ),
          };
        },
        { ...owner, commandId, reply },
      );
    await expect.poll(proof, { timeout: 90_000 }).toEqual({ echoes: 1, reply: true });
  } finally {
    db.close();
    if (app) {
      await app
        .evaluate(({ powerMonitor }) => powerMonitor.emit('shutdown'))
        .catch(() => undefined);
      await app.close();
    }
  }
});
