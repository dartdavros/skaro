import { expect, test } from '@playwright/test';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, relative } from 'node:path';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';
import { HISTORY_VERSION } from '../src/shared/history';

declare const window: Window & { skaro: SkaroApi };
const receipt = process.env.SKARO_NOTE_ACCEPTANCE;
test.skip(!receipt, 'Requires a verified backup of real Cat-pilot histories; no seeded messages');

test('shows only the accepted owner input from real multi-note history, including cached reopening', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const scope = JSON.parse(readFileSync(receipt!, 'utf8')) as {
    profile: string;
    projectId: string;
    taskId: string;
    runId: string;
    log: string;
    logHash: string;
    original: string;
  };
  const db = new DatabaseSync(join(scope.profile, 'skaro.db'), { readOnly: true });
  const commands = new Map<string, string>();
  try {
    for (const row of db
      .prepare('SELECT id,args FROM owner_commands WHERE owner=?')
      .all(`${scope.projectId}:${scope.taskId}`)) {
      const input = JSON.parse(String(row.args))[2] as { text: string; internal?: boolean };
      if (!input.internal && !input.text.startsWith('<skaro-note>'))
        commands.set(String(row.id), input.text);
    }
  } finally {
    db.close();
  }
  expect(commands.size).toBeGreaterThan(0);
  const cached = () => {
    const db = new DatabaseSync(join(scope.profile, 'workspace.db'), { readOnly: true });
    try {
      const owner = `${scope.projectId}:task:T-010`;
      const signature = String(
        db.prepare('SELECT signature FROM feed_views WHERE owner=?').get(owner)?.signature ?? '',
      );
      const rows = db
        .prepare('SELECT value FROM feed_blocks WHERE owner=?')
        .all(owner)
        .map((row) => JSON.parse(String(row.value)));
      const exposed = rows.filter(
        (block) =>
          block.type === 'row' &&
          block.row.type === 'user' &&
          block.row.item.text.startsWith('<skaro-note>'),
      ).length;
      return { signature, exposed };
    } finally {
      db.close();
    }
  };
  const previousCache = cached();
  expect(previousCache.signature).toMatch(/^4:/);
  expect(previousCache.exposed).toBeGreaterThan(0);
  const errors: string[] = [];
  const results: { phase: string; item: string; length: number }[] = [];
  let selected: { id: string; text: string } | undefined;
  for (const phase of ['restored', 'reopened']) {
    const app = await launchApp(scope.profile, { openSavedProject: false });
    try {
      const page = await app.firstWindow();
      page.on('pageerror', (error) => errors.push(error.message));
      if (phase === 'restored') {
        await page.evaluate(async (project) => {
          await window.skaro.invoke('task.open', project, 'T-010', { paged: true });
        }, scope.projectId);
        expect(cached().signature.startsWith(`${HISTORY_VERSION}:`)).toBe(true);
        expect(cached().exposed).toBe(0);
      }
      const view = await page.evaluate(async ({ projectId, taskId }) => {
        const projects = await window.skaro.invoke('projects.list');
        if (
          projects.length !== 1 ||
          projects[0]?.id !== projectId ||
          projects[0].name !== 'Cat-pilot'
        )
          throw new Error('Foreign project in verification');
        await window.skaro.invoke('tabs.set', { projects: [projectId], active: projectId });
        return window.skaro.invoke('task.open', projectId, taskId);
      }, scope);
      expect(view.task.status).toBe('done');
      expect(view.run?.id).toBe(scope.runId);
      if (!selected) {
        for (const item of view.timeline?.items ?? []) {
          if (
            item.kind !== 'message' ||
            item.role !== 'user' ||
            !/^<skaro-note>[\s\S]*?<\/skaro-note>\s*<skaro-note>/.test(item.text)
          )
            continue;
          const command = /^command_id: ([^\r\n]+)$/m.exec(item.text)?.[1];
          const text = command && commands.get(command);
          if (text) selected = { id: item.id, text };
        }
      }
      expect(
        selected,
        'Actual multi-note native echo must match a durable accepted owner command',
      ).toBeDefined();
      const target = selected!;
      await page.evaluate(async ({ projectId, taskId }) => {
        await window.skaro.invoke('app.setSetting', 'ui.workspace', {
          view: 'project',
          sections: { [projectId]: 'tasks' },
          openTasks: { [projectId]: taskId },
          openChats: {},
        });
      }, scope);
      await page.reload();
      const scroller = page.locator('.task-conversation .scroller');
      await expect(scroller).toBeVisible({ timeout: 30_000 });
      const bubble = page.locator(`[data-feed-block=${JSON.stringify(target.id)}] .fd-bubble`);
      for (let step = 0; step < 40 && !(await bubble.count()); step++) {
        await scroller.evaluate((element) => {
          element.dispatchEvent(new CustomEvent('feed-reveal', { bubbles: true }));
          element.scrollTop = Math.max(0, element.scrollTop - element.clientHeight * 0.75);
        });
        await page.waitForTimeout(150);
      }
      await expect(bubble).toHaveCount(1);
      await bubble.scrollIntoViewIfNeeded();
      const shown = (await bubble.textContent())!.trim();
      expect(shown).toBe(target.text.trim());
      expect(shown).not.toContain('<skaro-note>');
      expect(shown).not.toContain('command_id:');
      await page.screenshot({ path: info.outputPath(`${phase}.png`) });
      results.push({ phase, item: target.id, length: shown.length });
    } finally {
      await app.close();
    }
  }
  expect(errors).toEqual([]);
  expect(createHash('sha256').update(readFileSync(scope.log)).digest('hex')).toBe(scope.logHash);
  const copiedLog = join(scope.profile, relative(scope.original, scope.log));
  expect(createHash('sha256').update(readFileSync(copiedLog)).digest('hex')).toBe(scope.logHash);
  writeFileSync(
    info.outputPath('proof.json'),
    JSON.stringify(
      {
        project: scope.projectId,
        task: scope.taskId,
        results,
        errors,
        sourceHistoryUnchanged: true,
        copiedHistoryUnchanged: true,
        previousCache,
        rebuiltCache: cached(),
      },
      null,
      2,
    ),
  );
});
