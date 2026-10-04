import { arr, bool, num, obj, str, type Obj } from '@skaro/timeline';
import { SILENT, filesOf, noticeCode } from './projector-helpers.ts';
import type { CodexProjectionState } from './projector-state.ts';

export class CodexNotifications {
  private readonly state: CodexProjectionState;
  constructor(state: CodexProjectionState) {
    this.state = state;
  }
  onNotification(method: string, p: Obj): void {
    // Subagents run in their own threads: their items nest under the subagent task item,
    // their turns and status do not touch the main timeline.
    const threadId = str(p['threadId']);
    if (this.state.mainThread && threadId && threadId !== this.state.mainThread) {
      if (method === 'item/started' || method === 'item/completed') {
        const item = obj(p['item']);
        if (item && item['type'] !== 'subAgentActivity')
          this.state.itemsProjection.onItem(item, this.state.turnId, `agent-${threadId}`);
        return;
      }
      // The subagent thread finishing its turn finishes the subagent task.
      if (method === 'turn/completed') {
        const task = this.state.items.get(`agent-${threadId}`);
        const status = str(obj(p['turn'])?.['status']);
        if (task?.kind === 'task' && task.status === 'running') {
          this.state.upsert({
            ...task,
            status:
              status === 'failed' ? 'failed' : status === 'interrupted' ? 'interrupted' : 'done',
            endedAt: this.state.ctx.now(),
          });
        }
        return;
      }
      if (!method.startsWith('item/')) return;
    }
    switch (method) {
      case 'turn/started': {
        this.state.turnId = str(obj(p['turn'])?.['id']) ?? '';
        if (this.state.nextContinuation) this.state.continuationTurns.add(this.state.turnId);
        this.state.nextContinuation = false;
        this.state.retryNoticeId = undefined;
        if (this.state.nextTurnPlans) this.state.planTurns.add(this.state.turnId);
        this.state.nextTurnPlans = false;
        this.state.emit({ t: 'turn.started', turnId: this.state.turnId });
        return;
      }
      case 'turn/completed':
        return this.state.turns.onTurnCompleted(obj(p['turn']) ?? {});
      case 'item/started':
      case 'item/completed': {
        const item = obj(p['item']);
        if (item) this.state.itemsProjection.onItem(item, str(p['turnId']) ?? this.state.turnId);
        return;
      }
      case 'item/agentMessage/delta':
      case 'item/plan/delta':
      case 'item/reasoning/summaryTextDelta':
      case 'item/reasoning/textDelta': {
        const itemId = str(p['itemId']) ?? '';
        if (method.startsWith('item/reasoning'))
          this.state.emit({ t: 'activity', state: 'thinking' });
        else this.state.emit({ t: 'activity', state: 'writing' });
        this.state.emit({ t: 'item.append', itemId, field: 'text', chunk: str(p['delta']) ?? '' });
        return;
      }
      case 'item/commandExecution/outputDelta':
        this.state.emit({
          t: 'item.append',
          itemId: str(p['itemId']) ?? '',
          field: 'output',
          chunk: str(p['delta']) ?? '',
        });
        return;
      case 'item/commandExecution/terminalInteraction': {
        const item = this.state.items.get(str(p['itemId']) ?? '');
        if (item?.kind === 'command') this.state.upsert({ ...item, awaitingInput: true });
        return;
      }
      case 'item/fileChange/patchUpdated': {
        const item = this.state.items.get(str(p['itemId']) ?? '');
        const files = filesOf(p['changes']);
        if (item?.kind === 'file_change') this.state.upsert({ ...item, files });
        const first = files[0];
        if (first) this.state.emit({ t: 'activity', state: 'preparing_edit', target: first.path });
        return;
      }
      case 'turn/plan/updated':
        this.state.emit({
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
        this.state.emit({
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
        this.state.emit({
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
          this.state.emit({
            t: 'status',
            state: flags.some((f) => f === 'waitingOnApproval' || f === 'waitingOnUserInput')
              ? 'waiting'
              : 'working',
          });
        } else if (type === 'idle') {
          this.state.emit({ t: 'status', state: 'idle' });
        }
        return;
      }
      case 'error': {
        const error = obj(p['error']);
        const message = str(error?.['message']) ?? 'error';
        if (bool(p['willRetry'])) {
          this.state.retryNoticeId ??= `retry-${this.state.turnId}`;
          this.state.notice(this.state.retryNoticeId, 'warning', 'retry', message);
        } else {
          this.state.notice(
            `error-${this.state.turnId}-${this.state.items.size}`,
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
        this.state.notice(
          `warn-${this.state.items.size}`,
          'warning',
          'other',
          str(p['message']) ?? str(p['summary']) ?? method,
        );
        return;
      case 'model/rerouted':
        this.state.notice(
          `reroute-${this.state.turnId}`,
          'info',
          'model_switched',
          `${str(p['fromModel'])} → ${str(p['toModel'])}`,
        );
        return;
      case 'mcpServer/startupStatus/updated': {
        const status = str(p['status']);
        if (status === 'failed')
          this.state.notice(
            `mcp-${str(p['name'])}`,
            'warning',
            'mcp_failed',
            `${str(p['name'])}: ${str(p['error']) ?? status}`,
          );
        return;
      }
      case 'thread/reverted': {
        // The conversation goes back to before the reverted turn: its first item is the target.
        const first = [...this.state.items.values()].find(
          (i) => i.turnId === this.state.revertTurn && !i.parentId,
        );
        if (first) this.state.emit({ t: 'rewound', toItemId: first.id });
        this.state.revertTurn = undefined;
        return;
      }
      case 'serverRequest/resolved': {
        const requestId = p['requestId'];
        if (requestId !== undefined) this.state.requestHandler.closeInteraction(String(requestId));
        return;
      }
      default:
        if (
          SILENT.has(method) ||
          method.startsWith('thread/realtime/') ||
          method.startsWith('fuzzyFileSearch/')
        )
          return;
        this.state.emitUnknown({ method, params: p });
    }
  }
}
