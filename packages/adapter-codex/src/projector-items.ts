import {
  arr,
  num,
  obj,
  str,
  type Item,
  type ItemBody,
  type ItemStatus,
  type Obj,
} from '@skaro/timeline';
import { isPermissionContinuation } from './session-input.ts';
import { AGENT, statusOf, filesOf, mimeOf, displayCommand } from './projector-helpers.ts';
import type { CodexProjectionState } from './projector-state.ts';

export class CodexItems {
  private readonly state: CodexProjectionState;
  constructor(state: CodexProjectionState) {
    this.state = state;
  }
  onItem(item: Obj, turnId: string, parentId?: string): void {
    const type = str(item['type']) ?? '';
    if (
      type === 'userMessage' &&
      this.state.continuationTurns.has(turnId) &&
      !parentId &&
      isPermissionContinuation(item['content'])
    )
      return;
    if (type === 'subAgentActivity')
      return this.state.itemsProjection.onSubAgentActivity(item, turnId);
    if (!parentId && this.state.asyncQuestions.item(item, turnId)) return;
    if (!parentId && type === 'userMessage') this.state.asyncQuestions.answered();
    // Waiting for subagents is not an action of its own; the subagent task item shows progress.
    if (type === 'collabAgentToolCall' && item['tool'] === 'wait') return;
    const id = str(item['id']) ?? '';
    const native = { agent: AGENT, type, ref: id };
    const body = this.state.itemsProjection.itemBody(type, item);
    const existing = this.state.items.get(id);
    if (parentId && body.kind === 'message' && body.role === 'agent') {
      // A subagent's own answers are commentary inside its task; the last one is its summary.
      body.phase = 'commentary';
      const task = this.state.items.get(parentId);
      if (task?.kind === 'task' && body.text) this.state.upsert({ ...task, summary: body.text });
    }
    this.state.upsert({
      id,
      turnId,
      ...(parentId ? { parentId } : {}),
      ...body,
      status: body.status,
      endedAt:
        body.status !== 'running' && existing?.status === 'running'
          ? this.state.ctx.now()
          : existing?.endedAt,
      native,
    } as Item);
  }

  /** One task item per subagent thread: started → running, completed/failed → finished. */
  onSubAgentActivity(item: Obj, turnId: string): void {
    const agentThread = str(item['agentThreadId']);
    const kind = str(item['kind']);
    if (!agentThread || agentThread === this.state.mainThread) return;
    const id = `agent-${agentThread}`;
    const existing = this.state.items.get(id);
    if (kind !== 'started' && !existing) return;
    const status: ItemStatus =
      kind === 'started'
        ? 'running'
        : kind === 'failed'
          ? 'failed'
          : kind === 'completed'
            ? 'done'
            : (existing?.status ?? 'running');
    this.state.upsert({
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
      endedAt: status === 'running' ? undefined : this.state.ctx.now(),
      native: { agent: AGENT, type: 'subAgentActivity', ref: str(item['id']) ?? id },
    });
  }

  itemBody(type: string, item: Obj): ItemBody & { status: ItemStatus } {
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
          command: displayCommand(str(item['command']) ?? '', actions),
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
            this.state.ctx.attachImage({
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
}
