import { expect, test } from '@playwright/test';
import { AppDb, git } from '@skaro/core';
import { copyFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CompletionFixture } from '../src/main/completion-test-support';
import { IntegrationPending, type IntegrationOperation } from '../src/main/integration-model';
import type { SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
test.skip(
  process.env['SKARO_E2E_NATIVE_INTEGRATION'] !== '1' || !process.env['SKARO_AGENTS_DIR'],
  'Opt-in: uses the real configured native agent on owner-authorized Git/SQLite fixtures',
);

test('the native resolver verifies both accepted behaviors and publishes automatically', async ({
  playwright: _playwright,
}, testInfo) => {
  test.setTimeout(600_000);
  const f = await CompletionFixture.create();
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    const config = (await f.context.load()).config;
    await f.context.store.writeConfig({
      ...config,
      defaultAgent: 'codex',
      permissionMode: 'full',
      checks: [{ name: 'JavaScript syntax', run: 'node --check calculate.mjs' }],
    });
    const stage = await f.context.store.createMilestone({
      title: 'Native integration verification',
    });
    const first = await f.task('Preserve addition', stage.id);
    const second = await f.task('Preserve multiplication', stage.id);
    await f.context.store.updateTask(first.id, {
      body: '## Цель\n\ncalculate("add", a, b) returns a + b.\n\n## Критерии приёмки\n\n- [x] Addition is available through calculate and verify-add.mjs passes.\n',
    });
    await f.context.store.updateTask(second.id, {
      body: '## Цель\n\ncalculate("multiply", a, b) returns a * b. Preserve addition when integrating.\n\n## Критерии приёмки\n\n- [x] Multiplication is available through calculate and verify-multiply.mjs passes.\n',
    });
    await writeFile(
      join(f.repo, 'AGENTS.md'),
      'Only edit files in this candidate. Preserve both arithmetic operations. Do not install dependencies, use network tools or touch other projects. This JavaScript project has no services or build pipeline; node --check and the two existing verification commands are sufficient.\n',
    );
    await writeFile(
      join(f.repo, 'calculate.mjs'),
      "export function calculate(action,a,b){throw new Error('unsupported action');}\n",
    );
    for (const [name, action, expected] of [
      ['add', 'add', 7],
      ['multiply', 'multiply', 12],
    ])
      await writeFile(
        join(f.repo, `verify-${name}.mjs`),
        `import { strict as assert } from 'node:assert';import { calculate } from './calculate.mjs';assert.equal(calculate('${action}',3,4),${expected});\n`,
      );
    await f.commit();
    const sources = [await f.checkout(first), await f.checkout(second)];
    for (const [index, task] of [first, second].entries()) {
      const action = index === 0 ? 'add' : 'multiply';
      await writeFile(
        join(sources[index]!, 'calculate.mjs'),
        `export function calculate(action,a,b){if(action==='${action}')return a${index === 0 ? '+' : '*'}b;throw new Error('unsupported action');}\n`,
      );
      await f.coordinator.capture(
        f.projectId,
        task.id,
        task.branch!,
        sources[index]!,
        `:sparkles: feat: ${action}`,
        undefined,
        [{ name: action, run: `node verify-${action}.mjs` }],
      );
    }
    const heads = await Promise.all(sources.map((source) => f.context.git.head('HEAD', source)));
    await expect(f.coordinator.merge(f.projectId, stage.id)).rejects.toBeInstanceOf(
      IntegrationPending,
    );
    f.db.setOpenTabs([f.projectId], f.projectId);
    f.db.setSetting('ui.locale', 'ru');
    f.db.setSetting('ui.navCollapsed', false);
    await f.coordinator.close();
    f.projects.close();
    f.db.close();
    await copyFile(join(f.root, 'app.sqlite'), join(f.root, 'skaro.db'));
    f.db = AppDb.open(join(f.root, 'app.sqlite'));
    app = await launchApp(f.root);
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setSize(1412, 982);
      window.showInactive();
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.waitForFunction(() => !!window.skaro);
    await page.locator('.board .card').filter({ hasText: first.title }).click();
    await expect
      .poll(
        async () => {
          const tasks = await page.evaluate(
            (id) => window.skaro.invoke('tasks.list', id),
            f.projectId,
          );
          return tasks.every((task) => task.status === 'done');
        },
        { timeout: 540_000, intervals: [1000, 2000, 3000] },
      )
      .toBe(true);
    const operations = (await page.evaluate(
      (id) => window.skaro.invoke('app.getSetting', `integration.${id}.operations`),
      f.projectId,
    )) as IntegrationOperation[];
    const operation = operations[0]!;
    expect(operation.state).toBe('applied');
    expect(operation.nativeSessionId).toBeTruthy();
    expect(operation.verification?.head).toBe(operation.head);
    expect(
      operation.checkRuns?.filter((check) => check.state === 'passed').length,
    ).toBeGreaterThanOrEqual(3);
    expect(
      await Promise.all(
        sources.map(async (source) => (await git(source, ['rev-parse', 'HEAD'])).stdout.trim()),
      ),
    ).toEqual(heads);
    await expect(page.locator('.fd-feed')).toContainText('Интеграция проверена');
    await expect(page.locator('.fd-feed')).not.toContainText('Continue the saved integration.');
    await page.screenshot({ path: testInfo.outputPath('native-integration-completed.png') });
    expect(errors).toEqual([]);
  } finally {
    await app?.close();
    await f.close();
  }
});
