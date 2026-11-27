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
import { isAsyncQuestion, isDeferredInteraction, persistsAfterTurn } from './async-question.ts';
import { StateIndex } from './state-index.ts';
import { StateMemory } from './state-memory.ts';

export interface TurnState {
  id: string;
  outcome?: 'done' | 'interrupted' | 'failed';
  error?: AgentError;
  /** Usage reported by the time the turn ended. */
  usage?: { inputTokens: number; outputTokens: number };
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

function requiresAnswer(interaction: Interaction): boolean {
  return interaction.kind === 'question' && !isDeferredInteraction(interaction);
}

function waitsForInteraction(interaction: Interaction): boolean {
  return interaction.kind !== 'merge' && !isDeferredInteraction(interaction);
}

/** Applies events to a timeline in place (fast path for live sessions). */
export class Timeline {
  readonly state: TimelineState = emptyTimeline();
  private readonly indexed = new StateIndex(this.state);
  private readonly index = this.indexed.items;
  private readonly memory = new StateMemory(this.state);
  get retainedBytes(): number {
    return this.memory.bytes;
  }
  get hasRunningItems(): boolean {
    return this.indexed.busy;
  }
  /** Indexed access for persisted projections; live deltas must not scan the archive. */
  item(id: string): Item | undefined {
    const at = this.index.get(id);
    return at === undefined ? undefined : this.state.items[at];
  }
  position(id: string): number | undefined {
    return this.index.get(id);
  }
  liveItems(turnId: string): Item[] {
    return this.indexed.liveItems(turnId).map((id) => this.item(id)!);
  }
  /** Bounded hydration lets desktop command restoration yield between archive pages. */
  restoreItems(items: Item[]): void {
    for (const item of items) {
      const at = this.state.items.length;
      this.indexed.rememberItem(item, at);
      this.state.items.push(item);
      this.memory.item(item);
    }
  }

  static from(events: Iterable<TimelineEvent>): Timeline {
    const timeline = new Timeline();
    for (const event of events) timeline.apply(event);
    return timeline;
  }

  /** Continues a timeline from a snapshot (the renderer gets one, then live events). */
  static restore(state: TimelineState): Timeline {
    const timeline = new Timeline();
    Object.assign(timeline.state, state);
    if (timeline.state.interactions.some(requiresAnswer)) timeline.state.status = 'waiting';
    else if (
      timeline.state.status === 'waiting' &&
      timeline.state.interactions.some(isDeferredInteraction) &&
      !timeline.state.interactions.some(waitsForInteraction)
    )
      timeline.state.status = timeline.state.turns.some((turn) => !turn.outcome)
        ? 'working'
        : 'idle';
    timeline.indexed.rebuild();
    timeline.memory.rebuild();
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
        this.memory.turn(this.indexed.turn(event.turnId));
        s.status = s.interactions.some(requiresAnswer) ? 'waiting' : 'working';
        return;
      case 'turn.completed': {
        const turn = this.indexed.turn(event.turnId);
        turn.outcome = event.outcome;
        if (event.error) turn.error = event.error;
        this.indexed.complete(event.turnId);
        if (s.usage) {
          turn.usage = { inputTokens: s.usage.inputTokens, outputTokens: s.usage.outputTokens };
        }
        // A turn Skaro ends for a lost agent process gets no closing from the agent itself.
        for (const id of this.indexed.liveItems(event.turnId)) {
          const at = this.index.get(id)!;
          s.items[at] = {
            ...s.items[at]!,
            status: event.outcome === 'done' ? 'done' : 'interrupted',
          };
          this.indexed.rememberItem(s.items[at]!, at);
          this.memory.item(s.items[at]!);
        }
        this.memory.turn(turn);
        this.indexed.clearLive(event.turnId);
        delete s.activity;
        // Async questions wait for a later user message, even after the agent finishes.
        s.interactions = s.interactions.filter(persistsAfterTurn);
        s.status = s.interactions.some(requiresAnswer) ? 'waiting' : 'idle';
        return;
      }
      case 'item.upsert': {
        const at = this.index.get(event.item.id);
        this.indexed.rememberItem(event.item, at ?? s.items.length);
        if (at === undefined) {
          s.items.push({ ...event.item });
        } else {
          s.items[at] = { ...event.item };
        }
        this.memory.item(event.item);
        return;
      }
      case 'item.append': {
        const at = this.index.get(event.itemId);
        const item = at === undefined ? undefined : s.items[at];
        if (!item) return;
        if (event.field === 'text' && (item.kind === 'message' || item.kind === 'reasoning')) {
          this.memory.append(item, event.chunk);
          s.items[at!] = { ...item, text: (item.text ?? '') + event.chunk };
        } else if (event.field === 'output' && item.kind === 'command') {
          this.memory.append(item, event.chunk);
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
        if (waitsForInteraction(event.interaction)) s.status = 'waiting';
        return;
      case 'interaction.closed':
        s.interactions = s.interactions.filter((i) => i.id !== event.id);
        if (!s.interactions.some(waitsForInteraction) && s.status === 'waiting')
          s.status = this.indexed.working ? 'working' : 'idle';
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
        s.status = s.interactions.some(requiresAnswer) ? 'waiting' : event.state;
        return;
      case 'rewound':
        s.interactions = s.interactions.filter((i) => !isAsyncQuestion(i));
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
    this.indexed.rebuild();
    this.memory.rebuild();
  }
}

/** Items of the main timeline; subagent items (with parentId) are nested under their task. */
export function topLevelItems(state: TimelineState): Item[] {
  return state.items.filter((i) => !i.parentId);
}

export function childItems(state: TimelineState, parentId: string): Item[] {
  return state.items.filter((i) => i.parentId === parentId);
}
