import { expect, test } from '@playwright/test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import type { AgentId, SkaroApi } from '../src/shared/ipc';
import { launchApp, tempUserData } from './launch';
import { makeRepo, send } from './agent-task-support';

const agents = (process.env['SKARO_E2E_AGENTS'] ?? '')
  .split(',')
  .filter((agent): agent is AgentId => agent === 'codex' || agent === 'claude-code');

for (const agent of agents) {
  test(`${agent}: project chat applies a document, restores history and resumes with decisions`, async () => {
    test.setTimeout(10 * 60_000);
    const userData = tempUserData();
    const repo = makeRepo(userData);
    writeFileSync(
      join(repo, '.skaro', 'config.yaml'),
      'base_branch: main\nchat:\n  auto_accept_docs: false\n',
    );
    const db = AppDb.open(join(userData, 'skaro.db'));
    const project = db.addProject({ name: 'Chat verification', path: repo });
    db.setOpenTabs([project.id], project.id);
    db.setSetting('ui.locale', 'ru');
    db.close();
    let app = await launchApp(userData);
    try {
      let page = await app.firstWindow();
      await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
      const chat = await page.evaluate(
        async ({ projectId, agent }) => {
          const api = (window as unknown as { skaro: SkaroApi }).skaro;
          return api.invoke(
            'chat.create',
            projectId,
            { agent, effort: 'low', permissionMode: 'full' },
            {
              text:
                'Через инструмент Skaro write_doc предложи brief.md с точным содержимым "# CHAT_REFACTOR_OK". ' +
                'Не записывай файл самостоятельно, не запускай команды. После предложения закончи ответ.',
            },
          );
        },
        { projectId: project.id, agent },
      );
      await page.locator('.sessions .row').filter({ hasText: chat.title }).click();
      const proposal = page.locator('.proposal').filter({ hasText: 'brief.md' });
      await expect(proposal.getByRole('button', { name: 'Применить', exact: true })).toBeVisible({
        timeout: 5 * 60_000,
      });
      expect(existsSync(join(repo, '.skaro', 'brief.md'))).toBe(false);
      await proposal.getByRole('button', { name: 'Применить', exact: true }).click();
      await expect
        .poll(() => readFileSync(join(repo, '.skaro', 'brief.md'), 'utf8'))
        .toContain('CHAT_REFACTOR_OK');
      await expect(page.locator('.composer .stop')).toHaveCount(0, { timeout: 120_000 });
      await app.close();
      app = await launchApp(userData);
      page = await app.firstWindow();
      await page.getByRole('navigation').getByText('Чат', { exact: true }).click();
      await page.locator('.sessions .row').filter({ hasText: chat.title }).click();
      const restored = page.locator('.proposal').filter({ hasText: 'brief.md' });
      await restored.getByRole('button', { name: 'Откатить', exact: true }).click();
      await expect.poll(() => existsSync(join(repo, '.skaro', 'brief.md'))).toBe(false);
      await send(page, 'Ничего не меняй. Напиши одним словом CHAT_RESUMED_OK.');
      await expect(
        page.locator('.fd-text').filter({ hasText: 'CHAT_RESUMED_OK' }).last(),
      ).toBeVisible({ timeout: 5 * 60_000 });
      await expect(page.locator('.composer .stop')).toHaveCount(0, { timeout: 120_000 });
      await page.screenshot({
        path: join(__dirname, '..', 'test-results', `${agent}-chat-restored.png`),
      });
      await page.evaluate(
        async ({ projectId, chatId }) => {
          const api = (window as unknown as { skaro: SkaroApi }).skaro;
          await api.invoke('chat.archive', projectId, chatId, true);
          const list = await api.invoke('chats.list', projectId);
          if (!list.find((chat) => chat.id === chatId)?.archived)
            throw new Error('Chat was not archived');
        },
        { projectId: project.id, chatId: chat.id },
      );
    } finally {
      await app.close();
    }
  });
}
