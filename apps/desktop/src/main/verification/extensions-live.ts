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
      proof = { browser: await verifyBrowserExtensions(directory, owner, process.argv[3]!) };
    } else {
      stage = 'real-services';
      state = new AppState(join(data, 'skaro.db'));
      services = await createServices(state, data, () => undefined);
      stage = 'http-and-internal';
      const http = await verifyHttpExtensions(services, directory, owner);
      stage = 'context-routes';
      const routes = await verifyContextRoutes(directory, owner);
      stage = 'owner-context';
      proof = {
        http,
        routes,
        owner: await verifyOwnerContext(join(data, 'verification/openrouter-ba4'), owner),
      };
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
