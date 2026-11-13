import { app, shell } from 'electron';
import { join } from 'node:path';
import { AttachmentStore } from '@skaro/core';
import {
  McpHttpServer,
  mergeTaskTool,
  submitResultTool,
  startEnvironmentTool,
  configureEnvironmentTool,
  setupEnvironmentTool,
  secretInputTool,
  verifyIntegrationTool,
  taskHistoryTool,
  chatHistoryTool,
  ciRunTool,
  projectTools,
  c4Tools,
  type ToolResult,
  type SkaroScope,
} from '@skaro/mcp-server';
import type { EventName, Events } from '../shared/ipc';
import { ProductAgents } from './builtin-product-agents';
import { ChatSessions } from './chats';
import { Notifier } from './notifier';
import { Docs } from './docs';
import { Plan } from './plan';
import { Projects } from './projects';
import type { AppState } from './state';
import { TaskBoard } from './task-board';
import { TaskRuns } from './tasks';
import { trace } from './trace';
import { createC4Services } from './c4-services';
import type { C4Audits } from './c4-audits';
import { c4AuditTools } from './c4-audit-tools';
import { proposeC4Specification } from './c4-specification';
import { ProjectOverview } from './project-overview';
import { GraphService } from './graph/service';
import { attachProjectBackground } from './background-services';
import { reportGraph } from './background-graph';
import { BuiltinModelConfigurationStore } from './builtin-model-configuration';
import { BuiltinModelSettingsService } from './builtin-model-settings-service';
import { BuiltinModelCatalog } from './builtin-model-catalog';
import type { BuiltinTaskAuthorization } from './builtin-task-models';
import type { BuiltinChatAuthorization } from './builtin-chat-models';
import { builtinServiceModels } from './builtin-service-models';
import { setupProjectEnvironment } from './project-environment-setup';
import { ProjectCoordinators } from './project-coordinators';
import { coordinatedTools } from './coordinated-tools';
import { OwnerCommands } from './owner-commands';
import { ApplicationResources } from './application-resources';
import { ProjectMemory } from './project-memory';
import { bindProjectMemory } from './project-memory-binding';
import { coordinatorTools } from './coordinator-tools';
import { LocalVersions } from './local-versions';
import { managedCacheServices } from './managed-cache-services';
import { startProjectWriters } from './project-recovery-startup';

export async function createServices(
  appState: AppState,
  dataDir: string,
  emitEvent: <E extends EventName>(event: E, payload: Events[E]) => void,
  options: {
    builtinTasks?: BuiltinTaskAuthorization;
    builtinChats?: BuiltinChatAuthorization;
    /** Compiled worker directory for an explicitly scoped verification entry. */
    builtinEntries?: string;
    silentVerification?: boolean;
  } = {},
) {
  const db = appState.db;
  const auditObserver: { current?: C4Audits } = {};
  const emit = <E extends EventName>(event: E, payload: Events[E]) => {
    emitEvent(event, payload);
    auditObserver.current?.observe(event, payload);
  };
  if (options.silentVerification && !db.shell.projectScope)
    throw new Error('Silent verification requires an explicitly scoped project');
  if (options.builtinEntries && !db.shell.projectScope)
    throw new Error('An explicit builtin worker directory requires a scoped verification');
  attachProjectBackground(db, dataDir, emit);
  const resources = new ApplicationResources(db, dataDir);
  const currentRuns = () => runs;
  const currentChats = () => chats;
  const { managedCaches, cacheTools } = managedCacheServices(db, dataDir, currentRuns);
  const coordinators = new ProjectCoordinators(db);
  coordinators.recover();
  const modelConfiguration = new BuiltinModelConfigurationStore(db);
  const modelSettings = new BuiltinModelSettingsService(modelConfiguration, dataDir);
  const modelCatalog = new BuiltinModelCatalog(modelConfiguration, {
    credentials: modelSettings,
    verification: !!db.shell.projectScope,
    ...(db.shell.projectScope && process.env['SKARO_VERIFY_PROXY']
      ? { proxy: process.env['SKARO_VERIFY_PROXY'] }
      : {}),
  });
  const attachments = new AttachmentStore(join(dataDir, 'attachments'));
  const projects = new Projects(db, (projectId) => emit('project.changed', { projectId }), dataDir);
  const memory = new ProjectMemory(db, projects, dataDir);
  bindProjectMemory(db, memory);
  const graph = new GraphService(appState, dataDir, (status) => {
    emit('graph.changed', status);
    reportGraph(status, db.getProject(status.projectId)?.name ?? '');
  });
  const overview = new ProjectOverview(db, projects, (card) => emit('projects.card', card));
  const agents = new ProductAgents(
    {
      // Development and tests share one download of the agents.
      agentsDir: process.env['SKARO_AGENTS_DIR'] ?? join(dataDir, 'agents'),
      scratchDir: join(dataDir, 'scratch'),
      attachmentsDir: attachments.dir,
      store: appState,
      openUrl: (url) => void shell.openExternal(url),
      onChange: (list) => emit('agents.changed', list),
      locale: () => appState.getLocale(app.getLocale()),
    },
    { store: modelConfiguration, settings: modelSettings, catalog: modelCatalog },
    dataDir,
  );
  const mcp = new McpHttpServer<SkaroScope>({
    name: 'skaro',
    version: app.getVersion(),
    tools: coordinatedTools(db, coordinators, [
      ...coordinatorTools(memory, currentRuns, currentChats),
      ...cacheTools,
      ...c4AuditTools(() => c4Audits),
      ...c4Tools({
        migrate: (scope) => c4.migrate(scope),
        context: (scope) =>
          scope.kind === 'task'
            ? runs.scopedTool(scope, () => c4.context(scope))
            : scope.chatId
              ? c4Audits.context(scope.projectId, scope.chatId)
              : c4.context(scope),
        propose: (args, scope) =>
          scope.kind === 'task'
            ? runs.scopedTool(scope, () => c4.propose(args, scope))
            : c4.propose(args, scope),
        review: (args, scope) => runs.scopedTool(scope, () => c4.review(args, scope)),
      }),
      // Tools are called only after the app is up, when `runs` exists.
      mergeTaskTool((args, scope): Promise<ToolResult> => runs.mergeTask(args, scope)),
      submitResultTool((args, scope): Promise<ToolResult> => runs.submitResult(args, scope)),
      secretInputTool((questions, scope) => runs.requestSecret(questions, scope)),
      startEnvironmentTool((scope): Promise<ToolResult> => runs.startEnvironment(scope)),
      configureEnvironmentTool((args, scope) => runs.configureEnvironment(args, scope)),
      setupEnvironmentTool((args, scope) => {
        const action = () => setupProjectEnvironment(projects, args, scope);
        if (scope.kind === 'task') return runs.scopedTool(scope, action);
        const chat = scope.chatId ? db.getChat(scope.chatId) : undefined;
        if (!chat || chat.projectId !== scope.projectId)
          return Promise.resolve({ text: 'Invalid project chat scope.', isError: true });
        chats.assertMayWork(chat.id);
        return action();
      }),
      verifyIntegrationTool((checks, scope) => runs.verifyIntegration(checks, scope)),
      taskHistoryTool((args, scope) => runs.readHistory(args, scope)),
      chatHistoryTool((args, scope) => chats.readHistory(args, scope)),
      ciRunTool((args, scope) => ci.call(args, scope)),
      ...projectTools({
        planning: {
          preparePlan: (args, scope) => chats.planning.preparePlan(args, scope),
          proposeSavedPlan: (args, scope) => chats.planning.proposeSavedPlan(args, scope),
          finishPlan: (args, scope) => chats.planning.finishPlan(args, scope),
          controlPlan: (args, scope) => chats.planning.controlPlan(args, scope),
        },
        context: (scope) => chats.context(scope),
        writeDoc: (args, scope) => chats.writeDoc(args, scope),
        proposeAdr: (args, scope) => chats.proposeAdr(args, scope),
        proposeSpec: (args, scope) => proposeC4Specification(c4, projects, args, scope),
        stageArtifact: (args, scope) => chats.stageArtifact(args, scope),
        finishImport: (args, scope) => chats.finishImport(args, scope),
        proposeMilestones: (args, scope) => chats.proposeMilestones(args, scope),
        proposeTasks: (args, scope) => chats.proposeTasks(args, scope),
        updateTask: (args, scope) => chats.updateTask(args, scope),
        replanTasks: (args, scope) => chats.replanTasks(args, scope),
      }),
    ]),
  });
  await mcp.listen();
  trace('mcp server listening');
  const models = builtinServiceModels(
    {
      store: modelConfiguration,
      settings: modelSettings,
      catalog: modelCatalog,
      mcp,
      ...(db.shell.projectScope && process.env['SKARO_VERIFY_PROXY']
        ? { proxy: process.env['SKARO_VERIFY_PROXY'] }
        : {}),
    },
    !!db.shell.projectScope,
    options,
    db,
  );
  const notifier = new Notifier({
    setting: (key) => (options.silentVerification ? false : appState.getSetting(key)),
    locale: () => appState.getLocale(app.getLocale()),
  });
  const runs: TaskRuns = new TaskRuns(
    {
      coordinators,
      notify: (kind, text, title) => notifier.notify(kind, text, title),
      db,
      dataDir,
      projects,
      agents,
      attachments,
      mcp,
      emit,
      locale: () => appState.getLocale(app.getLocale()),
      ...(options.builtinEntries ? { builtinEntries: options.builtinEntries } : {}),
      ...(models.builtinSessions ? { builtinSessions: models.builtinSessions } : {}),
    },
    Number(appState.getSetting('runs.slots')) || 3,
  );
  runs.limitEnvironments();
  const localVersions = new LocalVersions(db, projects, dataDir, (project, integration) =>
    runs.localCandidates.verify(project, integration),
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
    ...(models.builtinChatSessions ? { builtinChatSessions: models.builtinChatSessions } : {}),
  });
  const commands = new OwnerCommands(
    db,
    (command) => emit('command.changed', command),
    coordinators,
    dataDir,
  );
  trace('task runs created');
  const { c4, c4Audits, ci } = createC4Services(
    db,
    projects,
    chats,
    runs,
    emit,
    () => appState.getLocale(app.getLocale()),
    (text) => notifier.notify('error', text),
  );
  auditObserver.current = c4Audits;
  await startProjectWriters(commands, runs, chats, c4Audits);

  graph.start();
  return {
    localVersions,
    memory,
    resources,
    managedCaches,
    coordinators,
    commands,
    graph,
    modelConfiguration,
    modelSettings,
    modelCatalog,
    overview,
    c4,
    c4Audits,
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
    ci,
  };
}
export type Services = Awaited<ReturnType<typeof createServices>>;
