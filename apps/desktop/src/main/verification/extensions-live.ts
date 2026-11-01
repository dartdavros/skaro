import { app } from 'electron';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { AppState } from '../state';
import { createServices, type Services } from '../app-services';
import { closeBackground } from '../background/client';
import { processBirth } from '@skaro/agent-runtime/process-identity';
import { verifyHttpExtensions } from './http-extensions';
import { verifyContextRoutes } from './context-routes';
import { verifyBrowserExtensions } from './browser-extensions';
import { verifyOwnerContext } from './owner-context';
import { catPilotTarget } from './browser-target';
import { verifyAcceptanceInspection } from './acceptance-live';
import { verifyCheckPlans } from './check-plans-live';
import { verifyNativeVerification } from './native-verification';
import { verifyNativeOperations } from './native-operations';
import { verifyNativeLifetime } from './native-lifetime';
import { verifyNativeModelPreflight } from './native-model-preflight';

app.setName('Skaro');
void app.whenReady().then(async () => {
  let state: AppState | undefined;
  let services: Services | undefined;
  let code = 1;
  let stage = 'single-instance';
  try {
    if (!app.requestSingleInstanceLock()) throw new Error('Skaro is already running');
    const data = app.getPath('userData');
    const directory = join(data, 'verification', `extensions-${randomUUID()}`);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const owner = {
      pid: process.pid,
      birth: (await processBirth(process.pid))!,
      platform: process.platform,
    };
    let proof: unknown;
    if (process.argv[2] === '--browser') {
      stage = 'task-browser';
      proof = {
        browser: await verifyBrowserExtensions(
          directory,
          owner,
          await catPilotTarget(data, process.argv[3]!),
        ),
      };
    } else {
      stage = 'real-services';
      state = new AppState(join(data, 'skaro.db'));
      services = await createServices(state, data, () => undefined);
      if (process.argv[2] === '--native-verification') {
        stage = 'native-verification';
        proof = { native: await verifyNativeVerification(services, directory, owner) };
      } else if (process.argv[2] === '--native-operations') {
        stage = 'native-operations';
        proof = { operations: await verifyNativeOperations(services, directory, owner) };
      } else if (process.argv[2] === '--native-lifetime') {
        stage = 'native-lifetime';
        proof = { lifetime: await verifyNativeLifetime(services, directory, owner) };
      } else if (process.argv[2] === '--native-model-preflight') {
        stage = 'native-model-preflight';
        proof = { model: await verifyNativeModelPreflight(services, data, directory, owner) };
      } else {
        stage = 'http-and-internal';
        const http = await verifyHttpExtensions(services, directory, owner);
        stage = 'context-routes';
        const routes = await verifyContextRoutes(directory, owner);
        stage = 'acceptance-inspection';
        const acceptance = await verifyAcceptanceInspection(services, directory, owner);
        stage = 'check-plans';
        const plans = await verifyCheckPlans(services, directory, owner);
        stage = 'owner-context';
        proof = {
          http,
          routes,
          acceptance,
          plans,
          owner: await verifyOwnerContext(join(data, 'verification/openrouter-ba4'), owner),
        };
      }
    }
    await writeFile(join(directory, 'proof.json'), JSON.stringify({ owner, proof }, null, 2));
    process.send?.({ type: 'proof', stage, directory, proof });
    code = 0;
  } catch (error) {
    // Local verification errors contain no remote model payload or API credentials.
    process.send?.({ type: 'failed', stage, name: error instanceof Error ? error.name : 'Error' });
  } finally {
    if (services) {
      await Promise.allSettled([
        services.runs.close(),
        services.chats.close(),
        services.mcp.close(),
        services.graph.close(),
        services.ci.close(),
      ]);
      services.projects.close();
    }
    await closeBackground();
    state?.db.close();
    app.exit(code);
  }
});
