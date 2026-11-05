// Real Codex, Electron services and the registered Cat-pilot; no replay or substituted API.
import { expect, test } from '@playwright/test';
import { join } from 'node:path';
import { launchApp } from './launch';
import { revealChatRow } from './chat-list-live-support';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const project = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(!profile || !project, 'Requires the registered Cat-pilot and signed-in Codex');

test('sends a composer clarification while both async fields remain unanswered', async () => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.hide();
      window.setSize(1412, 982);
      window.webContents.setBackgroundThrottling(false);
    });
    await page.evaluate(async (id) => {
      await window.skaro.invoke('tabs.set', { projects: [id], active: id });
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        view: 'project',
        sections: { [id]: 'chats' },
        openTasks: {},
        openChats: {},
      });
    }, project!);
    await page.reload();
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    const chat = await page.evaluate(
      async (id) =>
        window.skaro.invoke(
          'chat.create',
          id,
          { agent: 'codex', effort: 'low', permissionMode: 'full' },
          {
            text:
              'Проверка уточнения в Skaro. Не читай и не меняй файлы или документы проекта. ' +
              'Вызови request_user_input_async с двумя вопросами без вариантов: «Какой сервис проверяем?» ' +
              'и «Какой доступ нужен?». После вызова остановись и жди. ' +
              'Если я спрошу «О каком сервисе речь?», ответь только «CLARIFICATION_OK: речь о выбранном вами сервисе». ' +
              'Это уточнение не отвечает на вопросы; оставь оба вопроса открытыми. Другие инструменты не вызывай.',
          },
        ),
      project!,
    );
    await (await revealChatRow(page, project!, chat.id)).click();
    const card = page.locator('.chat .fd-card.question');
    await expect(card).toBeVisible({ timeout: 90_000 });
    const read = () =>
      page.evaluate(
        async ({ project, chat }) =>
          (await window.skaro.invoke('chat.open', project, chat)).timeline,
        { project: project!, chat: chat.id },
      );
    await expect.poll(async () => !!(await read()).turns.at(-1)?.outcome).toBe(true);
    const before = await read();
    expect(before.interactions[0]).toMatchObject({ kind: 'question', delivery: 'async' });
    const question = before.interactions[0]!;
    expect(question.kind === 'question' && question.questions.length).toBe(2);
    const input = page.locator('.chat .composer textarea');
    await input.fill('О каком сервисе речь?');
    await input.press('Enter');
    await expect(input).toHaveValue('');
    await expect(page.locator('.fd-text').filter({ hasText: 'CLARIFICATION_OK:' })).toBeVisible({
      timeout: 60_000,
    });
    await expect.poll(async () => !!(await read()).turns.at(-1)?.outcome).toBe(true);
    const after = await read();
    expect(after.interactions).toEqual(before.interactions);
    expect(after.status).toBe('waiting');
    expect(after.session?.nativeSessionId).toBe(before.session?.nativeSessionId);
    expect(
      after.items.some((item) => item.kind === 'decision' && item.answer?.kind === 'question'),
    ).toBe(false);
    await expect(card).toBeVisible();
    await expect(page.getByText('Ошибка: Ответьте на все вопросы', { exact: true })).toHaveCount(0);
    expect(errors).toEqual([]);
    await page.screenshot({ path: join(profile!, 'question-clarification.png') });
    console.log(`Actual clarification proof: ${profile}; chat ${chat.id}`);
    await page.evaluate(
      async ({ project, chat }) => window.skaro.invoke('chat.archive', project, chat, true),
      { project: project!, chat: chat.id },
    );
  } finally {
    // This check intentionally leaves unanswered cards. Use the application's graceful
    // end-session path so teardown does not wait on its native quit confirmation.
    await app.evaluate(({ powerMonitor }) => powerMonitor.emit('shutdown'));
    await app.close();
  }
});
