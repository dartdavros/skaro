import {
  str,
  type AgentError,
  type Emit,
  type Interaction,
  type Item,
  type ItemBody,
  type ItemDraft,
  type ItemStatus,
  type Obj,
  type PlanStep,
  type ProjectionContext,
} from '@skaro/timeline';
import { AGENT, type ToolItem } from './projector-helpers.ts';
import { ClaudeTransportProjection } from './projector-transport.ts';
import { ClaudeSystemProjection } from './projector-system.ts';
import { ClaudeStreamProjection } from './projector-stream.ts';
import { ClaudeMessagesProjection } from './projector-messages.ts';
import { ClaudeToolsProjection } from './projector-tools.ts';
import { ClaudePlanProjection } from './projector-plan.ts';
import { ClaudeRequestsProjection } from './projector-requests.ts';
import { ClaudeBackgroundProjection } from './projector-background.ts';
import { ClaudeTurnsProjection } from './projector-turns.ts';

export class ClaudeProjectionState {
  turnSeq = 0;
  turnId = '';
  turnOpen = false;
  /** Items of the current session by id (tool_use_id for tool calls). */
  readonly items = new Map<string, ToolItem | Item>();
  /** Agent messages of the current turn, in order; the last one becomes `final`. */
  turnMessages: string[] = [];
  turnError: AgentError | undefined;
  /** Blocks seen per assistant message id, to give streamed and final blocks the same id. */
  readonly blockCount = new Map<string, number>();
  readonly streamBlocks = new Map<number, { id: string; type: string }>();
  streamMessageId = '';
  /** Plan built from Task tools, by task id. */
  readonly plan = new Map<string, PlanStep>();
  readonly pendingTaskCreate = new Map<string, { subject: string; activeForm?: string }>();
  /** Open canUseTool requests: request_id → interaction. */
  readonly openRequests = new Map<string, Interaction>();
  /** tool_use_id → interaction id, for answering canUseTool. */
  readonly toolUseInteractions = new Map<string, string>();
  /** Background task id → item id. */
  readonly backgroundItems = new Map<string, string>();
  retryNoticeId: string | undefined;
  compactionNoticeId: string | undefined;
  /** Tokens in context at the latest main-thread reply. */
  contextTokens = 0;
  readonly ctx: ProjectionContext;
  readonly emit: Emit;
  constructor(ctx: ProjectionContext, emit: Emit) {
    this.ctx = ctx;
    this.emit = emit;
  }
  /** Without lifecycle messages, the first agent output means queued messages were picked up. */
  markQueuedDone(): void {
    for (const item of this.items.values()) {
      if (item.kind === 'message' && item.role === 'user' && item.status === 'queued') {
        this.upsert({ ...item, status: 'done' });
      }
    }
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  startTurn(): void {
    this.turnSeq++;
    this.turnId = `turn-${this.turnSeq}`;
    this.turnOpen = true;
    this.turnMessages = [];
    this.turnError = undefined;
    this.retryNoticeId = undefined;
    this.emit({ t: 'turn.started', turnId: this.turnId });
  }

  blockId(messageId: string, type: string, block: Obj | undefined, final = false): string {
    if (type === 'tool_use') return str(block?.['id']) ?? `${messageId}-tool`;
    // Streamed blocks and the final assistant messages (one per block) share ids by position.
    const key = `${messageId}|${final ? 'final' : 'stream'}`;
    const index = this.blockCount.get(key) ?? 0;
    this.blockCount.set(key, index + 1);
    return `${messageId}-${index}`;
  }

  upsert(partial: ItemDraft): void {
    const existing = this.items.get(partial.id);
    const item = {
      ...existing,
      ...partial,
      turnId: partial.turnId ?? existing?.turnId ?? this.turnId,
      startedAt: partial.startedAt ?? existing?.startedAt ?? this.ctx.now(),
    } as Item;
    if (item.parentId === undefined) delete item.parentId;
    this.items.set(item.id, item);
    const { toolName: _toolName, ...clean } = item as ToolItem;
    this.emit({ t: 'item.upsert', item: clean as Item });
  }

  finishTool(toolUseId: string, status: ItemStatus): void {
    const item = this.items.get(toolUseId);
    if (item && item.status === 'running')
      this.upsert({ ...item, status, endedAt: this.ctx.now() });
  }

  notice(
    id: string,
    level: 'info' | 'warning' | 'error',
    code: Extract<ItemBody, { kind: 'notice' }>['code'],
    text: string,
    retry?: { attempt: number; max: number; inMs: number },
    status: ItemStatus = 'done',
  ): void {
    this.upsert({
      id,
      kind: 'notice',
      level,
      code,
      text,
      retry,
      status,
      native: { agent: AGENT, type: 'notice', ref: id },
    });
  }

  emitUnknown(msg: Obj, error?: unknown): void {
    const id = `unknown-${str(msg['uuid']) ?? this.items.size}`;
    this.upsert({
      id,
      kind: 'unknown',
      raw: error ? { msg, error: String(error) } : msg,
      status: 'done',
      native: { agent: AGENT, type: `${str(msg['type'])}/${str(msg['subtype']) ?? ''}`, ref: id },
    });
  }

  /** Interaction opened for a tool call (canUseTool is keyed by tool use id). */
  interactionForToolUse(toolUseId: string): string | undefined {
    return this.toolUseInteractions.get(toolUseId);
  }
  readonly transport = new ClaudeTransportProjection(this);
  readonly system = new ClaudeSystemProjection(this);
  readonly stream = new ClaudeStreamProjection(this);
  readonly messages = new ClaudeMessagesProjection(this);
  readonly tools = new ClaudeToolsProjection(this);
  readonly planProjection = new ClaudePlanProjection(this);
  readonly requests = new ClaudeRequestsProjection(this);
  readonly background = new ClaudeBackgroundProjection(this);
  readonly turns = new ClaudeTurnsProjection(this);
}
