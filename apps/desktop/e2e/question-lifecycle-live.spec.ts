import { expect, test } from '@playwright/test';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
const userData = process.env['SKARO_E2E_INTERACTIONS_USER_DATA'];
const task = process.env['SKARO_E2E_INTERACTIONS_TASK_ID'];
const project = process.env['SKARO_VERIFICATION_PROJECT'];
test.skip(
  !userData || !task || !project,
  'Requires a real scoped Cat-pilot profile and its designated acceptance task',
);

test('real multi-secret questions retire on composer reply and explicit cancellation, including reload', async ({
  playwright: _playwright,
}, testInfo) => {
  test.setTimeout(360000);
  const app = await launchApp(userData!);
  try {
    const page = await app.firstWindow();
    const original = await page.evaluate(
      ({ project, task }) => window.skaro.invoke('task.open', project, task, { paged: true }),
      { project: project!, task: task! },
    );
    expect(original.task.title).toMatch(/^Приёмка Skaro:/);
    expect(original.timeline?.interactions).toHaveLength(0);
    await page.evaluate(
      async ({ project, task }) =>
        window.skaro.invoke('app.setSetting', 'ui.workspace', {
          view: 'project',
          sections: { [project]: 'tasks' },
          openTasks: { [project]: task },
          openChats: {},
        }),
      { project: project!, task: task! },
    );
    await page.reload();
    const input = page.locator('.composer textarea');
    await expect(input).toBeVisible();
    const view = () =>
      page.evaluate(
        ({ project, task }) => window.skaro.invoke('task.open', project, task, { paged: true }),
        { project: project!, task: task! },
      );
    const send = async (text: string) => {
      await input.fill(text);
      await input.press('Enter');
    };
    const question = async () => {
      await expect
        .poll(
          async () => (await view()).timeline?.interactions.some((i) => i.kind === 'question'),
          { timeout: 120000 },
        )
        .toBe(true);
      const interaction = (await view()).timeline!.interactions.find((i) => i.kind === 'question');
      if (interaction?.kind !== 'question')
        throw new Error('Native question disappeared before observation');
      return interaction;
    };
    await send(
      'Выполни только живую приёмку защищённой формы Skaro. Без файлов, shell, окружения и сдачи результата. Вызови request_secret с двумя полями env и ssh для проверки отмены формы; реальные значения не нужны и вводиться не будут. Затем жди ответа.',
    );
    const first = await question();
    expect(first.questions).toHaveLength(2);
    expect(first.questions.every((q) => q.secret)).toBe(true);
    await expect(
      page.getByRole('tab').filter({ hasText: 'Cat-pilot' }).locator('.dot.attention'),
    ).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('pending.png') });
    await send(
      'Отмени эту форму: защищённые значения не нужны. Только подтверди отмену текстом, не выполняй работу и не создавай новых вопросов.',
    );
    await expect
      .poll(async () => (await view()).timeline!.interactions.some((i) => i.id === first.id), {
        timeout: 30000,
      })
      .toBe(false);
    await expect(page.locator('.fd-card.question')).toHaveCount(0);
    await expect
      .poll(async () => (await view()).timeline?.status, { timeout: 120000 })
      .toBe('idle');
    await page.reload();
    await expect(input).toBeVisible();
    expect((await view()).timeline!.interactions.some((i) => i.id === first.id)).toBe(false);
    await send(
      'Выполни только следующий шаг приёмки формы: вызови request_secret с двумя полями env и ssh; значения вводиться не будут, затем жди явной отмены. Без файлов, shell, окружения и сдачи результата.',
    );
    const second = await question();
    const decisions = await page.evaluate(
      (project) => window.skaro.invoke('decisions.list', project),
      project!,
    );
    const decision = decisions.find(
      (d) => d.kind === 'interaction' && d.interaction.id === second.id,
    );
    expect(decision).toBeDefined();
    await page.evaluate(
      ({ project, decision }) =>
        window.skaro.invoke(
          'decisions.cancel',
          project,
          decision.id,
          decision.revision,
          'Владелец отменил проверочную форму',
        ),
      { project: project!, decision: decision! },
    );
    await expect
      .poll(async () => (await view()).timeline!.interactions.some((i) => i.id === second.id), {
        timeout: 30000,
      })
      .toBe(false);
    expect(
      (
        await page.evaluate((project) => window.skaro.invoke('decisions.list', project), project!)
      ).some((d) => d.id === decision!.id),
    ).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('cancelled.png') });
    await send(
      'Выполни только проверку нативной карточки: вызови request_user_input с вопросом о следующей read-only проверке и двумя вариантами — синтаксис или остановка. Файлы, shell, окружение и submit_result запрещены. После вызова жди ответа.',
    );
    const native = await question();
    expect(native.delivery).not.toBe('async');
    await send(
      'Отмени этот вопрос. Только ответь «ВОПРОС ОТМЕНЁН», ничего не выполняй и не создавай новых карточек.',
    );
    await expect
      .poll(async () => (await view()).timeline!.interactions.some((i) => i.id === native.id), {
        timeout: 30000,
      })
      .toBe(false);
    await expect
      .poll(async () => (await view()).timeline?.status, { timeout: 120000 })
      .toBe('idle');
    await expect(page.locator('.fd-card.question')).toHaveCount(0);
    await page.reload();
    await expect(input).toBeVisible();
    expect((await view()).timeline!.interactions.some((i) => i.id === native.id)).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('native-cancelled.png') });
  } finally {
    const page = app.windows()[0];
    await page?.evaluate(
      ({ project, task }) => window.skaro.invoke('task.interrupt', project, task),
      { project: project!, task: task! },
    );
    await app.close();
  }
});
