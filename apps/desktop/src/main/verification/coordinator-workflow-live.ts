import { app } from 'electron';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { catPilotState } from './cat-pilot-state';
import { createServices, type Services } from '../app-services';
import { closeNativeSessions } from '../native/client';
import { closeBackground } from '../background/client';
import { resourceInventory } from './resource-workflow-observation';
import { verifyCoordinatorMemory } from './coordinator-memory-live';
import { verifyCoordinatorInputs } from './coordinator-inputs-live';
import { verifyCoordinatorLocal } from './coordinator-local-live';

app.setName('Skaro');
app.on('window-all-closed', () => undefined);
void app.whenReady().then(async () => {
  const data = app.getPath('userData');
  const state = catPilotState(data);
  const projectId = state.db.shell.projectScope!;
  const directory = join(data, 'verification', `coordinator-workflow-${randomUUID()}`);
  const proof: Record<string, unknown> = { projectId, startedAt: new Date().toISOString() };
  let s: Services | undefined;
  let code = 1;
  try {
    await mkdir(directory, { recursive: true });
    s = await createServices(state, data, () => undefined, {
      builtinEntries: resolve('apps/desktop/out/main'),
    });
    const context = s.projects.get(projectId);
    const task = (await context.store.load()).tasks.find(
      (t) => t.title === 'Аудит штатного окружения Cat-pilot и допуска ресурсов RC-2',
    );
    assert(task, 'Use the existing real audit task, never seed a substitute');
    proof.before = await resourceInventory(context.root);
    await s.agents.requireReady('codex');
    process.send?.({ stage: 'shared-project-memory' });
    await verifyCoordinatorMemory(s, projectId, proof);
    process.send?.({ stage: 'existing-session-input-revalidation' });
    await verifyCoordinatorInputs(s, projectId, task.id, proof);
    process.send?.({ stage: 'immutable-candidate-and-local-installation' });
    await verifyCoordinatorLocal(s, projectId, task.id, proof, directory);
    proof.after = await resourceInventory(context.root);
    proof.passed = true;
    code = 0;
  } catch (error) {
    proof.error = error instanceof Error ? error.stack : String(error);
    process.send?.({ error: proof.error });
  } finally {
    if (s) {
      s.resources.stopAccepting();
      await closeNativeSessions();
      for (const close of [
        () => s!.commands.close(),
        () => s!.runs.close(),
        () => s!.chats.close(),
        () => s!.managedCaches.close(),
        () => s!.ci.close(),
        () => s!.mcp.close(),
        () => s!.graph.close(),
        () => s!.modelCatalog.close(),
        () => s!.modelSettings.close(),
        () => s!.coordinators.close(),
        () => s!.resources.close(),
        () => s!.projects.close(),
      ]) {
        try {
          await close();
        } catch (error) {
          proof.cleanupError = String(error);
          code = 1;
        }
      }
      await closeBackground();
    }
    await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
    state.db.close();
    process.send?.({ proof: join(directory, 'proof.json'), code });
    app.exit(code);
  }
});
