import { app } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { catPilotState } from './cat-pilot-state';
import { createServices, type Services } from '../app-services';
import { closeCoordinatorVerification } from './coordinator-live-close';
import { verifyEnvironmentAdmission } from './environment-admission-live';
import { reconcileAdmissionPrior } from './environment-admission-prior';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) app.exit(1);
app.on('window-all-closed', () => undefined);
void app.whenReady().then(async () => {
  const data = app.getPath('userData');
  const state = catPilotState(data);
  const project = state.db.shell.projectScope!;
  const directory = join(data, 'verification', `environment-admission-${randomUUID()}`);
  const proof: Record<string, unknown> = { project, startedAt: new Date().toISOString() };
  let services: Services | undefined;
  let code = 1;
  try {
    await mkdir(directory, { recursive: true });
    services = await createServices(state, data, () => undefined, {
      builtinEntries: resolve('apps/desktop/out/main'),
      silentVerification: true,
    });
    if (process.env.SKARO_ADMISSION_PRIOR)
      await reconcileAdmissionPrior(services, project, process.env.SKARO_ADMISSION_PRIOR, proof);
    await verifyEnvironmentAdmission(services, project, proof);
    proof.passed = true;
    code = 0;
  } catch (error) {
    proof.error = error instanceof Error ? error.stack : String(error);
    process.send?.({ error: proof.error });
  } finally {
    if (services)
      await closeCoordinatorVerification(services).catch((error: unknown) => {
        proof.cleanupError = String(error);
        code = 1;
      });
    await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
    state.db.close();
    process.send?.({ directory, code });
    app.exit(code);
  }
});
