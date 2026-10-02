import { app, shell } from 'electron';
import { join } from 'node:path';
import { AttachmentStore } from '@skaro/core';
import {
  McpHttpServer,
  mergeTaskTool,
  submitResultTool,
  projectTools,
  type ToolResult,
  type SkaroScope,
} from '@skaro/mcp-server';
import type { EventName, Events } from '../shared/ipc';
import { AgentManager } from './agents';
import { ChatSessions } from './chats';
import { Notifier } from './notifier';
import { Docs } from './docs';
import { Plan } from './plan';
import { Projects } from './projects';
import type { AppState } from './state';
import { TaskBoard } from './task-board';
import { TaskRuns } from './tasks';
import { trace } from './trace';

export async function createServices(
  appState: AppState,
  dataDir: string,
  emit: <E extends EventName>(event: E, payload: Events[E]) => void,
) {
  const db = appState.db;
  const attachments = new AttachmentStore(join(dataDir, 'attachments'));
  const projects = new Projects(db, (projectId) => emit('project.changed', { projectId }));
  const agents = new AgentManager({
    // Development and tests share one download of the agents.
    agentsDir: process.env['SKARO_AGENTS_DIR'] ?? join(dataDir, 'agents'),
    scratchDir: join(dataDir, 'scratch'),
    store: appState,
    openUrl: (url) => void shell.openExternal(url),
    onChange: (list) => emit('agents.changed', list),
    locale: () => appState.getLocale(app.getLocale()),
  });
  const mcp = new McpHttpServer<SkaroScope>({
    name: 'skaro',
    version: app.getVersion(),
    tools: [
      // Tools are called only after the app is up, when `runs` exists.
      mergeTaskTool((args, scope): Promise<ToolResult> => runs.mergeTask(args, scope)),
      submitResultTool((args, scope): Promise<ToolResult> => runs.submitResult(args, scope)),
      ...projectTools({
        context: (scope) => chats.context(scope),
        writeDoc: (args, scope) => chats.writeDoc(args, scope),
        proposeAdr: (args, scope) => chats.proposeAdr(args, scope),
        proposeSpec: (args, scope) => chats.proposeSpec(args, scope),
        stageArtifact: (args, scope) => chats.stageArtifact(args, scope),
        finishImport: (args, scope) => chats.finishImport(args, scope),
        proposeMilestones: (args, scope) => chats.proposeMilestones(args, scope),
        proposeTasks: (args, scope) => chats.proposeTasks(args, scope),
        updateTask: (args, scope) => chats.updateTask(args, scope),
      }),
    ],
  });
  await mcp.listen();
  trace('mcp server listening');
  const notifier = new Notifier({
    setting: (key) => appState.getSetting(key),
    locale: () => appState.getLocale(app.getLocale()),
  });
  const runs: TaskRuns = new TaskRuns(
    {
      notify: (kind, text) => notifier.notify(kind, text),
      db,
      dataDir,
      projects,
      agents,
      attachments,
      mcp,
      emit,
      locale: () => appState.getLocale(app.getLocale()),
    },
    Number(appState.getSetting('runs.slots')) || 3,
  );
  const board = new TaskBoard({
    projects,
    runs,
    emit,
    event: (projectId, kind, data) => db.addEvent(projectId, kind, data),
  });
  const docs = new Docs({ projects, emit, reveal: (path) => shell.showItemInFolder(path) });
  const plan = new Plan({
    projects,
    emit,
    deleteTasks: (projectId, ids) => board.delete(projectId, ids),
  });
  const chats: ChatSessions = new ChatSessions({
    db,
    dataDir,
    projects,
    agents,
    attachments,
    mcp,
    emit,
    locale: () => appState.getLocale(app.getLocale()),
  });
  trace('task runs created');

  return {
    appState,
    dataDir,
    db,
    attachments,
    projects,
    agents,
    mcp,
    runs,
    board,
    docs,
    plan,
    chats,
  };
}
export type Services = Awaited<ReturnType<typeof createServices>>;
