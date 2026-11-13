import { RELEASE_AGENT_IDS, type ManagedAgentId as AgentId } from '@skaro/agents';
import { app, net } from 'electron';
import { join } from 'node:path';
import { AgentInstaller, currentPlatform, type AppDb } from '@skaro/core';
import type { ChatSessions } from './chats';
import type { TaskRuns } from './tasks';
import type { Events, EventName } from '../shared/ipc';
import { currentBundle } from './update-current';
import { UpdateActivity } from './update-activity';
import { UpdateDriver } from './update-driver';
import { UpdateJournal } from './update-journal';
import { Updates } from './update-controller';

export async function createUpdates(options: {
  db: AppDb;
  runs: TaskRuns;
  chats: ChatSessions;
  dataDir: string;
  emit: <E extends EventName>(event: E, payload: Events[E]) => void;
}): Promise<{ updates: Updates; activity: UpdateActivity }> {
  const { runs, chats, dataDir, emit } = options;
  const platform = currentPlatform();
  const activity = new UpdateActivity(() => runs.updateBusy() || chats.updateBusy());
  const installer = new AgentInstaller({
    dir: process.env['SKARO_AGENTS_DIR'] ?? join(dataDir, 'agents'),
  });
  const installed = async (): Promise<AgentId[]> => {
    const ids = RELEASE_AGENT_IDS;
    const found = await Promise.all(ids.map((id) => installer.installed(id)));
    return ids.filter((_id, index) => found[index] !== undefined);
  };
  const current = await currentBundle(app.getVersion(), process.resourcesPath, app.isPackaged);
  const driver = new UpdateDriver(platform, app.isPackaged, app.getPath('exe'));
  const updates = new Updates({
    current,
    platform,
    activity,
    installer,
    installed,
    journal: new UpdateJournal(join(dataDir, 'updates')),
    driver,
    emit: (state) => emit('updates.changed', state),
    fetch: net.fetch.bind(net) as typeof fetch,
    executable: app.getPath('exe'),
    installable:
      app.isPackaged &&
      platform.os !== 'darwin' &&
      (platform.os !== 'linux' || !!process.env['APPIMAGE']),
  });
  driver.onApplyFailure((error) => updates.applyFailed(error));
  await updates.initialize();
  return { updates, activity };
}
