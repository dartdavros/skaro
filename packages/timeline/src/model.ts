import type { Proposal, ProposalState, ProposalResult } from './proposal-model.ts';
export type * from './proposal-model.ts';
import type { AgentCapabilities, AgentError } from './session-model.ts';
export type * from './session-model.ts';
import type { Interaction, InteractionAnswer } from './interactions.ts';
export type * from './interactions.ts';

// Canonical agent timeline model (docs/agent-output.md, section 3).
// The UI only knows these types; adapters project native agent output into them.

export type TimelineEvent =
  | {
      t: 'session.started';
      nativeSessionId: string;
      model: string;
      capabilities: AgentCapabilities;
    }
  | { t: 'turn.started'; turnId: string }
  | { t: 'item.upsert'; item: Item }
  | { t: 'item.append'; itemId: string; field: 'text' | 'output'; chunk: string }
  | { t: 'plan.updated'; steps: PlanStep[] }
  | { t: 'interaction.opened'; interaction: Interaction }
  | { t: 'interaction.closed'; id: string; resolution: 'answered' | 'cancelled' | 'expired' }
  | {
      t: 'usage';
      inputTokens: number;
      outputTokens: number;
      contextWindow?: number;
      contextUsedPct?: number;
    }
  | {
      t: 'activity';
      state: 'thinking' | 'writing' | 'preparing_edit' | 'waiting_model';
      target?: string;
    }
  | { t: 'rewound'; toItemId: string }
  | { t: 'limits'; state: 'ok' | 'warning' | 'exhausted'; resetsAt?: string }
  | { t: 'status'; state: 'working' | 'waiting' | 'idle' }
  | {
      t: 'turn.completed';
      turnId: string;
      outcome: 'done' | 'interrupted' | 'failed';
      /** Internal interruption followed by another turn in the same running task. */
      continuing?: boolean;
      error?: AgentError;
    };

export type ItemStatus = 'queued' | 'running' | 'done' | 'failed' | 'declined' | 'interrupted';

export interface ItemBase {
  id: string;
  turnId: string;
  /** Items produced by a subagent. */
  parentId?: string;
  status: ItemStatus;
  /** Timestamps are set by Skaro, not taken from the agent. */
  startedAt: number;
  endedAt?: number;
  native: { agent: string; type: string; ref: string };
}

export interface FileChange {
  path: string;
  change: 'add' | 'update' | 'delete' | 'move';
  movePath?: string;
  diff?: string;
  added?: number;
  removed?: number;
}

export type ItemBody =
  | {
      kind: 'message';
      role: 'user' | 'agent';
      text: string;
      phase?: 'commentary' | 'final' | 'plan';
    }
  | { kind: 'reasoning'; text?: string; redacted?: boolean }
  | {
      kind: 'explore';
      op: 'read' | 'search' | 'list' | 'fetch' | 'web';
      target: string;
      detail?: string;
      image?: ImageRef;
    }
  | { kind: 'file_change'; files: FileChange[] }
  | {
      kind: 'command';
      command: string;
      description?: string;
      output: string;
      outputLive: boolean;
      exitCode?: number;
      durationMs?: number;
      awaitingInput?: boolean;
      background?: { taskId: string; state: 'running' | 'done' | 'stopped' };
      image?: ImageRef;
    }
  | { kind: 'task'; title: string; agentType?: string; summary?: string; actions?: number }
  | {
      kind: 'image';
      source: 'viewed' | 'tool' | 'generated';
      image: ImageRef;
      caption?: string;
    }
  | {
      kind: 'tool';
      name: string;
      server?: string;
      input?: string;
      output?: string;
      images?: ImageRef[];
    }
  | {
      kind: 'notice';
      level: 'info' | 'warning' | 'error';
      code: NoticeCode;
      text: string;
      retry?: { attempt: number; max: number; inMs: number };
      /** Exact base before publication, retained in the run log for rebase merge reversal. */
      merge?: { before: string; strategy: 'squash' | 'merge' | 'rebase' };
    }
  | { kind: 'unknown'; raw: unknown }
  /**
   * Import of documentation (architecture.md 12): the copy of the sources Skaro prepared, added
   * by Skaro at the start of the import chat.
   */
  | {
      kind: 'import_prep';
      /** Files the agent reads (as they are or converted to text). */
      prepared: number;
      skipped: number;
      files: { path: string; note: string; skipped: boolean }[];
    }
  /** The user's answer to an interaction, added by Skaro (not by adapters) so the feed keeps it. */
  | { kind: 'decision'; interaction: Interaction; answer: InteractionAnswer }
  /**
   * A change the chat agent proposed through Skaro's MCP tools (agent-output.md 5.4), added by
   * Skaro. The tool does not hold the turn: the card stays in the feed and the user decides later.
   */
  | {
      kind: 'proposal';
      proposal: Proposal;
      state: ProposalState;
      /** What Skaro created when the proposal was accepted. */
      result?: ProposalResult;
    };

export type NoticeCode =
  | 'auth'
  | 'rate_limit'
  | 'retry'
  | 'compaction'
  | 'refusal'
  | 'denied'
  | 'model_switched'
  | 'mcp_failed'
  | 'session_restored'
  | 'session_lost'
  /** Skaro merged the task branch (text: target branch, native.ref: commit). */
  | 'merged'
  | 'other';

export type Item = ItemBase & ItemBody;

export interface PlanStep {
  id: string;
  text: string;
  activeText?: string;
  status: 'pending' | 'active' | 'done';
}

/**
 * Images never travel through the timeline as base64. The adapter stores bytes in
 * attachments/<sha256>.<ext>; the timeline and the raw log keep only the reference.
 */
export interface ImageRef {
  id: string;
  mime: string;
  width?: number;
  height?: number;
  /** File in the project, if the image comes from there. */
  path?: string;
  /** Image referenced by URL in agent Markdown; loaded only on click. */
  remoteUrl?: string;
}

/** Item as an adapter builds it: turn and start time default to the current ones. */
export type ItemDraft = Item extends infer I
  ? I extends Item
    ? Omit<I, 'turnId' | 'startedAt'> & Partial<Pick<ItemBase, 'turnId' | 'startedAt'>>
    : never
  : never;
