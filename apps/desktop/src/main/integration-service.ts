import { git } from '@skaro/core';
import {
  IntegrationFailed,
  IntegrationPending,
  type IntegrationOperation,
  type IntegrationRequest,
} from './integration-model';
import { IntegrationStore, integrationFingerprint } from './integration-store';
import { admitIntegration, commitIntegration, mergeHead, unmergedFiles } from './integration-git';
import type { ProjectContext } from './projects';
import { affectedBaseResults } from './integration-inputs';
import { integrationChecks, reviseIntegrationChecks } from './integration-checks';
import { runIntegrationChecks } from './integration-check-runner';
import type { IntegrationCheck } from '@skaro/mcp-server';
import type { Item } from '@skaro/timeline';
import { integrationHeads, checkpointLocalLayers } from './integration-local-changes';

export interface IntegrationDeps {
  store: IntegrationStore;
  project: (id: string) => ProjectContext;
  pending: (op: IntegrationOperation) => void;
  changed: (op: IntegrationOperation) => void;
  processStarted?: (op: IntegrationOperation, pid: number) => void | Promise<void>;
  stopProcesses?: (op: IntegrationOperation) => Promise<void>;
  /** A check row for the candidate feed: started, live output, finished. */
  checkChanged?: (op: IntegrationOperation, item: Item) => void;
}

/** The same recoverable integration protocol prepares dependencies and publication candidates. */
export class IntegrationService {
  private readonly pending = new Map<string, Promise<unknown>>();
  private readonly cancellations = new Map<string, AbortController>();
  readonly deps: IntegrationDeps;
  constructor(deps: IntegrationDeps) {
    this.deps = deps;
  }

  interrupt(id: string): void {
    this.cancellations.get(id)?.abort();
  }

  async serial<T>(id: string, action: () => Promise<T>): Promise<T> {
    const next = (this.pending.get(id) ?? Promise.resolve()).catch(() => undefined).then(action);
    this.pending.set(id, next);
    try {
      return await next;
    } finally {
      if (this.pending.get(id) === next) this.pending.delete(id);
    }
  }

  async prepare(request: IntegrationRequest): Promise<IntegrationOperation> {
    return this.serial(`${request.projectId}:${request.taskId}:${request.purpose}`, async () => {
      const context = this.deps.project(request.projectId);
      const baseHead = await context.git.head(request.base);
      const fingerprint = integrationFingerprint(request, baseHead);
      const writer = this.deps.store
        .all(request.projectId)
        .find(
          (item) =>
            item.taskId === request.taskId &&
            item.purpose === request.purpose &&
            (item.worker || item.executor),
        );
      if (writer) {
        if (request.publish) {
          this.deps.store.publish(writer, request);
        }
        throw new IntegrationPending(writer);
      }
      let op = this.deps.store
        .all(request.projectId)
        .findLast(
          (item) =>
            item.fingerprint === fingerprint &&
            (!request.localChanges || !['stale', 'applied'].includes(item.state)),
        );
      if (!op) {
        for (const saved of this.deps.store.all(request.projectId))
          if (
            saved.taskId === request.taskId &&
            saved.purpose === request.purpose &&
            !saved.worker &&
            !saved.executor &&
            // A new candidate supersedes every unfinished one of the task, stopped ones included.
            !['applied', 'stale'].includes(saved.state)
          ) {
            saved.state = 'stale';
            this.save(saved);
          }
        op = this.deps.store.create(
          {
            ...request,
            baseResults: await affectedBaseResults(
              context,
              this.deps.store,
              baseHead,
              request.results,
            ),
          },
          baseHead,
        );
      }
      if (request.publish) this.deps.store.publish(op, request);
      if (op.state === 'failed') throw new IntegrationFailed(op);
      // Admission can recover commit checkpoints, so it must never run beside a live writer.
      if (op.worker || op.executor) throw new IntegrationPending(op);
      await admitIntegration(context, op, (op) => this.save(op));
      if (['paused', 'waiting'].includes(op.state)) throw new IntegrationPending(op);
      if (op.state === 'ready') await this.assertReady(op);
      if (!['ready', 'applied'].includes(op.state)) {
        await this.advance(op);
      }
      if (op.state !== 'ready' && op.state !== 'applied') {
        this.deps.pending(op);
        throw new IntegrationPending(op);
      }
      return op;
    });
  }

  async advance(op: IntegrationOperation): Promise<void> {
    await admitIntegration(this.deps.project(op.projectId), op, (op) => this.save(op));
    const pendingHead = await mergeHead(op.worktree);
    if (pendingHead) {
      if (pendingHead !== integrationHeads(op)[op.cursor])
        throw new Error('Unexpected merge input in candidate.');
      op.conflicts = await unmergedFiles(op.worktree);
      if (op.conflicts.length || op.needsVerification) {
        op.state = 'resolving';
        op.needsVerification = true;
        this.save(op);
        return;
      }
      await commitIntegration(op, (op) => this.save(op));
    }
    while (op.cursor < integrationHeads(op).length) {
      const head = integrationHeads(op)[op.cursor]!;
      const present = await git(op.worktree, ['merge-base', '--is-ancestor', head, 'HEAD'], {
        allowFail: true,
      });
      if (present.code !== 0) {
        const merged = await git(op.worktree, ['merge', '--no-ff', '--no-commit', head], {
          allowFail: true,
        });
        if (await mergeHead(op.worktree))
          await git(op.worktree, [
            'restore',
            `--source=${op.baseHead}`,
            '--staged',
            '--worktree',
            '--',
            '.skaro',
          ]);
        if (merged.code !== 0) {
          op.conflicts = await unmergedFiles(op.worktree);
          if (op.conflicts.length) {
            op.state = 'resolving';
            op.needsVerification = true;
            this.save(op);
            return;
          }
          if (!(await mergeHead(op.worktree))) throw new Error(merged.stderr || merged.stdout);
        }
        await commitIntegration(op, (op) => this.save(op));
        continue;
      }
      op.head = (await git(op.worktree, ['rev-parse', 'HEAD'])).stdout.trim();
      op.cursor++;
      this.save(op);
      await git(op.worktree, ['update-ref', `refs/skaro/integrations/${op.id}`, op.head]);
    }
    op.state = op.needsVerification || integrationChecks(op).length ? 'verifying' : 'ready';
    this.save(op);
  }

  async verify(
    op: IntegrationOperation,
    checks: IntegrationCheck[],
    env: Record<string, string>,
  ): Promise<void> {
    // A rejected revision is the caller's mistake: the candidate and its recorded failure stay.
    const revised = reviseIntegrationChecks(op, checks);
    try {
      await this.verifyCandidate(op, revised, env);
    } catch (error) {
      op.error = error instanceof Error ? error.message : String(error);
      if (op.state !== 'paused') op.state = 'resolving';
      op.needsVerification = true;
      this.save(op);
      throw error;
    }
  }

  private async verifyCandidate(
    op: IntegrationOperation,
    revised: ReturnType<typeof reviseIntegrationChecks>,
    env: Record<string, string>,
  ): Promise<void> {
    op.checkReplacements = revised.replacements;
    op.verificationPlan = revised.plan;
    op.verification = undefined;
    this.save(op);
    const context = this.deps.project(op.projectId);
    await admitIntegration(context, op, (op) => this.save(op));
    const pendingHead = await mergeHead(op.worktree);
    if (pendingHead && pendingHead !== integrationHeads(op)[op.cursor])
      throw new Error('Unexpected merge input in candidate.');
    op.head = await commitIntegration(op, (op) => this.save(op));
    this.save(op);
    await this.advance(op);
    if (op.state === 'resolving')
      throw new Error(`Resolve the next conflict: ${op.conflicts.join(', ')}`);
    const plan = integrationChecks(op);
    if (!plan.length)
      throw new Error('Provide the real build and affected behavior checks for both inputs.');
    op.state = 'verifying';
    op.error = undefined;
    op.verificationPlan = plan;
    this.save(op);
    const tree = (await git(op.worktree, ['rev-parse', 'HEAD^{tree}'])).stdout.trim();
    op.checkRuns ??= [];
    const cancellation = new AbortController();
    this.cancellations.set(op.id, cancellation);
    try {
      await runIntegrationChecks(op, plan, env, cancellation, this.deps, (value) =>
        this.save(value),
      );
    } finally {
      this.cancellations.delete(op.id);
    }
    if ((await git(op.worktree, ['rev-parse', 'HEAD^{tree}'])).stdout.trim() !== tree)
      throw new Error('Candidate tree changed during verification.');
    if (
      cancellation.signal.aborted ||
      this.deps.store.find(op.projectId, op.id)?.state === 'paused'
    )
      throw new Error('Integration verification was interrupted.');
    op.verification = { head: op.head, checks: plan, completedAt: Date.now() };
    op.state = 'ready';
    op.error = undefined;
    this.save(op);
    await git(op.worktree, ['update-ref', `refs/skaro/integrations/${op.id}`, op.head]);
  }

  save(op: IntegrationOperation): void {
    checkpointLocalLayers(op);
    this.deps.store.save(op);
    this.deps.changed(op);
  }

  async assertReady(op: IntegrationOperation): Promise<void> {
    await admitIntegration(this.deps.project(op.projectId), op, (value) => this.save(value));
    if ((op.needsVerification || integrationChecks(op).length) && op.verification?.head !== op.head)
      throw new Error('Integration has no checks for its current commit.');
    if ((await git(op.worktree, ['status', '--porcelain', '--untracked-files=no'])).stdout.trim())
      throw new Error('The candidate changed after verification; verify the new resolution.');
  }
}
