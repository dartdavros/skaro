/* global window */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';
import { applicationState, fileTimes, sourceSnapshot } from './c4-audit-application-state.mjs';

const require = createRequire(import.meta.url);
const { _electron, expect } = require('@playwright/test');
const priorPath = process.argv.find((arg) => arg.startsWith('--accepted-proof='))?.slice(17);
assert(priorPath, 'Original real consent/crash proof is required');
const prior = JSON.parse(await readFile(priorPath, 'utf8'));
const projectId = '78bc2cd3-981b-40ed-a395-c6c6bc7da51b';
const packageId = 'skaro-c4-2fcaa711-d0aa-4225-852d-610f7afa681f';
assert.equal(prior.projectId, projectId);
assert.equal(prior.packageId, packageId);
const manifest = JSON.parse(
  await readFile(
    join(
      process.env.APPDATA,
      'Skaro/verification/c43-package-review-2fcaa711-d0aa-4225-852d-610f7afa681f/manifest.json',
    ),
    'utf8',
  ),
);
const directory = join(
  process.env.APPDATA,
  'Skaro/verification',
  `c43-accepted-recovery-${randomUUID()}`,
);
await mkdir(directory, { recursive: true });
const proof = {
  directory,
  priorPath,
  projectId,
  packageId,
  backups: prior.backups,
  stages: [],
  errors: [],
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
delete env.SKARO_VERIFY_C4_ACCEPTED_CRASH;
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
let electron, page, handle;
const invoke = (name, ...args) =>
  page.evaluate(([method, values]) => window.skaro.invoke(method, ...values), [name, args]);
const launch = async () => {
  electron = await _electron.launch({ args: [resolve('apps/desktop')], env, timeout: 60000 });
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
const owned = (state) => state.packages.find((row) => row.id === packageId);
try {
  proof.before = applicationState(projectId, packageId);
  assert.equal(proof.before.project.name, 'Cat-pilot');
  assert.equal(owned(proof.before).state, 'accepted');
  assert.equal(owned(proof.before).payloadHash, manifest.immutablePayloadHash);
  assert.deepEqual(proof.before.link, prior.afterCrash.link);
  assert.deepEqual(proof.before.receipt, prior.afterCrash.receipt);
  const root = proof.before.project.path;
  proof.sourceBefore = await sourceSnapshot(root, manifest);
  const expected = { ...prior.sourceBefore };
  for (const file of manifest.files) expected[`.skaro/${file.path}`] = file.afterHash;
  const history = `.skaro/c4/history/${manifest.revision}.json`;
  assert(proof.sourceBefore[history]);
  expected[history] = proof.sourceBefore[history];
  assert.deepEqual(
    proof.sourceBefore,
    expected,
    'Only the exact approved package and its journal were written',
  );
  const paths = [...manifest.files.map((file) => `.skaro/${file.path}`), history];
  proof.timesBefore = await fileTimes(root, paths);
  await save();
  // Recover the SAME genuine accepted operation, with the repaired exit checkpoint.
  const child = spawn(require('electron'), [resolve('apps/desktop')], {
    env: { ...env, SKARO_VERIFY_C4_ACCEPTED_CRASH: packageId },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let output = '';
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (chunk) => {
      output = (output + chunk.toString()).slice(-12000);
    });
  proof.checkpointExit = await new Promise((resolveExit, reject) => {
    const timer = setTimeout(
      () => reject(new Error('Real accepted checkpoint did not exit')),
      60000,
    );
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      resolveExit({ code, signal });
    });
  });
  proof.checkpointOutput = output;
  assert.equal(proof.checkpointExit.code, 87);
  proof.afterCheckpoint = applicationState(projectId, packageId);
  assert.equal(owned(proof.afterCheckpoint).state, 'accepted');
  assert.deepEqual(proof.afterCheckpoint.receipt, proof.before.receipt);
  assert.deepEqual(await sourceSnapshot(root, manifest), proof.sourceBefore);
  assert.deepEqual(await fileTimes(root, paths), proof.timesBefore);
  await stage('same-real-accepted-operation-exits-before-writer-dispatch-without-rewriting-files');
  await launch();
  const audit = await invoke('c4.audit', projectId);
  assert.equal(audit.id, proof.before.audit.id);
  assert.equal(audit.state, 'done');
  assert.equal(audit.result, 'applied');
  proof.afterRecovery = applicationState(projectId, packageId);
  assert.equal(owned(proof.afterRecovery).state, 'applied');
  assert.equal(owned(proof.afterRecovery).payloadHash, manifest.immutablePayloadHash);
  assert.deepEqual(proof.afterRecovery.link, proof.before.link);
  assert.deepEqual(proof.afterRecovery.receipt, { ...proof.before.receipt, state: 'done' });
  assert.equal(
    proof.afterRecovery.operations.filter(
      (row) => row.value.action === 'ipc.c4.decide' && row.state === 'succeeded',
    ).length,
    1,
  );
  assert.equal(
    proof.afterRecovery.events.filter((row) => row.kind === 'c4_application_verified').length,
    1,
  );
  assert.deepEqual(proof.afterRecovery.chatIds, proof.before.chatIds);
  assert.deepEqual(proof.afterRecovery.runIds, proof.before.runIds);
  for (const row of proof.before.packages.filter((row) => row.id !== packageId))
    assert.deepEqual(
      proof.afterRecovery.packages.find((next) => next.id === row.id),
      row,
    );
  assert.deepEqual(await sourceSnapshot(root, manifest), proof.sourceBefore);
  assert.deepEqual(await fileTimes(root, paths), proof.timesBefore);
  const decisions = await invoke('decisions.list', projectId);
  assert(!decisions.some((row) => row.origin.id === audit.chatId));
  proof.remainingDecisions = decisions.map((row) => ({ id: row.id, revision: row.revision }));
  assert.equal(decisions.length, 2, 'Keep the two unrelated historical task questions');
  await page.locator('[data-c4-audit]').click();
  const row = page
    .getByRole('dialog', { name: 'Фоновая работа', exact: true })
    .locator(`[data-c4-audit-row="${audit.id}"]`);
  await expect(row).toContainText('Согласованный пакет применён.');
  await expect(row.getByRole('button', { name: 'Открыть решение', exact: true })).toHaveCount(0);
  await page.screenshot({ path: join(directory, 'recovered-applied.png'), animations: 'disabled' });
  await stage('original-receipt-and-ipc-operation-closed-once-with-no-second-owner-question');
  await closeOwned();
  await launch();
  assert.deepEqual(await sourceSnapshot(root, manifest), proof.sourceBefore);
  assert.deepEqual(await fileTimes(root, paths), proof.timesBefore);
  assert.deepEqual(applicationState(projectId, packageId), proof.afterRecovery);
  assert.deepEqual(
    (await invoke('decisions.list', projectId)).map((row) => ({
      id: row.id,
      revision: row.revision,
    })),
    proof.remainingDecisions,
  );
  assert.deepEqual(proof.errors, []);
  await stage('second-restart-preserves-files-mtimes-history-receipt-and-remaining-questions');
  proof.passed = true;
} catch (error) {
  proof.error = error.stack ?? String(error);
  process.exitCode = 1;
  console.error(proof.error);
  await page
    ?.screenshot({ path: join(directory, 'failure.png'), animations: 'disabled' })
    .catch(() => undefined);
} finally {
  await save();
  await closeOwned();
  console.log(JSON.stringify({ directory, passed: proof.passed, error: proof.error }));
}
