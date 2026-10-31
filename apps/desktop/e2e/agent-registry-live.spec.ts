// Existing real profile, genuine installed runtimes and native logs. No substituted transport.
import { expect, test, type Page } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AGENT_IDS, agentCatalog } from '@skaro/agents';
import type { RawLine } from '@skaro/timeline';
import type { ChatView, SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
const profile = process.env['SKARO_RESPONSIVENESS_PROFILE'];
const projectId = process.env['SKARO_RESPONSIVENESS_PROJECT'];
test.skip(!profile || !projectId, 'Requires an isolated copy of a real profile and project');

async function finished(page: Page, chatId: string): Promise<ChatView> {
  let view: ChatView | undefined;
  await expect
    .poll(
      async () => {
        view = await page.evaluate(
          ({ projectId, chatId }) => window.skaro.invoke('chat.open', projectId, chatId),
          { projectId: projectId!, chatId },
        );
        const last = view.timeline.turns.at(-1);
        if (last?.outcome === 'failed') throw new Error(JSON.stringify(last.error));
        return last?.outcome;
      },
      { timeout: 120_000, intervals: [500, 1000] },
    )
    .toBe('done');
  return view!;
}

test('preserves the actual agent settings UI and returns only presentation metadata', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const catalog = await page.evaluate(() => window.skaro.invoke('agents.catalog'));
    expect(catalog).toEqual(agentCatalog());
    const agents = await page.evaluate(() => window.skaro.invoke('agents.refresh'));
    expect(agents.map((agent) => agent.id)).toEqual(AGENT_IDS);
    for (const agent of agents) {
      expect(agent.installed).toBe(true);
      expect(agent.error).toBeUndefined();
      expect(agent.authenticated).toBe(true);
    }
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.getByRole('button', { name: 'Агенты', exact: true }).click();
    const cards = page.locator('.settings .agent.set-card');
    await expect(cards).toHaveCount(catalog.length);
    for (const [index, agent] of catalog.entries()) {
      const models = await page.evaluate(
        (id) => window.skaro.invoke('agents.models', id, ''),
        agent.id,
      );
      expect(models.length).toBeGreaterThan(0);
      await expect(
        cards.nth(index).getByRole('button', { name: 'Модель по умолчанию', exact: true }),
      ).toBeVisible();
      await page.evaluate((id) => window.skaro.invoke('agents.config', id), agent.id);
      await expect(cards.nth(index).locator('.cfg-dir')).toBeVisible();
      await expect(cards.nth(index).locator('.name').first()).toHaveText(agent.name);
      const logo = cards.nth(index).getByRole('img', { name: agent.name, exact: true });
      await expect(logo).toHaveAttribute('width', '24');
      await expect(logo).toHaveAttribute('height', '24');
      expect(
        await logo
          .locator('path')
          .evaluateAll((paths) => paths.map((path) => path.getAttribute('d'))),
      ).toEqual(agent.logo.paths.map((path) => path.d));
    }
    await page.screenshot({ path: info.outputPath('agent-settings.png') });
    expect(errors).toEqual([]);
  } finally {
    await app.close();
  }
});

for (const agent of AGENT_IDS) {
  test(`${agent}: starts in the worker, replays the real log and resumes its native session`, async () => {
    test.setTimeout(300_000);
    let app = await launchApp(profile!, { openSavedProject: false });
    let chatId: string | undefined;
    try {
      let page = await app.firstWindow();
      const marker = `SKARO_REGISTRY_${agent}_${Date.now()}`;
      const chat = await page.evaluate(
        ({ projectId, agent, marker }) =>
          window.skaro.invoke(
            'chat.create',
            projectId,
            { agent, permissionMode: 'ask' },
            {
              text: `Delivery verification only. Reply with exactly ${marker}. Do not call tools, read or change files, documents or tasks.`,
            },
          ),
        { projectId: projectId!, agent, marker },
      );
      chatId = chat.id;
      const first = await finished(page, chatId);
      expect(
        first.timeline.items.some(
          (item) => item.kind === 'message' && item.role === 'agent' && item.text.includes(marker),
        ),
      ).toBe(true);
      const nativeId = first.timeline.session?.nativeSessionId;
      expect(nativeId).toBeTruthy();
      await app.close();

      const db = new DatabaseSync(join(profile!, 'skaro.db'), { readOnly: true });
      let record: Record<string, unknown>;
      try {
        record = db.prepare('SELECT log_path,native_session_id FROM chats WHERE id=?').get(chatId)!;
      } finally {
        db.close();
      }
      expect(record.native_session_id).toBe(nativeId);
      const lines: RawLine[] = (await readFile(join(profile!, String(record.log_path)), 'utf8'))
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line));
      expect(
        lines.some(
          (line) =>
            line.dir === 'meta' &&
            (line.line as { skaro?: string; agent?: string }).skaro === 'segment' &&
            (line.line as { agent?: string }).agent === agent,
        ),
      ).toBe(true);

      app = await launchApp(profile!, { openSavedProject: false });
      page = await app.firstWindow();
      const restored = await page.evaluate(
        ({ projectId, chatId }) => window.skaro.invoke('chat.open', projectId, chatId),
        { projectId: projectId!, chatId },
      );
      expect(restored.timeline.session?.nativeSessionId).toBe(nativeId);
      expect(
        restored.timeline.items.some(
          (item) => item.kind === 'message' && item.role === 'agent' && item.text.includes(marker),
        ),
      ).toBe(true);
      const next = `${marker}_RESUMED`;
      await page.evaluate(
        ({ projectId, chatId, next }) =>
          window.skaro.invoke('chat.send', projectId, chatId, {
            text: `Reply with exactly ${next}. Do not use tools or change anything.`,
          }),
        { projectId: projectId!, chatId, next },
      );
      await expect
        .poll(async () => (await finished(page, chatId!)).timeline.turns.length, {
          timeout: 120_000,
        })
        .toBeGreaterThan(first.timeline.turns.length);
      const resumed = await finished(page, chatId);
      expect(resumed.timeline.session?.nativeSessionId).toBe(nativeId);
      expect(
        resumed.timeline.items.some(
          (item) => item.kind === 'message' && item.role === 'agent' && item.text.includes(next),
        ),
      ).toBe(true);
    } finally {
      if (chatId) {
        const page = await app.firstWindow().catch(() => undefined);
        await page
          ?.evaluate(
            ({ projectId, chatId }) => window.skaro.invoke('chat.archive', projectId, chatId, true),
            { projectId: projectId!, chatId },
          )
          .catch(() => undefined);
      }
      await app.close();
    }
  });
}
