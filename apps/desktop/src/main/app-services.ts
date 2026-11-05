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
  taskBlockerTool,
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
import { CiRuns } from './ci-runs';
import { C4Service } from './c4-service';
import { proposeC4Specification } from './c4-specification';
import { ProjectOverview } from './project-overview';
import { GraphService } from './graph/service';
import { backgroundWork } from './background-work';
import { reportGraph } from './background-graph';
import { BuiltinModelConfigurationStore } from './builtin-model-configuration';
import { BuiltinModelSettingsService } from './builtin-model-settings-service';
import { BuiltinModelCatalog } from './builtin-model-catalog';
import type { BuiltinTaskAuthorization } from './builtin-task-models';
import type { BuiltinChatAuthorization } from './builtin-chat-models';
import { builtinServiceModels } from './builtin-service-models';
import { setBackgroundProjectScope } from './background/client';
import { setupProjectEnvironment } from './project-environment-setup';

export async function createServices(
  appState: AppState,
  dataDir: string,
  emit: <E extends EventName>(event: E, payload: Events[E]) => void,
  options: {
    builtinTasks?: BuiltinTaskAuthorization;
    builtinChats?: BuiltinChatAuthorization;
    /** Compiled worker directory for an explicitly scoped verification entry. */
    builtinEntries?: string;
  } = {},
) {
  const db = appState.db;
  if (options.builtinEntries && !db.shell.projectScope)
    throw new Error('An explicit builtin worker directory requires a scoped verification');
  setBackgroundProjectScope(dataDir, db.shell.projectScope);
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
  backgroundWork.attach((state) => emit('background.changed', state));
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
    tools: [
      ...c4Tools({
        migrate: (scope) => c4.migrate(scope),
        context: (scope) =>
          scope.kind === 'task'
            ? runs.scopedTool(scope, () => c4.context(scope))
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
      taskBlockerTool((reason, scope) => runs.reportBlocker(reason, scope)),
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
    ],
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
    setting: (key) => appState.getSetting(key),
    locale: () => appState.getLocale(app.getLocale()),
  });
  const runs: TaskRuns = new TaskRuns(
    {
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
  trace('task runs created');
  const c4 = new C4Service({
    assertMayWork: (scope) => {
      if (scope.chatId) chats.assertMayWork(scope.chatId);
    },
    db,
    projects,
    locale: () => appState.getLocale(app.getLocale()),
    publish: (scope, item) =>
      scope.kind === 'task'
        ? runs.architectureEvent(scope, item)
        : chats.architectureEvent(scope, item),
    changed: (projectId) => emit('project.changed', { projectId }),
    stageImport: (args, scope) => chats.stageC4(args, scope),
  });
  // Recovery must not hold the first frame or the owner's navigation behind old histories.
  setImmediate(
    () =>
      void chats
        .recoverReplans()
        .catch((error: unknown) => console.error('Replan recovery:', error)),
  );
  const ci = new CiRuns(db, projects, async (scope, text, error) => {
    if (scope.kind === 'task' && scope.taskId)
      await runs.operationNotice(scope.projectId, scope.taskId, text, error);
    else if (scope.chatId) await chats.operationNotice(scope.projectId, scope.chatId, text, error);
    if (error) notifier.notify('error', text);
  });

  graph.start();
  return {
    graph,
    modelConfiguration,
    modelSettings,
    modelCatalog,
    overview,
    c4,
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
