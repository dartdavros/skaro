import {
  str,
  type Emit,
  type Interaction,
  type Item,
  type ItemBody,
  type ItemDraft,
  type Obj,
  type ProjectionContext,
} from '@skaro/timeline';
import { AsyncQuestions } from './async-questions.ts';
import { AGENT } from './projector-helpers.ts';
import { CodexTransport } from './projector-transport.ts';
import { CodexNotifications } from './projector-notifications.ts';
import { CodexRequests } from './projector-requests.ts';
import { CodexItems } from './projector-items.ts';
import { CodexTurns } from './projector-turns.ts';

export class CodexProjectionState {
  readonly items = new Map<string, Item>();
  readonly requests = new Map<string, string>();
  // client request id → method
  readonly openRequests = new Map<string, Interaction>();
  // server request id → interaction
  turnId = '';
  /** Thread of the session; other threads are subagents. */
  mainThread = '';
  retryNoticeId: string | undefined;
  /** Turn named in the last thread/revert request. */
  revertTurn: string | undefined;
  /** Turns started in plan mode, and the plan approval waiting for the next turn. */
  readonly planTurns = new Set<string>();
  nextTurnPlans = false;
  openPlan: string | undefined;
  nextContinuation = false;
  readonly continuationTurns = new Set<string>();
  readonly ctx: ProjectionContext;
  readonly emit: Emit;
  readonly asyncQuestions: AsyncQuestions;
  constructor(ctx: ProjectionContext, emit: Emit) {
    this.ctx = ctx;
    this.emit = emit;
    this.asyncQuestions = new AsyncQuestions(ctx, emit);
  }
  upsert(partial: ItemDraft): void {
    const existing = this.items.get(partial.id);
    const item = {
      ...existing,
      ...partial,
      turnId: partial.turnId ?? existing?.turnId ?? this.turnId,
      startedAt: partial.startedAt ?? existing?.startedAt ?? this.ctx.now(),
    } as Item;
    if (item.endedAt === undefined) delete item.endedAt;
    this.items.set(item.id, item);
    this.emit({ t: 'item.upsert', item });
  }

  notice(
    id: string,
    level: 'info' | 'warning' | 'error',
    code: Extract<ItemBody, { kind: 'notice' }>['code'],
    text: string,
  ): void {
    this.upsert({
      id,
      kind: 'notice',
      level,
      code,
      text,
      status: 'done',
      native: { agent: AGENT, type: 'notice', ref: id },
    });
  }

  emitUnknown(msg: Obj, error?: unknown): void {
    const id = `unknown-${this.items.size}`;
    this.upsert({
      id,
      kind: 'unknown',
      raw: error ? { msg, error: String(error) } : msg,
      status: 'done',
      native: { agent: AGENT, type: str(msg['method']) ?? 'unknown', ref: id },
    });
  }

  /** Turn an item belongs to (for rewinding to a user message). */
  turnOf(itemId: string): string | undefined {
    return this.items.get(itemId)?.turnId;
  }
  readonly transport = new CodexTransport(this);
  readonly notifications = new CodexNotifications(this);
  readonly requestHandler = new CodexRequests(this);
  readonly itemsProjection = new CodexItems(this);
  readonly turns = new CodexTurns(this);
}
