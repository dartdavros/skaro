import { app } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { c4Hash, git } from '@skaro/core';
import { catPilotState } from './cat-pilot-state';
import { createServices, type Services } from '../app-services';
import { closeCoordinatorVerification } from './coordinator-live-close';
import {
  prepareRecoveryCase,
  recoveryPin,
  durableRecoveryJson,
  verifyRecoveryProtection,
  saveRecoveryPhaseProof,
} from './resource-recovery-case';
import { resourceRecoveryMeasurements } from './resource-recovery-measurements';
import { crashRecoveryReader, recoverReader } from './resource-recovery-reader';
import { watchRecoveryCleanup } from './resource-recovery-crash';
import { cleanCompletedWorktrees } from '../task-worktree-retention';
import { recoverCleanup, unavailableRecoveryDocker } from './resource-recovery-cleanup';
import { recoveryCycles } from './resource-recovery-cycles';
import { recoveryModelWait } from './resource-recovery-model';
import { finishResourceRecovery } from './resource-recovery-finish';
import { recoveryModelNetwork } from './resource-recovery-model-network';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) app.exit(1);
app.on('window-all-closed', () => undefined);
void app.whenReady().then(async () => {
  const data = app.getPath('userData'),
    state = catPilotState(data),
    project = state.db.shell.projectScope!;
  const directory =
    process.env['SKARO_RC4_CASE'] ||
    join(data, 'verification', `resource-recovery-${randomUUID()}`);
  assert(resolve(directory).startsWith(resolve(data, 'verification') + sep));
  const phase = process.env['SKARO_RC4_PHASE'] ?? 'inspect';
  const proof: Record<string, unknown> = {
    phase,
    directory,
    project,
    startedAt: new Date().toISOString(),
  };
  let services: Services | undefined,
    stopObserver: (() => void) | undefined,
    code = 1;
  try {
    const preflight = process.env['SKARO_RC4_PREFLIGHT'];
    assert(preflight);
    const backup = JSON.parse(await readFile(preflight, 'utf8'));
    assert(
      backup.passed &&
        backup.projectId === project &&
        backup.backup.integrity === 'ok' &&
        backup.backup.synced,
    );
    proof.preflight = preflight;
    proof.build = {
      bundle: process.argv[1],
      sha256: c4Hash(await readFile(process.argv[1]!, 'utf8')),
      skaroHead: (await git(process.cwd(), ['rev-parse', 'HEAD'])).stdout.trim(),
      cleanCommit: false,
    };
    await mkdir(directory, { recursive: true });
    const scenario = await prepareRecoveryCase(state.db, data, directory);
    recoveryPin(state.db, scenario, phase !== 'recover-cleanup');
    proof.before = await resourceRecoveryMeasurements(state.db, project, scenario.root);
    await durableRecoveryJson(join(directory, `${phase}-before.json`), proof);
    if (phase === 'crash-cleanup') {
      stopObserver = watchRecoveryCleanup(state.db, scenario, directory);
      recoveryPin(state.db, scenario, false);
    }
    services = await createServices(state, data, () => undefined, {
      builtinEntries: resolve('apps/desktop/out/main'),
      silentVerification: true,
    });
    if (phase === 'crash-reader') await crashRecoveryReader(services, scenario, directory);
    else if (phase === 'recover-reader')
      proof.reader = await recoverReader(services, scenario, directory);
    else if (phase === 'crash-cleanup') {
      await cleanCompletedWorktrees(services.runs['engine']);
      throw new Error('Actual cleanup crash window was not observed; no crash acceptance claimed');
    } else if (phase === 'recover-cleanup')
      proof.recovery = await recoverCleanup(services, scenario, directory);
    else if (phase === 'docker-unavailable')
      proof.docker = await unavailableRecoveryDocker(services, scenario);
    else if (phase === 'cycles') proof.cycles = await recoveryCycles(services, scenario);
    else if (phase === 'model-wait') proof.modelWait = await recoveryModelWait(services, scenario);
    else if (phase === 'model-unavailable')
      proof.modelNetwork = await recoveryModelNetwork(services, scenario, directory);
    else if (phase === 'finish')
      proof.acceptance = await finishResourceRecovery(services, scenario, directory);
    else assert.equal(phase, 'inspect');
    proof.protection = await verifyRecoveryProtection(state.db, data, scenario);
    proof.after = await resourceRecoveryMeasurements(state.db, project, scenario.root);
    code = 0;
  } catch (error) {
    proof.error = error instanceof Error ? error.stack : String(error);
  } finally {
    stopObserver?.();
    if (services)
      try {
        await closeCoordinatorVerification(services);
      } catch (error) {
        proof.cleanupError = String(error);
        code = 1;
      }
    proof.passed = code === 0;
    await saveRecoveryPhaseProof(directory, phase, proof);
    state.db.close();
    process.send?.({
      phase,
      proof: join(directory, `${phase}-proof.json`),
      code,
      error: proof.error,
    });
    app.exit(code);
  }
});
