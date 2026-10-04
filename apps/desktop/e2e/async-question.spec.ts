// Real Codex async tool, real Electron backend, persisted chat and thread resume.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { join } from 'node:path';
import { launchApp, tempUserData } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

const projectPath = process.env['SKARO_E2E_PERMISSION_PROJECT'];
test.skip(!projectPath, 'Requires an existing managed project and signed-in Codex');

async function windowOf(app: ElectronApplication) {
  const page = await app.firstWindow();
  await app.evaluate(({ BrowserWindow }) => {
    const window = BrowserWindow.getAllWindows()[0]!;
    window.hide();
    window.setSize(1412, 982);
    window.webContents.setBackgroundThrottling(false);
  });
  return page;
}

test('keeps an actual async question after the turn and restart, and resumes the same thread with the card answer', async () => {
  test.setTimeout(180_000);
  const userData = tempUserData();
  let app = await launchApp(userData);
  try {
    let page = await windowOf(app);
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const project = await page.evaluate(async (path) => {
      const api = (window as unknown as { skaro: SkaroApi }).skaro;
      await api.invoke('app.setSetting', 'ui.locale', 'ru');
      const project = await api.invoke('projects.add', path);
      await api.invoke('tabs.set', { projects: [project.id], active: project.id });
      return project;
    }, projectPath!);
    await page.reload();
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    const chat = await page.evaluate(async (projectId) => {
      const api = (window as unknown as { skaro: SkaroApi }).skaro;
      return api.invoke(
        'chat.create',
        projectId,
        { agent: 'codex', effort: 'low', permissionMode: 'full' },
        {
          text:
            'Проверка асинхронной карточки Skaro. Используй именно request_user_input_async ' +
            '(не синхронный request_user_input), один вопрос: «Какой вариант проверки выбрать?» ' +
            'с вариантами «Штатный контур» и «Оставить заблокированным». ' +
            'После подтверждения приёма инструмента заверши этот ход строкой ASYNC_QUESTION_SENT. ' +
            'Так проверяется сохранение карточки после завершения хода. ' +
            'Когда придёт мой ответ, напиши ASYNC_QUESTION_REPLY_OK и выбранный вариант. ' +
            'Не запускай команды, не читай и не изменяй файлы и документы проекта.',
        },
      );
    }, project.id);
    await page.locator('.sessions .row').first().click();
    await expect(page.locator('.fd-text').filter({ hasText: 'ASYNC_QUESTION_SENT' })).toBeVisible({
      timeout: 100_000,
    });
    await expect(page.locator('.composer .stop')).toHaveCount(0);
    const pending = await page.evaluate(
      async ({ projectId, chatId }) => {
        const api = (window as unknown as { skaro: SkaroApi }).skaro;
        return (await api.invoke('chat.open', projectId, chatId)).timeline;
      },
      { projectId: project.id, chatId: chat.id },
    );
    expect(pending.status).toBe('idle');
    expect(pending.interactions).toHaveLength(1);
    expect(pending.interactions[0]).toMatchObject({ kind: 'question', delivery: 'async' });
    await expect(page.locator('.fd-card.question')).toHaveCount(1);
    await page.screenshot({ path: join(userData, 'async-question-before-restart.png') });
    await app.close();
    app = await launchApp(userData);
    page = await windowOf(app);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await page.locator('.sessions .row').first().click();
    const question = page.locator('.fd-card.question');
    await expect(question).toBeVisible();
    await question.locator('.option').filter({ hasText: 'Оставить заблокированным' }).click();
    await page.screenshot({ path: join(userData, 'async-question-after-restart.png') });
    await question.getByRole('button', { name: 'Ответить', exact: true }).click();
    await expect(question).toHaveCount(0);
    await expect(
      page.locator('.fd-text').filter({ hasText: 'ASYNC_QUESTION_REPLY_OK' }),
    ).toBeVisible({ timeout: 60_000 });
    const answered = await page.evaluate(
      async ({ projectId, chatId }) => {
        const api = (window as unknown as { skaro: SkaroApi }).skaro;
        return (await api.invoke('chat.open', projectId, chatId)).timeline;
      },
      { projectId: project.id, chatId: chat.id },
    );
    expect(answered.session?.nativeSessionId).toBe(pending.session?.nativeSessionId);
    const reply = answered.items.findLast(
      (item) => item.kind === 'message' && item.role === 'user',
    );
    expect(reply).toMatchObject({ text: 'Оставить заблокированным' });
    await expect(
      page.locator('.fd-bubble').filter({ hasText: /^Оставить заблокированным$/ }),
    ).toHaveCount(0);
    await expect(
      page.locator('.fd-done-line').filter({ hasText: 'Ответ: Оставить заблокированным' }),
    ).toHaveCount(1);
    const history = await page.locator('.fd-feed').innerText();
    expect(history.indexOf('Какой вариант проверки выбрать?')).toBeLessThan(
      history.indexOf('Ответ: Оставить заблокированным'),
    );
    expect(
      answered.items.some((item) => item.kind === 'decision' && item.answer?.kind === 'question'),
    ).toBe(true);
    expect(errors).toEqual([]);
    console.log(`Actual async-question check: ${userData}`);
  } finally {
    await app.close();
  }
});
