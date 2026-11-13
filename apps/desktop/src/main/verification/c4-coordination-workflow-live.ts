import { app } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { catPilotState } from './cat-pilot-state';
import { createServices, type Services } from '../app-services';
import { closeCoordinatorVerification } from './coordinator-live-close';
import { prepareC4Coordination } from './c4-coordination-preparation';
import { applyC4CoordinationBaseline } from './c4-coordination-baseline';
import { renameC4CoordinationTask } from './c4-coordination-rename';
import { verifyC4CoordinationGuards } from './c4-coordination-guards';
import { verifyC4CoordinationBrowser } from './c4-coordination-browser';
import { submitC4CoordinationTask } from './c4-coordination-submit';
import { auditC4Coordination } from './c4-coordination-final';
import { prepareC4FaultTask } from './c4-fault-task';
import { submitC4FaultTask } from './c4-fault-submit';
import { prepareC4PublicationRetry } from './c4-publication-retry';
import { finishC4Acceptance } from './c4-finish-audit';
import {
  prepareC4PublicationRecovery,
  verifyC4PublicationRecovery,
} from './c4-publication-recovery';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) app.exit(1);
app.on('window-all-closed', () => undefined);
void app.whenReady().then(async () => {
  const data = app.getPath('userData'),
    state = catPilotState(data),
    projectId = state.db.shell.projectScope!;
  const directory = join(data, 'verification', `c4-coordination-${randomUUID()}`);
  const proof: Record<string, unknown> = {
    projectId,
    directory,
    phase: process.env['SKARO_C42_PHASE'] ?? 'prepare',
  };
  let s: Services | undefined,
    code = 1;
  let stopObserver: (() => void) | undefined;
  try {
    await mkdir(directory, { recursive: true });
    const preflight = process.env['SKARO_C42_PREFLIGHT'];
    assert(preflight);
    const backup = JSON.parse(await readFile(preflight, 'utf8'));
    assert(
      backup.passed &&
        backup.projectId === projectId &&
        backup.backup.integrity === 'ok' &&
        backup.backup.synced,
    );
    proof.preflight = preflight;
    const retry =
      proof.phase === 'resume-publication'
        ? await prepareC4PublicationRetry(state.db, data, projectId, directory)
        : undefined;
    stopObserver = retry?.stop;
    const recovery =
      proof.phase === 'recover-publication'
        ? await prepareC4PublicationRecovery(state.db, data, projectId)
        : undefined;
    s = await createServices(state, data, () => undefined, {
      builtinEntries: resolve('apps/desktop/out/main'),
      silentVerification: true,
    });
    if (proof.phase === 'prepare')
      proof.preparation = await prepareC4Coordination(s, projectId, directory);
    else if (proof.phase === 'apply-baseline')
      proof.baseline = await applyC4CoordinationBaseline(s, projectId);
    else if (proof.phase === 'rename')
      proof.rename = await renameC4CoordinationTask(s, projectId, directory);
    else if (proof.phase === 'guards')
      proof.guards = await verifyC4CoordinationGuards(s, projectId, directory);
    else if (proof.phase === 'browser')
      proof.browser = await verifyC4CoordinationBrowser(s, projectId, directory);
    else if (proof.phase === 'submit')
      proof.submission = await submitC4CoordinationTask(s, projectId, directory);
    else if (proof.phase === 'recover-publication')
      proof.recovery = await verifyC4PublicationRecovery(s, projectId, directory, recovery!);
    else if (proof.phase === 'audit')
      proof.audit = await auditC4Coordination(s, projectId, directory);
    else if (proof.phase === 'fault-task')
      proof.faultTask = await prepareC4FaultTask(s, projectId, directory);
    else if (proof.phase === 'fault-submit')
      proof.faultSubmission = await submitC4FaultTask(s, projectId, directory);
    else if (proof.phase === 'resume-publication') {
      await new Promise((resolve) => setTimeout(resolve, 30000));
      throw new Error('Expected real publication crash was not observed; inspect actual state');
    } else if (proof.phase === 'finish')
      proof.acceptance = await finishC4Acceptance(s, projectId, directory);
    else throw new Error('Unknown C4-2 verification phase');
    proof.passed = true;
    code = 0;
  } catch (error) {
    proof.error = error instanceof Error ? error.stack : String(error);
  } finally {
    stopObserver?.();
    if (s)
      try {
        await closeCoordinatorVerification(s);
      } catch (error) {
        proof.cleanupError = String(error);
        code = 1;
      }
    await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
    state.db.close();
    process.send?.({
      proof: join(directory, 'proof.json'),
      code,
      summary: {
        phase: proof.phase,
        passed: proof.passed,
        error: proof.error,
        cleanupError: proof.cleanupError,
      },
    });
    app.exit(code);
  }
});
