import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env.SKARO_RECOVERY_STATUS_PROFILE;
const scope = process.env.SKARO_VERIFICATION_PROJECT;
const policyKey = 'resources.policy.v1';
test.skip(!profile || !scope, 'Requires permission for the genuine scoped Cat-pilot Electron run');

test('shows a genuine resource wait as queued and its actual recovery as working', async ({
  browserName: _,
}, info) => {
  test.setTimeout(300000);
  const project = scope!;
  const app = await launchApp(profile!, { openSavedProject: false });
  let task: string | undefined;
  let policy: Record<string, unknown> | undefined;
  let previousIncidents: string[] = [];
  let started = false;
  const proof: Record<string, unknown> = { project };
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.bar').first().waitFor();
    expect(
      (await page.evaluate(() => window.skaro.invoke('projects.list'))).map((p) => p.id),
    ).toEqual([project]);
    const tasks = await page.evaluate((p) => window.skaro.invoke('tasks.list', p), project);
    task = tasks.find(
      (t) => t.title === 'Аудит штатного окружения Cat-pilot и допуска ресурсов RC-2',
    )?.id;
    expect(task).toBeDefined();
    const owner = { project, task: task! };
    const read = () =>
      page.evaluate(({ project, task }) => window.skaro.invoke('task.open', project, task), owner);
    const initial = await read();
    expect(initial.timeline?.status).not.toBe('working');
    expect(initial.run?.worktree).toBeTruthy();
    const gitState = () =>
      ['rev-parse', 'status'].map((kind) =>
        execFileSync(
          'git',
          [
            '-C',
            initial.run!.worktree!,
            ...(kind === 'rev-parse' ? ['rev-parse', 'HEAD'] : ['status', '--porcelain']),
          ],
          { encoding: 'utf8', windowsHide: true },
        ),
      );
    const before = gitState();
    const saved = await page.evaluate(
      (key) => window.skaro.invoke('app.getSetting', key),
      policyKey,
    );
    expect(saved && typeof saved === 'object').toBe(true);
    policy = saved as Record<string, unknown>;
    const initialIncidents = await page.evaluate(
      (p) => window.skaro.invoke('incidents.list', p),
      project,
    );
    expect(
      initialIncidents.some(
        (r) =>
          r.state === 'open' &&
          ['executing', 'verifying'].includes(r.protocol?.phase ?? '') &&
          r.protocol?.subscriptions.some((s) => s.taskId === task),
      ),
    ).toBe(false);
    previousIncidents = initialIncidents.map((row) => row.id);
    started = true;
    await page.evaluate(
      async ({ project, task, policyKey, policy }) => {
        await window.skaro.invoke('task.interrupt', project, task);
        await window.skaro.invoke('app.setSetting', policyKey, { ...policy, environment: 0 });
        await window.skaro.invoke('app.setSetting', 'ui.workspace', {
          view: 'project',
          sections: { [project]: 'tasks' },
          openTasks: { [project]: task },
          openChats: {},
        });
      },
      { ...owner, policyKey, policy },
    );
    await page.reload();
    await expect(page.locator('.task-description')).toBeVisible();
    await page.evaluate(
      ({ project, task }) =>
        window.skaro.invoke('task.send', project, task, {
          text: 'Продолжи только штатную read-only проверку запуска окружения этой аудитной задачи. Если intent остановлен, сначала вызови resume_task с command_id этого сообщения и точной цитатой первого предложения. Затем вызови start_environment один раз. Если ресурсы заняты, верни управление Skaro и заверши ход без повторов инструмента. Не меняй исходники, конфигурацию проекта, критерии или Git; не подменяй данные и не запускай seed/reset; не вызывай submit_result.',
        }),
      owner,
    );
    let incident = '';
    await expect
      .poll(
        async () => {
          const rows = await page.evaluate(
            (p) => window.skaro.invoke('incidents.list', p),
            project,
          );
          incident =
            rows.find(
              (r) =>
                !previousIncidents.includes(r.id) &&
                r.state === 'open' &&
                r.protocol?.code === 'environment_waiting_resource' &&
                r.protocol.subscriptions.some((s) => s.taskId === task),
            )?.id ?? '';
          return !!incident && (await read()).timeline?.status === 'idle';
        },
        { timeout: 180000 },
      )
      .toBe(true);
    const chip = page.locator('.task-description .chip').first();
    await expect(chip).toHaveText(/В очереди|Queued/);
    await page.screenshot({ path: info.outputPath('recovery-queued.png') });
    proof.queued = true;
    await page.evaluate(
      ({ policyKey, policy }) => window.skaro.invoke('app.setSetting', policyKey, policy),
      { policyKey, policy },
    );
    await expect(chip).toHaveText(/В работе|In progress/, { timeout: 60000 });
    const during = (
      await page.evaluate((p) => window.skaro.invoke('incidents.list', p), project)
    ).find((r) => r.id === incident);
    expect(during?.protocol?.phase).toMatch(/executing|verifying/);
    expect((await read()).timeline?.status).toBe('idle');
    await page.screenshot({ path: info.outputPath('recovery-working.png') });
    proof.working = true;
    await page.evaluate(
      ({ project, incident }) => window.skaro.invoke('incidents.recheck', project, incident),
      { project, incident },
    );
    expect(
      (await page.evaluate((p) => window.skaro.invoke('incidents.list', p), project)).find(
        (r) => r.id === incident,
      )?.state,
    ).toBe('resolved');
    await page.evaluate(
      ({ project, task }) => window.skaro.invoke('task.interrupt', project, task),
      owner,
    );
    expect(gitState()).toEqual(before);
    expect(errors).toEqual([]);
    proof.readyVerified = true;
    proof.headAndWorktreeUnchanged = true;
    proof.errors = errors;
  } finally {
    try {
      const page = await app.firstWindow();
      if (started && task) {
        await page.evaluate(
          ({ project, task }) => window.skaro.invoke('task.interrupt', project, task),
          { project, task },
        );
        const rows = await page.evaluate((p) => window.skaro.invoke('incidents.list', p), project);
        for (const row of rows.filter(
          (r) =>
            !previousIncidents.includes(r.id) &&
            r.state === 'open' &&
            r.protocol?.subscriptions.some((s) => s.taskId === task),
        ))
          await page.evaluate(
            ({ project, id }) => window.skaro.invoke('incidents.cancel', project, id),
            { project, id: row.id },
          );
      }
      if (started && policy)
        await page.evaluate(({ key, value }) => window.skaro.invoke('app.setSetting', key, value), {
          key: policyKey,
          value: policy,
        });
    } finally {
      await app.evaluate(({ powerMonitor }) => powerMonitor.emit('shutdown'));
      await app.close();
    }
  }
  writeFileSync(
    info.outputPath('recovery-proof.json'),
    JSON.stringify({ ...proof, passed: true }, null, 2),
  );
});
