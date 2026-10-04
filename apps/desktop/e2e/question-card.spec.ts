// Opt-in check with the real Electron backend, existing project and installed Codex.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { launchApp, tempUserData } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

const projectPath = process.env['SKARO_E2E_PERMISSION_PROJECT'];
test.skip(!projectPath, 'Requires an existing real managed project and signed-in Codex');

test('shows board IDs and delivers an actual Codex question before finishing', async () => {
  test.setTimeout(180_000);
  const userData = tempUserData();
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.hide();
      window.setSize(1412, 982);
      window.webContents.setBackgroundThrottling(false);
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const { project, tasks } = await page.evaluate(async (path) => {
      const api = (window as unknown as { skaro: SkaroApi }).skaro;
      await api.invoke('app.setSetting', 'ui.locale', 'ru');
      const project = await api.invoke('projects.add', path);
      await api.invoke('tabs.set', { projects: [project.id], active: project.id });
      return { project, tasks: await api.invoke('tasks.list', project.id) };
    }, projectPath!);
    await page.reload();
    const cards = page.locator('.board .card');
    await expect(cards.first()).toBeVisible();
    const titles = await cards.locator('.top > .title').allTextContents();
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(
        tasks.some((task) => title === `${task.id.replace(/^T-0*(\d+)$/, 'T$1')} · ${task.title}`),
      ).toBe(true);
    }
    await page.screenshot({ path: join(userData, 'board-task-ids.png') });
    await cards.first().click();
    await expect(page.locator('.task .composer')).toBeVisible();
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await page.evaluate(async (projectId) => {
      const api = (window as unknown as { skaro: SkaroApi }).skaro;
      await api.invoke(
        'chat.create',
        projectId,
        { agent: 'codex', effort: 'low', permissionMode: 'full' },
        {
          text:
            'Проверяем настоящую карточку вопроса в Skaro. Для этой проверки требуется моё решение: ' +
            'выбрать «Штатный контур» или «Оставить заблокированным». Задай этот выбор через инструмент ' +
            'вопросов и дождись ответа. Не пиши, что вопрос отправлен, вместо вызова инструмента. ' +
            'Не запускай команды, не читай и не изменяй файлы и документы проекта. ' +
            'После ответа напиши QUESTION_CARD_OK и выбранный вариант.',
        },
      );
    }, project.id);
    await page.locator('.sessions .row').first().click();
    const question = page.locator('.fd-card.question');
    await expect(question).toBeVisible({ timeout: 100_000 });
    await expect(page.getByText('QUESTION_CARD_OK', { exact: true })).toHaveCount(0);
    const answer = question.getByRole('button', { name: 'Ответить', exact: true });
    await expect(answer).toBeDisabled();
    await question.locator('.option').filter({ hasText: 'Оставить заблокированным' }).click();
    await expect(answer).toBeEnabled();
    await page.screenshot({ path: join(userData, 'question-card.png') });
    await answer.click();
    await expect(question).toHaveCount(0);
    await expect(page.locator('.fd-text').filter({ hasText: 'QUESTION_CARD_OK' })).toBeVisible({
      timeout: 60_000,
    });
    await expect(page.locator('.composer .stop')).toHaveCount(0);
    await page.screenshot({ path: join(userData, 'question-answered.png') });
    expect(errors).toEqual([]);
    console.log(`Real Skaro verification: ${userData}`);
  } finally {
    await app.close();
  }
});
