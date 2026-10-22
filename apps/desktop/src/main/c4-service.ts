import { dirname } from 'node:path';
import { background } from './background/client';
import { git, type C4Package, type AppDb } from '@skaro/core';
import type {
  C4Handlers,
  ProposeC4Args,
  ReviewC4Args,
  SkaroScope,
  ToolResult,
} from '@skaro/mcp-server';
import type { Item } from '@skaro/timeline';
import type { Projects } from './projects';
import {
  c4ArchitectureHash,
  c4ChangeHash,
  c4CoverageProblems,
  c4ReviewKey,
  type C4TaskReview,
} from './c4-review';
import { readTaskC4Scope, reviewedC4Ids } from './c4-task-scope';

type ProposalItem = Extract<Item, { kind: 'proposal' }>;
export interface C4ProposalRecord {
  scope: SkaroScope;
  package: C4Package;
  item: ProposalItem;
  fileIndex?: { path: string; beforeHash: string | null; afterHash: string }[];
}
interface Deps {
  db: AppDb;
  projects: Projects;
  locale(): string;
  publish(scope: SkaroScope, item: ProposalItem): Promise<void>;
  changed(projectId: string): void;
  stageImport(args: ProposeC4Args, scope: SkaroScope): Promise<ToolResult>;
  assertMayWork?(scope: SkaroScope): void;
}

export class C4Service implements C4Handlers {
  private readonly deps: Deps;
  private readonly deciding = new Map<string, Promise<void>>();
  constructor(deps: Deps) {
    this.deps = deps;
  }
  private get dataDir(): string {
    return dirname(this.deps.db.filePath);
  }
  records(projectId: string, ownerId?: string): Promise<C4ProposalRecord[]> {
    return background(this.dataDir, 'c4.list', projectId, ownerId);
  }
  private save(record: C4ProposalRecord): Promise<void> {
    return background(this.dataDir, 'c4.save', record);
  }
  content(projectId: string, itemId: string, side: 'before' | 'after'): Promise<string> {
    return background(this.dataDir, 'c4.content', projectId, itemId, side);
  }
  files(projectId: string, itemId: string): Promise<string[]> {
    return background(this.dataDir, 'c4.files', projectId, itemId);
  }
  file(projectId: string, itemId: string, path: string, side: 'before' | 'after'): Promise<string> {
    return background(this.dataDir, 'c4.file', projectId, itemId, path, side);
  }
  reviewPackage(projectId: string, itemId: string) {
    return background(this.dataDir, 'c4.review', projectId, itemId);
  }
  reviewDetail(projectId: string, itemId: string, key: string) {
    return background(this.dataDir, 'c4.reviewDetail', projectId, itemId, key);
  }
  reviewModel(projectId: string, itemId: string, side: 'before' | 'after') {
    return background(this.dataDir, 'c4.reviewModel', projectId, itemId, side);
  }
  private caller(scope: SkaroScope): string {
    this.deps.assertMayWork?.(scope);
    const context = this.deps.projects.get(scope.projectId);
    if (scope.kind === 'task') {
      const run = scope.runId ? this.deps.db.getRun(scope.runId) : undefined;
      if (
        !run ||
        run.projectId !== scope.projectId ||
        run.taskId !== scope.taskId ||
        run.retiredAt !== undefined ||
        this.deps.db.listRuns(scope.projectId, scope.taskId!)[0]?.id !== run.id
      )
        throw new Error('This task run is no longer current.');
      return run.worktree ?? context.root;
    }
    const chat = scope.chatId ? this.deps.db.getChat(scope.chatId) : undefined;
    if (scope.kind !== 'project_chat' || !chat || chat.projectId !== scope.projectId)
      throw new Error('Invalid C4 chat scope');
    return context.root;
  }
  async context(scope: SkaroScope): Promise<ToolResult> {
    const checkout = this.caller(scope);
    const context = this.deps.projects.get(scope.projectId);
    context.invalidate();
    return background(
      this.dataDir,
      'c4.context',
      context.root,
      this.deps.projects.defaults(),
      scope,
      checkout,
    );
  }
  async propose(args: ProposeC4Args, scope: SkaroScope): Promise<ToolResult> {
    const checkout = this.caller(scope);
    if (scope.importId) return this.deps.stageImport(args, scope);
    const context = this.deps.projects.get(scope.projectId);
    const record = await background(
      this.dataDir,
      'c4.prepare',
      context.root,
      {
        ...args,
        locale: this.deps.locale(),
        codeRoot: checkout,
      },
      scope,
    );
    const item = record.item;
    await this.deps.publish(scope, item);
    const facts = await this.reviewPackage(scope.projectId, item.id);
    return {
      text: JSON.stringify({
        packageId: item.id,
        state: 'pending',
        applied: [],
        documents: facts.documents.map((d) => d.path),
        architecture: facts.model.map((c) => ({
          group: c.group,
          id: c.id,
          operation: c.operation,
          fields: c.fields,
        })),
        generatedDocuments: facts.generated,
        message:
          'Saved for ONE owner decision. Nothing has been applied. Do not propose its documents separately or report them accepted. Read get_c4_context after the owner decides.',
      }),
    };
  }
  async migrate(scope: SkaroScope): Promise<ToolResult> {
    this.caller(scope);
    if (scope.kind !== 'project_chat' || scope.importId)
      throw new Error('Document migration requires a project chat.');
    if (
      (await this.records(scope.projectId)).some((r) =>
        ['pending', 'accepted'].includes(r.item.state),
      )
    )
      throw new Error('Resolve pending architecture packages before migrating document storage.');
    const context = this.deps.projects.get(scope.projectId);
    const record = await background(
      this.dataDir,
      'c4.prepareMigration',
      context.root,
      this.deps.locale(),
      scope,
    );
    if (!record) return { text: 'No embedded C4 copies remain. Nothing changed.' };
    await this.deps.publish(scope, record.item);
    return {
      text: `Migration package ${record.item.id} awaits one owner decision. Nothing has been applied.`,
    };
  }
  decide(
    projectId: string,
    id: string,
    action: 'apply' | 'reject',
    fingerprint?: string,
  ): Promise<void> {
    const previous = this.deciding.get(projectId) ?? Promise.resolve();
    const operation = previous
      .catch(() => undefined)
      .then(() => this.decideOnce(projectId, id, action, fingerprint));
    this.deciding.set(projectId, operation);
    return operation.finally(() => {
      if (this.deciding.get(projectId) === operation) this.deciding.delete(projectId);
    });
  }
  private async decideOnce(
    projectId: string,
    id: string,
    action: 'apply' | 'reject',
    fingerprint?: string,
  ): Promise<void> {
    const record = (await this.records(projectId)).find((r) => r.item.id === id);
    if (!record) throw new Error('Unknown C4 package');
    if (record.item.state === 'applied' && action === 'apply') return;
    if (record.item.state !== 'pending' && record.item.state !== 'accepted')
      throw new Error('This C4 package is already decided');
    if (action === 'apply' && record.item.state === 'pending') {
      const review = await this.reviewPackage(projectId, id);
      if (!fingerprint || fingerprint !== review.fingerprint)
        throw new Error('Open the current architecture package before accepting it.');
    }
    if (action === 'reject' && record.item.state === 'accepted')
      throw new Error(
        'A confirmed package must finish recovery; it cannot be rejected after writing starts.',
      );
    const context = this.deps.projects.get(projectId);
    if (action === 'reject') record.item = { ...record.item, state: 'rejected' };
    else {
      record.item = { ...record.item, state: 'accepted', result: {} };
      await this.save(record);
      await this.deps.publish(record.scope, record.item);
      try {
        await background(this.dataDir, 'c4.apply', context.root, projectId, id);
        record.item = { ...record.item, state: 'applied', result: {} };
      } catch (error) {
        const status = await background(this.dataDir, 'c4.status', context.root, projectId, id);
        record.item = {
          ...record.item,
          state: status === 'applied' ? 'applied' : status === 'writing' ? 'accepted' : 'pending',
          result: { error: String(error) },
        };
        await this.save(record);
        context.invalidate();
        await this.deps.publish(record.scope, record.item);
        throw error;
      }
    }
    await this.save(record);
    context.invalidate();
    this.deps.changed(projectId);
    await this.deps.publish(record.scope, record.item);
  }
  async review(args: ReviewC4Args, scope: SkaroScope): Promise<ToolResult> {
    const checkout = this.caller(scope);
    if (scope.kind !== 'task' || !scope.taskId || !scope.runId)
      throw new Error('C4 code review requires a current task run');
    const context = this.deps.projects.get(scope.projectId);
    this.deps.db.setSetting(c4ReviewKey(scope.projectId, scope.taskId), null);
    context.invalidate();
    const artifacts = await context.load();
    const baseHead = (
      await git(checkout, ['rev-parse', artifacts.config.baseBranch])
    ).stdout.trim();
    const taskScope = await readTaskC4Scope(checkout, baseHead, artifacts, scope.taskId);
    const ids = reviewedC4Ids(taskScope, args, artifacts.c4);
    const reviewedScope = {
      ...taskScope,
      elements: [...ids].filter((id) => artifacts.c4?.elements.some((item) => item.id === id)),
      relationships: [...ids].filter((id) =>
        artifacts.c4?.relationships.some((item) => item.id === id),
      ),
    };
    const problems = c4CoverageProblems(artifacts, scope.taskId, args, taskScope);
    if (args.changeHash !== (await c4ChangeHash(checkout, baseHead)))
      problems.push('Code changed since context was read.');
    if (
      (await this.records(scope.projectId, scope.taskId)).some(
        (r) =>
          r.package.task?.id === scope.taskId && ['pending', 'accepted'].includes(r.item.state),
      )
    )
      problems.push('A required task architecture package is still pending.');
    if (problems.length) return { text: problems.join('\n'), isError: true };
    const review: C4TaskReview = {
      ...args,
      baseHead,
      modelHash: c4ArchitectureHash(artifacts, reviewedScope),
      scope: reviewedScope,
      runId: scope.runId,
    };
    this.deps.db.setSetting(c4ReviewKey(scope.projectId, scope.taskId), review);
    return {
      text: 'C4 code review saved for this exact model revision and code change fingerprint. submit_result rechecks both.',
    };
  }
  async restore(scope: SkaroScope): Promise<void> {
    for (const record of await this.records(scope.projectId, scope.taskId ?? scope.chatId)) {
      if (record.item.state === 'accepted') {
        try {
          await this.decide(scope.projectId, record.item.id, 'apply');
        } catch {
          /* Durable error is displayed on the existing card. */
        }
      } else await this.deps.publish(record.scope, record.item);
    }
  }
}
