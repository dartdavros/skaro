import { app, net } from 'electron';
import { join } from 'node:path';
import {
  AgentInstaller,
  currentPlatform,
  isAgentBusy,
  type AppDb,
  type AgentId,
} from '@skaro/core';
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
  const { db, runs, chats, dataDir, emit } = options;
  const platform = currentPlatform();
  const activity = new UpdateActivity(
    () =>
      runs.slots().free < runs.slots().total ||
      db
        .listProjects()
        .some(
          (project) =>
            [...db.getTaskRuntime(project.id).values()].some((task) => isAgentBusy(task.state)) ||
            chats.list(project.id).some((chat) => chat.live),
        ),
  );
  const installer = new AgentInstaller({
    dir: process.env['SKARO_AGENTS_DIR'] ?? join(dataDir, 'agents'),
  });
  const installed = async (): Promise<AgentId[]> => {
    const ids: AgentId[] = ['codex', 'claude-code'];
    const found = await Promise.all(ids.map((id) => installer.installed(id)));
    return ids.filter((_id, index) => found[index] !== undefined);
  };
  const current = await currentBundle(app.getVersion(), process.resourcesPath, app.isPackaged);
  const driver = new UpdateDriver(platform, app.isPackaged);
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
    installable: app.isPackaged && (platform.os !== 'linux' || !!process.env['APPIMAGE']),
  });
  driver.onApplyFailure((error) => updates.applyFailed(error));
  await updates.initialize();
  return { updates, activity };
}
