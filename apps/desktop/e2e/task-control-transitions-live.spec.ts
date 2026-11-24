import { expect, test, type ElectronApplication } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { launchApp } from './launch';
import { crashAtCheckpoint } from './task-control-crash';
import type { SkaroApi } from '../src/shared/ipc';
import type { TaskTransition } from '../src/main/task-lifecycle-journal';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env.SKARO_LIFECYCLE_PROFILE;
const project = process.env.SKARO_VERIFICATION_PROJECT;
test.skip(!profile || !project, 'Requires the genuine Cat-pilot profile');

test('recovers interrupted Stop and Resume commands against the recorded native run', async () => {
  test.setTimeout(240_000);
  const owner = { project: project!, task: 'T-010' };
  const db = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
  const read = db.prepare('SELECT value FROM collection_records WHERE collection=? AND id=?');
  const transition = (): TaskTransition | undefined => {
    const row = read.get(`task.lifecycle.v1.${project}`, owner.task);
    return row && JSON.parse(String(row.value));
  };
  let app: ElectronApplication | undefined;
  const launch = async () => {
    app = await launchApp(profile!, { openSavedProject: false });
    const page = await app.firstWindow();
    await expect(page.locator('.bar')).toBeVisible();
    expect(
      (await page.evaluate(() => window.skaro.invoke('projects.list'))).map((p) => p.id),
    ).toEqual([project]);
    return page;
  };
  try {
    expect(db.prepare('SELECT name FROM projects WHERE id=?').get(project!)?.name).toMatch(
      /^cat-pilot$/i,
    );
    let page = await launch();
    const control = () =>
      page.evaluate(
        ({ project, task }) => window.skaro.invoke('task.controls', project, task),
        owner,
      );
    const stop = (commandId: string) =>
      page.evaluate(
        ({ project, task, commandId }) =>
          window.skaro.invoke('task.park', project, task, 'stopped', commandId),
        { ...owner, commandId },
      );
    const resume = (commandId: string) =>
      page.evaluate(
        ({ project, task, commandId }) =>
          window.skaro.invoke('task.send', project, task, {
            commandId,
            resumeTask: true,
            text: 'Проверка аварийного восстановления Skaro. Ответь только «Принято». Не используй инструменты, не меняй файлы или статус задачи.',
          }),
        { ...owner, commandId },
      );
    const interrupt = async (id: string, action: () => Promise<unknown>) => {
      await crashAtCheckpoint(app!, project!, action, () => {
        const row = transition();
        return row?.commandId === id && row.phase !== 'settled' ? row.token : undefined;
      });
      app = undefined;
      expect(transition()?.phase).not.toBe('settled');
      page = await launch();
    };
    expect((await control())?.stage).toBe('in_progress');
    const stopId = randomUUID();
    await interrupt(stopId, () => stop(stopId));
    await expect
      .poll(transition, { timeout: 45_000 })
      .toMatchObject({ commandId: stopId, target: 'stopped', phase: 'settled' });
    expect((await control())?.stage).toBe('stopped');
    expect(await stop(stopId)).toMatchObject({ requestId: stopId, status: 'stopped' });

    const resumeId = randomUUID();
    await interrupt(resumeId, () => resume(resumeId));
    await expect
      .poll(
        () => {
          const row = transition();
          return row?.commandId === resumeId && (row.phase === 'settled' || !!row.incidentId);
        },
        { timeout: 45_000 },
      )
      .toBe(true);
    const recovered = transition()!;
    if (recovered.phase !== 'settled') {
      const incidents = await page.evaluate(
        (p) => window.skaro.invoke('incidents.list', p),
        project!,
      );
      expect(incidents.find((i) => i.id === recovered.incidentId)).toMatchObject({
        state: 'open',
        protocol: { code: 'task_lifecycle_unconfirmed' },
      });
      expect((await control())?.lifecyclePending).toBe(true);
      await stop(randomUUID());
      expect((await control())?.lifecyclePending).toBe(false);
      const current = await page.evaluate(
        (p) => window.skaro.invoke('incidents.list', p),
        project!,
      );
      expect(current.find((i) => i.id === recovered.incidentId)?.state).toBe('cancelled');
      const renewed = randomUUID();
      await resume(renewed);
      await expect
        .poll(transition, { timeout: 90_000 })
        .toMatchObject({ commandId: renewed, phase: 'settled', target: 'in_progress' });
    }
    expect((await control())?.stage).toBe('in_progress');
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
