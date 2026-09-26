// Stage 6 end to end: a project chat with a real agent writes the brief, proposes an ADR and a
// milestone with tasks through Skaro's MCP tools; the user accepts the cards and everything lands
// in .skaro/. The decisions reach the agent with the next message.
//
// Needs signed-in agents and spends a little of their usage, so it runs only on request:
//   SKARO_E2E_AGENTS=claude-code,codex SKARO_AGENTS_DIR=<shared agents dir> pnpm test:e2e agent-chat

import { expect, test, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AppDb } from '@skaro/core';
import { launchApp, tempUserData } from './launch';

const agents = (process.env['SKARO_E2E_AGENTS'] ?? '').split(',').filter(Boolean);

function makeRepo(root: string): string {
  const repo = join(root, 'calc');
  mkdirSync(join(repo, '.skaro'), { recursive: true });
  writeFileSync(join(repo, 'README.md'), '# calc\n');
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
  return repo;
}

/** The summary line of each finished turn (not the warning bars of notices). */
async function waitTurnEnd(page: Page, count: number): Promise<void> {
  const ends = page.locator('.fd-bar:not(.warning)');
  await expect(ends).toHaveCount(count, { timeout: 10 * 60_000 });
  await expect(ends.last()).not.toHaveClass(/error/);
}

async function send(page: Page, text: string): Promise<void> {
  const box = page.locator('.composer textarea');
  await box.fill(text);
  await box.press('Enter');
}

for (const agent of agents) {
  test(`${agent}: the chat writes the brief, an ADR, a milestone and tasks to .skaro/`, async () => {
    test.setTimeout(30 * 60_000);
    const userData = tempUserData();
    const repo = makeRepo(userData);
    const db = AppDb.open(join(userData, 'skaro.db'));
    const project = db.addProject({ name: 'Calc', path: repo });
    db.setOpenTabs([project.id], project.id);
    db.setSetting('ui.locale', 'ru');
    // A new chat starts with the agent chosen last.
    db.setSetting(`chats.${project.id}.last`, { agent, effort: 'low' });
    db.close();

    const app = await launchApp(userData);
    const page = await app.firstWindow();
    await page.getByRole('navigation').getByText('Чат').click();
    await expect(page.getByText('С чего начнём проект?')).toBeVisible();

    await send(
      page,
      'Проект — консольный калькулятор на TypeScript. Без уточняющих вопросов, сразу: ' +
        '1) запиши короткий бриф инструментом write_doc (brief.md); ' +
        '2) предложи ADR «TypeScript как язык проекта» инструментом propose_adr; ' +
        '3) предложи этап «Ядро» с двумя задачами — «Сложение» и «Умножение», умножение зависит ' +
        'от сложения — инструментом propose_milestones. Код не пиши и файлы сам не меняй.',
    );
    await waitTurnEnd(page, 1);

    // The brief applies at once (auto-apply is on by default) and can be rolled back.
    const brief = join(repo, '.skaro', 'brief.md');
    expect(existsSync(brief)).toBe(true);
    await expect(page.locator('.proposal').filter({ hasText: 'brief.md' })).toContainText(
      'Применено',
    );

    // The ADR and the milestone wait for the user.
    const adr = page.locator('.proposal').filter({ hasText: /ADR-0001/ });
    await adr.getByRole('button', { name: 'Принять' }).click();
    await expect(page.getByText(/Принят ADR-0001/)).toBeVisible();

    const plan = page.locator('.proposal').filter({ hasText: /Этап M01/ });
    await plan.getByRole('button', { name: /Создать 2 задачи/ }).click();
    await expect(page.getByText(/Создан этап M01/)).toBeVisible();

    // Everything is in .skaro/.
    const adrs = readdirSync(join(repo, '.skaro', 'adr'));
    expect(adrs).toHaveLength(1);
    expect(readFileSync(join(repo, '.skaro', 'adr', adrs[0]!), 'utf8')).toContain(
      'status: accepted',
    );
    expect(readdirSync(join(repo, '.skaro', 'milestones'))).toHaveLength(1);
    const tasks = readdirSync(join(repo, '.skaro', 'tasks')).map((f) =>
      readFileSync(join(repo, '.skaro', 'tasks', f), 'utf8'),
    );
    expect(tasks).toHaveLength(2);
    const mul = tasks.find((t) => /title: .*[Уу]множ/.test(t));
    expect(mul).toMatch(/depends_on:\s*\n?\s*-?\s*\[?T-00\d/);
    expect(tasks.every((t) => t.includes('milestone: M01'))).toBe(true);
    // The chat reads code only: no files outside .skaro/ appeared.
    expect(readdirSync(repo).sort()).toEqual(['.git', '.skaro', 'README.md']);

    // The decisions go to the agent with the next message; the feed shows the text as written.
    await send(page, 'Что уже есть в проекте? Ответь одной строкой.');
    await waitTurnEnd(page, 2);
    const last = page.locator('.fd-user').last();
    await expect(last).toContainText('Что уже есть в проекте?');
    await expect(last).not.toContainText('skaro-note');
    await app.close();
  });
}
