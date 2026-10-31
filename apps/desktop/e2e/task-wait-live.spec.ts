// Opt-in verification against an existing isolated project, real history and a signed-in agent.
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { launchApp } from './launch';
import type { SkaroApi, WorkspaceState } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_LAUNCH_PROJECT'];
const task = process.env['SKARO_WAIT_TASK'];
test.skip(!profile || !project || !task, 'Requires an existing isolated task and signed-in Codex');

test('keeps a completed task turn free of invented questions and allows a real continuation', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  const page = await app.firstWindow();
  let previous: WorkspaceState | undefined;
  const ids = { project: project!, task: task! };
  const open = () =>
    page.evaluate(({ project, task }) => window.skaro.invoke('task.open', project, task), ids);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  try {
    const before = await open();
    expect(before.task.status).not.toBe('done');
    expect(before.task.status).not.toBe('review');
    expect(before.timeline?.interactions).toEqual([]);
    previous = await page.evaluate(async ({ project, task }) => {
      const workspace = (await window.skaro.invoke(
        'app.getSetting',
        'ui.workspace',
      )) as WorkspaceState;
      await window.skaro.invoke('tabs.set', { projects: [project], active: project });
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        ...workspace,
        view: 'project',
        sections: { ...workspace.sections, [project]: 'tasks' },
        openTasks: { ...workspace.openTasks, [project]: task },
      });
      return workspace;
    }, ids);
    await page.reload();
    await expect(page.locator('.composer textarea')).toBeVisible();

    for (const step of ['stopped', 'continued']) {
      const marker = `SKARO_WAIT_${step}_${randomUUID().replaceAll('-', '')}`;
      await page
        .locator('.composer textarea')
        .fill(
          'Проверка оркестрации Skaro. Не продолжай реализацию задачи. ' +
            'Не изменяй файлы, критерии, архитектуру или состояние задачи. ' +
            'Не запускай команды и не вызывай submit_result. ' +
            'Прочитай read_task_history, чтобы проверить доступность чтения истории. ' +
            'Затем вызови report_task_blocker с причиной «Владелец запросил только чтение; реализацию не продолжать». ' +
            `После этого заверши ход одной строкой ${marker}. Вопросов нет.`,
        );
      await page.locator('.composer textarea').press('Enter');
      // Reopening the actual task while native startup is pending used to invent a wait card.
      for (let index = 0; index < 5; index++) {
        const view = await open();
        expect(view.timeline?.interactions.some((i) => i.id.startsWith('skaro-wait-'))).toBe(false);
      }
      await expect
        .poll(
          async () => {
            const view = await open();
            const messages = view.timeline?.items.filter(
              (item) => item.kind === 'message' && item.role === 'agent',
            );
            return {
              finished: view.timeline?.turns.at(-1)?.outcome,
              replied: messages?.some(
                (item) => item.kind === 'message' && item.text.includes(marker),
              ),
              questions: view.timeline?.interactions.length,
            };
          },
          { timeout: 70_000 },
        )
        .toEqual({ finished: 'done', replied: true, questions: 0 });
      const finished = await open();
      const turn = finished.timeline!.turns.at(-1)!.id;
      expect(
        finished.timeline!.items.some(
          (item) =>
            item.turnId === turn &&
            item.kind === 'tool' &&
            item.name.endsWith('read_task_history') &&
            item.status === 'done',
        ),
      ).toBe(true);
      await expect(page.locator('.fd-card.question')).toHaveCount(0);
      await expect(page.locator('.composer textarea')).not.toHaveAttribute(
        'placeholder',
        'Ответить своими словами…',
      );
    }
    await page.screenshot({ path: info.outputPath('task-after-continuation.png') });
    expect(errors).toEqual([]);
  } finally {
    // The prompts above authorize no implementation; close even if an assertion fails mid-turn.
    await page.evaluate(
      ({ project, task }) => window.skaro.invoke('task.interrupt', project, task),
      ids,
    );
    if (previous)
      await page.evaluate(
        (workspace) => window.skaro.invoke('app.setSetting', 'ui.workspace', workspace),
        previous,
      );
    await app.close();
  }
});
