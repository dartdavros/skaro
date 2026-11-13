import { dirname } from 'node:path';
import { c4Coordination, bindC4Packages } from './c4-coordination-binding';
import { taskC4Protocol } from './c4-protocol';
import { background } from './background/client';
import { C4ValidationError, type C4Package, type AppDb } from '@skaro/core';
import type {
  C4Handlers,
  ProposeC4Args,
  ReviewC4Args,
  SkaroScope,
  ToolResult,
} from '@skaro/mcp-server';
import type { Item } from '@skaro/timeline';
import type { Projects } from './projects';
import { legacyC4ServiceReview } from './c4-service-review';
import { c4RecordProtocol } from './c4-record-protocol';
import { classifiedC4Package } from './c4-package-review';
import { decideC4Package } from './c4-package-decision';
import { c4ToolFailure, recordC4Diagnostic } from './c4-tool-diagnostic';

type ProposalItem = Extract<Item, { kind: 'proposal' }>;
export interface C4ProposalRecord {
  protocol?: import('@skaro/core').C4Protocol;
  scope: SkaroScope;
  package: C4Package;
  item: ProposalItem;
  fileIndex?: { path: string; beforeHash: string | null; afterHash: string }[];
}
export interface C4ServiceDeps {
  db: AppDb;
  projects: Projects;
  locale(): string;
  publish(scope: SkaroScope, item: ProposalItem): Promise<void>;
  changed(projectId: string): void;
  stageImport(args: ProposeC4Args, scope: SkaroScope): Promise<ToolResult>;
  assertMayWork?(scope: SkaroScope): void;
}

export class C4Service implements C4Handlers {
  private readonly deps: C4ServiceDeps;
  private readonly deciding = new Map<string, Promise<void>>();
  constructor(deps: C4ServiceDeps) {
    this.deps = deps;
    bindC4Packages(deps.db, {
      read: (id, project) => background(this.dataDir, 'c4.package', project, id),
      publish: (record) => deps.publish(record.scope, record.item),
    });
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
    try {
      return await this.proposeOnce(args, scope, checkout);
    } catch (error) {
      recordC4Diagnostic(
        this.deps.db,
        scope,
        error instanceof C4ValidationError ? error.diagnostic : null,
      );
      this.deps.changed(scope.projectId);
      return c4ToolFailure(error);
    }
  }
  private async proposeOnce(
    args: ProposeC4Args,
    scope: SkaroScope,
    checkout: string,
  ): Promise<ToolResult> {
    if (scope.importId) return this.deps.stageImport(args, scope);
    if (scope.chatId && this.deps.db.getSetting(`c4.audit.chat.${scope.chatId}`, undefined)) {
      const audit = this.deps.db.getSetting<import('../shared/c4-audit').C4Audit | undefined>(
        `c4.audit.${scope.projectId}`,
        undefined,
      );
      if (
        audit?.chatId !== scope.chatId ||
        !['preparing', 'running', 'decision'].includes(audit.state)
      )
        throw new Error('Audit no longer has proposal authority');
      if (
        (await this.records(scope.projectId, scope.chatId)).some((r) =>
          ['pending', 'accepted'].includes(r.item.state),
        )
      )
        throw new Error('The audit already has one saved package awaiting its original decision');
    }
    const context = this.deps.projects.get(scope.projectId);
    const protocol =
      scope.kind === 'task' && scope.runId
        ? taskC4Protocol(this.deps.db, scope.projectId, scope.runId)
        : 'package-v1';
    const record = await background(
      this.dataDir,
      'c4.prepare',
      context.root,
      {
        ...args,
        locale: this.deps.locale(),
        codeRoot: checkout,
        protocol,
      },
      scope,
    );
    const item = record.item;
    if (protocol === 'impact-v1') return c4Coordination(this.deps.db)!.requestScope(scope, item.id);
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
      .then(() =>
        decideC4Package(
          this.deps,
          {
            records: (p) => this.records(p),
            save: (r) => this.save(r),
            review: (p, id) => this.reviewPackage(p, id),
          },
          projectId,
          id,
          action,
          fingerprint,
        ),
      );
    this.deciding.set(projectId, operation);
    return operation.finally(() => {
      if (this.deciding.get(projectId) === operation) this.deciding.delete(projectId);
    });
  }
  async review(args: ReviewC4Args, scope: SkaroScope): Promise<ToolResult> {
    const checkout = this.caller(scope);
    if (scope.kind !== 'task' || !scope.taskId || !scope.runId)
      throw new Error('C4 code review requires a current task run');
    if (taskC4Protocol(this.deps.db, scope.projectId, scope.runId) === 'impact-v1')
      return c4Coordination(this.deps.db)!.requestScope(scope);
    return legacyC4ServiceReview(this.deps, args, scope, checkout, () =>
      this.records(scope.projectId, scope.taskId),
    );
  }

  async restore(scope: SkaroScope): Promise<void> {
    for (const record of await this.records(scope.projectId, scope.taskId ?? scope.chatId)) {
      const protocol = c4RecordProtocol(record);
      if (
        protocol === 'impact-v1' &&
        record.item.state === 'pending' &&
        !classifiedC4Package(this.deps.db, record)
      )
        continue;
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
