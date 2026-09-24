// Claude Code (Agent SDK stdio stream) → canonical timeline (docs/agent-output.md, 4.1).
// Input is the raw stream in both directions: stdout lines from the CLI and stdin lines
// Skaro sent (user messages, control responses). Replaying a raw log gives the same timeline.

import {
  arr,
  bool,
  countDiff,
  formFields,
  num,
  obj,
  str,
  type AgentError,
  type AgentErrorCategory,
  type Emit,
  type FileChange,
  type Interaction,
  type Item,
  type ItemBody,
  type ItemDraft,
  type ItemStatus,
  type Obj,
  type PlanStep,
  type ProjectionContext,
  type Question,
} from '@skaro/timeline';

export const CLAUDE_ADAPTER_VERSION = '0.1.0';

const AGENT = 'claude';

const PLAN_TOOLS = new Set(['TaskCreate', 'TaskUpdate', 'TaskGet', 'TaskList', 'TodoWrite']);

/** System subtypes that only go to the raw log (hooks, plugins, memory, service). */
const SILENT_SYSTEM = new Set([
  'hook_started',
  'hook_progress',
  'hook_response',
  'plugin_install',
  'files_persisted',
  'memory_recall',
  'commands_changed',
  'control_request_progress',
  'elicitation_complete',
  'thinking_tokens',
  'worker_shutting_down',
  'mirror_error',
  'notification',
  // Human-readable "doing X" / turn summaries; candidates for the live line and board status.
  'task_summary',
  'post_turn_summary',
]);

const SILENT_TYPES = new Set([
  'keep_alive',
  'prompt_suggestion',
  'tool_use_summary',
  'tool_progress',
  'control_cancel_request',
  'auth_status',
  'conversation_reset',
]);

type ToolItem = Item & { toolName: string };

export class ClaudeProjector {
  private turnSeq = 0;
  private turnId = '';
  private turnOpen = false;
  /** Items of the current session by id (tool_use_id for tool calls). */
  private readonly items = new Map<string, ToolItem | Item>();
  /** Agent messages of the current turn, in order; the last one becomes `final`. */
  private turnMessages: string[] = [];
  private turnError: AgentError | undefined;
  /** Blocks seen per assistant message id, to give streamed and final blocks the same id. */
  private readonly blockCount = new Map<string, number>();
  private readonly streamBlocks = new Map<number, { id: string; type: string }>();
  private streamMessageId = '';
  /** Plan built from Task tools, by task id. */
  private readonly plan = new Map<string, PlanStep>();
  private readonly pendingTaskCreate = new Map<string, { subject: string; activeForm?: string }>();
  /** Open canUseTool requests: request_id → interaction. */
  private readonly openRequests = new Map<string, Interaction>();
  /** tool_use_id → interaction id, for answering canUseTool. */
  private readonly toolUseInteractions = new Map<string, string>();
  /** Background task id → item id. */
  private readonly backgroundItems = new Map<string, string>();
  private retryNoticeId: string | undefined;
  private compactionNoticeId: string | undefined;
  /** Tokens in context at the latest main-thread reply. */
  private contextTokens = 0;

  private readonly ctx: ProjectionContext;
  private readonly emit: Emit;

  constructor(ctx: ProjectionContext, emit: Emit) {
    this.ctx = ctx;
    this.emit = emit;
  }

  /** One JSON line Skaro wrote to the CLI's stdin. */
  input(line: unknown): void {
    const msg = obj(line);
    if (!msg) return;
    try {
      if (msg['type'] === 'user') this.onUserInput(msg);
      else if (msg['type'] === 'control_response') this.onControlResponse(msg);
      else if (msg['type'] === 'control_request') {
        const request = obj(msg['request']);
        const toItemId = str(request?.['user_message_id']);
        if (request?.['subtype'] === 'rewind_files' && toItemId && !request['dry_run']) {
          this.emit({ t: 'rewound', toItemId });
        }
      }
    } catch (error) {
      this.emitUnknown(msg, error);
    }
  }

  /** One JSON line the CLI wrote to stdout. */
  output(line: unknown): void {
    const msg = obj(line);
    if (!msg) return;
    try {
      this.onOutput(msg);
    } catch (error) {
      this.emitUnknown(msg, error);
    }
  }

  // ── stdin ────────────────────────────────────────────────────────────────

  private onUserInput(msg: Obj): void {
    const message = obj(msg['message']);
    const content = message?.['content'];
    // Tool results written by Skaro are not user turns.
    const text =
      typeof content === 'string'
        ? content
        : arr(content)
            .map((b) => (obj(b)?.['type'] === 'text' ? str(obj(b)?.['text']) : undefined))
            .filter((t): t is string => t !== undefined)
            .join('\n');
    if (!text && !arr(content).some((b) => obj(b)?.['type'] === 'image')) return;
    const images = arr(content).filter((b) => obj(b)?.['type'] === 'image');

    // A message sent while a turn runs is picked up by the agent between steps.
    if (!this.turnOpen) this.startTurn();
    const id = str(msg['uuid']) ?? `user-${this.turnId}-${this.items.size}`;
    this.upsert({
      id,
      kind: 'message',
      role: 'user',
      text,
      // Queued until the CLI picks it up (command_lifecycle) or answers.
      status: 'queued',
      native: { agent: AGENT, type: 'user', ref: id },
    });
    for (const block of images) {
      const source = obj(obj(block)?.['source']);
      const data = str(source?.['data']);
      if (!data) continue;
      this.upsert({
        id: `${id}-img-${this.items.size}`,
        kind: 'image',
        source: 'viewed',
        image: this.ctx.attachImage({
          base64: data,
          mime: str(source?.['media_type']) ?? 'image/png',
        }),
        status: 'done',
        native: { agent: AGENT, type: 'user.image', ref: id },
      });
    }
  }

  private onControlResponse(msg: Obj): void {
    const response = obj(msg['response']);
    const requestId = str(response?.['request_id']);
    if (!requestId) return;
    const interaction = this.openRequests.get(requestId);
    if (!interaction) return;
    this.openRequests.delete(requestId);
    this.emit({ t: 'interaction.closed', id: interaction.id, resolution: 'answered' });

    const payload = obj(response?.['response']);
    const toolUseId = str(payload?.['toolUseID']);
    if (payload?.['behavior'] === 'deny' && toolUseId) this.finishTool(toolUseId, 'declined');
  }

  // ── stdout ───────────────────────────────────────────────────────────────

  private onOutput(msg: Obj): void {
    const type = str(msg['type']);
    switch (type) {
      case 'system':
        return this.onSystem(msg);
      case 'stream_event':
        return this.onStreamEvent(msg);
      case 'assistant':
        return this.onAssistant(msg);
      case 'user':
        return this.onToolResults(msg);
      case 'result':
        return this.onResult(msg);
      case 'rate_limit_event':
        return this.onRateLimit(msg);
      case 'command_lifecycle':
        return this.onCommandLifecycle(msg);
      case 'control_request':
        return this.onControlRequest(msg);
      case 'control_response':
        return;
      default:
        if (type && SILENT_TYPES.has(type)) return;
        this.emitUnknown(msg);
    }
  }

  private onSystem(msg: Obj): void {
    const subtype = str(msg['subtype']);
    switch (subtype) {
      case 'init': {
        this.emit({
          t: 'session.started',
          nativeSessionId: str(msg['session_id']) ?? '',
          model: str(msg['model']) ?? '',
          capabilities: {
            tools: arr(msg['tools']).filter((t): t is string => typeof t === 'string'),
            flags: arr(msg['capabilities']).filter((t): t is string => typeof t === 'string'),
            agentVersion: str(msg['claude_code_version']),
          },
        });
        for (const server of arr(msg['mcp_servers'])) {
          const s = obj(server);
          const status = str(s?.['status']);
          if (status === 'failed' || status === 'needs-auth') {
            this.notice(
              `mcp-${str(s?.['name'])}`,
              'warning',
              'mcp_failed',
              `${str(s?.['name'])}: ${status}`,
            );
          }
        }
        return;
      }
      case 'session_state_changed': {
        const state = str(msg['state']);
        if (state === 'running') this.emit({ t: 'status', state: 'working' });
        else if (state === 'requires_action') this.emit({ t: 'status', state: 'waiting' });
        else if (state === 'idle') this.emit({ t: 'status', state: 'idle' });
        return;
      }
      case 'api_retry': {
        this.retryNoticeId ??= `retry-${this.turnId}`;
        const attempt = num(msg['attempt']) ?? 0;
        const max = num(msg['max_retries']) ?? 0;
        this.notice(this.retryNoticeId, 'warning', 'retry', str(msg['error']) ?? 'retry', {
          attempt,
          max,
          inMs: num(msg['retry_delay_ms']) ?? 0,
        });
        return;
      }
      case 'status': {
        if (msg['status'] === 'compacting') {
          this.compactionNoticeId = `compaction-${this.turnId}-${this.items.size}`;
          this.notice(
            this.compactionNoticeId,
            'info',
            'compaction',
            'compacting',
            undefined,
            'running',
          );
        } else if (str(msg['compact_result']) === 'failed' && this.compactionNoticeId) {
          this.notice(
            this.compactionNoticeId,
            'warning',
            'compaction',
            str(msg['compact_error']) ?? 'failed',
            undefined,
            'failed',
          );
          this.compactionNoticeId = undefined;
        }
        return;
      }
      case 'compact_boundary': {
        const id = this.compactionNoticeId ?? `compaction-${str(msg['uuid'])}`;
        this.notice(id, 'info', 'compaction', 'compacted');
        this.compactionNoticeId = undefined;
        return;
      }
      case 'permission_denied': {
        const toolUseId = str(msg['tool_use_id']);
        if (toolUseId) this.finishTool(toolUseId, 'declined');
        this.notice(`denied-${toolUseId}`, 'warning', 'denied', str(msg['message']) ?? 'denied');
        return;
      }
      case 'model_refusal_fallback':
        this.notice(
          `refusal-${str(msg['uuid'])}`,
          'warning',
          'model_switched',
          str(msg['content']) ?? '',
        );
        return;
      case 'model_refusal_no_fallback':
        this.notice(`refusal-${str(msg['uuid'])}`, 'error', 'refusal', str(msg['content']) ?? '');
        return;
      case 'informational': {
        const level = str(msg['level']) === 'warning' ? 'warning' : 'info';
        this.notice(`info-${str(msg['uuid'])}`, level, 'other', str(msg['content']) ?? '');
        return;
      }
      case 'local_command_output':
        this.notice(`cmd-${str(msg['uuid'])}`, 'info', 'other', str(msg['content']) ?? '');
        return;
      case 'task_started':
        return this.onTaskStarted(msg);
      case 'task_progress':
        return this.onTaskProgress(msg);
      case 'task_updated':
        return this.onTaskUpdated(msg);
      case 'task_notification':
        return this.onTaskNotification(msg);
      case 'background_tasks_changed':
        return;
      default:
        if (subtype && SILENT_SYSTEM.has(subtype)) return;
        this.emitUnknown(msg);
    }
  }

  /** Lifecycle of a sent user message (capability msg_lifecycle_v1). */
  private onCommandLifecycle(msg: Obj): void {
    const item = this.items.get(str(msg['command_uuid']) ?? '');
    if (item?.kind !== 'message' || item.role !== 'user') return;
    const state = str(msg['state']);
    if (state === 'started' && item.status === 'queued') this.upsert({ ...item, status: 'done' });
    else if (state === 'cancelled' && item.status === 'queued')
      this.upsert({ ...item, status: 'interrupted' });
  }

  /** Without lifecycle messages, the first agent output means queued messages were picked up. */
  private markQueuedDone(): void {
    for (const item of this.items.values()) {
      if (item.kind === 'message' && item.role === 'user' && item.status === 'queued') {
        this.upsert({ ...item, status: 'done' });
      }
    }
  }

  private onStreamEvent(msg: Obj): void {
    const event = obj(msg['event']);
    if (!event) return;
    const parentId = str(msg['parent_tool_use_id']);
    switch (str(event['type'])) {
      case 'message_start':
        this.streamMessageId = str(obj(event['message'])?.['id']) ?? '';
        this.streamBlocks.clear();
        return;
      case 'content_block_start': {
        const index = num(event['index']) ?? 0;
        const block = obj(event['content_block']);
        const blockType = str(block?.['type']) ?? '';
        const id = this.blockId(this.streamMessageId, blockType, block);
        this.streamBlocks.set(index, { id, type: blockType });
        if (blockType === 'thinking' || blockType === 'redacted_thinking') {
          this.emit({ t: 'activity', state: 'thinking' });
          this.upsert({
            id,
            parentId,
            kind: 'reasoning',
            text: '',
            redacted: blockType === 'redacted_thinking',
            status: 'running',
            native: { agent: AGENT, type: 'stream.thinking', ref: id },
          });
        } else if (blockType === 'text') {
          this.emit({ t: 'activity', state: 'writing' });
          this.upsert({
            id,
            parentId,
            kind: 'message',
            role: 'agent',
            text: '',
            phase: 'commentary',
            status: 'running',
            native: { agent: AGENT, type: 'stream.text', ref: id },
          });
        } else if (blockType === 'tool_use') {
          const name = str(block?.['name']) ?? '';
          const editing = ['Edit', 'Write', 'NotebookEdit'].includes(name);
          this.emit({ t: 'activity', state: editing ? 'preparing_edit' : 'waiting_model' });
        }
        return;
      }
      case 'content_block_delta': {
        const block = this.streamBlocks.get(num(event['index']) ?? -1);
        const delta = obj(event['delta']);
        if (!block || !delta) return;
        const deltaType = str(delta['type']);
        if (deltaType === 'text_delta') {
          this.emit({
            t: 'item.append',
            itemId: block.id,
            field: 'text',
            chunk: str(delta['text']) ?? '',
          });
        } else if (deltaType === 'thinking_delta') {
          this.emit({
            t: 'item.append',
            itemId: block.id,
            field: 'text',
            chunk: str(delta['thinking']) ?? '',
          });
        } else if (deltaType === 'input_json_delta' && block.type === 'tool_use') {
          // Live line: the edited path appears in the partial input before the call completes.
          const match = /"(?:file_path|notebook_path)"\s*:\s*"([^"]+)"/.exec(
            str(delta['partial_json']) ?? '',
          );
          if (match?.[1]) this.emit({ t: 'activity', state: 'preparing_edit', target: match[1] });
        }
        return;
      }
      default:
        return;
    }
  }

  private onAssistant(msg: Obj): void {
    if (!this.turnOpen) this.startTurn();
    if (!msg['parent_tool_use_id']) this.markQueuedDone();
    const message = obj(msg['message']);
    const messageId = str(message?.['id']) ?? str(msg['uuid']) ?? '';
    const parentId = str(msg['parent_tool_use_id']);
    const error = str(msg['error']);
    if (error)
      this.turnError = { category: errorCategory(error), message: textOf(message) || error };

    const usage = obj(msg['context_usage']);
    if (usage) {
      this.emit({
        t: 'usage',
        inputTokens: num(usage['total_tokens']) ?? 0,
        outputTokens: 0,
        contextWindow: num(usage['raw_max_tokens']),
        contextUsedPct: num(usage['percentage']),
      });
    }
    // Context fill: what the model saw for the latest main-thread reply.
    const messageUsage = obj(message?.['usage']);
    if (messageUsage && !parentId) {
      this.contextTokens =
        (num(messageUsage['input_tokens']) ?? 0) +
        (num(messageUsage['cache_read_input_tokens']) ?? 0) +
        (num(messageUsage['cache_creation_input_tokens']) ?? 0) +
        (num(messageUsage['output_tokens']) ?? 0);
    }

    for (const raw of arr(message?.['content'])) {
      const block = obj(raw);
      if (!block) continue;
      const blockType = str(block['type']) ?? '';
      const id = this.blockId(messageId, blockType, block, true);
      const native = { agent: AGENT, type: `assistant.${blockType}`, ref: id };
      switch (blockType) {
        case 'text': {
          const text = str(block['text']) ?? '';
          // Synthetic error messages (e.g. "Not logged in") become the turn error, not agent text.
          if (error) {
            this.notice(
              id,
              'error',
              error === 'rate_limit'
                ? 'rate_limit'
                : errorCategory(error) === 'auth'
                  ? 'auth'
                  : 'other',
              text,
            );
            break;
          }
          this.upsert({
            id,
            parentId,
            kind: 'message',
            role: 'agent',
            text,
            phase: 'commentary',
            status: 'done',
            native,
          });
          if (!parentId) this.turnMessages.push(id);
          break;
        }
        case 'thinking':
          this.upsert({
            id,
            parentId,
            kind: 'reasoning',
            text: str(block['thinking']) ?? '',
            status: 'done',
            native,
          });
          break;
        case 'redacted_thinking':
          this.upsert({ id, parentId, kind: 'reasoning', redacted: true, status: 'done', native });
          break;
        case 'tool_use':
          this.onToolUse(block, parentId);
          break;
        default:
          this.upsert({ id, parentId, kind: 'unknown', raw: block, status: 'done', native });
      }
    }
  }

  private onToolUse(block: Obj, parentId: string | undefined): void {
    const id = str(block['id']) ?? '';
    const name = str(block['name']) ?? '';
    const input = obj(block['input']) ?? {};
    const native = { agent: AGENT, type: `tool_use.${name}`, ref: id };

    if (PLAN_TOOLS.has(name)) {
      this.onPlanTool(id, name, input);
      return;
    }
    if (name === 'AskUserQuestion') return; // shown as a question interaction
    if (name === 'ExitPlanMode') {
      const plan = str(input['plan']);
      if (plan)
        this.upsert({
          id,
          parentId,
          kind: 'message',
          role: 'agent',
          text: plan,
          phase: 'plan',
          status: 'done',
          native,
        });
      return;
    }

    const body = toolBody(name, input);
    this.upsert({ id, parentId, ...body, status: 'running', native, toolName: name } as ToolItem);
  }

  private onPlanTool(id: string, name: string, input: Obj): void {
    if (name === 'TaskCreate') {
      this.pendingTaskCreate.set(id, {
        subject: str(input['subject']) ?? '',
        activeForm: str(input['activeForm']),
      });
    } else if (name === 'TaskUpdate') {
      const taskId = str(input['taskId']);
      if (!taskId) return;
      const step = this.plan.get(taskId) ?? { id: taskId, text: '', status: 'pending' as const };
      const status = str(input['status']);
      if (status === 'deleted') {
        this.plan.delete(taskId);
      } else {
        if (str(input['subject'])) step.text = str(input['subject']) ?? step.text;
        if (str(input['activeForm'])) step.activeText = str(input['activeForm']);
        if (status)
          step.status =
            status === 'in_progress' ? 'active' : status === 'completed' ? 'done' : 'pending';
        this.plan.set(taskId, step);
      }
      this.emitPlan();
    } else if (name === 'TodoWrite') {
      this.plan.clear();
      arr(input['todos']).forEach((todo, index) => {
        const t = obj(todo);
        const status = str(t?.['status']);
        this.plan.set(String(index), {
          id: String(index),
          text: str(t?.['content']) ?? '',
          activeText: str(t?.['activeForm']),
          status: status === 'in_progress' ? 'active' : status === 'completed' ? 'done' : 'pending',
        });
      });
      this.emitPlan();
    }
  }

  private emitPlan(): void {
    this.emit({ t: 'plan.updated', steps: [...this.plan.values()].map((s) => ({ ...s })) });
  }

  private onToolResults(msg: Obj): void {
    const content = arr(obj(msg['message'])?.['content']);
    const structured = obj(msg['tool_use_result']);
    for (const raw of content) {
      const block = obj(raw);
      if (block?.['type'] !== 'tool_result') continue;
      const toolUseId = str(block['tool_use_id']) ?? '';
      const isError = bool(block['is_error']) ?? false;
      const text = resultText(block['content']);

      const pendingTask = this.pendingTaskCreate.get(toolUseId);
      if (pendingTask) {
        this.pendingTaskCreate.delete(toolUseId);
        const taskId = str(obj(structured?.['task'])?.['id']) ?? /#(\w+)/.exec(text)?.[1];
        if (taskId) {
          this.plan.set(taskId, {
            id: taskId,
            text: pendingTask.subject,
            activeText: pendingTask.activeForm,
            status: 'pending',
          });
          this.emitPlan();
        }
        continue;
      }

      const item = this.items.get(toolUseId) as ToolItem | undefined;
      if (!item) continue;
      const updated = this.completeTool(item, isError, text, structured, block['content']);
      this.upsert(updated);
    }
  }

  private completeTool(
    item: ToolItem,
    isError: boolean,
    text: string,
    result: Obj | undefined,
    content: unknown,
  ): ToolItem {
    let status: ItemStatus = isError ? 'failed' : 'done';
    // A denied call still gets an error tool_result; an interrupt produces the same rejection text.
    if (item.status === 'declined') status = 'declined';
    else if (isError && text.startsWith("The user doesn't want to proceed with this tool use"))
      status = 'interrupted';
    const next = { ...item, status, endedAt: this.ctx.now() } as ToolItem;
    switch (next.kind) {
      case 'command': {
        const stdout = str(result?.['stdout']);
        const stderr = str(result?.['stderr']);
        next.output =
          stdout !== undefined || stderr !== undefined
            ? [stdout, stderr].filter(Boolean).join('\n')
            : text;
        const exit = /Exit code (\d+)/.exec(text);
        if (exit?.[1]) next.exitCode = Number(exit[1]);
        else if (!isError) next.exitCode = 0;
        if (bool(result?.['interrupted'])) next.status = 'interrupted';
        const bg = str(result?.['backgroundTaskId']);
        if (bg) {
          next.status = 'running';
          next.background = { taskId: bg, state: 'running' };
          this.backgroundItems.set(bg, next.id);
        }
        if (bool(result?.['isImage'])) {
          const image = imageBlock(content);
          if (image) next.image = this.ctx.attachImage(image);
        }
        break;
      }
      case 'file_change': {
        // Copy before filling in: the running item was already emitted with this array.
        next.files = next.files.map((f) => ({ ...f }));
        const file = next.files[0];
        if (!file) break;
        const git = obj(result?.['gitDiff']);
        const patch = str(git?.['patch']) ?? patchFromStructured(result?.['structuredPatch']);
        if (patch) file.diff = patch;
        file.added = num(git?.['additions']) ?? (patch ? countDiff(patch).added : undefined);
        file.removed = num(git?.['deletions']) ?? (patch ? countDiff(patch).removed : undefined);
        if (str(result?.['type']) === 'create') {
          file.change = 'add';
          const content = str(result?.['content']);
          if (!patch && content !== undefined) {
            file.added = content.split('\n').filter(Boolean).length;
            file.removed = 0;
          }
        }
        break;
      }
      case 'explore': {
        const file = obj(result?.['file']);
        if (str(result?.['type']) === 'image' && file) {
          const dims = obj(file['dimensions']);
          next.image = this.ctx.attachImage({
            base64: str(file['base64']) ?? '',
            mime: str(file['type']) ?? 'image/png',
            width: num(dims?.['displayWidth']) ?? num(dims?.['originalWidth']),
            height: num(dims?.['displayHeight']) ?? num(dims?.['originalHeight']),
            path: next.target,
          });
        }
        break;
      }
      case 'task': {
        const summary = arr(result?.['content'])
          .map((c) => str(obj(c)?.['text']))
          .filter(Boolean)
          .join('\n');
        next.summary = summary || text;
        next.actions = num(result?.['totalToolUseCount']) ?? next.actions;
        break;
      }
      case 'tool': {
        next.output = text;
        const images = arr(content)
          .map((c) => imageBlock([c]))
          .filter((i): i is NonNullable<typeof i> => i !== undefined)
          .map((i) => this.ctx.attachImage(i));
        if (images.length) next.images = images;
        break;
      }
      default:
        break;
    }
    return next;
  }

  private onControlRequest(msg: Obj): void {
    const requestId = str(msg['request_id']);
    const request = obj(msg['request']);
    if (!requestId || !request) return;
    if (request['subtype'] === 'elicitation') return this.onElicitation(requestId, request);
    if (request['subtype'] !== 'can_use_tool') return;
    const toolName = str(request['tool_name']) ?? '';
    const input = obj(request['input']) ?? {};
    const toolUseId = str(request['tool_use_id']);
    const id = `perm-${requestId}`;

    let interaction: Interaction;
    if (toolName === 'AskUserQuestion') {
      interaction = { kind: 'question', id, questions: questionsOf(input) };
    } else if (toolName === 'ExitPlanMode') {
      interaction = { kind: 'plan_approval', id, plan: str(input['plan']) ?? '' };
    } else {
      const command = str(input['command']);
      const path =
        str(input['file_path']) ?? str(input['notebook_path']) ?? str(request['blocked_path']);
      const type = command
        ? 'command'
        : ['Edit', 'Write', 'NotebookEdit'].includes(toolName)
          ? 'file_write'
          : toolName.startsWith('mcp__')
            ? 'mcp'
            : toolName === 'WebFetch'
              ? 'network'
              : 'other';
      interaction = {
        kind: 'approval',
        id,
        itemId: toolUseId,
        action: {
          type,
          title: str(request['title']) ?? toolName,
          command,
          paths: path ? [path] : undefined,
          host: toolName === 'WebFetch' ? hostOf(str(input['url'])) : undefined,
          reason: str(request['decision_reason']) ?? str(request['description']),
        },
        choices: arr(request['permission_suggestions']).length
          ? ['allow_once', 'allow_session', 'deny']
          : ['allow_once', 'deny'],
      };
    }
    this.openRequests.set(requestId, interaction);
    if (toolUseId) this.toolUseInteractions.set(toolUseId, interaction.id);
    this.emit({ t: 'interaction.opened', interaction });
  }

  /** MCP server asks for input (form) or a browser sign-in (url). */
  private onElicitation(requestId: string, request: Obj): void {
    const server = str(request['mcp_server_name']) ?? 'mcp';
    const id = `elicit-${requestId}`;
    const url = str(request['url']);
    const interaction: Interaction =
      request['mode'] === 'url' && url
        ? { kind: 'login', id, server, url }
        : {
            kind: 'form',
            id,
            server,
            title: str(request['title']) ?? str(request['message']) ?? server,
            fields: formFields(request['requested_schema']),
          };
    this.openRequests.set(requestId, interaction);
    this.emit({ t: 'interaction.opened', interaction });
  }

  /** Interaction opened for a tool call (canUseTool is keyed by tool use id). */
  interactionForToolUse(toolUseId: string): string | undefined {
    return this.toolUseInteractions.get(toolUseId);
  }

  private onTaskStarted(msg: Obj): void {
    const toolUseId = str(msg['tool_use_id']);
    const item = toolUseId ? (this.items.get(toolUseId) as ToolItem | undefined) : undefined;
    if (item?.kind === 'task') {
      this.upsert({ ...item, agentType: str(msg['subagent_type']) ?? item.agentType });
    }
  }

  private onTaskProgress(msg: Obj): void {
    const toolUseId = str(msg['tool_use_id']);
    const item = toolUseId ? (this.items.get(toolUseId) as ToolItem | undefined) : undefined;
    if (item?.kind === 'task') {
      this.upsert({ ...item, actions: num(obj(msg['usage'])?.['tool_uses']) ?? item.actions });
    }
  }

  private onTaskUpdated(msg: Obj): void {
    const status = str(obj(msg['patch'])?.['status']);
    if (status === 'completed' || status === 'failed' || status === 'killed') {
      this.finishBackground(str(msg['task_id']) ?? '', status === 'killed' ? 'stopped' : 'done');
    }
  }

  private onTaskNotification(msg: Obj): void {
    const status = str(msg['status']);
    this.finishBackground(
      str(msg['task_id']) ?? '',
      status === 'stopped' ? 'stopped' : 'done',
      str(msg['summary']),
    );
  }

  private finishBackground(taskId: string, state: 'done' | 'stopped', summary?: string): void {
    const itemId = this.backgroundItems.get(taskId);
    const item = itemId ? (this.items.get(itemId) as ToolItem | undefined) : undefined;
    if (item?.kind !== 'command') return;
    this.backgroundItems.delete(taskId);
    this.upsert({
      ...item,
      status: state === 'stopped' ? 'interrupted' : 'done',
      endedAt: this.ctx.now(),
      background: { taskId, state },
      output: summary && !item.output ? summary : item.output,
    });
  }

  private onResult(msg: Obj): void {
    const usage = obj(msg['usage']);
    if (usage) {
      // The largest context window among the models of the turn is the main model's.
      const window = Math.max(
        0,
        ...Object.values(obj(msg['modelUsage']) ?? {}).map(
          (m) => num(obj(m)?.['contextWindow']) ?? 0,
        ),
      );
      this.emit({
        t: 'usage',
        inputTokens:
          (num(usage['input_tokens']) ?? 0) +
          (num(usage['cache_read_input_tokens']) ?? 0) +
          (num(usage['cache_creation_input_tokens']) ?? 0),
        outputTokens: num(usage['output_tokens']) ?? 0,
        ...(window > 0 ? { contextWindow: window } : {}),
        ...(window > 0 && this.contextTokens > 0
          ? { contextUsedPct: Math.round((this.contextTokens / window) * 1000) / 10 }
          : {}),
      });
    }

    // Outcome by is_error and assistant.error, not by subtype (auth errors come as subtype "success").
    const terminal = str(msg['terminal_reason']);
    const interrupted = terminal === 'aborted_streaming' || terminal === 'aborted_tools';
    const isError = bool(msg['is_error']) ?? false;
    let outcome: 'done' | 'interrupted' | 'failed' = interrupted
      ? 'interrupted'
      : isError
        ? 'failed'
        : 'done';
    let error = this.turnError;
    if (outcome === 'failed' && !error) {
      const text = str(msg['result']) ?? arr(msg['errors']).filter(Boolean).join('\n');
      error = { category: categoryFromText(text, num(msg['api_error_status'])), message: text };
    }
    if (outcome !== 'failed') error = undefined;
    if (!this.turnOpen) this.startTurn();

    const last = this.turnMessages.at(-1);
    const lastItem = last ? this.items.get(last) : undefined;
    if (lastItem?.kind === 'message' && outcome === 'done')
      this.upsert({ ...lastItem, phase: 'final' });

    for (const item of this.items.values()) {
      if (item.turnId !== this.turnId || item.status !== 'running') continue;
      if (item.kind === 'command' && item.background) continue;
      this.upsert({
        ...item,
        status: outcome === 'interrupted' ? 'interrupted' : 'done',
        endedAt: this.ctx.now(),
      });
    }
    if (outcome === 'failed' && error === undefined) outcome = 'failed';
    this.emit({ t: 'turn.completed', turnId: this.turnId, outcome, error });
    this.turnOpen = false;
  }

  private onRateLimit(msg: Obj): void {
    const info = obj(msg['rate_limit_info']);
    const status = str(info?.['status']);
    const resetsAt = num(info?.['resetsAt']);
    this.emit({
      t: 'limits',
      state: status === 'rejected' ? 'exhausted' : status === 'allowed_warning' ? 'warning' : 'ok',
      resetsAt: resetsAt ? new Date(resetsAt * 1000).toISOString() : undefined,
    });
  }

  // ── helpers ──────────────────────────────────────────────────────────────

  private startTurn(): void {
    this.turnSeq++;
    this.turnId = `turn-${this.turnSeq}`;
    this.turnOpen = true;
    this.turnMessages = [];
    this.turnError = undefined;
    this.retryNoticeId = undefined;
    this.emit({ t: 'turn.started', turnId: this.turnId });
  }

  private blockId(messageId: string, type: string, block: Obj | undefined, final = false): string {
    if (type === 'tool_use') return str(block?.['id']) ?? `${messageId}-tool`;
    // Streamed blocks and the final assistant messages (one per block) share ids by position.
    const key = `${messageId}|${final ? 'final' : 'stream'}`;
    const index = this.blockCount.get(key) ?? 0;
    this.blockCount.set(key, index + 1);
    return `${messageId}-${index}`;
  }

  private upsert(partial: ItemDraft): void {
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

  private finishTool(toolUseId: string, status: ItemStatus): void {
    const item = this.items.get(toolUseId);
    if (item && item.status === 'running')
      this.upsert({ ...item, status, endedAt: this.ctx.now() });
  }

  private notice(
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

  private emitUnknown(msg: Obj, error?: unknown): void {
    const id = `unknown-${str(msg['uuid']) ?? this.items.size}`;
    this.upsert({
      id,
      kind: 'unknown',
      raw: error ? { msg, error: String(error) } : msg,
      status: 'done',
      native: { agent: AGENT, type: `${str(msg['type'])}/${str(msg['subtype']) ?? ''}`, ref: id },
    });
  }
}

// ── tool registry (docs/agent-output.md, 4.1) ──────────────────────────────

function toolBody(name: string, input: Obj): ItemBody {
  switch (name) {
    case 'Read':
      return {
        kind: 'explore',
        op: 'read',
        target: str(input['file_path']) ?? '',
        detail: rangeOf(input),
      };
    case 'Glob':
      return {
        kind: 'explore',
        op: 'list',
        target: str(input['pattern']) ?? '',
        detail: str(input['path']),
      };
    case 'Grep':
      return {
        kind: 'explore',
        op: 'search',
        target: str(input['pattern']) ?? '',
        detail: str(input['path']),
      };
    case 'WebFetch':
      return { kind: 'explore', op: 'fetch', target: str(input['url']) ?? '' };
    case 'WebSearch':
      return { kind: 'explore', op: 'web', target: str(input['query']) ?? '' };
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': {
      const path = str(input['file_path']) ?? str(input['notebook_path']) ?? '';
      const file: FileChange = { path, change: 'update' };
      return { kind: 'file_change', files: [file] };
    }
    case 'Bash':
    case 'PowerShell':
      return {
        kind: 'command',
        command: str(input['command']) ?? '',
        description: str(input['description']),
        output: '',
        outputLive: false,
      };
    case 'Agent':
    case 'Task':
    case 'Workflow':
      return {
        kind: 'task',
        title: str(input['description']) ?? str(input['name']) ?? name,
        agentType: str(input['subagent_type']),
      };
    default: {
      const mcp = /^mcp__([^_]+(?:_[^_]+)*)__(.+)$/.exec(name);
      return {
        kind: 'tool',
        name: mcp?.[2] ?? name,
        server: mcp?.[1],
        input: JSON.stringify(input),
      };
    }
  }
}

function rangeOf(input: Obj): string | undefined {
  const offset = num(input['offset']);
  const limit = num(input['limit']);
  if (offset === undefined && limit === undefined) return undefined;
  const from = offset ?? 1;
  return limit ? `${from}-${from + limit - 1}` : `${from}-`;
}

function questionsOf(input: Obj): Question[] {
  return arr(input['questions']).map((q, index) => {
    const question = obj(q) ?? {};
    return {
      id: str(question['question']) ?? String(index),
      header: str(question['header']) ?? '',
      text: str(question['question']) ?? '',
      multi: bool(question['multiSelect']) ?? false,
      allowFreeText: true,
      options: arr(question['options']).map((o) => {
        const option = obj(o) ?? {};
        return {
          label: str(option['label']) ?? '',
          description: str(option['description']),
          preview: str(option['preview']),
        };
      }),
    };
  });
}

function resultText(content: unknown): string {
  if (typeof content === 'string') return content;
  return arr(content)
    .map((c) => (obj(c)?.['type'] === 'text' ? str(obj(c)?.['text']) : undefined))
    .filter(Boolean)
    .join('\n');
}

function imageBlock(content: unknown): { base64: string; mime: string } | undefined {
  for (const c of arr(content)) {
    const block = obj(c);
    if (block?.['type'] !== 'image') continue;
    const source = obj(block['source']);
    const base64 = str(source?.['data']) ?? str(block['data']);
    if (base64)
      return { base64, mime: str(source?.['media_type']) ?? str(block['mimeType']) ?? 'image/png' };
  }
  return undefined;
}

function patchFromStructured(patch: unknown): string | undefined {
  const hunks = arr(patch)
    .map(obj)
    .filter((h): h is Obj => h !== undefined);
  if (!hunks.length) return undefined;
  return hunks
    .map((h) => {
      const header = `@@ -${num(h['oldStart'])},${num(h['oldLines'])} +${num(h['newStart'])},${num(h['newLines'])} @@`;
      return [header, ...arr(h['lines']).filter((l): l is string => typeof l === 'string')].join(
        '\n',
      );
    })
    .join('\n');
}

function textOf(message: Obj | undefined): string {
  return arr(message?.['content'])
    .map((b) => str(obj(b)?.['text']))
    .filter(Boolean)
    .join('\n');
}

function hostOf(url: string | undefined): string | undefined {
  try {
    return url ? new URL(url).host : undefined;
  } catch {
    return undefined;
  }
}

function errorCategory(error: string): AgentErrorCategory {
  switch (error) {
    case 'authentication_failed':
    case 'oauth_org_not_allowed':
    case 'account_on_hold':
    case 'verification_required':
    case 'cloud_credential_error':
      return 'auth';
    case 'rate_limit':
    case 'billing_error':
      return 'limit';
    case 'overloaded':
    case 'server_error':
      return 'overloaded';
    default:
      return 'other';
  }
}

function categoryFromText(text: string, status: number | undefined): AgentErrorCategory {
  if (status === 401 || status === 403 || /log ?in|auth/i.test(text)) return 'auth';
  if (status === 429 || /rate limit|usage limit/i.test(text)) return 'limit';
  if (status === 529 || status === 503 || /overloaded/i.test(text)) return 'overloaded';
  if (/prompt is too long|context/i.test(text)) return 'context_overflow';
  if (/network|ECONN|ETIMEDOUT|fetch failed/i.test(text)) return 'network';
  return 'other';
}
