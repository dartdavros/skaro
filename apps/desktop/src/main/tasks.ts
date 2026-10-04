import { type ProjectArtifacts, type Task } from '@skaro/core';
import type { MergeTaskArgs, SubmitResultArgs, SkaroScope, ToolResult } from '@skaro/mcp-server';
import { type InteractionAnswer } from '@skaro/timeline';
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
import { TaskRunEngine } from './task-run-engine';
import { startTaskEnvironment } from './task-environment-tool';
export { ActiveRun, type TaskRunDeps } from './task-run-model';
export { requirementsOf } from './task-run-helpers';

/** Public API: composes focused task-run services without owning their workflows. */
export class TaskRuns {
  revertMerge(projectId: string, taskId: string, commit: string): Promise<void> {
    return this.engine.mergeActions.revert(projectId, taskId, commit);
  }
  private readonly engine: TaskRunEngine;
  constructor(deps: TaskRunDeps, slots = 3) {
    this.engine = new TaskRunEngine(deps, slots);
  }
  list(projectId: string): Promise<TaskSummary[]> {
    return this.engine.views.list(projectId);
  }
  slots(): RunSlots {
    return this.engine.scheduling.slots();
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
    return this.engine.views.assign(projectId, taskId, assignment);
  }
  forget(projectId: string, taskId: string): Promise<void> {
    return this.engine.sessions.forget(projectId, taskId);
  }
  open(projectId: string, taskId: string): Promise<TaskView> {
    return this.engine.views.open(projectId, taskId);
  }
  workdir(projectId: string, taskId: string): string {
    return this.engine.views.workdir(projectId, taskId);
  }
  toggleCriterion(projectId: string, taskId: string, index: number): Promise<void> {
    return this.engine.views.toggleCriterion(projectId, taskId, index);
  }
  settings(projectId: string, task: Task, artifacts: ProjectArtifacts): AgentSettings {
    return this.engine.views.settings(projectId, task, artifacts);
  }
  setSettings(projectId: string, taskId: string, next: AgentSettings): Promise<void> {
    return this.engine.views.setSettings(projectId, taskId, next);
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
  cancel(projectId: string, taskId: string): Promise<void> {
    return this.engine.scheduling.cancel(projectId, taskId);
  }
  stages(projectId: string): Promise<StageInfo[]> {
    return this.engine.stages.list(projectId);
  }
  runStage(projectId: string, stageId: string, message: string): Promise<void> {
    return this.engine.stages.start(projectId, stageId, message);
  }
  stopStage(projectId: string, stageId: string): Promise<void> {
    return this.engine.stages.stop(projectId, stageId);
  }
  /** «Влить готовое» of a stage: shows the card in the feed of the stage. */
  mergeFinished(projectId: string, stageId: string): Promise<void> {
    return this.engine.stages.mergeFinished(projectId, stageId);
  }
  mergeFromBoard(projectId: string, taskId: string): Promise<'merged' | 'open'> {
    return this.engine.mergeActions.mergeFromBoard(projectId, taskId);
  }
  stopBackground(projectId: string, taskId: string, backgroundId: string): Promise<void> {
    return this.engine.messages.stopBackground(projectId, taskId, backgroundId);
  }
  mergeTask(args: MergeTaskArgs, scope: SkaroScope): Promise<ToolResult> {
    return this.engine.results.mergeTask(args, scope);
  }
  submitResult(args: SubmitResultArgs, scope: SkaroScope): Promise<ToolResult> {
    return this.engine.results.submitResult(args, scope);
  }
  startEnvironment(scope: SkaroScope): Promise<ToolResult> {
    return startTaskEnvironment(this.engine, scope);
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
    return this.engine.mergeActions.merge(projectId, taskId, interactionId, action);
  }
  close(): Promise<void> {
    return this.engine.sessions.close();
  }
}
