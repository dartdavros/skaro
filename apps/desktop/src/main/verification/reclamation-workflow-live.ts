import assert from 'node:assert/strict';
import { app } from 'electron';
import { join, resolve } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { catPilotState } from './cat-pilot-state';
import { createServices, type Services } from '../app-services';
import { closeNativeSessions } from '../native/client';
import { closeBackground } from '../background/client';
import { protectedFingerprint, reclamationInventory } from './reclamation-observation';
import {
  reclamationPreflight,
  reclamationStartupGuard,
  protectVerificationResources,
  releasePreviousVerificationAccess,
} from './reclamation-preflight';
import { verifyReclamationHistory } from './reclamation-history-live';

app.setName('Skaro');
if (!app.requestSingleInstanceLock()) {
  console.error('Close the other Skaro instance before authorized reclamation verification');
  app.exit(2);
}
app.on('window-all-closed', () => undefined);
void app
  .whenReady()
  .then(async () => {
    const data = app.getPath('userData');
    reclamationStartupGuard(data);
    const state = catPilotState(data);
    const projectId = state.db.shell.projectScope!;
    const directory = join(data, 'verification', `reclamation-workflow-${randomUUID()}`);
    const proof: Record<string, unknown> = { projectId, startedAt: new Date().toISOString() };
    let services: Services | undefined;
    let releaseProtection: (() => void) | undefined;
    let input: Awaited<ReturnType<typeof reclamationPreflight>> | undefined;
    let protectedBefore: Awaited<ReturnType<typeof protectedFingerprint>> | undefined;
    let code = 1;
    try {
      await mkdir(directory, { recursive: true });
      input = await reclamationPreflight(state.db, data);
      protectedBefore = await protectedFingerprint(state.db, projectId, input.root, data);
      proof.protectedBefore = protectedBefore;
      proof.before = await reclamationInventory(input.root, data, input.target);
      proof.authorization = {
        taskId: input.run.taskId,
        resourceId: input.record.id,
        generation: input.record.generation,
        path: input.target,
        head: input.head,
      };
      releaseProtection = protectVerificationResources(state.db, input.record);
      // Only the exact old verification pin approved by the owner is released.
      releasePreviousVerificationAccess(state.db, input);
      services = await createServices(state, data, () => undefined, {
        builtinEntries: resolve('apps/desktop/out/main'),
      });
      await verifyReclamationHistory(services, input, data, proof);
      proof.scenarioPassed = true;
      code = 0;
    } catch (error) {
      proof.error = error instanceof Error ? error.stack : String(error);
      process.send?.({ error: proof.error });
    } finally {
      if (services) {
        services.resources.stopAccepting();
        for (const close of [
          () => closeNativeSessions(),
          () => services!.commands.close(),
          () => services!.runs.close(),
          () => services!.chats.close(),
          () => services!.managedCaches.close(),
          () => services!.ci.close(),
          () => services!.mcp.close(),
          () => services!.graph.close(),
          () => services!.modelCatalog.close(),
          () => services!.modelSettings.close(),
          () => services!.coordinators.close(),
          () => services!.resources.close(),
          () => services!.projects.close(),
          () => closeBackground(),
        ]) {
          try {
            await close();
          } catch (error) {
            const errors = (proof.cleanupErrors ??= []) as string[];
            errors.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
            code = 1;
          }
        }
      }
      try {
        if (input && protectedBefore) {
          const after = await protectedFingerprint(state.db, projectId, input.root, data);
          proof.protectedAfter = after;
          assert.deepEqual(
            after,
            protectedBefore,
            'Protected source, branches and histories must be unchanged',
          );
          proof.after = await reclamationInventory(input.root, data, input.target);
        }
      } catch (error) {
        proof.finalVerificationError = error instanceof Error ? error.stack : String(error);
        code = 1;
      } finally {
        try {
          releaseProtection?.();
        } catch (error) {
          proof.protectionReleaseError = String(error);
          code = 1;
        }
      }
      proof.passed = code === 0;
      await mkdir(directory, { recursive: true });
      await writeFile(join(directory, 'proof.json'), JSON.stringify(proof, null, 2));
      state.db.close();
      process.send?.({ proof: join(directory, 'proof.json'), code });
      app.exit(code);
    }
  })
  .catch((error: unknown) => {
    const reason = error instanceof Error ? (error.stack ?? error.message) : String(error);
    console.error(reason);
    process.send?.({ error: reason });
    app.exit(1);
  });
