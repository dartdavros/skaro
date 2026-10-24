import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { AppDb } from '@skaro/core';
import type { IntegrationOperation, IntegrationRequest } from './integration-model';
import type { CompletionOperation } from './completion-store';
import type { MessageInput } from '../shared/ipc';

export function integrationFingerprint(request: IntegrationRequest, baseHead: string): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        project: request.projectId,
        task: request.taskId,
        purpose: request.purpose,
        baseHead,
        results: request.results.map((r) => [r.taskId, r.head, r.criteria, r.verification]),
        checks: request.checks,
        localChanges: request.localChanges?.id,
      }),
    )
    .digest('hex');
}

/** Durable operation ownership and immutable inputs; no state is inferred from agent prose. */
export class IntegrationStore {
  private readonly db: Pick<AppDb, 'getSetting' | 'setSetting' | 'collections'>;
  readonly dataDir: string;
  constructor(db: Pick<AppDb, 'getSetting' | 'setSetting' | 'collections'>, dataDir: string) {
    this.db = db;
    this.dataDir = dataDir;
  }

  all(projectId: string): IntegrationOperation[] {
    return this.db.collections.all(`integration.${projectId}.operations`);
  }

  find(projectId: string, id: string): IntegrationOperation | undefined {
    return this.db.collections.get(`integration.${projectId}.operations`, id);
  }

  publications(projectId: string): CompletionOperation[] {
    return this.db.collections.all(`completion.${projectId}.operations`);
  }

  inputs(id: string): MessageInput[] {
    return this.db.getSetting(`integration.${id}.inputs`, []);
  }

  appendInput(id: string, input: MessageInput): void {
    const pending = this.inputs(id);
    if (input.commandId && pending.some((value) => value.commandId === input.commandId)) return;
    this.db.setSetting(`integration.${id}.inputs`, [...pending, input]);
  }

  delivered(id: string, count: number): void {
    this.db.setSetting(`integration.${id}.inputs`, this.inputs(id).slice(count));
  }

  publish(
    op: IntegrationOperation,
    request: Pick<IntegrationRequest, 'target' | 'partial' | 'message'>,
  ): void {
    const intent = {
      publish: true,
      target: request.target,
      partial: request.partial,
      message: request.message,
    };
    this.db.setSetting(`integration.${op.id}.publication`, intent);
    Object.assign(op, intent);
    this.save(op);
  }

  save(op: IntegrationOperation): void {
    const saved = this.find(op.projectId, op.id);
    const intent = this.db.getSetting(`integration.${op.id}.publication`, null);
    if (intent) Object.assign(op, intent);
    else if (saved?.publish && !op.publish) {
      op.publish = saved.publish;
      op.target = saved.target;
      op.partial = saved.partial;
      op.message = saved.message;
    }
    op.updatedAt = Date.now();
    this.db.collections.put(`integration.${op.projectId}.operations`, op);
  }

  create(request: IntegrationRequest, baseHead: string): IntegrationOperation {
    const id = randomUUID();
    const op: IntegrationOperation = {
      ...request,
      id,
      baseHead,
      fingerprint: integrationFingerprint(request, baseHead),
      worktree: join(this.dataDir, 'integrations', request.projectId, id, 'checkout'),
      head: baseHead,
      cursor: 0,
      state: 'preparing',
      conflicts: [],
      needsVerification: false,
      attempts: 0,
      sequence: 0,
      updatedAt: Date.now(),
      ...(request.purpose === 'publication' ? { mergeChecks: true as const } : {}),
    };
    if (request.publish) this.publish(op, request);
    else this.save(op);
    return op;
  }
}
