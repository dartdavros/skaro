import { recoverCoordinatorIncidents } from './coordinator-recovery';
import { type ProjectArtifacts, type Task } from '@skaro/core';
import type { MergeTaskArgs, SubmitResultArgs, SkaroScope, ToolResult } from '@skaro/mcp-server';
import { type InteractionAnswer, type Item } from '@skaro/timeline';
import type {
  AgentSettings,
  MergeAction,
  MessageInput,
  RunSlots,
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
import { serializeTaskMutation } from './project-task-mutations';
import { TaskRunEngine } from './task-run-engine';
import { TaskCatalogService } from './task-catalog-service';
import { errorText } from './session-log';
import { startTaskEnvironment } from './task-environment-tool';
import { clearTaskChat } from './task-clear';
import { configureTaskEnvironment } from './task-environment-config-tool';
import type { ConfigureEnvironmentArgs } from '@skaro/mcp-server';
import type { ProcessAdmissionPort } from '@skaro/timeline';
import { builtinAcceptancePort } from './builtin-acceptance';
import { builtinTaskAdmission } from './builtin-task-admission';
import { submitTaskResult } from './task-submit';
import { taskArchitectureEvent } from './task-architecture-events';
import { requestTaskSecret } from './task-secret-input';
import { resumeTaskExecution } from './task-resume';
import { prepareBuiltinTaskReview } from './builtin-task-review';
import type { BuiltinTaskLaunchRequest, BuiltinTaskHandoffRequest } from './builtin-task-start';
export { ActiveRun, type TaskRunDeps } from './task-run-model';
export { requirementsOf } from './task-run-helpers';

/** Public API: composes focused task-run services without owning their workflows. */
export class TaskRuns {
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
  constructor(deps: TaskRunDeps, slots = 3) {
    this.engine = new TaskRunEngine(deps, slots);
    this.catalog = new TaskCatalogService(this.engine);
  }
  list(projectId: string): Promise<TaskSummary[]> {
    return this.engine.views.list(projectId);
  }
  slots(): RunSlots {
    return this.engine.scheduling.slots();
  }
  publicationAgents(): number {
    return this.engine.integrations.publicationAgents();
  }
  setSlots(slots: number): void {
    return this.engine.scheduling.setSlots(slots);
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
    return serializeTaskMutation(this.engine.project(projectId), () =>
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
    return this.engine.messages.interrupt(projectId, taskId);
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
  async operationNotice(
    projectId: string,
    taskId: string,
    text: string,
    error: boolean,
  ): Promise<void> {
    const active = await this.engine.history.restore(projectId, taskId);
    if (active) this.engine.history.notice(active, 'other', error ? 'error' : 'info', text);
  }
  submitResult(args: SubmitResultArgs, scope: SkaroScope): Promise<ToolResult> {
    return submitTaskResult(this.engine, args, scope);
  }
  reportBlocker(
    reason: string,
    scope: SkaroScope,
    details?: import('@skaro/mcp-server').TaskBlockerDetails,
  ): Promise<ToolResult> {
    return taskTool(this.engine, scope, async () => {
      const active = this.engine.requireActive(scope.projectId, scope.taskId!);
      if (this.engine.deps.coordinators)
        await this.engine.incidents.report(active, reason, details);
      else this.engine.continuation.block(active, reason);
      return {
        text: 'The external blocker is recorded. The task remains incomplete; automatic continuation is suspended. Report the precise blocker without asking for a generic continue message.',
      };
    });
  }
  resumeTask(commandId: string, instruction: string, scope: SkaroScope): Promise<ToolResult> {
    return taskTool(this.engine, scope, async () => {
      const active = this.engine.requireActive(scope.projectId, scope.taskId!);
      const task = await this.engine.project(scope.projectId).load();
      if (!task.tasks.some((task) => task.id === scope.taskId && task.status === 'in_progress'))
        return { text: 'Only an in-progress task can resume execution.', isError: true };
      return resumeTaskExecution(
        this.engine.continuation.execution(active),
        active.timeline.state,
        commandId,
        instruction,
      );
    });
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
