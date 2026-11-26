import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { launchApp } from './launch';
import type { SkaroApi } from '../src/shared/ipc';

declare const window: Window & { skaro: SkaroApi };
const project = process.env.SKARO_VERIFICATION_PROJECT;
const profile = process.env.SKARO_FOLLOW_UP_PROFILE;
test.skip(!project || !profile, 'Requires the registered Cat-pilot and its real profile');

test('keeps Mermaid errors inside the draft and reports memory of the live process tree', async ({
  browserName: _browserName,
}, info) => {
  test.setTimeout(180_000);
  const readme = await readFile(join(__dirname, '../node_modules/mermaid/README.md'), 'utf8');
  const example = /^```mermaid\r?\n(flowchart [\s\S]*?)\r?\n```/m.exec(readme)!;
  // An actual prefix encountered while typing the published flowchart, inside its first label.
  const prefix = example[0].slice(0, example[0].indexOf('[') + 1);
  const app = await launchApp(profile!, { openSavedProject: false });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('.bar')).toBeVisible();
    await page.evaluate(async (id) => {
      const projects = await window.skaro.invoke('projects.list');
      if (projects.length !== 1 || projects[0]?.id !== id) throw new Error('Wrong project scope');
      await window.skaro.invoke('app.setSetting', 'ui.workspace', {
        view: 'project',
        sections: { [id]: 'docs' },
      });
    }, project!);
    await page.reload();
    await page.getByRole('button', { name: /^(Редактировать|Edit)$/ }).click();
    const editor = page.locator('textarea[data-doc-editor]');
    const previous = await editor.inputValue();
    const diagram = page.locator('.md-mermaid');
    for (let pass = 0; pass < 2; pass++) {
      await editor.fill(prefix);
      await expect(diagram).toHaveClass(/md-mermaid-error/);
      await expect(diagram).toContainText('A[');
      await expect(page.locator('body > [id^="dsk-mermaid"]')).toHaveCount(0);
      await expect(page.getByText('Syntax error in text', { exact: true })).toHaveCount(0);
      if (pass === 0) await page.screenshot({ path: info.outputPath('mermaid-error.png') });
      await editor.fill(example[0]);
      await expect(diagram.locator(':scope > svg')).toBeVisible();
      await expect(diagram).toContainText('Result 2');
      await expect(diagram).not.toHaveClass(/md-mermaid-error/);
    }
    await page.screenshot({ path: info.outputPath('mermaid-document.png') });
    await editor.fill(previous);
    await page.getByRole('button', { name: /^(Отмена|Cancel)$/ }).click();
    await expect(editor).toHaveCount(0);
    await expect(page.locator('body > [id^="dsk-mermaid"]')).toHaveCount(0);

    const nav = page.locator('.project-nav');
    const chats = nav.getByRole('button', { name: /^(Чат|Chat)$/ });
    await chats.click();
    const row = page.locator('[data-chat-id]:not(:has(.live))').first();
    await row.click();
    const chatId = await row.getAttribute('data-chat-id');
    await nav.getByRole('button', { name: /^(Документы|Documents)$/ }).click();
    await chats.click();
    await expect(page.locator(`[data-chat-id="${chatId}"]`)).toHaveClass(/\bon\b/);
    await expect(page.locator('body > [id^="dsk-mermaid"]')).toHaveCount(0);

    const memory = await page.evaluate(
      async () => (await window.skaro.invoke('diagnostics.export')).memory,
    );
    expect(memory?.scope).toBe('process-tree');
    for (const role of ['Browser', 'Tab'])
      expect(memory?.processes.some((row) => row.role === role && row.residentBytes > 0)).toBe(
        true,
      );
    for (const row of memory!.processes)
      expect(Object.keys(row).sort()).toEqual(['residentBytes', 'role']);
    console.log('Live diagnostic memory:', memory);
  } finally {
    await app.close();
  }
});
