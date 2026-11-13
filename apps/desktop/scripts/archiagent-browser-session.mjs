/* global window */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join, relative, resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

export const { _electron, expect } = createRequire(import.meta.url)('@playwright/test');
export const project = '78bc2cd3-981b-40ed-a395-c6c6bc7da51b';
export function browserSession(directory, proof, proofName = 'browser-shared-proof.json') {
  assert(
    /^archiagent-ag1-[\da-f-]+$/.test(
      relative(resolve(process.env.APPDATA, 'Skaro/verification'), directory),
    ),
  );
  const env = {
    ...cleanCommandEnvironment(),
    SKARO_VERIFICATION_PROJECT: project,
    SKARO_VERIFICATION_SILENT: '1',
    SKARO_TRACE: '1',
    // Existing owner-approved VPN route; no direct catalog fallback.
    SKARO_VERIFY_PROXY: 'http://127.0.0.1:10809',
  };
  for (const name of [
    'HOME',
    'USERPROFILE',
    'APPDATA',
    'LOCALAPPDATA',
    'ProgramData',
    'ProgramFiles',
    'ProgramFiles(x86)',
    'ProgramW6432',
    'ALLUSERSPROFILE',
    'HOMEDRIVE',
    'HOMEPATH',
  ])
    if (process.env[name]) env[name] = process.env[name];
  let electron, page;
  const invoke = (method, ...args) =>
    page.evaluate(([m, a]) => window.skaro.invoke(m, ...a), [method, args]);
  return {
    get page() {
      return page;
    },
    invoke,
    async launch() {
      electron = await _electron.launch({ args: [resolve('apps/desktop')], env, timeout: 60000 });
      const child = electron.process();
      for (const [stream, source] of [
        ['stdout', child.stdout],
        ['stderr', child.stderr],
      ])
        source?.on('data', (chunk) => {
          (proof.processLog ??= []).push({ stream, text: String(chunk) });
          process.stderr.write(chunk);
        });
      page = await electron.firstWindow();
      page.setDefaultTimeout(30000);
      page.on('pageerror', (error) => proof.errors.push(error.message));
      await page.waitForFunction(() => window.skaro?.invoke);
      assert.deepEqual(await invoke('tabs.get'), { projects: [project], active: project });
    },
    async openProject() {
      await page.locator('button.home').click();
      await page.getByText('Cat-pilot', { exact: true }).last().click();
    },
    async screenshot(name) {
      await page.screenshot({ path: join(directory, name + '.png'), animations: 'disabled' });
    },
    async crash() {
      const owned = electron.process(),
        pid = owned.pid;
      assert(pid > 0 && owned.exitCode === null && owned.signalCode === null);
      const closed = electron.waitForEvent('close', { timeout: 30000 });
      const exited = new Promise((resolve) => owned.once('exit', resolve));
      const killed = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
      });
      await closed;
      await exited;
      proof.crashProcess = {
        pid,
        taskkillStatus: killed.status,
        output: String(killed.stdout),
        error: String(killed.stderr),
        exitCode: owned.exitCode,
        signal: owned.signalCode,
      };
      assert(
        owned.exitCode !== null || owned.signalCode !== null,
        'Owned process must actually exit',
      );
      electron = undefined;
      return pid;
    },
    async close() {
      if (!electron) return;
      const assertionsPassed = proof.passed === true && !proof.cleanupError;
      proof.passed = false;
      proof.assertionsPassed = assertionsPassed;
      await writeFile(join(directory, proofName), JSON.stringify(proof, null, 2));
      try {
        await electron.close();
        proof.normalExit = true;
        proof.passed = assertionsPassed;
      } catch (error) {
        proof.closeError = String(error);
        throw error;
      } finally {
        await writeFile(join(directory, proofName), JSON.stringify(proof, null, 2));
      }
    },
  };
}
