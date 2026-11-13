/* global window */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { auditPackageHistory, verifyPendingAudit } from './c4-audit-pending-ui.mjs';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

const { _electron, expect } = createRequire(import.meta.url)('@playwright/test');
const projectId = '78bc2cd3-981b-40ed-a395-c6c6bc7da51b';
const resumeFile = process.argv
  .find((arg) => arg.startsWith('--resume-stopped='))
  ?.slice('--resume-stopped='.length);
const resumed = resumeFile ? JSON.parse(await readFile(resumeFile, 'utf8')) : undefined;
const decisionFile = process.argv
  .find((arg) => arg.startsWith('--resume-decision='))
  ?.slice('--resume-decision='.length);
const decisionProof = decisionFile ? JSON.parse(await readFile(decisionFile, 'utf8')) : undefined;
if (decisionProof) assert.equal(decisionProof.projectId, projectId);
if (resumed) assert.equal(resumed.projectId, projectId);
const directory = join(process.env.APPDATA, 'Skaro', 'verification', `c43-ui-${randomUUID()}`);
await mkdir(directory, { recursive: true });
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
const proof = {
  directory,
  projectId,
  errors: [],
  stages: [],
  scope:
    'Real scoped Skaro, real Cat-pilot and native agent. No mock API, fixture, server or seeded project.',
};
let electron, page, owned;
const stage = (name, data = {}) => {
  proof.stages.push({ name, ...data });
  console.log(JSON.stringify({ name, ...data }));
};
const invoke = (name, ...args) =>
  page.evaluate(([method, values]) => window.skaro.invoke(method, ...values), [name, args]);
const launch = async () => {
  electron = await _electron.launch({ args: [resolve('apps/desktop')], env, timeout: 60000 });
  page = await electron.firstWindow();
  page.setDefaultTimeout(30000);
  page.on('pageerror', (error) => proof.errors.push(error.message));
  await page.waitForFunction(() => window.skaro?.invoke);
  assert.deepEqual(await invoke('tabs.get'), { projects: [projectId], active: projectId });
};
const closeOwned = async () => {
  if (!electron) return;
  const processHandle = electron.process();
  if (processHandle.exitCode !== null || processHandle.signalCode !== null) return;
  const pid = processHandle.pid;
  assert(Number.isSafeInteger(pid) && pid > 0);
  const closed = electron.waitForEvent('close', { timeout: 30000 });
  const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { encoding: 'utf8' });
  await closed;
  electron = undefined;
  stage('controlled-driver-process-exit', {
    pid,
    taskkillStatus: result.status,
    stderr: result.stderr?.slice(0, 500),
  });
};
const openC4 = async () => {
  await page.locator('button.home').click();
  await page.getByText('Cat-pilot', { exact: true }).last().click();
  await page.locator('.project-nav').getByRole('button', { name: 'C4', exact: true }).click();
  await expect(page.locator('[data-c4-audit]')).toBeVisible();
};
const dialog = () => page.getByRole('dialog', { name: 'Фоновая работа', exact: true });
const screenshot = (name) =>
  page.screenshot({ path: join(directory, name + '.png'), animations: 'disabled' });
const waitAudit = async (states, timeout = 60000) => {
  await expect
    .poll(async () => (await invoke('c4.audit', projectId))?.state, {
      timeout,
      intervals: [500, 1000, 2000],
    })
    .toMatch(new RegExp(`^(${states.join('|')})$`));
  return invoke('c4.audit', projectId);
};
const sourceState = async (root) => {
  const listed = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: root, encoding: 'utf8' },
  );
  assert.equal(listed.status, 0);
  const paths = [
    ...new Set([...listed.stdout.split('\0').filter(Boolean), '.skaro/c4/model.json']),
  ].sort();
  const files = [];
  for (const path of paths)
    files.push([
      path,
      createHash('sha256')
        .update(await readFile(join(root, path)))
        .digest('hex'),
    ]);
  const status = spawnSync('git', ['status', '--porcelain=v1'], { cwd: root, encoding: 'utf8' });
  assert.equal(status.status, 0);
  return { files, status: status.stdout };
};
try {
  if (decisionProof) proof.packageHistoryBefore = auditPackageHistory(projectId);
  await launch();
  const project = await invoke('projects.get', projectId);
  const root = project.path;
  proof.before = await sourceState(root);
  const beforeChats = await invoke('chats.list', projectId);
  const beforeAudit = await invoke('c4.audit', projectId);
  proof.initialAudit = beforeAudit;
  await openC4();
  await screenshot('c4-before-start');
  assert.deepEqual(await invoke('chats.list', projectId), beforeChats);
  assert.deepEqual(await invoke('c4.audit', projectId), beforeAudit);
  stage('opening-c4-only-reads-existing-state', { chats: beforeChats.length });
  let terminal;
  if (decisionProof) {
    assert.equal(beforeAudit?.id, decisionProof.result.id);
    assert.equal(beforeAudit.state, 'decision');
    owned = terminal = beforeAudit;
    proof.resumedFrom = decisionFile;
  } else {
    if (resumed) {
      assert.equal(beforeAudit?.id, resumed.firstAudit.id);
      assert.equal(beforeAudit.state, 'stopped');
      proof.firstAudit = beforeAudit;
      proof.resumedFrom = resumeFile;
      owned = beforeAudit;
    } else {
      await page.locator('[data-c4-audit]').click();
      await expect(dialog()).toBeVisible();
      if (beforeAudit) {
        assert(
          ['done', 'partial', 'error', 'stopped'].includes(beforeAudit.state),
          'Do not replace an existing unresolved audit',
        );
        await dialog()
          .getByRole('button', { name: /^(Запустить заново|Повторить)$/ })
          .click();
      }
      owned = await waitAudit(['preparing', 'running', 'resource', 'model', 'decision', 'error']);
      proof.firstAudit = owned;
      assert(owned.chatId || owned.state === 'error');
      if (owned.state === 'error') throw new Error(owned.error);
      await screenshot('audit-running');
      const stop = dialog().locator('[data-c4-audit-stop]');
      await expect(stop).toBeVisible();
      proof.stopButton = await stop.evaluate((button) => {
        const svg = button.querySelector('svg');
        return {
          height: button.getBoundingClientRect().height,
          fontSize: window.getComputedStyle(button).fontSize,
          iconWidth: svg.getBoundingClientRect().width,
          fill: window.getComputedStyle(svg).fill,
          strokeWidth: window.getComputedStyle(svg).strokeWidth,
        };
      });
      assert.equal(proof.stopButton.height, 24);
      assert.equal(proof.stopButton.iconWidth, 12);
      assert.notEqual(proof.stopButton.fill, 'none');
      assert.equal(proof.stopButton.strokeWidth, '0px');
      stage('compact-solid-stop-button', proof.stopButton);
      await dialog().getByRole('button', { name: 'Закрыть', exact: true }).last().click();
      await page
        .locator('.project-nav')
        .getByRole('button', { name: 'Документы', exact: true })
        .click();
      assert.equal((await invoke('c4.audit', projectId)).id, owned.id);
      await page.locator('.project-nav').getByRole('button', { name: 'C4', exact: true }).click();
      await page.locator('[data-c4-audit]').click();
      assert.equal((await invoke('c4.audit', projectId)).id, owned.id);
      assert.equal((await invoke('chats.list', projectId)).length, beforeChats.length + 1);
      stage('one-explicit-audit-survives-close-and-navigation', {
        id: owned.id,
        chatId: owned.chatId,
      });
      const current = await invoke('c4.audit', projectId);
      assert(
        ['preparing', 'running', 'resource', 'model', 'recovering'].includes(current.state),
        `Safe stop requires an active actual audit, got ${current.state}`,
      );
      await dialog().getByRole('button', { name: 'Остановить', exact: true }).click();
      owned = await waitAudit(['stopped']);
      await screenshot('audit-stopped');
      stage('safe-stop-confirmed', { id: owned.id });
      await closeOwned();
      await launch();
      await openC4();
    }
    assert.equal((await invoke('c4.audit', projectId)).state, 'stopped');
    assert.equal((await invoke('c4.audit', projectId)).id, owned.id);
    await page.locator('[data-c4-audit]').click();
    await screenshot('stopped-after-restart');
    stage('stopped-audit-does-not-resume-after-restart', { id: owned.id });
    await dialog().getByRole('button', { name: 'Запустить заново', exact: true }).click();
    owned = await waitAudit(['preparing', 'running', 'resource', 'model', 'decision', 'error']);
    assert.notEqual(owned.id, proof.firstAudit.id);
    proof.fullAudit = owned;
    terminal = await waitAudit(['done', 'partial', 'decision', 'error', 'conflict'], 900000);
  }
  proof.result = terminal;
  await screenshot('audit-result');
  if (terminal.state === 'error') throw new Error(terminal.error);
  if (terminal.state === 'decision') {
    proof.pending = await verifyPendingAudit({
      page,
      invoke,
      projectId,
      expected: terminal,
      directory,
      expect,
    });
    stage('real-decision-preserved-for-owner', { id: proof.pending.decisionId });
    await closeOwned();
    await launch();
    await openC4();
    const restored = await verifyPendingAudit({
      page,
      invoke,
      projectId,
      expected: terminal,
      directory,
      expect,
      suffix: '-restart',
    });
    assert.equal(restored.fingerprint, proof.pending.fingerprint);
    assert.equal(restored.revision, proof.pending.revision);
    stage('pending-package-survives-real-process-restart', {
      id: restored.decisionId,
      fingerprint: restored.fingerprint,
    });
  } else stage('real-full-audit-result', { state: terminal.state, result: terminal.result });
  proof.after = await sourceState(root);
  assert.deepEqual(proof.after, proof.before, 'Read-only audit cannot change Cat-pilot files');
  if (decisionProof) {
    proof.packageHistoryAfter = auditPackageHistory(projectId);
    assert.deepEqual(proof.packageHistoryAfter, proof.packageHistoryBefore);
    stage('all-original-package-bytes-states-and-protocols-preserved', {
      packages: proof.packageHistoryAfter.length,
      protocols: [...new Set(proof.packageHistoryAfter.map((row) => row.protocol))],
    });
  }
  assert.deepEqual(proof.errors, []);
  proof.passed = true;
} catch (error) {
  proof.error = error.stack ?? String(error);
  await screenshot('failure').catch(() => undefined);
  console.error(proof.error);
  process.exitCode = 1;
} finally {
  if (owned?.chatId) {
    const current = await invoke('c4.audit', projectId).catch(() => undefined);
    if (
      current?.id === owned.id &&
      ['preparing', 'running', 'resource', 'model'].includes(current.state)
    )
      await invoke('c4.auditStop', projectId, owned.id).catch((error) => {
        proof.cleanupError = String(error);
      });
  }
  await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(
    JSON.stringify({
      directory,
      passed: proof.passed,
      result: proof.result?.state,
      error: proof.error,
    }),
  );
  await closeOwned();
}
