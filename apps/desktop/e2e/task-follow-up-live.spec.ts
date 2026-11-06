import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { launchApp } from './launch';
import type { AgentSettings, SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_FOLLOW_UP_PROFILE'];
const project = process.env['SKARO_VERIFICATION_PROJECT'];
const root = process.env['SKARO_E2E_WRITE_PROJECT_ROOT'];
const task = 'T-006';
test.skip(!profile || !project || !root, 'Requires the real scoped Cat-pilot and signed-in Codex');

test('answers a task question without execution, then waits for a pinned option card', async ({
  browserName: _browserName,
}, testInfo) => {
  test.setTimeout(360_000);
  const taskDirectory = join(root!, '.skaro', 'tasks');
  const taskFile = join(
    taskDirectory,
    readdirSync(taskDirectory).find((name) => name.startsWith(`${task}-`))!,
  );
  const beforeTask = readFileSync(taskFile, 'utf8');
  expect(beforeTask).toMatch(/^status: in_progress\r?$/m);
  const app = await launchApp(profile!, { openSavedProject: false });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  let saved: AgentSettings | undefined;
  let changed = false;
  let originalRun: string | undefined;
  const read = () =>
    page.evaluate(
      ({ project, task }) => window.skaro.invoke('task.open', project, task, { paged: true }),
      { project: project!, task },
    );
  try {
    const tabs = await page.evaluate(() => window.skaro.invoke('tabs.get'));
    expect(tabs).toEqual({ projects: [project], active: project });
    const before = await read();
    expect(before.timeline?.interactions.filter((item) => item.kind !== 'merge')).toEqual([]);
    saved = before.settings;
    originalRun = before.run!.id;
    await page.evaluate(
      async ({ project, task, settings }) => {
        const { model: _model, budgetUsd: _budget, ...rest } = settings;
        await window.skaro.invoke('task.setSettings', project, task, {
          ...rest,
          agent: 'codex',
          effort: 'low',
          permissionMode: 'full',
          planFirst: false,
        });
      },
      { project: project!, task, settings: saved },
    );
    changed = true;
    const baseline = await read();
    await page.evaluate(
      async ({ project, task }) => {
        await window.skaro.invoke('app.setSetting', 'ui.workspace', {
          view: 'project',
          sections: { [project]: 'tasks' },
          openTasks: { [project]: task },
          openChats: {},
        });
      },
      { project: project!, task },
    );
    await page.reload();
    const input = page.locator('.task-conversation .composer textarea');
    await expect(input).toBeEnabled({ timeout: 30_000 });
    const marker = randomUUID().slice(0, 8);
    const first = `FOLLOW_UP_${marker}`;
    await input.fill(
      `Это только вопрос, не поручение выполнять T-006. Почему вопрос в чате не означает разрешения продолжить задачу? Ответь одним предложением с маркером ${first}. Не читай и не меняй файлы, не выполняй команды, не сдавай задачу и не вызывай инструменты.`,
    );
    await input.press('Enter');
    await expect(page.locator('.fd-text').filter({ hasText: first })).toBeVisible({
      timeout: 90_000,
    });
    await expect
      .poll(async () => (await read()).timeline?.status, { timeout: 30_000 })
      .toBe('idle');
    const answered = await read();
    const turn = answered.timeline!.turns.at(-1)!;
    expect(turn.outcome).toBe('done');
    await page.waitForTimeout(5000);
    expect((await read()).timeline!.turns.at(-1)!.id).toBe(turn.id);
    expect((await read()).queued).toBe(false);
    await page.screenshot({ path: testInfo.outputPath('question-idle.png') });

    const second = `DECISION_${marker}`;
    await input.fill(
      `Для проверки общения нужно моё решение: только объяснить порядок проверки или отложить проверку. Выбирать за меня нельзя. Покажи карточку с этими двумя вариантами и дождись ответа. Не реализуй T-006, не читай и не меняй файлы, не запускай команды. После ответа напиши только ${second} и закончи. Другие инструменты, кроме вопроса, не вызывай.`,
    );
    await input.press('Enter');
    const card = page.locator('.task-conversation .fd-card.question');
    await expect(card).toBeVisible({ timeout: 90_000 });
    expect(await card.locator('.option').count()).toBeGreaterThanOrEqual(2);
    expect(await card.evaluate((element) => !element.closest('.scroller'))).toBe(true);
    const cardBox = await card.boundingBox();
    const inputBox = await input.boundingBox();
    expect(cardBox!.y + cardBox!.height).toBeLessThanOrEqual(inputBox!.y);
    const pending = await read();
    expect(pending.timeline!.status).toBe('waiting');
    await page.waitForTimeout(5000);
    expect((await read()).timeline!.turns.at(-1)!.id).toBe(pending.timeline!.turns.at(-1)!.id);
    await expect(page.locator('.fd-text').filter({ hasText: second })).toHaveCount(0);
    await page.screenshot({ path: testInfo.outputPath('decision-waiting.png') });
    await card.locator('.option').first().click();
    await card.getByRole('button', { name: 'Ответить', exact: true }).click();
    await expect(card).toHaveCount(0);
    await expect(page.locator('.fd-text').filter({ hasText: second })).toBeVisible({
      timeout: 90_000,
    });
    await expect
      .poll(async () => (await read()).timeline!.status, { timeout: 30_000 })
      .toBe('idle');
    const final = await read();
    await page.waitForTimeout(5000);
    expect((await read()).timeline!.turns.at(-1)!.id).toBe(final.timeline!.turns.at(-1)!.id);
    expect(final.task.status).toBe('needs_answer');
    expect(final.task.criteria).toEqual(before.task.criteria);
    const newTurns = new Set(
      final
        .timeline!.turns.filter(
          (item) => !baseline.timeline!.turns.some((old) => old.id === item.id),
        )
        .map((item) => item.id),
    );
    expect(
      final.timeline!.items.filter(
        (item) =>
          newTurns.has(item.turnId) && ['command', 'file_change', 'tool'].includes(item.kind),
      ),
    ).toEqual([]);
    expect(errors).toEqual([]);
    await page.screenshot({ path: testInfo.outputPath('decision-answered-idle.png') });
  } finally {
    if (changed && saved) {
      await page.evaluate(
        ({ project, task }) => window.skaro.invoke('task.interrupt', project, task),
        { project: project!, task },
      );
      if (saved.agent !== 'skaro')
        await page.evaluate(
          ({ project, task, settings }) =>
            window.skaro.invoke('task.setSettings', project, task, settings),
          { project: project!, task, settings: saved },
        );
    }
    await app.close();
    if (changed && saved?.agent === 'skaro')
      execFileSync(
        process.execPath,
        [join(__dirname, '../scripts/restore-follow-up-agent.mjs'), originalRun!],
        {
          cwd: join(__dirname, '..'),
          env: process.env,
          timeout: 180_000,
          stdio: 'pipe',
        },
      );
    expect(readFileSync(taskFile, 'utf8')).toBe(beforeTask);
  }
});
