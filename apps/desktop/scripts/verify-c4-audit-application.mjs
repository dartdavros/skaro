/* global window */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, open, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';
import {
  applicationState,
  backupDatabases,
  fileTimes,
  sourceSnapshot,
} from './c4-audit-application-state.mjs';

const { _electron, expect } = createRequire(import.meta.url)('@playwright/test');
const projectId = '78bc2cd3-981b-40ed-a395-c6c6bc7da51b';
const packageId = 'skaro-c4-2fcaa711-d0aa-4225-852d-610f7afa681f';
assert(
  process.argv.includes(`--approved-package=${packageId}`),
  'Explicit reviewed package required',
);
const reviewDir = join(
  process.env.APPDATA,
  'Skaro/verification/c43-package-review-2fcaa711-d0aa-4225-852d-610f7afa681f',
);
const manifest = JSON.parse(await readFile(join(reviewDir, 'manifest.json'), 'utf8'));
assert.equal(manifest.projectId, projectId);
assert.equal(manifest.packageId, packageId);
const directory = join(
  process.env.APPDATA,
  'Skaro/verification',
  `c43-application-${randomUUID()}`,
);
await mkdir(directory, { recursive: true });
const proof = { directory, projectId, packageId, stages: [], errors: [] };
const save = async () => {
  const handle = await open(join(directory, 'proof.json'), 'w');
  try {
    await handle.writeFile(JSON.stringify(proof, null, 2));
    await handle.sync();
  } finally {
    await handle.close();
  }
};
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
let electron, page, processHandle;
const invoke = (name, ...args) =>
  page.evaluate(([method, values]) => window.skaro.invoke(method, ...values), [name, args]);
const launch = async (crash = false) => {
  electron = await _electron.launch({
    args: [resolve('apps/desktop')],
    env: { ...env, ...(crash ? { SKARO_VERIFY_C4_ACCEPTED_CRASH: packageId } : {}) },
    timeout: 60000,
  });
  processHandle = electron.process();
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
  if (!electron || processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  const closed = electron.waitForEvent('close', { timeout: 30000 });
  assert(Number.isSafeInteger(processHandle.pid) && processHandle.pid > 0);
  spawnSync('taskkill', ['/PID', String(processHandle.pid), '/T', '/F'], { encoding: 'utf8' });
  await closed;
  electron = undefined;
};
const currentPackage = (state) => state.packages.find((row) => row.id === packageId);
try {
  proof.before = applicationState(projectId, packageId);
  assert.equal(proof.before.project.name, 'Cat-pilot');
  assert.equal(currentPackage(proof.before)?.state, 'pending');
  assert.equal(currentPackage(proof.before).payloadHash, manifest.immutablePayloadHash);
  assert.equal(proof.before.link, undefined);
  const root = proof.before.project.path;
  proof.sourceBefore = await sourceSnapshot(root, manifest);
  for (const file of manifest.files)
    assert.equal(proof.sourceBefore[`.skaro/${file.path}`], file.beforeHash);
  proof.backups = await backupDatabases(directory);
  await stage('both-durable-sqlite-copies-verified-before-consent');
  await launch(true);
  const chats = await invoke('chats.list', projectId);
  const audit = await invoke('c4.audit', projectId);
  assert.equal(audit.id, proof.before.audit.id);
  assert.equal(audit.state, 'decision');
  const entries = await invoke('decisions.list', projectId);
  const entry = entries.find((row) => row.item?.id === packageId);
  assert(entry && entry.origin.id === audit.chatId);
  const review = await invoke('c4.review', projectId, packageId);
  assert.equal(
    review.fingerprint,
    'fb0eb2d3f79756630c07463047d1667a08327a1fa25e348fac67482454c99fff',
  );
  proof.decision = { id: entry.id, revision: entry.revision, fingerprint: review.fingerprint };
  const otherDecisions = entries.filter((row) => row.id !== entry.id);
  await page.locator('[data-decision-button]').click();
  const queue = page.getByRole('dialog', { name: 'Требуют ответа', exact: true });
  const card = queue.locator(`[data-project-decision="${entry.id}"]`);
  await card.scrollIntoViewIfNeeded();
  await page.screenshot({ path: join(directory, 'before-consent.png'), animations: 'disabled' });
  await save();
  const closed = electron.waitForEvent('close', { timeout: 60000 });
  proof.clickResult = await card
    .getByRole('button', { name: 'Применить', exact: true })
    .click()
    .then(() => 'dispatched', String);
  await closed;
  assert.equal(processHandle.exitCode, 87);
  electron = undefined;
  proof.afterCrash = applicationState(projectId, packageId);
  assert.equal(currentPackage(proof.afterCrash).state, 'accepted');
  assert.equal(currentPackage(proof.afterCrash).payloadHash, manifest.immutablePayloadHash);
  assert.equal(proof.afterCrash.receipt.state, 'dispatching');
  assert.equal(proof.afterCrash.link.revision, entry.revision);
  assert.equal(
    proof.afterCrash.operations.filter(
      (row) => row.value.action === 'ipc.c4.decide' && row.state === 'dispatching',
    ).length,
    1,
  );
  assert(proof.afterCrash.events.some((row) => row.kind === 'c4_accepted_crash_checkpoint'));
  assert.deepEqual(await sourceSnapshot(root, manifest), proof.sourceBefore);
  await stage('real-exit-87-after-durable-accepted-before-any-physical-write');
  await launch();
  await expect
    .poll(async () => (await invoke('c4.audit', projectId)).state, { timeout: 60000 })
    .toBe('done');
  const restored = await invoke('c4.audit', projectId);
  assert.equal(restored.id, audit.id);
  assert.equal(restored.result, 'applied');
  proof.afterRecovery = applicationState(projectId, packageId);
  assert.equal(currentPackage(proof.afterRecovery).state, 'applied');
  assert.equal(currentPackage(proof.afterRecovery).payloadHash, manifest.immutablePayloadHash);
  assert.deepEqual(proof.afterRecovery.link, proof.afterCrash.link);
  assert.deepEqual(proof.afterRecovery.receipt, { ...proof.afterCrash.receipt, state: 'done' });
  assert.equal(
    proof.afterRecovery.operations.filter(
      (row) => row.value.action === 'ipc.c4.decide' && row.state === 'succeeded',
    ).length,
    1,
  );
  assert.deepEqual(await invoke('decisions.list', projectId), otherDecisions);
  assert.deepEqual(await invoke('chats.list', projectId), chats);
  proof.sourceAfter = await sourceSnapshot(root, manifest);
  const expectedSource = { ...proof.sourceBefore };
  for (const file of manifest.files) expectedSource[`.skaro/${file.path}`] = file.afterHash;
  expectedSource[`.skaro/c4/history/${manifest.revision}.json`] =
    proof.sourceAfter[`.skaro/c4/history/${manifest.revision}.json`];
  assert(expectedSource[`.skaro/c4/history/${manifest.revision}.json`]);
  assert.deepEqual(proof.sourceAfter, expectedSource);
  for (const row of proof.before.packages.filter((row) => row.id !== packageId))
    assert.deepEqual(
      proof.afterRecovery.packages.find((next) => next.id === row.id),
      row,
    );
  const physical = [
    ...manifest.files.map((file) => `.skaro/${file.path}`),
    `.skaro/c4/history/${manifest.revision}.json`,
  ];
  proof.fileTimes = await fileTimes(root, physical);
  await page.locator('[data-c4-audit]').click();
  await page.screenshot({ path: join(directory, 'recovered-applied.png'), animations: 'disabled' });
  await stage('same-owner-receipt-and-operation-completed-five-exact-files-applied');
  await closeOwned();
  await launch();
  assert.deepEqual(await sourceSnapshot(root, manifest), proof.sourceAfter);
  assert.deepEqual(await fileTimes(root, physical), proof.fileTimes);
  const repeated = applicationState(projectId, packageId);
  assert.deepEqual(repeated, proof.afterRecovery);
  assert.deepEqual(await invoke('decisions.list', projectId), otherDecisions);
  assert.deepEqual(await invoke('chats.list', projectId), chats);
  await stage('second-restart-no-rewrite-no-new-chat-no-duplicate-consent');
  assert.deepEqual(proof.errors, []);
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
