import { projectRecords } from './project-records';
import type { TaskRuntime } from '@skaro/core';
import { assertQuestionsAnswered } from '@skaro/timeline';
import type {
  ConfigureEnvironmentArgs,
  IntegrationCheck,
  SkaroScope,
  ToolResult,
} from '@skaro/mcp-server';
import { IntegrationStore } from './integration-store';
import { IntegrationService } from './integration-service';
import { IntegrationHistory } from './integration-history';
import {
  integrationQueueKey,
  integrationEnvironmentKey,
  integrationParticipants,
  type IntegrationOperation,
} from './integration-model';
import type { ResolverSession } from './integration-worker';
import { executeIntegration } from './integration-execution';
import type { TaskRunEngine } from './task-run-engine';
import { errorText } from './session-log';
import { IntegrationControls } from './integration-controls';
import { recoverIntegrations } from './integration-resume';
import { randomUUID } from 'node:crypto';

/** Connects the integration protocol to task scheduling, permissions, environments and recovery. */
export class TaskIntegrations {
  readonly store: IntegrationStore;
  readonly service: IntegrationService;
  readonly history: IntegrationHistory;
  private readonly sessions = new Map<string, ResolverSession>();
  readonly controls: IntegrationControls;
  private closed = false;
  private readonly executions = new Set<Promise<void>>();
  private readonly operations = new Map<string, IntegrationOperation>();
  private readonly interrupted = new Set<string>();
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
    this.controls = new IntegrationControls(ctx, this.sessions);
    this.store = new IntegrationStore(ctx.deps.db, ctx.deps.dataDir);
    this.history = new IntegrationHistory(
      this.store,
      (p, t) => ctx.changed(p, t),
      (batch) => ctx.deps.emit('integration.events', batch),
    );
    this.service = new IntegrationService({
      store: this.store,
      project: (id) => ctx.project(id),
      pending: (op) => this.enqueue(op),
      changed: (op) => {
        for (const taskId of integrationParticipants(op)) ctx.changed(op.projectId, taskId);
      },
      processStarted: async (op, pid) => {
        await ctx.processes.startedAsync(`verification-${op.id}`, pid, true);
        this.assertExecuting(op);
      },
      stopProcesses: (op) => ctx.processes.stop(`verification-${op.id}`),
    });
  }

  enqueue(op: IntegrationOperation): void {
    if (!this.closed) this.ctx.queue.enqueue([integrationQueueKey(op)]);
  }

  /**
   * What an integration does shows on its task only while the task is being prepared. A merge
   * works on accepted results: the tasks stay in review, the stage reads the progress and the
   * failure from the operation (stage-views). Only a question in the chat makes its task wait.
   */
  setRuntime(op: IntegrationOperation, state: TaskRuntime): void {
    if (op.purpose !== 'publication' || state === 'waiting') {
      this.ctx.setRuntime(op.projectId, op.taskId, state);
      return;
    }
    const own = this.ctx.active.get(`${op.projectId}\n${op.taskId}`);
    if (own) this.ctx.events.settleRuntime(own);
    else this.ctx.setRuntime(op.projectId, op.taskId, 'idle');
    this.ctx.deps.emit('project.changed', { projectId: op.projectId });
  }

  operation(queueKey: string): IntegrationOperation | undefined {
    const [project, id] = queueKey.split('\n');
    return id?.startsWith('@integration:') ? this.store.find(project!, id.slice(13)) : undefined;
  }

  publicationAgents(): number {
    return [...this.sessions.values()].filter(
      ({ operation }) => operation.purpose === 'publication' && operation.state !== 'waiting',
    ).length;
  }

  blocked(op: IntegrationOperation): boolean {
    const owner = `${op.projectId}\n${op.taskId}`;
    const active = this.ctx.active.get(owner);
    return (
      this.ctx.queue.state().running.includes(owner) ||
      op.results.some(
        (result) =>
          this.ctx.active.get(`${op.projectId}\n${result.taskId}`)?.timeline.state.status ===
          'working',
      ) ||
      !!active?.switching ||
      active?.timeline.state.status === 'working'
    );
  }

  ownsTask(projectId: string, taskId: string): boolean {
    return this.store
      .all(projectId)
      .some(
        (op) =>
          (op.executor ||
            ['preparing', 'resolving', 'verifying', 'paused', 'waiting'].includes(op.state)) &&
          (op.taskId === taskId || op.results.some((result) => result.taskId === taskId)),
      );
  }

  get closing(): boolean {
    return this.closed;
  }

  executing(id: string): IntegrationOperation | undefined {
    return this.operations.get(id);
  }

  assertExecuting(op: IntegrationOperation): void {
    if (this.closed || this.interrupted.has(op.id) || op.state === 'paused' || !op.executor)
      throw new Error('Integration execution was interrupted.');
  }

  pause(op: IntegrationOperation): void {
    this.interrupted.add(op.id);
    op.state = 'paused';
    this.service.save(op);
  }

  wasInterrupted(id: string): boolean {
    return this.interrupted.has(id);
  }

  session(id: string, value?: ResolverSession): void {
    if (value) this.sessions.set(id, value);
    else this.sessions.delete(id);
  }

  run(op: IntegrationOperation): Promise<void> {
    if (
      this.closed ||
      this.operations.has(op.id) ||
      !['preparing', 'resolving', 'verifying', 'ready'].includes(op.state)
    )
      return Promise.resolve();
    op.executor = randomUUID();
    this.interrupted.delete(op.id);
    this.operations.set(op.id, op);
    this.service.save(op);
    const execution = executeIntegration(this.ctx, op).finally(() => {
      // Publication releases this lease before updating the operation to applied.
      // Do not overwrite that later checkpoint with the executor's old ready snapshot.
      if (op.executor || this.interrupted.has(op.id)) {
        op.executor = undefined;
        if (this.interrupted.has(op.id)) op.state = 'paused';
        this.service.save(op);
      }
      this.operations.delete(op.id);
      this.interrupted.delete(op.id);
      this.executions.delete(execution);
      this.ctx.queue.poke();
    });
    this.executions.add(execution);
    return execution;
  }
  private admitted(scope: SkaroScope): ResolverSession {
    const session = scope.integrationId && this.sessions.get(scope.integrationId);
    if (
      !session ||
      scope.kind !== 'integration' ||
      session.worker !== scope.runId ||
      session.operation.projectId !== scope.projectId ||
      session.operation.taskId !== scope.taskId ||
      session.operation.state === 'paused' ||
      this.closed
    )
      throw new Error('This integration session is no longer its current worker.');
    return session;
  }

  async verify(checks: IntegrationCheck[], scope: SkaroScope): Promise<ToolResult> {
    try {
      const { operation: op } = this.admitted(scope);
      assertQuestionsAnswered((await this.history.state(op)).state);
      await this.service.serial(op.id, () => {
        this.assertExecuting(op);
        return this.service.verify(
          op,
          checks,
          // Shell variables are the same variables used by the managed candidate services.
          this.environmentVariables(op),
        );
      });
      return {
        text: 'The integration candidate passed its checks. End this turn; Skaro will continue automatically.',
      };
    } catch (error) {
      return { text: errorText(error), isError: true };
    }
  }

  private environmentVariables(op: IntegrationOperation): Record<string, string> {
    return this.ctx.deps.db.getSetting(`integration.${op.id}.env`, {});
  }

  async environment(scope: SkaroScope, args?: ConfigureEnvironmentArgs): Promise<ToolResult> {
    try {
      const { operation: op } = this.admitted(scope);
      assertQuestionsAnswered((await this.history.state(op)).state);
      const key = integrationEnvironmentKey(op);
      const description = await this.ctx.environments.describe(key);
      this.assertExecuting(op);
      this.ctx.deps.db.setSetting(`integration.${op.id}.env`, description.variables);
      if (args) return { text: JSON.stringify(await this.ctx.environments.configure(key, args)) };
      return { text: JSON.stringify(await this.ctx.environments.start(key)) };
    } catch (error) {
      return { text: errorText(error), isError: true };
    }
  }

  recover(): Promise<void> {
    return recoverIntegrations(this.ctx);
  }

  async close(): Promise<void> {
    this.closed = true;
    for (const op of this.operations.values()) {
      await this.ctx.processes.stop(`verification-${op.id}`);
      this.service.interrupt(op.id);
      if (op.worker) await this.ctx.processes.stop(op.worker);
      await this.sessions.get(op.id)?.session.close();
      await this.service.serial(op.id, async () => undefined);
    }
    await Promise.allSettled(this.executions);
    for await (const project of projectRecords(this.ctx.deps.db))
      for (const op of this.store.all(project.id)) await this.history.close(op);
  }
}
