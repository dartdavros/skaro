import { app } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { catPilotState } from './cat-pilot-state';
import { createServices, type Services } from '../app-services';
import { closeCoordinatorVerification } from './coordinator-live-close';
import { verifyProjectScope } from './project-scope-proof';
import { verifyEnvironmentIsolation } from './environment-isolation-live';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) app.exit(1);
app.on('window-all-closed', () => undefined);
void app.whenReady().then(async () => {
  const data = app.getPath('userData'),
    state = catPilotState(data);
  const directory = join(data, 'verification', `environment-isolation-${randomUUID()}`);
  const proof: Record<string, unknown> = {
    directory,
    startedAt: new Date().toISOString(),
    scenarios: process.env.SKARO_ISOLATION_IN_PLACE_ONLY
      ? ['in-place']
      : process.env.SKARO_ISOLATION_WORKTREE_ONLY
        ? ['worktree-switch']
        : ['worktree-switch', 'in-place'],
  };
  let services: Services | undefined,
    code = 1;
  try {
    await mkdir(directory, { recursive: true });
    process.send?.({ directory, phase: 'starting-scoped-services' });
    services = await createServices(state, data, () => undefined, {
      builtinEntries: resolve('apps/desktop/out/main'),
      silentVerification: true,
    });
    proof.scope = verifyProjectScope(services);
    await verifyEnvironmentIsolation(services, state.db.shell.projectScope!, directory, proof);
    proof.passed = true;
    code = 0;
  } catch (error) {
    proof.error = error instanceof Error ? error.stack : String(error);
    process.send?.({ error: proof.error });
  } finally {
    if (services)
      await closeCoordinatorVerification(services).catch((error: unknown) => {
        proof.shutdownError = String(error);
        code = 1;
      });
    await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
    state.db.close();
    process.send?.({ directory, code });
    app.exit(code);
  }
});
