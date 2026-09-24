// Codex app-server (JSON-RPC v2) → canonical timeline (docs/agent-output.md, 4.2).
// Input is the raw JSON-RPC stream in both directions, so a raw log replays into the same timeline.

import {
  arr,
  bool,
  countDiff,
  num,
  obj,
  str,
  type AgentErrorCategory,
  type Emit,
  type FileChange,
  type Interaction,
  type Item,
  type ItemBody,
  type ItemDraft,
  type ItemStatus,
  type Obj,
  type ProjectionContext,
} from '@skaro/timeline';

export const CODEX_ADAPTER_VERSION = '0.1.0';

const AGENT = 'codex';

/** Notifications that only go to the raw log. */
const SILENT = new Set([
  'thread/started',
  'thread/name/updated',
  'thread/settings/updated',
  'thread/queue/changed',
  'thread/goal/updated',
  'thread/goal/cleared',
  'turn/diff/updated',
  // Duplicates the contextCompaction item.
  'thread/compacted',
  'item/reasoning/summaryPartAdded',
  'item/mcpToolCall/progress',
  'item/fileChange/outputDelta',
  'hook/started',
  'hook/completed',
  'rawResponseItem/completed',
  'rawResponse/completed',
  'skills/changed',
  'account/updated',
  'app/list/updated',
  'fs/changed',
  'turn/moderationMetadata',
  'model/verification',
  'model/safetyBuffering/updated',
  'remoteControl/status/changed',
  'thread/environment/connected',
  'thread/environment/disconnected',
  'thread/attachment/updated',
  'thread/project/updated',
  'project/changed',
  'modelProvider/authRecoveryStarted',
  'modelProvider/authRecoveryCompleted',
]);

export class CodexProjector {
  private readonly items = new Map<string, Item>();
  private readonly requests = new Map<string, string>(); // client request id → method
  private readonly openRequests = new Map<string, Interaction>(); // server request id → interaction
  private turnId = '';
  /** Thread of the session; other threads are subagents. */
  private mainThread = '';
  private retryNoticeId: string | undefined;

  private readonly ctx: ProjectionContext;
  private readonly emit: Emit;

  constructor(ctx: ProjectionContext, emit: Emit) {
    this.ctx = ctx;
    this.emit = emit;
  }

  /** One JSON-RPC message Skaro sent to the app-server. */
  input(line: unknown): void {
    const msg = obj(line);
    if (!msg) return;
    try {
      const id = msg['id'];
      if (typeof msg['method'] === 'string' && id !== undefined) {
        this.requests.set(String(id), msg['method']);
      } else if (id !== undefined && ('result' in msg || 'error' in msg)) {
        this.closeInteraction(String(id));
      }
    } catch (error) {
      this.emitUnknown(msg, error);
    }
  }

  /** One JSON-RPC message the app-server sent. */
  output(line: unknown): void {
    const msg = obj(line);
    if (!msg) return;
    try {
      const method = str(msg['method']);
      const id = msg['id'];
      if (method && id !== undefined)
        this.onServerRequest(String(id), method, obj(msg['params']) ?? {});
      else if (method) this.onNotification(method, obj(msg['params']) ?? {});
      else if (id !== undefined) this.onResponse(String(id), msg);
    } catch (error) {
      this.emitUnknown(msg, error);
    }
  }

  private onResponse(id: string, msg: Obj): void {
    const method = this.requests.get(id);
    this.requests.delete(id);
    const result = obj(msg['result']);
    if (
      (method === 'thread/start' || method === 'thread/resume' || method === 'thread/fork') &&
      result
    ) {
      this.mainThread = str(obj(result['thread'])?.['id']) ?? this.mainThread;
      this.emit({
        t: 'session.started',
        nativeSessionId: str(obj(result['thread'])?.['id']) ?? '',
        model: str(result['model']) ?? '',
        capabilities: { agentVersion: str(obj(result['thread'])?.['cliVersion']) },
      });
    }
    const error = obj(msg['error']);
    if (error && method === 'turn/start') {
      this.notice(`rpc-${id}`, 'error', 'other', str(error['message']) ?? 'turn/start failed');
    }
  }

  private onNotification(method: string, p: Obj): void {
    // Subagents run in their own threads: their items nest under the subagent task item,
    // their turns and status do not touch the main timeline.
    const threadId = str(p['threadId']);
    if (this.mainThread && threadId && threadId !== this.mainThread) {
      if (method === 'item/started' || method === 'item/completed') {
        const item = obj(p['item']);
        if (item && item['type'] !== 'subAgentActivity')
          this.onItem(item, this.turnId, `agent-${threadId}`);
        return;
      }
      if (!method.startsWith('item/')) return;
    }
    switch (method) {
      case 'turn/started': {
        this.turnId = str(obj(p['turn'])?.['id']) ?? '';
        this.retryNoticeId = undefined;
        this.emit({ t: 'turn.started', turnId: this.turnId });
        return;
      }
      case 'turn/completed':
        return this.onTurnCompleted(obj(p['turn']) ?? {});
      case 'item/started':
      case 'item/completed': {
        const item = obj(p['item']);
        if (item) this.onItem(item, str(p['turnId']) ?? this.turnId);
        return;
      }
      case 'item/agentMessage/delta':
      case 'item/plan/delta':
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta': {
        const itemId = str(p['itemId']) ?? '';
        if (method.startsWith('item/reasoning')) this.emit({ t: 'activity', state: 'thinking' });
        else this.emit({ t: 'activity', state: 'writing' });
        this.emit({ t: 'item.append', itemId, field: 'text', chunk: str(p['delta']) ?? '' });
        return;
      }
      case 'item/commandExecution/outputDelta':
        this.emit({
          t: 'item.append',
          itemId: str(p['itemId']) ?? '',
          field: 'output',
          chunk: str(p['delta']) ?? '',
        });
        return;
      case 'item/commandExecution/terminalInteraction': {
        const item = this.items.get(str(p['itemId']) ?? '');
        if (item?.kind === 'command') this.upsert({ ...item, awaitingInput: true });
        return;
      }
      case 'item/fileChange/patchUpdated': {
        const item = this.items.get(str(p['itemId']) ?? '');
        const files = filesOf(p['changes']);
        if (item?.kind === 'file_change') this.upsert({ ...item, files });
        const first = files[0];
        if (first) this.emit({ t: 'activity', state: 'preparing_edit', target: first.path });
        return;
      }
      case 'turn/plan/updated':
        this.emit({
          t: 'plan.updated',
          steps: arr(p['plan']).map((s, index) => {
            const step = obj(s) ?? {};
            const status = str(step['status']);
            return {
              id: String(index),
              text: str(step['step']) ?? '',
              status:
                status === 'inProgress' ? 'active' : status === 'completed' ? 'done' : 'pending',
            };
          }),
        });
        return;
      case 'thread/tokenUsage/updated': {
        const usage = obj(p['tokenUsage']);
        const total = obj(usage?.['total']);
        const last = obj(usage?.['last']);
        const window = num(usage?.['modelContextWindow']);
        const used = num(last?.['totalTokens']);
        this.emit({
          t: 'usage',
          inputTokens: num(total?.['inputTokens']) ?? 0,
          outputTokens: num(total?.['outputTokens']) ?? 0,
          contextWindow: window,
          contextUsedPct:
            window && used !== undefined ? Math.round((used / window) * 1000) / 10 : undefined,
        });
        return;
      }
      case 'account/rateLimits/updated': {
        const limits = obj(p['rateLimits']);
        const windows = [obj(limits?.['primary']), obj(limits?.['secondary'])].filter(
          (w): w is Obj => !!w,
        );
        const worst = windows.sort(
          (a, b) => (num(b['usedPercent']) ?? 0) - (num(a['usedPercent']) ?? 0),
        )[0];
        const used = num(worst?.['usedPercent']) ?? 0;
        const resetsAt = num(worst?.['resetsAt']);
        this.emit({
          t: 'limits',
          state:
            used >= 100 || limits?.['rateLimitReachedType']
              ? 'exhausted'
              : used >= 90
                ? 'warning'
                : 'ok',
          resetsAt: resetsAt ? new Date(resetsAt * 1000).toISOString() : undefined,
        });
        return;
      }
      case 'thread/status/changed': {
        const status = obj(p['status']);
        const type = str(status?.['type']);
        const flags = arr(status?.['activeFlags']);
        if (type === 'active') {
          this.emit({
            t: 'status',
            state: flags.some((f) => f === 'waitingOnApproval' || f === 'waitingOnUserInput')
              ? 'waiting'
              : 'working',
          });
        } else if (type === 'idle') {
          this.emit({ t: 'status', state: 'idle' });
        }
        return;
      }
      case 'error': {
        const error = obj(p['error']);
        const message = str(error?.['message']) ?? 'error';
        if (bool(p['willRetry'])) {
          this.retryNoticeId ??= `retry-${this.turnId}`;
          this.notice(this.retryNoticeId, 'warning', 'retry', message);
        } else {
          this.notice(
            `error-${this.turnId}-${this.items.size}`,
            'error',
            noticeCode(error),
            message,
          );
        }
        return;
      }
      case 'warning':
      case 'configWarning':
      case 'deprecationNotice':
      case 'guardianWarning':
      case 'windows/worldWritableWarning':
        this.notice(
          `warn-${this.items.size}`,
          'warning',
          'other',
          str(p['message']) ?? str(p['summary']) ?? method,
        );
        return;
      case 'model/rerouted':
        this.notice(
          `reroute-${this.turnId}`,
          'info',
          'model_switched',
          `${str(p['fromModel'])} → ${str(p['toModel'])}`,
        );
        return;
      case 'mcpServer/startupStatus/updated': {
        const status = str(p['status']);
        if (status === 'failed')
          this.notice(
            `mcp-${str(p['name'])}`,
            'warning',
            'mcp_failed',
            `${str(p['name'])}: ${str(p['error']) ?? status}`,
          );
        return;
      }
      case 'thread/reverted':
        this.emit({ t: 'rewound', toItemId: '' });
        return;
      case 'serverRequest/resolved': {
        const requestId = p['requestId'];
        if (requestId !== undefined) this.closeInteraction(String(requestId));
        return;
      }
      default:
        if (
          SILENT.has(method) ||
          method.startsWith('thread/realtime/') ||
          method.startsWith('fuzzyFileSearch/')
        )
          return;
        this.emitUnknown({ method, params: p });
    }
  }

  private onServerRequest(id: string, method: string, p: Obj): void {
    const interactionId = `req-${id}`;
    let interaction: Interaction | undefined;
    switch (method) {
      case 'item/commandExecution/requestApproval':
        interaction = {
          kind: 'approval',
          id: interactionId,
          itemId: str(p['itemId']),
          action: {
            type: obj(p['networkApprovalContext']) ? 'network' : 'command',
            title: str(p['command']) ?? 'command',
            command: str(p['command']),
            host: str(obj(p['networkApprovalContext'])?.['host']),
            reason: str(p['reason']),
          },
          choices: ['allow_once', 'allow_session', 'deny'],
        };
        break;
      case 'item/fileChange/requestApproval': {
        const item = this.items.get(str(p['itemId']) ?? '');
        interaction = {
          kind: 'approval',
          id: interactionId,
          itemId: str(p['itemId']),
          action: {
            type: 'file_write',
            title: 'file change',
            paths: item?.kind === 'file_change' ? item.files.map((f) => f.path) : undefined,
            reason: str(p['reason']),
          },
          choices: ['allow_once', 'allow_session', 'deny'],
        };
        break;
      }
      case 'item/permissions/requestApproval':
        interaction = {
          kind: 'approval',
          id: interactionId,
          itemId: str(p['itemId']),
          action: { type: 'other', title: 'permissions', reason: str(p['reason']) },
          choices: ['allow_once', 'allow_session', 'deny'],
        };
        break;
      case 'item/tool/requestUserInput':
        interaction = {
          kind: 'question',
          id: interactionId,
          questions: arr(p['questions']).map((q, index) => {
            const question = obj(q) ?? {};
            return {
              id: str(question['id']) ?? String(index),
              header: str(question['header']) ?? '',
              text: str(question['question']) ?? '',
              multi: false,
              allowFreeText: bool(question['isOther']) ?? false,
              secret: bool(question['isSecret']) ?? false,
              options: arr(question['options']).map((o) => ({
                label: str(obj(o)?.['label']) ?? '',
                description: str(obj(o)?.['description']),
              })),
            };
          }),
        };
        break;
      default:
        this.emitUnknown({ method, params: p, id });
        return;
    }
    this.openRequests.set(id, interaction);
    this.emit({ t: 'interaction.opened', interaction });
  }

  private closeInteraction(requestId: string): void {
    const interaction = this.openRequests.get(requestId);
    if (!interaction) return;
    this.openRequests.delete(requestId);
    this.emit({ t: 'interaction.closed', id: interaction.id, resolution: 'answered' });
  }

  private onItem(item: Obj, turnId: string, parentId?: string): void {
    const type = str(item['type']) ?? '';
    if (type === 'subAgentActivity') return this.onSubAgentActivity(item, turnId);
    // Waiting for subagents is not an action of its own; the subagent task item shows progress.
    if (type === 'collabAgentToolCall' && item['tool'] === 'wait') return;
    const id = str(item['id']) ?? '';
    const native = { agent: AGENT, type, ref: id };
    const body = this.itemBody(type, item);
    const existing = this.items.get(id);
    if (parentId && body.kind === 'message' && body.role === 'agent') {
      // A subagent's own answers are commentary inside its task; the last one is its summary.
      body.phase = 'commentary';
      const task = this.items.get(parentId);
      if (task?.kind === 'task' && body.text) this.upsert({ ...task, summary: body.text });
    }
    this.upsert({
      id,
      turnId,
      ...(parentId ? { parentId } : {}),
      ...body,
      status: body.status,
      endedAt:
        body.status !== 'running' && existing?.status === 'running'
          ? this.ctx.now()
          : existing?.endedAt,
      native,
    } as Item);
  }

  /** One task item per subagent thread: started → running, completed/failed → finished. */
  private onSubAgentActivity(item: Obj, turnId: string): void {
    const agentThread = str(item['agentThreadId']);
    const kind = str(item['kind']);
    if (!agentThread || agentThread === this.mainThread) return;
    const id = `agent-${agentThread}`;
    const existing = this.items.get(id);
    if (kind !== 'started' && !existing) return;
    const status: ItemStatus =
      kind === 'started'
        ? 'running'
        : kind === 'failed'
          ? 'failed'
          : kind === 'completed'
            ? 'done'
            : (existing?.status ?? 'running');
    this.upsert({
      ...(existing?.kind === 'task' ? existing : {}),
      id,
      turnId: existing?.turnId ?? turnId,
      kind: 'task',
      title:
        existing?.kind === 'task'
          ? existing.title
          : (str(item['agentPath'])?.split('/').pop() ?? 'subagent'),
      agentType: 'subagent',
      status,
      endedAt: status === 'running' ? undefined : this.ctx.now(),
      native: { agent: AGENT, type: 'subAgentActivity', ref: str(item['id']) ?? id },
    });
  }

  private itemBody(type: string, item: Obj): ItemBody & { status: ItemStatus } {
    const status = statusOf(str(item['status']));
    switch (type) {
      case 'userMessage':
        return {
          kind: 'message',
          role: 'user',
          text: arr(item['content'])
            .map((c) => str(obj(c)?.['text']))
            .filter(Boolean)
            .join('\n'),
          status: 'done',
        };
      case 'agentMessage':
        return {
          kind: 'message',
          role: 'agent',
          text: str(item['text']) ?? '',
          phase: str(item['phase']) === 'final_answer' ? 'final' : 'commentary',
          status: 'done',
        };
      case 'plan':
        return {
          kind: 'message',
          role: 'agent',
          text: str(item['text']) ?? '',
          phase: 'plan',
          status: 'done',
        };
      case 'reasoning': {
        const summary = arr(item['summary']).filter((s): s is string => typeof s === 'string');
        const content = arr(item['content']).filter((s): s is string => typeof s === 'string');
        return {
          kind: 'reasoning',
          text: (summary.length ? summary : content).join('\n\n'),
          status: 'done',
        };
      }
      case 'commandExecution': {
        const actions = arr(item['commandActions'])
          .map(obj)
          .filter((a): a is Obj => !!a);
        const explore =
          actions.length > 0 &&
          actions.every((a) => ['read', 'search', 'listFiles'].includes(str(a['type']) ?? ''));
        if (explore) {
          const first = actions[0] ?? {};
          const actionType = str(first['type']);
          const op = actionType === 'read' ? 'read' : actionType === 'search' ? 'search' : 'list';
          const target =
            actionType === 'search'
              ? (str(first['query']) ?? '')
              : (str(first['path']) ?? str(first['name']) ?? '.');
          const more = actions
            .slice(1)
            .map((a) => str(a['path']) ?? str(a['query']) ?? str(a['command']));
          return {
            kind: 'explore',
            op,
            target,
            detail: more.length ? more.join(', ') : undefined,
            status,
          };
        }
        return {
          kind: 'command',
          command: str(item['command']) ?? '',
          output: str(item['aggregatedOutput']) ?? '',
          outputLive: true,
          exitCode: num(item['exitCode']),
          durationMs: num(item['durationMs']),
          status: status === 'done' && (num(item['exitCode']) ?? 0) !== 0 ? 'failed' : status,
        };
      }
      case 'fileChange':
        return { kind: 'file_change', files: filesOf(item['changes']), status };
      case 'mcpToolCall': {
        const result = obj(item['result']);
        const content = arr(result?.['content']);
        const images = content
          .map(obj)
          .filter((c): c is Obj => c?.['type'] === 'image' && typeof c['data'] === 'string')
          .map((c) =>
            this.ctx.attachImage({
              base64: str(c['data']) ?? '',
              mime: str(c['mimeType']) ?? 'image/png',
            }),
          );
        const error = str(obj(item['error'])?.['message']);
        return {
          kind: 'tool',
          name: str(item['tool']) ?? '',
          server: str(item['server']),
          input: JSON.stringify(item['arguments'] ?? null),
          output:
            error ??
            content
              .map((c) => str(obj(c)?.['text']))
              .filter(Boolean)
              .join('\n'),
          images: images.length ? images : undefined,
          status,
        };
      }
      case 'dynamicToolCall':
        return {
          kind: 'tool',
          name: str(item['tool']) ?? '',
          server: str(item['namespace']),
          input: JSON.stringify(item['arguments'] ?? null),
          status: item['success'] === false ? 'failed' : status,
        };
      case 'webSearch':
        return { kind: 'explore', op: 'web', target: str(item['query']) ?? '', status: 'done' };
      case 'collabAgentToolCall':
        return {
          kind: 'task',
          title: str(item['prompt'])?.split('\n')[0] ?? str(item['tool']) ?? 'subagent',
          agentType: str(item['tool']),
          status,
        };
      case 'imageView': {
        const path = str(item['path']) ?? '';
        return {
          kind: 'explore',
          op: 'read',
          target: path,
          image: { id: path, mime: mimeOf(path), path },
          status: 'done',
        };
      }
      case 'imageGeneration': {
        const path = str(item['savedPath']);
        const failure = str(item['failure']) ?? str(obj(item['failure'])?.['message']);
        if (failure)
          return {
            kind: 'notice',
            level: 'warning',
            code: 'other',
            text: failure,
            status: 'failed',
          };
        return {
          kind: 'image',
          source: 'generated',
          image: { id: path ?? str(item['id']) ?? '', mime: mimeOf(path ?? '.png'), path },
          caption: str(item['revisedPrompt']),
          status,
        };
      }
      case 'contextCompaction':
        return {
          kind: 'notice',
          level: 'info',
          code: 'compaction',
          text: 'compacted',
          status: 'done',
        };
      case 'hookPrompt':
      case 'functionCallOutput':
      case 'sleep':
      case 'enteredReviewMode':
      case 'exitedReviewMode':
        return { kind: 'tool', name: str(item['name']) ?? type, status };
      default:
        return { kind: 'unknown', raw: item, status: 'done' };
    }
  }

  private onTurnCompleted(turn: Obj): void {
    const status = str(turn['status']);
    const error = obj(turn['error']);
    const outcome =
      status === 'interrupted' ? 'interrupted' : status === 'failed' ? 'failed' : 'done';
    const turnId = str(turn['id']) ?? this.turnId;
    for (const item of this.items.values()) {
      // An item without item/completed by the end of the turn never finished (e.g. the sandbox
      // failed to start the process).
      if (item.turnId === turnId && item.status === 'running') {
        this.upsert({
          ...item,
          status: outcome === 'interrupted' ? 'interrupted' : 'failed',
          endedAt: this.ctx.now(),
        });
      }
    }
    this.emit({
      t: 'turn.completed',
      turnId,
      outcome,
      error:
        outcome === 'failed'
          ? { category: errorCategory(error), message: str(error?.['message']) ?? '' }
          : undefined,
    });
  }

  private upsert(partial: ItemDraft): void {
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

  private notice(
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

  private emitUnknown(msg: Obj, error?: unknown): void {
    const id = `unknown-${this.items.size}`;
    this.upsert({
      id,
      kind: 'unknown',
      raw: error ? { msg, error: String(error) } : msg,
      status: 'done',
      native: { agent: AGENT, type: str(msg['method']) ?? 'unknown', ref: id },
    });
  }
}

function statusOf(status: string | undefined): ItemStatus {
  switch (status) {
    case 'inProgress':
      return 'running';
    case 'failed':
      return 'failed';
    case 'declined':
      return 'declined';
    default:
      return 'done';
  }
}

function filesOf(changes: unknown): FileChange[] {
  return arr(changes).map((c) => {
    const change = obj(c) ?? {};
    const kind = obj(change['kind']);
    const kindType = str(kind?.['type']) ?? str(change['kind']);
    const movePath = str(kind?.['move_path']);
    const diff = str(change['diff']);
    // For a new file the diff is the file content itself.
    const counts =
      diff === undefined
        ? undefined
        : kindType === 'add'
          ? { added: diff.split('\n').filter(Boolean).length, removed: 0 }
          : countDiff(diff);
    return {
      path: str(change['path']) ?? '',
      change:
        kindType === 'add'
          ? 'add'
          : kindType === 'delete'
            ? 'delete'
            : movePath
              ? 'move'
              : 'update',
      movePath,
      diff,
      added: counts?.added,
      removed: counts?.removed,
    };
  });
}

function mimeOf(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  return ext === 'jpg' || ext === 'jpeg'
    ? 'image/jpeg'
    : ext === 'gif'
      ? 'image/gif'
      : ext === 'webp'
        ? 'image/webp'
        : 'image/png';
}

function errorInfo(error: Obj | undefined): string {
  const info = error?.['codexErrorInfo'];
  if (typeof info === 'string') return info;
  return Object.keys(obj(info) ?? {})[0] ?? '';
}

function errorCategory(error: Obj | undefined): AgentErrorCategory {
  switch (errorInfo(error)) {
    case 'unauthorized':
      return 'auth';
    case 'usageLimitExceeded':
    case 'rateLimitExceeded':
    case 'sessionBudgetExceeded':
      return 'limit';
    case 'serverOverloaded':
    case 'internalServerError':
      return 'overloaded';
    case 'contextWindowExceeded':
      return 'context_overflow';
    case 'httpConnectionFailed':
    case 'responseStreamConnectionFailed':
    case 'responseStreamDisconnected':
      return 'network';
    case 'cyberPolicy':
    case 'misalignmentPolicyViolation':
      return 'refusal';
    default:
      return /log ?in|auth|401/i.test(str(error?.['message']) ?? '') ? 'auth' : 'other';
  }
}

function noticeCode(error: Obj | undefined): Extract<ItemBody, { kind: 'notice' }>['code'] {
  switch (errorCategory(error)) {
    case 'auth':
      return 'auth';
    case 'limit':
      return 'rate_limit';
    case 'refusal':
      return 'refusal';
    default:
      return 'other';
  }
}
