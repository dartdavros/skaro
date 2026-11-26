import { recoverCoordinatorIncidents } from './coordinator-recovery';
import { taskUpdateBusy } from './task-update-activity';
import { type ProjectArtifacts, type Task, type TaskStatus } from '@skaro/core';
import type { MergeTaskArgs, SubmitResultArgs, SkaroScope, ToolResult } from '@skaro/mcp-server';
import type { InteractionAnswer, Item, ProcessAdmissionPort } from '@skaro/timeline';
import type {
  AgentSettings,
  MergeAction,
  MessageInput,
  StageInfo,
  TaskAssignment,
  TaskSummary,
  TaskView,
} from '../shared/ipc';
import { type TaskRunDeps } from './task-run-model';
import type { HistoryArgs } from '@skaro/mcp-server';
import { taskTool, trackRun } from './task-run-access';
import { readTaskHistory } from './task-history-context';
import { taskDecisionSources } from './task-decision-sources';
import { mutateTaskOwner, serializeTaskMutation } from './project-task-mutations';
import { TaskRunEngine } from './task-run-engine';
import { TaskCatalogService } from './task-catalog-service';
import { errorText } from './session-log';
import { startTaskEnvironment } from './task-environment-tool';
import { clearTaskChat } from './task-clear';
import { configureTaskEnvironment } from './task-environment-config-tool';
import type { ConfigureEnvironmentArgs } from '@skaro/mcp-server';
import { builtinAcceptancePort } from './builtin-acceptance';
import { builtinTaskAdmission } from './builtin-task-admission';
import { submitTaskResult } from './task-submit';
import { taskArchitectureEvent } from './task-architecture-events';
import { requestTaskSecret } from './task-secret-input';
import { resumeTaskFromInstruction } from './task-resume';
import { reportTaskBlocker } from './task-blocker-report';
import { cancelTaskQuestion } from './question-cancel-handlers';
import { prepareModelIncident, verifyModelIncident } from './incident-model-access';
import { prepareBuiltinTaskReview } from './builtin-task-review';
import { setTaskBoardStatus } from './task-board-status';
import { parkTask, type ParkedTaskStatus } from './task-park';
import type { BuiltinTaskLaunchRequest, BuiltinTaskHandoffRequest } from './builtin-task-start';
export { ActiveRun, type TaskRunDeps } from './task-run-model';
export { requirementsOf } from './task-run-helpers';
/** Public API: composes focused task-run services without owning their workflows. */
export class TaskRuns {
  cancelIntegrationQuestion(id: string, reason: string, scope: SkaroScope) {
    return this.engine.integrations.cancelQuestion(id, reason, scope);
  }
  prepareIncident(scope: SkaroScope, id: string) {
    return prepareModelIncident(this.engine, scope, id);
  }
  verifyIncident(scope: SkaroScope, id: string) {
    return verifyModelIncident(this.engine, scope, id);
  }
  incidentArtifacts(project: string) {
    return this.engine.project(project).summary();
  }
  cancelQuestion(project: string, task: string, id: string, reason: string, runId?: string) {
    return cancelTaskQuestion(this.engine, project, task, id, reason, runId);
  }
  get incidents() {
    return this.engine.incidents;
  }
  get localCandidates() {
    return this.engine.localCandidates;
  }
  handoffBuiltin(request: BuiltinTaskHandoffRequest): Promise<void> {
    return this.engine.handoff.changeBuiltin(request);
  }
  /** Main-only entry; product picker/IPC selection remains a separate gate. */
  launchBuiltin(request: BuiltinTaskLaunchRequest): Promise<void> {
    return this.engine.scheduling.launchBuiltin(request);
  }
  builtinAdmission(scope: SkaroScope, sessionId: string, signal: AbortSignal) {
    return builtinTaskAdmission(this.engine, scope, sessionId, signal);
  }
  builtinReview(projectId: string, taskId: string) {
    return prepareBuiltinTaskReview(this.engine, projectId, taskId);
  }
  builtinAcceptance(scope: SkaroScope, admissions: Pick<ProcessAdmissionPort, 'requireActive'>) {
    return builtinAcceptancePort(this.engine, scope, admissions);
  }
  projectChanged(projectId: string): void {
    this.engine.merges.coordinator.changed(projectId);
    this.catalog.invalidate(projectId);
    this.engine.incidents.projectChanged(projectId);
  }
  scopedTool(scope: SkaroScope, action: () => Promise<ToolResult>): Promise<ToolResult> {
    return taskTool(this.engine, scope, action);
  }
  async architectureEvent(
    scope: SkaroScope,
    item: Extract<Item, { kind: 'proposal' }>,
  ): Promise<void> {
    return taskArchitectureEvent(this.engine, scope, item);
  }
  revertMerge(projectId: string, taskId: string, commit: string): Promise<void> {
    return this.engine.mergeActions.revert(projectId, taskId, commit);
  }
  private readonly engine: TaskRunEngine;
  readonly catalog: TaskCatalogService;
  constructor(deps: TaskRunDeps) {
    this.engine = new TaskRunEngine(deps);
    this.catalog = new TaskCatalogService(this.engine);
  }
  list(projectId: string): Promise<TaskSummary[]> {
    return this.engine.views.list(projectId);
  }
  updateBusy(): boolean {
    return taskUpdateBusy(this.engine);
  }
  publicationAgents(): number {
    return this.engine.integrations.publicationAgents();
  }
  launch(
    projectId: string,
    taskIds: string[],
    message: string,
    assignment?: TaskAssignment,
  ): Promise<void> {
    return this.engine.scheduling.launch(projectId, taskIds, message, assignment);
  }
  assign(projectId: string, taskId: string, assignment: TaskAssignment): Promise<void> {
    return serializeTaskMutation(this.engine.project(projectId), () =>
      this.engine.views.assign(projectId, taskId, assignment),
    );
  }
  forget(projectId: string, taskId: string): Promise<void> {
    return this.engine.sessions.forget(projectId, taskId);
  }
  setBoardStatus(projectId: string, taskId: string, status: TaskStatus): Promise<void> {
    return setTaskBoardStatus(this.engine, projectId, taskId, status);
  }
  retireHistory(projectId: string, taskId: string): void {
    this.engine.deps.db.retireTaskRuns(projectId, taskId);
    this.engine.scheduling.forgetAwaiting(projectId, [taskId]);
  }
  open(projectId: string, taskId: string, options?: { paged: boolean }): Promise<TaskView> {
    return this.engine.views.open(projectId, taskId, options);
  }
  openExternal(
    projectId: string,
    taskId: string,
    url: string,
    open: (url: string) => Promise<void>,
  ): Promise<void> {
    return this.engine.reviews.open(projectId, taskId, url, open);
  }
  stopEnvironmentReview(projectId: string, taskId: string): Promise<void> {
    return this.engine.reviews.stop(projectId, taskId);
  }
  workdir(projectId: string, taskId: string): Promise<string> {
    return this.engine.views.workdir(projectId, taskId);
  }
  get files() {
    return this.engine.files;
  }
  toggleCriterion(projectId: string, taskId: string, index: number): Promise<void> {
    return serializeTaskMutation(this.engine.project(projectId), () =>
      this.engine.views.toggleCriterion(projectId, taskId, index),
    );
  }
  settings(projectId: string, task: Task, artifacts: ProjectArtifacts): AgentSettings {
    return this.engine.views.settings(projectId, task, artifacts);
  }
  setSettings(projectId: string, taskId: string, next: AgentSettings): Promise<void> {
    return mutateTaskOwner(this.engine.project(projectId), taskId, () =>
      this.engine.views.setSettings(projectId, taskId, next),
    );
  }
  followProjectDefaults(projectId: string): Promise<void> {
    return serializeTaskMutation(this.engine.project(projectId), () =>
      this.engine.views.followProjectDefaults(projectId),
    );
  }
  send(projectId: string, taskId: string, input: MessageInput): Promise<void> {
    return this.engine.messages.send(projectId, taskId, input);
  }
  respond(
    projectId: string,
    taskId: string,
    interactionId: string,
    answer: InteractionAnswer,
  ): Promise<void> {
    return this.engine.messages.respond(projectId, taskId, interactionId, answer);
  }
  interrupt(projectId: string, taskId: string): Promise<void> {
    return this.engine.messages.interrupt(projectId, taskId, true);
  }
  park(projectId: string, taskId: string, status: ParkedTaskStatus, requestId?: string) {
    return parkTask(this.engine, projectId, taskId, status, undefined, requestId);
  }
  clearChat(projectId: string, taskId: string): Promise<void> {
    return clearTaskChat(this.engine, projectId, taskId);
  }
  cancel(projectId: string, taskId: string): Promise<void> {
    return this.engine.scheduling.cancel(projectId, taskId);
  }
  stages(projectId: string): Promise<StageInfo[]> {
    return this.engine.stages.list(projectId);
  }
  runStage(projectId: string, stageId: string, message: string): Promise<void> {
    return this.reported(stageId, this.engine.stages.start(projectId, stageId, message));
  }
  stopStage(projectId: string, stageId: string): Promise<void> {
    return this.engine.stages.stop(projectId, stageId);
  }
  /** The plan shows no error of its stage buttons: a refusal comes as the usual notification. */
  private async reported(stageId: string, action: Promise<void>): Promise<void> {
    try {
      await action;
    } catch (error) {
      this.engine.deps.notify?.('error', `${stageId}: ${errorText(error)}`);
      throw error;
    }
  }
  mergeFromBoard(projectId: string, taskId: string): Promise<'merged' | 'open'> {
    return this.engine.mergeActions.mergeFromBoard(projectId, taskId);
  }
  stopBackground(projectId: string, taskId: string, backgroundId: string): Promise<void> {
    return this.engine.messages.stopBackground(projectId, taskId, backgroundId);
  }
  mergeTask(args: MergeTaskArgs, scope: SkaroScope): Promise<ToolResult> {
    if (scope.kind === 'project_chat') return this.engine.results.mergeTask(args, scope);
    return taskTool(this.engine, scope, () => this.engine.results.mergeTask(args, scope));
  }
  operationNotice(project: string, task: string, text: string, error: boolean): Promise<void> {
    return this.engine.history.operationNotice(project, task, text, error);
  }
  submitResult(args: SubmitResultArgs, scope: SkaroScope): Promise<ToolResult> {
    return submitTaskResult(this.engine, args, scope);
  }
  reportBlocker(
    reason: string,
    scope: SkaroScope,
    details?: import('@skaro/mcp-server').TaskBlockerDetails,
    operationId?: string,
  ): Promise<ToolResult> {
    return reportTaskBlocker(this.engine, reason, scope, details, operationId);
  }
  resumeTask(commandId: string, instruction: string, scope: SkaroScope): Promise<ToolResult> {
    return taskTool(this.engine, scope, () =>
      resumeTaskFromInstruction(this.engine, scope, commandId, instruction),
    );
  }
  requestSecret(questions: import('@skaro/mcp-server').SecretQuestion[], scope: SkaroScope) {
    return requestTaskSecret(this.engine, questions, scope);
  }
  startEnvironment(scope: SkaroScope): Promise<ToolResult> {
    if (scope.kind === 'integration') return this.engine.integrations.environment(scope);
    return taskTool(this.engine, scope, () => startTaskEnvironment(this.engine, scope));
  }

  configureEnvironment(args: ConfigureEnvironmentArgs, scope: SkaroScope): Promise<ToolResult> {
    if (scope.kind === 'integration') return this.engine.integrations.environment(scope, args);
    return taskTool(this.engine, scope, () => configureTaskEnvironment(this.engine, args, scope));
  }

  recoverCoordination() {
    return recoverCoordinatorIncidents(this.engine);
  }
  decisionSources(projectId: string, only?: string) {
    return taskDecisionSources(this.engine, projectId, only);
  }
  readHistory(args: HistoryArgs, scope: SkaroScope): Promise<ToolResult> {
    return readTaskHistory(this.engine, args, scope);
  }

  verifyIntegration(
    checks: import('@skaro/mcp-server').IntegrationCheck[],
    scope: SkaroScope,
  ): Promise<ToolResult> {
    return this.engine.integrations.verify(checks, scope);
  }
  /** After a start of the app: Docker may have brought every old environment back. */
  limitEnvironments(): void {
    this.engine.limitEnvironments();
  }
  merge(
    projectId: string,
    taskId: string,
    interactionId: string,
    action: MergeAction,
  ): Promise<void> {
    return trackRun(this.engine.requireActive(projectId, taskId), () =>
      this.engine.mergeActions.merge(projectId, taskId, interactionId, action),
    );
  }
  close(): Promise<void> {
    return this.engine.sessions.close();
  }
}
