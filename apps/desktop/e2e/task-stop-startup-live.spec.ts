import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { processBirth, type OwnedProcess } from '@skaro/agent-runtime/process-identity';
import type { SkaroApi } from '../src/shared/ipc';
import type { TaskTransition } from '../src/main/task-lifecycle-journal';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env.SKARO_LIFECYCLE_PROFILE;
const project = process.env.SKARO_VERIFICATION_PROJECT;
test.skip(!profile || !project, 'Requires the genuine Cat-pilot profile');

test('Stop during native startup retires the registered process and permits a fresh Resume', async () => {
  test.setTimeout(180_000);
  const owner = { project: project!, task: 'T-010' };
  using db = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
  expect(db.prepare('SELECT name FROM projects WHERE id=?').get(project!)?.name).toMatch(
    /^cat-pilot$/i,
  );
  const journal = db.prepare('SELECT value FROM collection_records WHERE collection=? AND id=?');
  const transition = (): TaskTransition =>
    JSON.parse(String(journal.get(`task.lifecycle.v1.${project}`, owner.task)?.value));
  const setting = db.prepare('SELECT value FROM settings WHERE key=?');
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.bar')).toBeVisible();
    expect(
      (await page.evaluate(() => window.skaro.invoke('projects.list'))).map((p) => p.id),
    ).toEqual([project]);
    const control = () =>
      page.evaluate(
        ({ project, task }) => window.skaro.invoke('task.controls', project, task),
        owner,
      );
    const stop = (id: string) =>
      page.evaluate(
        ({ project, task, id }) => window.skaro.invoke('task.park', project, task, 'stopped', id),
        { ...owner, id },
      );
    const resume = (id: string) =>
      page.evaluate(
        ({ project, task, id }) =>
          window.skaro.invoke('task.send', project, task, {
            commandId: id,
            resumeTask: true,
            text: 'Проверка остановки Skaro. Ответь только «Принято». Не используй инструменты, не меняй файлы или статус задачи.',
          }),
        { ...owner, id },
      );
    const before = await control();
    expect(before?.stage).toBe('in_progress');
    expect(before?.lifecyclePending).toBe(false);
    await stop(randomUUID());
    const run = transition().run;
    expect(run).toBeTruthy();
    const processes = (): OwnedProcess[] =>
      JSON.parse(String(setting.get(`run.${run}.processes`)?.value ?? '[]'));
    expect(processes()).toEqual([]);

    const lostSessions = () =>
      page.evaluate(async ({ project, task }) => {
        const { timeline } = await window.skaro.invoke('task.open', project, task);
        return timeline?.items
          .filter((item) => item.kind === 'notice' && item.code === 'session_lost')
          .map((item) => item.id);
      }, owner);
    const priorLosses = await lostSessions();
    expect(priorLosses).toBeDefined();
    const interrupted = randomUUID();
    const delivery = resume(interrupted).catch(() => undefined);
    let registered: OwnedProcess | undefined;
    await expect
      .poll(
        () => {
          const first = processes()[0];
          if (first && transition().target === 'stopped') registered = first;
          return !!registered;
        },
        { intervals: [5], timeout: 60_000 },
      )
      .toBe(true);
    const stopping = randomUUID();
    const started = Date.now();
    expect(await stop(stopping)).toMatchObject({ requestId: stopping, status: 'stopped' });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeLessThan(50_000);
    await delivery;
    expect(transition()).toMatchObject({
      commandId: stopping,
      target: 'stopped',
      phase: 'settled',
      run,
    });
    expect(await control()).toMatchObject({ stage: 'stopped', lifecyclePending: false });
    expect(processes()).toEqual([]);
    expect(await processBirth(registered!.pid)).not.toBe(registered!.birth);
    expect(await lostSessions()).toEqual(priorLosses);
    console.info(
      `Cat-pilot T-010: verified Stop receipt in ${elapsed} ms; original process exited.`,
    );

    const renewed = randomUUID();
    await resume(renewed);
    await expect.poll(transition, { timeout: 90_000 }).toMatchObject({
      commandId: renewed,
      target: 'in_progress',
      phase: 'settled',
      run,
    });
    expect(await control()).toMatchObject({ stage: 'in_progress', lifecyclePending: false });
  } finally {
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('shutdown')).catch(() => undefined);
    await app.close();
  }
});
