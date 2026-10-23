import { expect, test } from '@playwright/test';
import { cp, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { git } from '@skaro/core';
import { CompletionFixture } from '../src/main/completion-test-support';
import { AUTO_MERGE_KEY, type SkaroApi } from '../src/shared/ipc';
import { launchApp } from './launch';

declare const window: Window & { skaro: SkaroApi };
test.skip(
  !process.env['SKARO_E2E_NATIVE_INTEGRATION'] || !process.env['SKARO_AGENTS_DIR'],
  'Explicit native-agent check with authorized temporary Git inputs and the real Electron backend',
);

test('dirty_base card starts the native agent and publishes without losing local work', async ({
  playwright: _playwright,
}, testInfo) => {
  test.setTimeout(600_000);
  const f = await CompletionFixture.create();
  let app: Awaited<ReturnType<typeof launchApp>> | undefined;
  try {
    const taskCheck = { name: 'Task behavior', run: `"${process.execPath}" verify-task.mjs` };
    const config = (await f.context.load()).config;
    await f.context.store.writeConfig({
      ...config,
      defaultAgent: 'codex',
      permissionMode: 'full',
      checks: [taskCheck],
    });
    const task = await f.task('Сохранить локальные изменения при слиянии');
    await writeFile(
      join(f.repo, 'AGENTS.md'),
      'Work only in this checkout. This authorized temporary Git test has no services or dependencies. ' +
        'Preserve task=true and the CURRENT local input: staged=true for the staged input, working=true only for the later working input. ' +
        `Node is installed at ${process.execPath}. Use it for --check behavior.mjs, verify-task.mjs and verify-local.mjs. ` +
        'The local check passes only after the final local layer; resolve and call verify_integration again when requested. ' +
        'Do not install anything or access other projects. Stage your resolution and use verify_integration; do not commit.\n',
    );
    await writeFile(
      join(f.repo, 'behavior.mjs'),
      'export const behavior = { task: false, staged: false, working: false };\n',
    );
    await writeFile(
      join(f.repo, 'verify-task.mjs'),
      "import {strict as assert} from 'node:assert';import {behavior} from './behavior.mjs';assert.equal(behavior.task,true);\n",
    );
    await writeFile(
      join(f.repo, 'verify-local.mjs'),
      "import {strict as assert} from 'node:assert';import {behavior} from './behavior.mjs';assert.equal(behavior.staged,true);assert.equal(behavior.working,true);\n",
    );
    await f.commit();
    const source = await f.checkout(task);
    const taskCode = 'export const behavior = { task: true, staged: false, working: false };\n';
    await writeFile(join(source, 'behavior.mjs'), taskCode);
    await f.review(task.id);
    await f.coordinator.capture(
      f.projectId,
      task.id,
      task.branch!,
      source,
      ':sparkles: feat: enable task behavior',
      'Task behavior verified',
      [taskCheck],
    );
    await writeFile(
      join(f.repo, 'behavior.mjs'),
      'export const behavior = { task: false, staged: true, working: false };\n',
    );
    await git(f.repo, ['add', 'behavior.mjs']);
    await writeFile(
      join(f.repo, 'behavior.mjs'),
      'export const behavior = { task: false, staged: true, working: true };\n',
    );
    f.db.setSetting(AUTO_MERGE_KEY, false);
    f.db.setSetting('ui.locale', 'ru');
    f.db.setSetting('runs.slots', 1);
    f.db.setOpenTabs([f.projectId], f.projectId);
    await f.coordinator.close();
    f.projects.close();
    app = await launchApp(f.root);
    const page = await app.firstWindow();
    await app.evaluate(({ BrowserWindow }) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setSize(1412, 982);
    });
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.locator('.board .card').filter({ hasText: task.title }).click();
    const card = page.locator('.fd-merge-card');
    await expect(card).toContainText('Слияние затронет файлы с локальными изменениями');
    const resolve = card.getByRole('button', {
      name: 'Разрешить конфликты с агентом',
      exact: true,
    });
    await expect(resolve).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath('dirty-base-action.png') });
    await resolve.click();
    await expect(card).toHaveCount(0, { timeout: 30_000 });
    await expect
      .poll(
        async () => {
          const view = await page.evaluate(
            ({ project, task }) => window.skaro.invoke('task.open', project, task),
            { project: f.projectId, task: task.id },
          );
          return view.task.status;
        },
        { timeout: 420_000, intervals: [2000] },
      )
      .toBe('done');
    await page.screenshot({ path: testInfo.outputPath('dirty-base-completed.png') });
    expect((await git(f.repo, ['show', 'HEAD:behavior.mjs'])).stdout).toBe(taskCode);
    const index = (await git(f.repo, ['show', ':behavior.mjs'])).stdout;
    const working = await readFile(join(f.repo, 'behavior.mjs'), 'utf8');
    const parse = (code: string) =>
      JSON.parse(JSON.stringify(Function(code.replace('export const behavior =', 'return'))()));
    expect(parse(index)).toEqual({ task: true, staged: true, working: false });
    expect(parse(working)).toEqual({ task: true, staged: true, working: true });
    expect(errors).toEqual([]);
    console.log(
      `Native dirty_base verification: ${testInfo.outputPath('dirty-base-completed.png')}`,
    );
  } catch (error) {
    await app
      ?.firstWindow()
      .then((page) => page.screenshot({ path: testInfo.outputPath('dirty-base-failure.png') }))
      .catch(() => undefined);
    await cp(join(f.root, 'integrations'), testInfo.outputPath('integrations'), {
      recursive: true,
    }).catch(() => undefined);
    throw error;
  } finally {
    await app?.close();
    await f.close();
  }
});
