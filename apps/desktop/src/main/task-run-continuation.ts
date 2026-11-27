import { c4Hash, git, type Task } from '@skaro/core';
import { TaskExecution } from './task-execution';
import type { TaskRunEngine } from './task-run-engine';
import type { ActiveRun } from './task-run-model';
import { awaitsDecision } from './task-wait-card';
import { taskC4WaitPolicy } from './c4-package-policy';
import { key } from './task-run-helpers';
import { c4ChangeHash } from './c4-fingerprint';
import { checkoutKey } from './task-stage';
import type { EnvironmentRecord } from './task-environment-registry';
import type { MessageInput } from '../shared/ipc';
import { OWNER_PERMISSION_INSTRUCTIONS } from './agent-interaction-instructions';
import { incidentDiagnosisCurrent } from './incident-model-diagnosis';
import { handoffStalledMerge } from './task-merge-conflict-recovery';
import { CompletionStore } from './completion-store';
import { taskAcceptanceNote } from './task-acceptance-report';

const CONTINUE =
  'Continue the authorized task to its verified result. The preceding model turn ended, ' +
  'but Skaro has not accepted the task result. Do not ask the owner to say continue. ' +
  'Read the actual remaining criteria and tool results, complete implementation and affected ' +
  'verification, then call submit_result. Resolve routine setup with Skaro tools. ' +
  'For a genuinely missing owner decision, invoke the blocking question tool and act on its answer. ' +
  OWNER_PERMISSION_INSTRUCTIONS +
  ' ' +
  'For required owner credentials, call Skaro request_secret and wait for its protected answer; ' +
  'do not report the missing key as an external blocker before offering that input. ' +
  'If an external prerequisite really cannot be recovered within the authorized project setup, ' +
  'call report_task_blocker with the exact evidence; do not invent a question or claim completion. ' +
  'Explicit owner restrictions and stop requests still apply. Never waive unmet criteria.';

/** Continue an authorized task, rather than treating every model final answer as task completion. */
export class TaskRunContinuation {
  private readonly ctx: TaskRunEngine;
  constructor(ctx: TaskRunEngine) {
    this.ctx = ctx;
  }
  execution(active: ActiveRun): TaskExecution {
    return new TaskExecution(this.ctx.deps.db, active.run.id);
  }
  canDeliver(active: ActiveRun, input: MessageInput): boolean {
    if (input.internal && input.commandId?.startsWith('diagnose-incident-'))
      return (
        !this.ctx.closing && incidentDiagnosisCurrent(this.ctx, active.run.id, input.commandId)
      );
    if (!input.internal || !input.commandId?.startsWith('continue-')) return true;
    const intent = this.execution(active);
    if (
      input.commandId.startsWith('continue-c4-decision-') &&
      !input.commandId.endsWith(`-${intent.intentVersion()}`)
    )
      return false;
    const execution = intent.read();
    return !this.ctx.closing && execution.enabled && !execution.blocked;
  }
  stop(projectId: string, taskId: string): void {
    const run =
      this.ctx.active.get(key(projectId, taskId))?.run ??
      this.ctx.deps.db.listRuns(projectId, taskId)[0];
    if (run) new TaskExecution(this.ctx.deps.db, run.id).stop();
  }
  block(active: ActiveRun, reason: string): void {
    this.execution(active).block(reason);
    this.ctx.history.notice(active, 'other', 'error', reason);
  }
  async recover(projectId: string, task: Task): Promise<boolean> {
    if (this.ctx.closing || task.status !== 'in_progress' || task.archived) return false;
    const run = this.ctx.deps.db.listRuns(projectId, task.id)[0];
    if (!run) return false;
    const execution = new TaskExecution(this.ctx.deps.db, run.id).read();
    if (!execution.enabled || execution.blocked) return false;
    const active = await this.ctx.history.restore(projectId, task.id);
    if (
      !active ||
      active.switching ||
      active.timeline.state.turns.at(-1)?.outcome === 'failed' ||
      active.timeline.state.status !== 'idle' ||
      active.timeline.state.interactions.some((interaction) => interaction.kind !== 'merge') ||
      awaitsDecision(active.timeline.state, taskC4WaitPolicy(this.ctx.deps.db, projectId, run.id))
    )
      return true;
    await this.ctx.scheduling.enqueue(projectId, task.id, {
      internal: true,
      commandId: `continue-recovery-${run.id}-${active.segments}`,
      text:
        'Skaro restarted while this authorized task was incomplete. Inspect the actual checkout, ' +
        'last command and saved decisions before continuing; an interrupted command may have partly run. ' +
        'Unanswered questions are not consent. ' +
        CONTINUE,
    });
    return true;
  }
  async afterTurn(active: ActiveRun, task: Task): Promise<boolean> {
    const execution = this.execution(active);
    if (!execution.read().enabled || task.status !== 'in_progress' || this.ctx.closing)
      return false;
    const state = active.timeline.state;
    const blocksC4 = taskC4WaitPolicy(this.ctx.deps.db, active.projectId, active.run.id);
    const turn = state.turns.at(-1);
    if (!turn || turn.outcome !== 'done') return false;
    const available = () =>
      !this.ctx.closing &&
      !active.switching &&
      this.ctx.active.get(key(active.projectId, active.taskId)) === active &&
      state.turns.at(-1)?.id === turn.id &&
      state.status === 'idle' &&
      !state.interactions.some((interaction) => interaction.kind !== 'merge') &&
      !awaitsDecision(state, blocksC4) &&
      !this.ctx.queuedInputs.get(key(active.projectId, active.taskId))?.length &&
      !this.ctx.startup.read(active.projectId, active.taskId)?.inputs.length;
    if (!available()) return true;
    if (execution.read().blocked) {
      this.ctx.setRuntime(active.projectId, active.taskId, 'failed', active.run.id);
      return true;
    }
    const context = this.ctx.project(active.projectId);
    const artifacts = await context.load();
    const cwd = active.run.worktree ?? context.root;
    const head = (await git(cwd, ['rev-parse', 'HEAD'])).stdout.trim();
    const changes = await c4ChangeHash(cwd, head);
    const environment = this.ctx.deps.db
      .getSetting<EnvironmentRecord[]>('environments', [])
      .find(
        (record) =>
          record.projectId === active.projectId && record.taskId === checkoutKey(active).taskId,
      );
    const fingerprint = c4Hash(
      JSON.stringify({
        head,
        changes,
        body: task.body,
        architecture: artifacts.c4?.revision,
        environment: environment && {
          created: environment.created,
          source: environment.source,
          start: environment.start,
        },
      }),
    );
    if (!available() || !execution.read().enabled) return true;
    const next = execution.next(turn.id, fingerprint);
    if (next === 'duplicate') return true;
    if (next === 'stalled') {
      if (await handoffStalledMerge(this.ctx, active, task)) return true;
      if (!execution.read().enabled) return true;
      if (this.ctx.deps.coordinators) {
        const conflict = new CompletionStore(this.ctx.deps.db, active.projectId)
          .conflicts()
          .includes(active.taskId);
        const incident = await this.ctx.incidents.report(
          active,
          conflict
            ? 'The first Git conflict resolution stalled in the task checkout'
            : 'Repeated completion without progress',
          {
            cause: 'no-progress',
            code: conflict ? 'merge_conflict_stalled' : 'no_progress',
            condition: 'owner-evidence',
          },
          'controller',
        );
        await this.ctx.incidents.reconcile(active.projectId, incident.id);
        return true;
      }
      this.block(
        active,
        'Агент повторно завершил работу без результата и без изменений. Автопродолжение остановлено, чтобы не расходовать лимит впустую.',
      );
      this.ctx.setRuntime(active.projectId, active.taskId, 'failed', active.run.id);
      return true;
    }
    await this.ctx.scheduling.enqueue(active.projectId, active.taskId, {
      text: CONTINUE + taskAcceptanceNote(this.ctx.deps.db, active.run.id, task),
      internal: true,
      commandId: `continue-${active.run.id}-${turn.id}`,
    });
    return true;
  }
}
