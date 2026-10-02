import { expect, test } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import { launchApp, tempUserData } from './launch';
import { makeRepo, openTask } from './agent-task-support';

/** Authorized file/Git fixtures; real Electron main, preload, replay and native download. */
test('shows unknown events as expandable service lines and exports sanitized diagnostics', async () => {
  const userData = tempUserData();
  const repo = makeRepo(userData);
  const db = AppDb.open(join(userData, 'skaro.db'));
  const project = db.addProject({ name: 'Diagnostics', path: repo });
  db.setOpenTabs([project.id], project.id);
  db.setSetting('ui.locale', 'ru');
  const logPath = 'runs/unknown.jsonl';
  const run = db.createRun({
    projectId: project.id,
    taskId: 'T-001',
    agent: 'codex',
    logPath,
    adapterVersion: 'test',
  });
  db.finishRun(run.id, 'done');
  db.close();
  mkdirSync(join(userData, 'runs'));
  writeFileSync(
    join(userData, logPath),
    JSON.stringify({
      ts: 0,
      dir: 'meta',
      line: {
        skaro: 'event',
        event: {
          t: 'item.upsert',
          item: {
            id: 'unknown-1',
            turnId: '',
            kind: 'unknown',
            status: 'done',
            startedAt: 0,
            native: { agent: 'codex', type: 'future/event', ref: 'private-ref' },
            raw: { content: 'private-file-content', apiKey: 'private-token' },
          },
        },
      },
    }) + '\n',
  );
  const app = await launchApp(userData);
  try {
    const page = await app.firstWindow();
    await openTask(page, 'Исправить сложение');
    const notice = page
      .locator('.fd-notice')
      .filter({ hasText: 'Событие агента, которое Skaro пока не умеет показать' });
    await expect(notice).toBeVisible();
    await notice.locator('.more').click();
    await expect(notice).toContainText('future/event');
    await expect(notice).not.toContainText('private-file-content');
    await page.getByRole('button', { name: 'Настройки', exact: true }).click();
    await page.getByRole('button', { name: 'О программе', exact: true }).click();
    const path = join(userData, 'exported-diagnostics.json');
    await app.evaluate(({ session }, destination) => {
      session.defaultSession.once('will-download', (_event, item) => item.setSavePath(destination));
    }, path);
    await page.getByRole('button', { name: 'Выгрузить диагностику' }).click();
    await expect
      .poll(() => {
        if (!existsSync(path)) return undefined;
        try {
          return JSON.parse(readFileSync(path, 'utf8')).unknownEvents;
        } catch {
          return undefined;
        }
      })
      .toBe(1);
    const contents = readFileSync(path, 'utf8');
    for (const secret of ['private-ref', 'private-token', 'private-file-content', repo])
      expect(contents).not.toContain(secret);
    await page.screenshot({ path: 'test-results/diagnostics-real-electron.png' });
  } finally {
    await app.close();
  }
});
