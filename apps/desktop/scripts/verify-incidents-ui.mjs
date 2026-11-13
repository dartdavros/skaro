/* global window, innerHeight */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { cleanCommandEnvironment } from '@skaro/agent-runtime/environment';

const require = createRequire(import.meta.url);
const { _electron } = require('@playwright/test');
const projectId = '78bc2cd3-981b-40ed-a395-c6c6bc7da51b',
  taskId = 'T-010';
const directory = join(
  process.env.APPDATA,
  'Skaro',
  'verification',
  `incidents-ui-${randomUUID()}`,
);
await mkdir(directory, { recursive: true });
const env = { ...cleanCommandEnvironment(), SKARO_VERIFICATION_PROJECT: projectId };
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
const electron = await _electron.launch({ args: [resolve('apps/desktop')], env, timeout: 60000 });
const page = await electron.firstWindow();
page.setDefaultTimeout(30000);
const proof = { projectId, directory, errors: [] };
page.on('pageerror', (error) => proof.errors.push(error.message));
const invoke = (method, ...args) =>
  page.evaluate(([m, a]) => window.skaro.invoke(m, ...a), [method, args]);
let policy;
try {
  await page.waitForFunction(() => window.skaro?.invoke);
  policy = await invoke('incidents.policy', projectId);
  const records = await invoke('incidents.list', projectId);
  const prior = records.find((r) => r.protocol?.condition === 'environment-ready');
  assert(prior, 'Use the previously observed real audit environment');
  await invoke(
    'incidents.setPolicy',
    projectId,
    { ...policy, mode: 'confirm', expiresAt: Date.now() + 3600000, rules: [], denied: [] },
    policy.revision,
  );
  await page.locator('button.home').click();
  await page.getByText('Cat-pilot', { exact: true }).last().click();
  await page
    .getByText('Аудит штатного окружения Cat-pilot и допуска ресурсов RC-2', { exact: true })
    .first()
    .click();
  const commandId = randomUUID();
  const prompt = `Продолжай только проверку AC-3: сначала вызови resume_task для этого указания. Проверь штатный сервис задачи, который сейчас остановлен. Сообщи этот реальный блокер через report_task_blocker: cause environment, code service_unavailable, resource_id ${prior.subject.id}, condition environment-ready. Сам сервис не запускай: запуск требует отдельного решения владельца. Закончи ход после отчёта. Не меняй файлы, критерии, настройки, не делай коммиты и submit_result. После ответа владельца deny оставайся на паузе. command_id: ${commandId}`;
  await invoke('task.send', projectId, taskId, { text: prompt, commandId });
  console.log(JSON.stringify({ stage: 'worker-report-and-pinned-approval', directory }));
  const deadline = Date.now() + 240000;
  let pending;
  while (Date.now() < deadline) {
    const rows = await invoke('incidents.list', projectId);
    pending = rows.find(
      (r) =>
        r.state === 'open' &&
        r.protocol?.condition === 'environment-ready' &&
        r.protocol?.decisionId,
    );
    if (pending) break;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert(pending, 'The real worker must report the actual unavailable service');
  const title = page.getByText('start_environment', { exact: true }).last();
  await title.waitFor({ state: 'visible' });
  await page.screenshot({ path: join(directory, 'pending.png') });
  const geometry = await title.evaluate((node) => {
    const rect = node.getBoundingClientRect();
    const pinned = node.closest('.pending-actions');
    return {
      y: rect.y,
      bottom: rect.bottom,
      height: innerHeight,
      pinned: !!pinned,
      text: node.parentElement?.textContent,
    };
  });
  assert(geometry.y >= 0 && geometry.bottom < geometry.height);
  proof.pending = { incident: pending.id, decision: pending.protocol.decisionId, geometry };
  // Reload exercises real persisted history and the existing pinned-actions presentation.
  await page.reload();
  await page.locator('button.home').click();
  await page.getByText('Cat-pilot', { exact: true }).last().click();
  await page
    .getByText('Аудит штатного окружения Cat-pilot и допуска ресурсов RC-2', { exact: true })
    .first()
    .click();
  await page.getByText('start_environment', { exact: true }).last().waitFor({ state: 'visible' });
  await page.screenshot({ path: join(directory, 'restored.png') });
  // Stop through the normal owner command, then answer exactly this decision through the same API as the card.
  await invoke('task.interrupt', projectId, taskId);
  await invoke('task.respond', projectId, taskId, `coordinator:${pending.protocol.decisionId}`, {
    kind: 'approval',
    choice: 'deny',
  });
  proof.restored = true;
  proof.passed = true;
} catch (error) {
  proof.error = error.stack ?? String(error);
  await page.screenshot({ path: join(directory, 'failure.png') }).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await invoke('task.interrupt', projectId, taskId).catch((error) => {
    proof.cleanupError = String(error);
    process.exitCode = 1;
  });
  if (policy) {
    const current = await invoke('incidents.policy', projectId);
    await invoke('incidents.setPolicy', projectId, policy, current.revision);
  }
  await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
  console.log(JSON.stringify(proof));
  await electron.close();
}
