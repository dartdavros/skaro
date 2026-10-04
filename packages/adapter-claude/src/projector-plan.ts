import { arr, obj, str, type Obj } from '@skaro/timeline';
import type { ClaudeProjectionState } from './projector-state.ts';

export class ClaudePlanProjection {
  private readonly state: ClaudeProjectionState;
  constructor(state: ClaudeProjectionState) {
    this.state = state;
  }
  onPlanTool(id: string, name: string, input: Obj): void {
    if (name === 'TaskCreate') {
      this.state.pendingTaskCreate.set(id, {
        subject: str(input['subject']) ?? '',
        activeForm: str(input['activeForm']),
      });
    } else if (name === 'TaskUpdate') {
      const taskId = str(input['taskId']);
      if (!taskId) return;
      const step = this.state.plan.get(taskId) ?? {
        id: taskId,
        text: '',
        status: 'pending' as const,
      };
      const status = str(input['status']);
      if (status === 'deleted') {
        this.state.plan.delete(taskId);
      } else {
        if (str(input['subject'])) step.text = str(input['subject']) ?? step.text;
        if (str(input['activeForm'])) step.activeText = str(input['activeForm']);
        if (status)
          step.status =
            status === 'in_progress' ? 'active' : status === 'completed' ? 'done' : 'pending';
        this.state.plan.set(taskId, step);
      }
      this.emitPlan();
    } else if (name === 'TodoWrite') {
      this.state.plan.clear();
      arr(input['todos']).forEach((todo, index) => {
        const t = obj(todo);
        const status = str(t?.['status']);
        this.state.plan.set(String(index), {
          id: String(index),
          text: str(t?.['content']) ?? '',
          activeText: str(t?.['activeForm']),
          status: status === 'in_progress' ? 'active' : status === 'completed' ? 'done' : 'pending',
        });
      });
      this.emitPlan();
    }
  }

  emitPlan(): void {
    this.state.emit({
      t: 'plan.updated',
      steps: [...this.state.plan.values()].map((s) => ({ ...s })),
    });
  }
}
