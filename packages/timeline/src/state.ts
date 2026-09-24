// Timeline assembled from canonical events: what the task feed and chat render.
// Pure and deterministic, so a raw log always rebuilds the same timeline (principle P2).

import type {
  AgentCapabilities,
  AgentError,
  Interaction,
  Item,
  PlanStep,
  TimelineEvent,
} from './model.ts';

export interface TurnState {
  id: string;
  outcome?: 'done' | 'interrupted' | 'failed';
  error?: AgentError;
}

export interface TimelineState {
  session?: { nativeSessionId: string; model: string; capabilities: AgentCapabilities };
  turns: TurnState[];
  /** Items in the order they first appeared. */
  items: Item[];
  /** The agent plan; undefined until the agent makes one. */
  plan?: PlanStep[];
  /** Interactions waiting for the user. */
  interactions: Interaction[];
  usage?: {
    inputTokens: number;
    outputTokens: number;
    contextWindow?: number;
    contextUsedPct?: number;
  };
  limits?: { state: 'ok' | 'warning' | 'exhausted'; resetsAt?: string };
  /** Live line; cleared when the turn ends. */
  activity?: { state: string; target?: string };
  status: 'working' | 'waiting' | 'idle';
}

export function emptyTimeline(): TimelineState {
  return { turns: [], items: [], interactions: [], status: 'idle' };
}

/** Applies events to a timeline in place (fast path for live sessions). */
export class Timeline {
  readonly state: TimelineState = emptyTimeline();
  private readonly index = new Map<string, number>();

  static from(events: Iterable<TimelineEvent>): Timeline {
    const timeline = new Timeline();
    for (const event of events) timeline.apply(event);
    return timeline;
  }

  apply(event: TimelineEvent): void {
    const s = this.state;
    switch (event.t) {
      case 'session.started':
        s.session = {
          nativeSessionId: event.nativeSessionId,
          model: event.model,
          capabilities: event.capabilities,
        };
        return;
      case 'turn.started':
        if (!s.turns.some((t) => t.id === event.turnId)) s.turns.push({ id: event.turnId });
        s.status = 'working';
        return;
      case 'turn.completed': {
        const turn = s.turns.find((t) => t.id === event.turnId);
        if (turn) {
          turn.outcome = event.outcome;
          if (event.error) turn.error = event.error;
        } else {
          s.turns.push({
            id: event.turnId,
            outcome: event.outcome,
            ...(event.error ? { error: event.error } : {}),
          });
        }
        delete s.activity;
        // Questions and approvals do not outlive the turn that asked them.
        s.interactions = s.interactions.filter((i) => i.kind === 'merge');
        s.status = 'idle';
        return;
      }
      case 'item.upsert': {
        const at = this.index.get(event.item.id);
        if (at === undefined) {
          this.index.set(event.item.id, s.items.length);
          s.items.push({ ...event.item });
        } else {
          s.items[at] = { ...event.item };
        }
        return;
      }
      case 'item.append': {
        const at = this.index.get(event.itemId);
        const item = at === undefined ? undefined : s.items[at];
        if (!item) return;
        if (event.field === 'text' && (item.kind === 'message' || item.kind === 'reasoning')) {
          s.items[at!] = { ...item, text: (item.text ?? '') + event.chunk };
        } else if (event.field === 'output' && item.kind === 'command') {
          s.items[at!] = { ...item, output: item.output + event.chunk };
        }
        return;
      }
      case 'plan.updated':
        s.plan = event.steps.map((step) => ({ ...step }));
        return;
      case 'interaction.opened':
        s.interactions = [
          ...s.interactions.filter((i) => i.id !== event.interaction.id),
          event.interaction,
        ];
        s.status = 'waiting';
        return;
      case 'interaction.closed':
        s.interactions = s.interactions.filter((i) => i.id !== event.id);
        if (!s.interactions.length && s.status === 'waiting') s.status = 'working';
        return;
      case 'usage':
        s.usage = {
          inputTokens: event.inputTokens,
          outputTokens: event.outputTokens,
          ...(event.contextWindow !== undefined ? { contextWindow: event.contextWindow } : {}),
          // A usage report without context data keeps the last known fill.
          ...((event.contextUsedPct ?? s.usage?.contextUsedPct) !== undefined
            ? { contextUsedPct: event.contextUsedPct ?? s.usage?.contextUsedPct }
            : {}),
        };
        return;
      case 'limits':
        s.limits = { state: event.state, ...(event.resetsAt ? { resetsAt: event.resetsAt } : {}) };
        return;
      case 'activity':
        s.activity = { state: event.state, ...(event.target ? { target: event.target } : {}) };
        return;
      case 'status':
        s.status = event.state;
        return;
      case 'rewound':
        this.rewind(event.toItemId);
        return;
    }
  }

  /** Drops the target message and everything after it (the conversation continues from before it). */
  private rewind(toItemId: string): void {
    const at = this.index.get(toItemId);
    if (at === undefined) return;
    const removedTurns = new Set(this.state.items.slice(at).map((i) => i.turnId));
    const keptTurns = new Set(this.state.items.slice(0, at).map((i) => i.turnId));
    this.state.items = this.state.items.slice(0, at);
    this.state.turns = this.state.turns.filter(
      (t) => keptTurns.has(t.id) || !removedTurns.has(t.id),
    );
    this.index.clear();
    this.state.items.forEach((item, i) => this.index.set(item.id, i));
  }
}

/** Items of the main timeline; subagent items (with parentId) are nested under their task. */
export function topLevelItems(state: TimelineState): Item[] {
  return state.items.filter((i) => !i.parentId);
}

export function childItems(state: TimelineState, parentId: string): Item[] {
  return state.items.filter((i) => i.parentId === parentId);
}
