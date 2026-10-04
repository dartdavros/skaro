import { arr, num, obj, str, type Obj } from '@skaro/timeline';
import { SILENT_SYSTEM } from './projector-helpers.ts';
import type { ClaudeProjectionState } from './projector-state.ts';

export class ClaudeSystemProjection {
  private readonly state: ClaudeProjectionState;
  constructor(state: ClaudeProjectionState) {
    this.state = state;
  }
  onSystem(msg: Obj): void {
    const subtype = str(msg['subtype']);
    switch (subtype) {
      case 'init': {
        this.state.emit({
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
            this.state.notice(
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
        if (state === 'running') this.state.emit({ t: 'status', state: 'working' });
        else if (state === 'requires_action') this.state.emit({ t: 'status', state: 'waiting' });
        else if (state === 'idle') this.state.emit({ t: 'status', state: 'idle' });
        return;
      }
      case 'api_retry': {
        this.state.retryNoticeId ??= `retry-${this.state.turnId}`;
        const attempt = num(msg['attempt']) ?? 0;
        const max = num(msg['max_retries']) ?? 0;
        this.state.notice(
          this.state.retryNoticeId,
          'warning',
          'retry',
          str(msg['error']) ?? 'retry',
          {
            attempt,
            max,
            inMs: num(msg['retry_delay_ms']) ?? 0,
          },
        );
        return;
      }
      case 'status': {
        if (msg['status'] === 'compacting') {
          this.state.compactionNoticeId = `compaction-${this.state.turnId}-${this.state.items.size}`;
          this.state.notice(
            this.state.compactionNoticeId,
            'info',
            'compaction',
            'compacting',
            undefined,
            'running',
          );
        } else if (str(msg['compact_result']) === 'failed' && this.state.compactionNoticeId) {
          this.state.notice(
            this.state.compactionNoticeId,
            'warning',
            'compaction',
            str(msg['compact_error']) ?? 'failed',
            undefined,
            'failed',
          );
          this.state.compactionNoticeId = undefined;
        }
        return;
      }
      case 'compact_boundary': {
        const id = this.state.compactionNoticeId ?? `compaction-${str(msg['uuid'])}`;
        this.state.notice(id, 'info', 'compaction', 'compacted');
        this.state.compactionNoticeId = undefined;
        return;
      }
      case 'permission_denied': {
        const toolUseId = str(msg['tool_use_id']);
        if (toolUseId) this.state.finishTool(toolUseId, 'declined');
        this.state.notice(
          `denied-${toolUseId}`,
          'warning',
          'denied',
          str(msg['message']) ?? 'denied',
        );
        return;
      }
      case 'model_refusal_fallback':
        this.state.notice(
          `refusal-${str(msg['uuid'])}`,
          'warning',
          'model_switched',
          str(msg['content']) ?? '',
        );
        return;
      case 'model_refusal_no_fallback':
        this.state.notice(
          `refusal-${str(msg['uuid'])}`,
          'error',
          'refusal',
          str(msg['content']) ?? '',
        );
        return;
      case 'informational': {
        const level = str(msg['level']) === 'warning' ? 'warning' : 'info';
        this.state.notice(`info-${str(msg['uuid'])}`, level, 'other', str(msg['content']) ?? '');
        return;
      }
      case 'local_command_output':
        this.state.notice(`cmd-${str(msg['uuid'])}`, 'info', 'other', str(msg['content']) ?? '');
        return;
      case 'task_started':
        return this.state.background.onTaskStarted(msg);
      case 'task_progress':
        return this.state.background.onTaskProgress(msg);
      case 'task_updated':
        return this.state.background.onTaskUpdated(msg);
      case 'task_notification':
        return this.state.background.onTaskNotification(msg);
      case 'background_tasks_changed':
        return;
      default:
        if (subtype && SILENT_SYSTEM.has(subtype)) return;
        this.state.emitUnknown(msg);
    }
  }

  /** Lifecycle of a sent user message (capability msg_lifecycle_v1). */
  onCommandLifecycle(msg: Obj): void {
    const item = this.state.items.get(str(msg['command_uuid']) ?? '');
    if (item?.kind !== 'message' || item.role !== 'user') return;
    const state = str(msg['state']);
    if (state === 'started' && item.status === 'queued')
      this.state.upsert({ ...item, status: 'done' });
    else if (state === 'cancelled' && item.status === 'queued')
      this.state.upsert({ ...item, status: 'interrupted' });
  }
}
