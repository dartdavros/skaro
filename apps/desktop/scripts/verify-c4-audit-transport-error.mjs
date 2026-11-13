/* global window */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createConnection } from 'node:net';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';
import { processBirth, stopOwnedProcess } from '@skaro/agent-runtime/process-identity';
import {
  applicationState,
  nativeAuditProcesses,
  sourceSnapshot,
} from './c4-audit-application-state.mjs';

const { _electron, expect } = createRequire(import.meta.url)('@playwright/test');
const projectId = '78bc2cd3-981b-40ed-a395-c6c6bc7da51b';
const packageId = 'skaro-c4-2fcaa711-d0aa-4225-852d-610f7afa681f';
const terminateNative = process.argv.includes('--terminate-native');
const directory = join(process.env.APPDATA, 'Skaro/verification', `c43-transport-${randomUUID()}`);
await mkdir(directory, { recursive: true });
const manifest = JSON.parse(
  await readFile(
    join(
      process.env.APPDATA,
      'Skaro/verification/c43-package-review-2fcaa711-d0aa-4225-852d-610f7afa681f/manifest.json',
    ),
    'utf8',
  ),
);
const proof = {
  directory,
  projectId,
  packageId,
  stages: [],
  errors: [],
  scope: terminateNative
    ? 'Actual configured native client, account and model, normal connection. Only its recorded PID/birth is terminated. No fake event, server, fixture or preference change.'
    : 'Actual configured native client, account and model. Only this child process has an unavailable proxy. No server, fake API, fixture or preference change.',
};
const save = () => writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
const stage = async (name) => {
  proof.stages.push(name);
  await save();
  console.log(name);
};
const env = {
  ...cleanCommandEnvironment(),
  SKARO_VERIFICATION_PROJECT: projectId,
  SKARO_VERIFICATION_SILENT: '1',
};
for (const key of [
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
  if (process.env[key]) env[key] = process.env[key];
delete env.SKARO_VERIFY_C4_ACCEPTED_CRASH;
let electron, page, handle, owned;
const invoke = (name, ...args) =>
  page.evaluate(([method, values]) => window.skaro.invoke(method, ...values), [name, args]);
const launch = async (unavailable = false) => {
  const proxy = unavailable
    ? {
        HTTP_PROXY: 'http://127.0.0.1:1',
        HTTPS_PROXY: 'http://127.0.0.1:1',
        ALL_PROXY: 'http://127.0.0.1:1',
        NO_PROXY: '',
      }
    : {};
  electron = await _electron.launch({
    args: [resolve('apps/desktop')],
    env: { ...env, ...proxy },
    timeout: 60000,
  });
  handle = electron.process();
  page = await electron.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => proof.errors.push(error.message));
  await page.waitForFunction(() => window.skaro?.invoke);
  assert.deepEqual(await invoke('tabs.get'), { projects: [projectId], active: projectId });
  await page.locator('button.home').click();
  await page.getByText('Cat-pilot', { exact: true }).last().click();
  await page.locator('.project-nav').getByRole('button', { name: 'C4', exact: true }).click();
};
const closeOwned = async () => {
  if (!electron || handle.exitCode !== null || handle.signalCode !== null) return;
  const closed = electron.waitForEvent('close', { timeout: 30000 });
  assert(Number.isSafeInteger(handle.pid) && handle.pid > 0);
  spawnSync('taskkill', ['/PID', String(handle.pid), '/T', '/F'], { encoding: 'utf8' });
  await closed;
  electron = undefined;
};
try {
  if (!terminateNative)
    await new Promise((done, fail) => {
      const socket = createConnection({ host: '127.0.0.1', port: 1 });
      socket.setTimeout(2000, () => {
        socket.destroy();
        fail(new Error('Proxy state unknown'));
      });
      socket.once('connect', () => {
        socket.destroy();
        fail(new Error('Refuse occupied proxy port'));
      });
      socket.once('error', (error) => (error.code === 'ECONNREFUSED' ? done() : fail(error)));
    });
  proof.before = applicationState(projectId, packageId);
  if (proof.before.audit.state === 'done') assert.equal(proof.before.audit.result, 'applied');
  else {
    assert.equal(proof.before.audit.state, 'stopped');
    assert(process.argv.includes(`--previous-audit=${proof.before.audit.id}`));
  }
  assert.equal(proof.before.packages.find((row) => row.id === packageId)?.state, 'applied');
  const root = proof.before.project.path;
  proof.sourceBefore = await sourceSnapshot(root, manifest);
  await save();
  await launch(!terminateNative);
  const before = await invoke('c4.audit', projectId);
  const decisions = await invoke('decisions.list', projectId);
  await page.locator('[data-c4-audit]').click();
  const dialog = page.getByRole('dialog', { name: 'Фоновая работа', exact: true });
  await dialog
    .locator(`[data-c4-audit-row="${before.id}"]`)
    .getByRole('button', { name: 'Запустить заново', exact: true })
    .click();
  owned = await invoke('c4.audit', projectId);
  assert.notEqual(owned.id, before.id);
  if (terminateNative) {
    await expect
      .poll(() => nativeAuditProcesses(projectId, owned.id), { timeout: 60000 })
      .toBeTruthy();
    proof.nativeFault = nativeAuditProcesses(projectId, owned.id);
    assert.equal((await invoke('c4.audit', projectId)).state, 'running');
    for (const process of proof.nativeFault.processes)
      assert.equal(await processBirth(process.pid), process.birth);
    await save();
    for (const process of proof.nativeFault.processes) await stopOwnedProcess(process);
    proof.nativeFault.exitConfirmed = true;
    await stage('controlled-exit-of-only-this-audits-real-native-client-by-recorded-pid-and-birth');
  }
  await expect
    .poll(async () => (await invoke('c4.audit', projectId)).state, {
      timeout: 180000,
      intervals: [500, 1000, 2000],
    })
    .toMatch(/^(error|decision|done|partial)$/);
  proof.result = await invoke('c4.audit', projectId);
  assert.equal(proof.result.id, owned.id);
  assert.equal(proof.result.state, 'error');
  assert(proof.result.error);
  const row = dialog.locator(`[data-c4-audit-row="${owned.id}"]`);
  await expect(row).toContainText('Не удалось завершить аудит');
  await expect(row.locator('[role="alert"]')).toBeVisible();
  await expect(row.getByRole('button', { name: 'Повторить', exact: true })).toBeVisible();
  await page.screenshot({ path: join(directory, 'real-native-error.png'), animations: 'disabled' });
  proof.afterFailure = applicationState(projectId, packageId);
  assert.deepEqual(proof.afterFailure.packages, proof.before.packages);
  assert.deepEqual(proof.afterFailure.runIds, proof.before.runIds);
  assert.equal(proof.afterFailure.chatIds.length, proof.before.chatIds.length + 1);
  assert.deepEqual(await invoke('decisions.list', projectId), decisions);
  assert.deepEqual(await sourceSnapshot(root, manifest), proof.sourceBefore);
  await stage(
    'actual-native-transport-failure-shows-approved-error-and-retry-without-any-package-or-source-write',
  );
  await closeOwned();
  await launch();
  assert.deepEqual(await invoke('c4.audit', projectId), proof.result);
  assert.deepEqual(applicationState(projectId, packageId), proof.afterFailure);
  await page.locator('[data-c4-audit]').click();
  await page.screenshot({
    path: join(directory, 'error-after-normal-restart.png'),
    animations: 'disabled',
  });
  assert.deepEqual(await sourceSnapshot(root, manifest), proof.sourceBefore);
  assert.deepEqual(proof.errors, []);
  await stage('normal-restart-keeps-same-error-and-history-without-automatic-model-retry');
  proof.passed = true;
} catch (error) {
  proof.error = error.stack ?? String(error);
  process.exitCode = 1;
  console.error(proof.error);
  await page
    ?.screenshot({ path: join(directory, 'failure.png'), animations: 'disabled' })
    .catch(() => undefined);
} finally {
  if (electron && owned) {
    const current = await invoke('c4.audit', projectId).catch(() => undefined);
    if (
      current?.id === owned.id &&
      ['preparing', 'running', 'resource', 'model'].includes(current.state)
    )
      await invoke('c4.auditStop', projectId, owned.id).catch((error) => {
        proof.cleanupError = String(error);
      });
  }
  await save();
  await closeOwned();
  console.log(JSON.stringify({ directory, passed: proof.passed, error: proof.error }));
}
