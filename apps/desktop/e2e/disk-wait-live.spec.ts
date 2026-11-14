import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';
import { livePlanChat } from './plan-actions-live-support';
import { reserveLiveDisk, openDiskWaitOwner, prepareDiskWaitTask } from './disk-wait-live-support';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env.SKARO_DISK_WAIT_PROFILE;
const project = process.env.SKARO_VERIFICATION_PROJECT;
const policyKey = 'resources.policy.v1';
test.skip(!profile || !project, 'Requires owner-approved genuine scoped Cat-pilot verification');

test('shows genuine disk admission in chat and task, then resumes after restoring the real policy', async ({
  browserName: _,
}, info) => {
  test.setTimeout(600000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const prefix = `Skaro33-${Date.now()}`;
  let chat = '';
  let task = '';
  let policy: unknown;
  let workspace: unknown;
  let saved = false;
  const proof: Record<string, unknown> = { project, prefix };
  try {
    const page = await app.firstWindow();
    await page.locator('.bar').first().waitFor();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const projects = await page.evaluate(() => window.skaro.invoke('projects.list'));
    expect(projects.map((p) => p.id)).toEqual([project]);
    const root = projects[0]!.path;
    const sourceState = () =>
      ['rev-parse', 'status'].map((kind) =>
        execFileSync(
          'git',
          [
            '-C',
            root,
            ...(kind === 'rev-parse'
              ? ['rev-parse', 'HEAD']
              : ['status', '--porcelain', '--', '.', ':!.skaro']),
          ],
          { encoding: 'utf8', windowsHide: true },
        ),
      );
    const before = sourceState();
    policy = await page.evaluate((key) => window.skaro.invoke('app.getSetting', key), policyKey);
    workspace = await page.evaluate(() => window.skaro.invoke('app.getSetting', 'ui.workspace'));
    saved = true;
    const milestones = await page.evaluate(
      (p) => window.skaro.invoke('plan.milestones', p),
      project!,
    );
    const settings = await page.evaluate((p) => window.skaro.invoke('chats.defaults', p), project!);
    const plan = {
      key: prefix,
      title: prefix,
      expected_total: 1,
      milestones: [
        {
          milestone: milestones[0]!.id,
          requirements: [],
          tasks: [
            {
              ref: 'disk',
              title: prefix,
              goal: 'Разрешённая проверка индикации дискового ожидания Skaro. Только ответить DISK_WAIT_TASK_READY без инструментов, исходников и окружений.',
              criteria: ['После допуска получен ответ DISK_WAIT_TASK_READY без изменения проекта.'],
              requirements: [],
              depends_on: [],
            },
          ],
        },
      ],
    };
    chat = (
      await page.evaluate(
        ({ p, settings, text }) => window.skaro.invoke('chat.create', p, settings, { text }),
        {
          p: project!,
          settings,
          text: `Владелец разрешил один проверочный чат и одну задачу для индикации ожидания диска. Исходники, существующие задачи, этапы, C4 и окружения не менять. Не запускать shell или computer use. Вызови prepare_plan с ${JSON.stringify(plan)}, затем propose_saved_plan и finish_plan. Покажи один полный план и заверши ход.`,
        },
      )
    ).id;
    const { offer, read } = livePlanChat(page, project!, chat);
    const proposal = await offer('plan');
    const navigate = (section: 'chat' | 'tasks') =>
      openDiskWaitOwner(page, project!, chat, task, section);
    await navigate('chat');
    await page
      .locator(`[id="proposal-${proposal.id}"]`)
      .getByRole('button', { name: /Подтвердить план|Confirm plan/ })
      .click();
    await expect
      .poll(
        async () => {
          task =
            (await page.evaluate((p) => window.skaro.invoke('tasks.list', p), project!)).find(
              (t) => t.title === prefix,
            )?.id ?? '';
          return !!task;
        },
        { timeout: 60000 },
      )
      .toBe(true);
    await expect.poll(async () => (await read()).timeline.status, { timeout: 60000 }).toBe('idle');
    const prepared = await prepareDiskWaitTask(page, project!, task, settings, {
      chat,
      profile: profile!,
      policy,
      screenshot: info.outputPath('task-preparation-disk-wait.png'),
    });
    const preparedMessages = prepared.messages;
    proof.taskPreparationWait = prepared.initialWait;
    await navigate('chat');
    await reserveLiveDisk(page, profile!, policy);
    await page.evaluate(
      ({ p, c }) => {
        void window.skaro
          .invoke('chat.send', p, c, {
            text: 'Проверка владельца: ответь только DISK_WAIT_CHAT_READY. Не вызывай инструменты и ничего не меняй.',
          })
          .catch(() => {});
      },
      { p: project!, c: chat },
    );
    await expect(page.locator('.fd-live')).toContainText('Ожидает места на диске', {
      timeout: 60000,
    });
    await expect(page.locator('.fd-live')).toContainText(/нужно .*доступно 0 Б/);
    await expect(page.locator('.fd-live')).not.toContainText('Ждёт ответа модели');
    await expect(page.locator('.fd-live')).toHaveAttribute('data-tip', /budget_disk/);
    proof.chatWait = (await read()).resourceWait;
    expect(proof.chatWait).toMatchObject({ reason: 'budget_disk' });
    await page.screenshot({ path: info.outputPath('chat-disk-wait.png') });
    await page.evaluate(({ key, value }) => window.skaro.invoke('app.setSetting', key, value), {
      key: policyKey,
      value: policy,
    });
    await expect.poll(async () => (await read()).resourceWait, { timeout: 90000 }).toBeUndefined();
    await expect
      .poll(
        async () => {
          const view = await read();
          return (
            view.timeline.status === 'idle' &&
            view.timeline.items.some(
              (i) =>
                i.kind === 'message' &&
                i.role === 'agent' &&
                i.text.includes('DISK_WAIT_CHAT_READY'),
            )
          );
        },
        { timeout: 180000 },
      )
      .toBe(true);
    proof.chatResumed = true;
    await reserveLiveDisk(page, profile!, policy);
    await page.evaluate(
      ({ p, t }) => {
        void window.skaro
          .invoke('task.send', p, t, {
            text: 'Разрешённая проверка владельца: ответь только DISK_WAIT_TASK_READY. Никаких инструментов, файлов, окружений и submit_result.',
          })
          .catch(() => {});
      },
      { p: project!, t: task },
    );
    await navigate('tasks');
    await expect(page.locator('.fd-live')).toContainText('Ожидает места на диске', {
      timeout: 60000,
    });
    await expect(page.locator('.task-description .chip')).toHaveText('Ожидает места на диске');
    const taskView = () =>
      page.evaluate(({ p, t }) => window.skaro.invoke('task.open', p, t, { paged: true }), {
        p: project!,
        t: task,
      });
    const waiting = await taskView();
    expect(waiting.task.status).toBe('queued');
    expect(waiting.task.resourceWait?.reason).toBe('budget_disk');
    const since = waiting.task.resourceWait!.since;
    await page.reload();
    await expect(page.locator('.fd-live')).toContainText('Ожидает места на диске');
    expect((await taskView()).task.resourceWait?.since).toBe(since);
    proof.taskWait = waiting.task.resourceWait;
    await page.screenshot({ path: info.outputPath('task-disk-wait.png') });
    await page.evaluate(({ key, value }) => window.skaro.invoke('app.setSetting', key, value), {
      key: policyKey,
      value: policy,
    });
    await expect
      .poll(async () => (await taskView()).task.resourceWait, { timeout: 90000 })
      .toBeUndefined();
    await expect(
      page.locator('.fd-live').filter({ hasText: 'Ожидает места на диске' }),
    ).toHaveCount(0);
    await expect
      .poll(
        async () => {
          const view = await taskView();
          return view.timeline?.items.some(
            (i) =>
              i.kind === 'message' &&
              i.role === 'agent' &&
              i.text.includes('DISK_WAIT_TASK_READY') &&
              !preparedMessages.includes(i.id),
          );
        },
        { timeout: 180000 },
      )
      .toBe(true);
    await expect.poll(async () => (await read()).resourceWait, { timeout: 60000 }).toBeUndefined();
    await expect
      .poll(
        async () =>
          (await read()).timeline.items.some(
            (i) =>
              i.kind === 'message' && i.role === 'agent' && i.text.includes('DISK_WAIT_CHAT_READY'),
          ),
        { timeout: 180000 },
      )
      .toBe(true);
    expect(sourceState()).toEqual(before);
    expect(errors).toEqual([]);
    proof.resumedWithoutSourceChanges = true;
    proof.pageErrors = [...errors];
    await page.screenshot({ path: info.outputPath('disk-wait-resumed.png') });
  } finally {
    try {
      const page = await app.firstWindow();
      if (task)
        await page.evaluate(({ p, t }) => window.skaro.invoke('task.interrupt', p, t), {
          p: project!,
          t: task,
        });
      if (chat)
        await page.evaluate(({ p, c }) => window.skaro.invoke('chat.interrupt', p, c), {
          p: project!,
          c: chat,
        });
      if (saved) {
        await page.evaluate(({ key, value }) => window.skaro.invoke('app.setSetting', key, value), {
          key: policyKey,
          value: policy,
        });
        await page.evaluate(
          (value) => window.skaro.invoke('app.setSetting', 'ui.workspace', value),
          workspace,
        );
      }
      if (task)
        await page.evaluate(({ p, t }) => window.skaro.invoke('tasks.delete', p, [t]), {
          p: project!,
          t: task,
        });
      if (chat)
        await page.evaluate(({ p, c }) => window.skaro.invoke('chat.archive', p, c, true), {
          p: project!,
          c: chat,
        });
      proof.policyRestored = saved;
      proof.verificationTaskRemoved = !!task;
    } finally {
      await app.evaluate(({ powerMonitor }) => powerMonitor.emit('shutdown'));
      await app.close();
    }
  }
  await writeFile(
    info.outputPath('proof.json'),
    JSON.stringify({ ...proof, passed: true }, null, 2),
  );
});
