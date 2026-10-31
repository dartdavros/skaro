// Opt-in: real project, real task proposal, real Codex, real submit_result and Git merge.
import { expect, test } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_LAUNCH_PROJECT'];
const root = process.env['SKARO_E2E_WRITE_PROJECT_ROOT'];
const existingTask = process.env['SKARO_COMPLETION_TASK'];
const existingMarker = process.env['SKARO_COMPLETION_MARKER'];
test.skip(
  !profile || !project || !root,
  'Requires an existing isolated real project and signed-in Codex',
);

test('continues an intermediate model final and merges the verified task without another owner message', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(240_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const marker = existingMarker ?? randomUUID().slice(0, 8);
  const title = `Документировать запуск Кота-пилота ${marker}`;
  const before = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root!,
    encoding: 'utf8',
  }).trim();
  let taskId: string | undefined;
  let chatId: string | undefined;
  const previous = await page.evaluate(async () => ({
    tabs: await window.skaro.invoke('tabs.get'),
    workspace: await window.skaro.invoke('app.getSetting', 'ui.workspace'),
    automatic: await window.skaro.invoke('app.getSetting', 'merge.auto'),
  }));
  try {
    if (existingTask) {
      await page.evaluate(
        async ({ project, task }) => {
          await window.skaro.invoke('tabs.set', { projects: [project], active: project });
          await window.skaro.invoke('app.setSetting', 'ui.workspace', {
            view: 'project',
            sections: { [project]: 'tasks' },
            openTasks: { [project]: task },
            openChats: {},
          });
        },
        { project: project!, task: existingTask },
      );
      await page.reload();
      const view = await page.evaluate(
        ({ project, task }) => window.skaro.invoke('task.open', project, task),
        { project: project!, task: existingTask },
      );
      expect(view.task.status).toBe('done');
      expect(view.timeline!.turns.length).toBeGreaterThanOrEqual(2);
      expect(
        view.timeline!.items.some(
          (item) =>
            item.kind === 'message' &&
            item.role === 'agent' &&
            item.text.includes(`FIRST_TURN_${marker}`),
        ),
      ).toBe(true);
      expect(
        view.timeline!.items.some(
          (item) =>
            item.kind === 'tool' && item.name.endsWith('submit_result') && item.status === 'done',
        ),
      ).toBe(true);
      const merged = view.timeline!.items.find(
        (item) => item.kind === 'notice' && item.code === 'merged',
      );
      if (!merged || merged.kind !== 'notice') throw new Error('No persisted actual merge');
      const publication = merged.native.ref;
      expect(
        execFileSync('git', ['merge-base', '--is-ancestor', publication, 'HEAD'], {
          cwd: root!,
          encoding: 'utf8',
        }),
      ).toBe('');
      const files = execFileSync(
        'git',
        [
          'diff-tree',
          '--no-commit-id',
          '--name-only',
          '-r',
          publication,
          '--',
          '.',
          ':(exclude).skaro',
        ],
        { cwd: root!, encoding: 'utf8' },
      ).trim();
      expect(files).toBe('README.md');
      expect(await readFile(join(root!, 'README.md'), 'utf8')).toContain('index.html');
      expect(view.timeline!.interactions).toEqual([]);
      await expect(
        page.locator('.fd-bubble').filter({ hasText: 'Continue the authorized task' }),
      ).toHaveCount(0);
      await page.screenshot({ path: info.outputPath('actual-task-merged-restored.png') });
      expect(errors).toEqual([]);
      console.log(
        'Verified actual autonomous task and persisted Git publication:',
        existingTask,
        publication,
      );
      return;
    }
    const chat = await page.evaluate(
      ({ project, title }) =>
        window.skaro.invoke(
          'chat.create',
          project,
          { agent: 'codex', model: 'gpt-6.1-sol', effort: 'low', permissionMode: 'full' },
          {
            text:
              `Предложи одну самостоятельную задачу без зависимостей и без нового этапа: «${title}». ` +
              'Небольшое улучшение документации существующего проекта: создать README.md в корне с описанием ' +
              'реальных index.html, каталогов css и js и запуском статического приложения открытием index.html. ' +
              'Критерии: README описывает фактическую структуру; инструкция не выдумывает зависимости или команды; ' +
              'продуктовые HTML/CSS/JS и дизайн не изменены. Прочитай контекст и вызови propose_tasks для одной задачи. ' +
              'В этом чате задачу не реализуй, файлы не меняй и новую архитектуру не предлагай.',
          },
        ),
      { project: project!, title },
    );
    chatId = chat.id;
    await expect
      .poll(
        async () => {
          const view = await page.evaluate(
            ({ project, chat }) => window.skaro.invoke('chat.open', project, chat),
            { project: project!, chat: chat.id },
          );
          return view.timeline.items.some(
            (item) =>
              item.kind === 'proposal' && item.state === 'pending' && item.proposal.type === 'plan',
          );
        },
        { timeout: 80_000 },
      )
      .toBe(true);
    await page.evaluate(
      async ({ project, chat }) => {
        const view = await window.skaro.invoke('chat.open', project, chat);
        const item = view.timeline.items.find(
          (item) =>
            item.kind === 'proposal' && item.state === 'pending' && item.proposal.type === 'plan',
        );
        if (
          !item ||
          item.kind !== 'proposal' ||
          item.proposal.type !== 'plan' ||
          item.proposal.tasks.length !== 1
        )
          throw new Error('Expected one real proposed task');
        await window.skaro.invoke('chat.proposal', project, chat, item.id, {
          action: 'apply',
          tasks: item.proposal.tasks.map((task) => task.ref),
        });
      },
      { project: project!, chat: chat.id },
    );
    const task = (
      await page.evaluate((project) => window.skaro.invoke('tasks.list', project), project!)
    ).find((item) => item.title.includes(marker));
    if (!task) throw new Error('Accepted task was not created');
    taskId = task.id;
    await page.evaluate(
      async ({ project, task }) => {
        const view = await window.skaro.invoke('task.open', project, task);
        await window.skaro.invoke('task.setSettings', project, task, {
          ...view.settings,
          agent: 'codex',
          effort: 'low',
          permissionMode: 'full',
          planFirst: false,
        });
        await window.skaro.invoke('app.setSetting', 'merge.auto', true);
        await window.skaro.invoke('tabs.set', { projects: [project], active: project });
        await window.skaro.invoke('app.setSetting', 'ui.workspace', {
          view: 'project',
          sections: { [project]: 'tasks' },
          openTasks: { [project]: task },
          openChats: {},
        });
      },
      { project: project!, task: task.id },
    );
    await page.reload();
    await page.evaluate(
      ({ project, task, marker }) =>
        window.skaro.invoke(
          'tasks.run',
          project,
          [task],
          'Выполни принятую задачу до проверенной сдачи и автоматического вливания. ' +
            'Проверяется продолжение между ходами: только в ПЕРВОМ ходе прочитай index.html и заверши ход строкой ' +
            `FIRST_TURN_${marker}, без правок и submit_result. ` +
            'Это намеренный промежуточный ход; следующий служебный ход Skaro должен автоматически завершить ту же задачу: ' +
            'создать README по фактическим исходникам, проверить критерии и вызвать submit_result. ' +
            'Не проси владельца написать продолжи. Только документация; продуктовые HTML/CSS/JS не менять.',
        ),
      { project: project!, task: task.id, marker },
    );
    await expect
      .poll(
        async () => {
          const view = await page.evaluate(
            ({ project, task }) => window.skaro.invoke('task.open', project, task),
            { project: project!, task: task.id },
          );
          if (view.timeline?.interactions.some((item) => item.kind === 'question'))
            throw new Error('Unexpected owner question for a fully specified task');
          return (
            view.task.status === 'done' &&
            view.timeline?.items.some(
              (item) =>
                item.kind === 'tool' &&
                item.name.endsWith('submit_result') &&
                item.status === 'done',
            )
          );
        },
        { timeout: 130_000, intervals: [500, 1000, 2000] },
      )
      .toBe(true);
    const view = await page.evaluate(
      ({ project, task }) => window.skaro.invoke('task.open', project, task),
      { project: project!, task: task.id },
    );
    expect(view.timeline!.turns.length).toBeGreaterThanOrEqual(2);
    expect(
      view.timeline!.items.some(
        (item) =>
          item.kind === 'message' &&
          item.role === 'agent' &&
          item.text.includes(`FIRST_TURN_${marker}`),
      ),
    ).toBe(true);
    expect(
      view.timeline!.items.some(
        (item) =>
          item.kind === 'tool' && item.name.endsWith('submit_result') && item.status === 'done',
      ),
    ).toBe(true);
    expect(view.timeline!.interactions).toEqual([]);
    const readme = await readFile(join(root!, 'README.md'), 'utf8');
    for (const name of ['index.html', 'css', 'js']) expect(readme).toContain(name);
    expect(
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root!, encoding: 'utf8' }).trim(),
    ).not.toBe(before);
    await expect(
      page.locator('.fd-bubble').filter({ hasText: 'Continue the authorized task' }),
    ).toHaveCount(0);
    await page.screenshot({ path: info.outputPath('actual-task-merged.png') });
    expect(errors).toEqual([]);
    console.log('Real task automatically completed and merged:', task.id);
  } finally {
    if (taskId)
      await page.evaluate(
        ({ project, task }) => window.skaro.invoke('task.interrupt', project, task),
        { project: project!, task: taskId },
      );
    if (chatId)
      await page.evaluate(
        ({ project, chat }) => window.skaro.invoke('chat.interrupt', project, chat),
        { project: project!, chat: chatId },
      );
    await page.evaluate(async (previous) => {
      await window.skaro.invoke('tabs.set', previous.tabs);
      await window.skaro.invoke('app.setSetting', 'ui.workspace', previous.workspace);
      await window.skaro.invoke('app.setSetting', 'merge.auto', previous.automatic ?? null);
    }, previous);
    await app.close();
  }
});
