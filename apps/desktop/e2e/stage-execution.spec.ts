import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppDb, ArtifactStore } from '@skaro/core';
import { git, makeRepo } from './agent-task-support';
import { launchApp, noAgents, noAgentsReason, tempUserData } from './launch';

const BRANCH = 'skaro/M01-billing';

/**
 * A stage whose two tasks are done in its branch and wait for its merge, and a stage that is
 * not started. No agent runs: the merge of a stage is Skaro's own work.
 */
async function stageProject(userData: string) {
  const repo = makeRepo(userData);
  const store = new ArtifactStore(repo);
  await store.createMilestone({
    title: 'Оплата и подписки',
    body: '## Цель\n\nОплата без поддержки.\n\n## Критерий готовности\n\n- [ ] Оплата проходит end-to-end\n',
  });
  await store.createMilestone({ title: 'Уведомления' });
  await store.updateTask('T-001', { milestone: 'M01', status: 'review', order: 1 });
  await store.updateTask('T-002', { milestone: 'M01', status: 'review', order: 2 });
  await store.createTask({ title: 'Шаблоны писем', milestone: 'M02' });
  // The work of the two tasks is in the branch of the stage.
  git(repo, 'checkout', '-q', '-b', BRANCH);
  writeFileSync(join(repo, 'src', 'billing.js'), 'export const price = 10;\n');
  git(repo, 'add', 'src/billing.js');
  git(repo, 'commit', '-q', '-m', 'feat: billing');
  git(repo, 'checkout', '-q', 'main');
  await store.updateMilestone('M01', { branch: BRANCH });
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Stage verification', path: repo });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  db.close();
  return { repo, store };
}

test.skip(noAgents, noAgentsReason);

test('shows a stage on the plan and the board and merges it from its own screen', async () => {
  const userData = tempUserData();
  const { repo, store } = await stageProject(userData);
  const shots = process.env['SKARO_E2E_STAGE_SCREENSHOTS'];
  if (shots) mkdirSync(shots, { recursive: true });
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const shot = async (name: string) => {
      if (shots) await page.screenshot({ path: join(shots, `${name}.png`) });
    };
    const nav = (name: string) => page.getByRole('navigation').getByText(name, { exact: true });

    // The board: finished tasks of the stage are in review, dimmed, and do not wait for the user.
    const card = page.locator('.board-card').filter({ hasText: 'Исправить сложение' });
    await expect(card.locator('.ms')).toHaveText('M01 · ждёт слияния этапа');
    await expect(card).toHaveClass(/stage-done/);
    await shot('board');

    // The plan: the state of the stage and its button stand in the header of the milestone.
    await nav('План').click();
    const plan = page.locator('.screen').filter({ has: page.locator('.stages') });
    const stage = (name: string) =>
      plan.locator('.stage').filter({ has: page.locator('.name', { hasText: name }) });
    const billing = stage('Оплата и подписки');
    await expect(billing.locator('.state')).toHaveText('Остановлен · 2 из 2');
    await expect(billing.locator('.run')).toHaveText('Продолжить');
    await expect(billing.locator('.meta')).toContainText('Оплата проходит end-to-end');
    await expect(billing.locator('.meta')).not.toContainText('[ ]');
    await expect(billing.locator('.count')).toHaveText('2 из 2');
    await expect(billing.locator('.rows .stage-note').first()).toHaveText('ждёт слияния этапа');
    await expect(stage('Уведомления').locator('.run')).toHaveText('Запустить');
    await shot('plan');

    // «Влить готовое» opens the screen of the stage with the card of its finished tasks.
    await billing.getByRole('button', { name: 'Действия с этапом', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Влить готовое', exact: true }).click();
    const merge = page.locator('.fd-merge-card');
    await expect(merge.locator('.fd-card-title')).toHaveText('Влить готовые задачи этапа?');
    await expect(merge.locator('.stage-tasks .row')).toHaveCount(2);
    await expect(merge).toContainText('Приёмка этапа ещё не пройдена');
    await expect(page.locator('.crumbs .crumb')).toHaveText('План');
    await expect(page.getByRole('navigation').locator('[aria-current]')).toHaveText(/План/);
    await expect(page.locator('.task-description .tasks .row')).toHaveCount(2);
    await shot('stage-finished');

    // The readiness criterion is ticked by hand: the card becomes the merge of the stage.
    await page.locator('.task-description .criterion').click();
    await expect(merge.locator('.fd-card-title')).toHaveText('Влить этап?');
    await expect(merge).not.toContainText('Приёмка этапа ещё не пройдена');
    const message = merge.locator('.stage-tasks input').first();
    await message.fill('feat(billing): модель тарифов');
    await shot('stage-merge');

    await merge.getByRole('button', { name: 'Влить', exact: true }).click();
    await expect(page.locator('.fd-divider').filter({ hasText: 'Влито в main' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(merge).toHaveCount(0);
    await shot('stage-merged');
    expect((await store.readTask('T-001')).status).toBe('done');
    expect((await store.readTask('T-002')).status).toBe('done');
    expect(git(repo, 'log', '--format=%s', 'main')).toContain('feat: billing');
    expect(git(repo, 'show', 'main:src/billing.js')).toContain('price');
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});
