import { app } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { catPilotState } from './cat-pilot-state';
import { createServices, type Services } from '../app-services';
import { coordinatorHistoryAudit, assertHistoryAudit } from './coordinator-history-audit';
import { closeCoordinatorVerification } from './coordinator-live-close';
import { dispatchState } from '../coordination-dispatch';
import { crashCoordinatorEffect, recoverCoordinatorEffect } from './coordinator-effect-live';
import { coordinatorHandoff } from './coordinator-handoff-live';
import { coordinatorShared } from './coordinator-shared-live';
import { prepareCoordinatorAudit, isolateCoordinatorAudit } from './coordinator-audit-task-live';
import { coordinatorQuota } from './coordinator-quota-live';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) app.exit(1);
app.on('window-all-closed', () => undefined);
void app.whenReady().then(async () => {
  const data = app.getPath('userData'),
    state = catPilotState(data),
    projectId = state.db.shell.projectScope!;
  const directory =
    process.env['SKARO_AC5_CASE'] ||
    join(data, 'verification', `coordination-recovery-${randomUUID()}`);
  assert(resolve(directory).startsWith(resolve(data, 'verification') + sep));
  const proof: Record<string, unknown> = {
    projectId,
    directory,
    phase: process.env['SKARO_AC5_PHASE'] ?? 'inspect',
  };
  let services: Services | undefined,
    code = 1;
  try {
    await mkdir(directory, { recursive: true });
    const preflight = process.env['SKARO_AC5_PREFLIGHT'];
    assert(preflight, 'A verified SQLite preflight copy is required before this live migration');
    const backup = JSON.parse(await readFile(preflight, 'utf8'));
    assert(
      backup.passed &&
        backup.projectId === projectId &&
        backup.backup.integrity === 'ok' &&
        backup.backup.synced,
    );
    proof.preflight = preflight;
    const before = await coordinatorHistoryAudit(state.db, data, projectId);
    services = await createServices(state, data, () => undefined, {
      builtinEntries: resolve('apps/desktop/out/main'),
    });
    proof.migration = state.db.getSetting(`coordination.migration.v1.${projectId}`, undefined);
    assert.equal((proof.migration as { blocked: boolean }).blocked, false);
    proof.dispatch = dispatchState(state.db, projectId);
    proof.histories = await assertHistoryAudit(before, state.db, data, projectId);
    const agents: Record<string, string> = {};
    for (const agent of ['codex', 'skaro'] as const)
      try {
        await services.agents.requireReady(agent);
        agents[agent] = 'ready';
      } catch (error) {
        agents[agent] = String(error);
      }
    proof.agents = agents;
    if (proof.phase === 'crash-effect')
      await crashCoordinatorEffect(services, projectId, directory);
    else if (proof.phase === 'recover-effect')
      proof.effectRecovery = await recoverCoordinatorEffect(services, projectId, directory);
    else if (proof.phase === 'handoff')
      proof.handoff = await coordinatorHandoff(services, projectId, data);
    else if (proof.phase === 'shared') await coordinatorShared(services, projectId, proof);
    else if (proof.phase === 'prepare-audit')
      proof.audit = await prepareCoordinatorAudit(services, projectId);
    else if (proof.phase === 'quota') proof.quota = await coordinatorQuota(services, projectId);
    else if (proof.phase === 'isolate-audit')
      proof.audit = await isolateCoordinatorAudit(services, projectId);
    else assert.equal(proof.phase, 'inspect');
    proof.passed = true;
    code = 0;
  } catch (error) {
    proof.error = error instanceof Error ? error.stack : String(error);
  } finally {
    if (services)
      try {
        await closeCoordinatorVerification(services);
      } catch (error) {
        proof.cleanupError = String(error);
        code = 1;
      }
    await writeFile(
      join(directory, `${String(proof.phase)}-proof.json`),
      JSON.stringify(proof, null, 2),
    );
    state.db.close();
    process.send?.({
      proof: join(directory, `${String(proof.phase)}-proof.json`),
      code,
      summary: proof,
    });
    app.exit(code);
  }
});
