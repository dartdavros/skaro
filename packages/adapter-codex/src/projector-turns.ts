import { obj, str, type Obj } from '@skaro/timeline';
import { isPermissionContinuation } from './session-input.ts';
import { errorCategory } from './projector-helpers.ts';
import type { CodexProjectionState } from './projector-state.ts';

export class CodexTurns {
  private readonly state: CodexProjectionState;
  constructor(state: CodexProjectionState) {
    this.state = state;
  }
  onTurnCompleted(turn: Obj): void {
    const status = str(turn['status']);
    const error = obj(turn['error']);
    const outcome =
      status === 'interrupted' ? 'interrupted' : status === 'failed' ? 'failed' : 'done';
    const turnId = str(turn['id']) ?? this.state.turnId;
    for (const item of this.state.items.values()) {
      // An item without item/completed by the end of the turn never finished (e.g. the sandbox
      // failed to start the process).
      if (item.turnId === turnId && item.status === 'running') {
        this.state.upsert({
          ...item,
          status: outcome === 'interrupted' ? 'interrupted' : 'failed',
          endedAt: this.state.ctx.now(),
        });
      }
    }
    this.state.emit({
      t: 'turn.completed',
      turnId,
      outcome,
      error:
        outcome === 'failed'
          ? { category: errorCategory(error), message: str(error?.['message']) ?? '' }
          : undefined,
    });
    // Codex does not ask to approve a plan: a plan made in plan mode waits for the next turn.
    const plan = [...this.state.items.values()].find(
      (i) => i.turnId === turnId && i.kind === 'message' && i.phase === 'plan' && !i.parentId,
    );
    if (outcome === 'done' && this.state.planTurns.has(turnId) && plan?.kind === 'message') {
      this.state.openPlan = `plan-${turnId}`;
      this.state.emit({
        t: 'interaction.opened',
        interaction: { kind: 'plan_approval', id: this.state.openPlan, plan: plan.text },
      });
    }
  }

  /** Skaro's turn/start: the answer to an open plan approval, and whether it plans again. */
  onTurnStartRequest(params: Obj): void {
    this.state.nextContinuation = isPermissionContinuation(params['input']);
    if (this.state.openPlan) {
      this.state.emit({ t: 'interaction.closed', id: this.state.openPlan, resolution: 'answered' });
      this.state.openPlan = undefined;
    }
    this.state.nextTurnPlans = obj(params['collaborationMode'])?.['mode'] === 'plan';
  }
}
