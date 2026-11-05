// Real Codex async tool, real Electron backend, persisted chat and thread resume.
import { expect, test, type ElectronApplication } from '@playwright/test';
import { revealChatRow } from './chat-list-live-support';
import { join } from 'node:path';
import { launchApp, tempUserData } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

const projectPath = process.env['SKARO_E2E_PERMISSION_PROJECT'];
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const projectId = process.env['SKARO_RESPONSIVENESS_PROJECT'];
const existingChat = process.env['SKARO_QUESTION_CHAT'];
test.skip(
  !projectPath && !(profile && projectId),
  'Requires an existing managed project and signed-in Codex',
);

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
  const userData = profile ?? tempUserData();
  let app = await launchApp(userData, { openSavedProject: false });
  try {
    let page = await windowOf(app);
    const errors: string[] = [];
    page.on('pageerror', (error) => {
      errors.push(error.message);
      console.log('Renderer error:', error.message);
    });
    const project = await page.evaluate(
      async ({ path, id }) => {
        const api = (window as unknown as { skaro: SkaroApi }).skaro;
        if (id) {
          const project = (await api.invoke('projects.list')).find((p) => p.id === id);
          if (!project) throw new Error('The real project is absent from the copied profile');
          return project;
        }
        await api.invoke('app.setSetting', 'ui.locale', 'ru');
        const project = await api.invoke('projects.add', path!);
        await api.invoke('tabs.set', { projects: [project.id], active: project.id });
        return project;
      },
      { path: projectPath, id: projectId },
    );
    await page.reload();
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    const initialChats = (
      await page.evaluate(
        async (id) => (window as unknown as { skaro: SkaroApi }).skaro.invoke('chats.list', id),
        project.id,
      )
    ).filter((chat) => !chat.archived).length;
    const chat = await page.evaluate(
      async ({ projectId, existingChat }) => {
        const api = (window as unknown as { skaro: SkaroApi }).skaro;
        if (existingChat)
          return (await api.invoke('chats.list', projectId)).find(
            (chat) => chat.id === existingChat,
          )!;
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
      },
      { projectId: project.id, existingChat },
    );
    await expect
      .poll(() =>
        page.evaluate(
          async (project) =>
            (
              await (window as unknown as { skaro: SkaroApi }).skaro.invoke(
                'chats.query',
                project,
                false,
              )
            ).activeCount,
          project.id,
        ),
      )
      .toBe(initialChats + (existingChat ? 0 : 1));
    await (await revealChatRow(page, project.id, chat.id)).click();
    await expect(page.locator('.chat .main > .head .title')).toHaveText(chat.title, {
      timeout: 5000,
    });
    await expect(page.locator('.fd-card.question')).toBeVisible({ timeout: 100_000 });
    await expect(page.locator('.fd-text').filter({ hasText: 'ASYNC_QUESTION_SENT' })).toHaveCount(
      0,
    );
    const pending = await page.evaluate(
      async ({ projectId, chatId }) => {
        const api = (window as unknown as { skaro: SkaroApi }).skaro;
        return (await api.invoke('chat.open', projectId, chatId)).timeline;
      },
      { projectId: project.id, chatId: chat.id },
    );
    expect(pending.status).toBe('waiting');
    expect(pending.interactions).toHaveLength(1);
    expect(pending.interactions[0]).toMatchObject({ kind: 'question', delivery: 'async' });
    const blocked = await page.evaluate(
      async ({ projectId, chatId }) => {
        const api = (window as unknown as { skaro: SkaroApi }).skaro;
        const commandId = crypto.randomUUID();
        await api.invoke('chat.send', projectId, chatId, {
          commandId,
          internal: true,
          text: 'Проверка барьера вопросов: это сообщение не должно попасть агенту до ответа на карточку.',
        });
        return commandId;
      },
      { projectId: project.id, chatId: chat.id },
    );
    await expect
      .poll(async () => {
        const commands = await page.evaluate(
          ({ projectId, chatId }) =>
            (window as unknown as { skaro: SkaroApi }).skaro.invoke(
              'commands.list',
              projectId,
              chatId,
            ),
          { projectId: project.id, chatId: chat.id },
        );
        return commands.find((command) => command.id === blocked)?.state;
      })
      .toBe('failed');
    await expect(page.locator('.fd-bar')).toHaveCount(0);
    const pinned = await page
      .locator('.fd-card.question')
      .evaluate((el) => !el.closest('.scroller') && !!el.closest('.bottom'));
    expect(pinned).toBe(true);
    await expect(page.locator('.fd-card.question')).toHaveCount(1);
    await page.screenshot({ path: join(userData, 'async-question-before-restart.png') });
    await app.close();
    app = await launchApp(userData, { openSavedProject: false });
    page = await windowOf(app);
    page.on('pageerror', (error) => errors.push(error.message));
    await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
    await (await revealChatRow(page, project.id, chat.id)).click();
    const question = page.locator('.fd-card.question');
    await expect(question).toBeVisible();
    await page.evaluate(
      ({ project, chat }) =>
        (window as unknown as { skaro: SkaroApi }).skaro.invoke(
          'chat.archive',
          project,
          chat,
          true,
        ),
      { project: project.id, chat: chat.id },
    );
    await expect(question).toHaveCount(0);
    const archivedAnswer = await page.evaluate(
      async ({ project, chat, interaction }) => {
        const api = (window as unknown as { skaro: SkaroApi }).skaro;
        const view = await api.invoke('chat.open', project, chat);
        const pending = view.timeline.interactions.find((item) => item.id === interaction);
        if (pending?.kind !== 'question') throw new Error('Archiving lost the real question');
        try {
          await api.invoke('chat.respond', project, chat, interaction, {
            kind: 'question',
            answers: Object.fromEntries(
              pending.questions.map((q) => [q.id, [q.options[0]!.label]]),
            ),
          });
          return '';
        } catch (error) {
          return String(error);
        }
      },
      { project: project.id, chat: chat.id, interaction: pending.interactions[0]!.id },
    );
    expect(archivedAnswer).toContain('archived');
    await page.evaluate(
      ({ project, chat }) =>
        (window as unknown as { skaro: SkaroApi }).skaro.invoke(
          'chat.archive',
          project,
          chat,
          false,
        ),
      { project: project.id, chat: chat.id },
    );
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
    expect(reply?.kind === 'message' && reply.text).toContain('Оставить заблокированным');
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
