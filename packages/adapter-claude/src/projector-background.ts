import { num, obj, str, type Obj } from '@skaro/timeline';
import { type ToolItem } from './projector-helpers.ts';
import type { ClaudeProjectionState } from './projector-state.ts';

export class ClaudeBackgroundProjection {
  private readonly state: ClaudeProjectionState;
  constructor(state: ClaudeProjectionState) {
    this.state = state;
  }
  onTaskStarted(msg: Obj): void {
    const toolUseId = str(msg['tool_use_id']);
    const item = toolUseId ? (this.state.items.get(toolUseId) as ToolItem | undefined) : undefined;
    if (item?.kind === 'task') {
      this.state.upsert({ ...item, agentType: str(msg['subagent_type']) ?? item.agentType });
    }
  }

  onTaskProgress(msg: Obj): void {
    const toolUseId = str(msg['tool_use_id']);
    const item = toolUseId ? (this.state.items.get(toolUseId) as ToolItem | undefined) : undefined;
    if (item?.kind === 'task') {
      this.state.upsert({
        ...item,
        actions: num(obj(msg['usage'])?.['tool_uses']) ?? item.actions,
      });
    }
  }

  onTaskUpdated(msg: Obj): void {
    const status = str(obj(msg['patch'])?.['status']);
    if (status === 'completed' || status === 'failed' || status === 'killed') {
      this.finishBackground(str(msg['task_id']) ?? '', status === 'killed' ? 'stopped' : 'done');
    }
  }

  onTaskNotification(msg: Obj): void {
    const status = str(msg['status']);
    this.finishBackground(
      str(msg['task_id']) ?? '',
      status === 'stopped' ? 'stopped' : 'done',
      str(msg['summary']),
    );
  }

  finishBackground(taskId: string, state: 'done' | 'stopped', summary?: string): void {
    const itemId = this.state.backgroundItems.get(taskId);
    const item = itemId ? (this.state.items.get(itemId) as ToolItem | undefined) : undefined;
    if (item?.kind !== 'command') return;
    this.state.backgroundItems.delete(taskId);
    this.state.upsert({
      ...item,
      status: state === 'stopped' ? 'interrupted' : 'done',
      endedAt: this.state.ctx.now(),
      background: { taskId, state },
      output: summary && !item.output ? summary : item.output,
    });
  }
}
