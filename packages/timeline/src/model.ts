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
      error?: AgentError;
    };

export interface AgentCapabilities {
  /** Native tool names the session exposes. */
  tools?: string[];
  /** Agent-specific protocol flags used for feature detection. */
  flags?: string[];
  agentVersion?: string;
}

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
    }
  | { kind: 'unknown'; raw: unknown };

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

export interface Question {
  id: string;
  header: string;
  text: string;
  multi: boolean;
  allowFreeText: boolean;
  secret?: boolean;
  options: { label: string; description?: string; preview?: string }[];
}

export type Interaction =
  | {
      kind: 'approval';
      id: string;
      itemId?: string;
      action: {
        type: 'command' | 'file_write' | 'network' | 'mcp' | 'other';
        title: string;
        command?: string;
        paths?: string[];
        host?: string;
        reason?: string;
      };
      choices: ('allow_once' | 'allow_session' | 'deny')[];
    }
  | { kind: 'question'; id: string; questions: Question[] }
  | { kind: 'plan_approval'; id: string; plan: string }
  | {
      kind: 'form';
      id: string;
      server: string;
      title: string;
      fields: {
        id: string;
        label: string;
        type: 'text' | 'number' | 'select' | 'boolean';
        options?: string[];
        required?: boolean;
      }[];
    }
  | { kind: 'login'; id: string; server: string; url: string }
  | {
      kind: 'merge';
      id: string;
      from: string;
      to: string;
      files: number;
      added: number;
      removed: number;
      /** Hard reasons the merge cannot happen now (core GitService.checkMerge). */
      blockers: ('dirty_base' | 'not_on_base' | 'conflicts' | 'no_changes')[];
      /** Warnings: base commits the branch lacks, and .skaro/ changes that will be dropped. */
      baseAhead: number;
      skaroChanges: string[];
      conflicts: string[];
    };

export type AgentErrorCategory =
  'auth' | 'limit' | 'overloaded' | 'network' | 'context_overflow' | 'refusal' | 'other';

export interface AgentError {
  category: AgentErrorCategory;
  /** Original agent text. */
  message: string;
}

export type ApprovalAnswer =
  | { kind: 'approval'; choice: 'allow_once' | 'allow_session' }
  | { kind: 'approval'; choice: 'deny'; message?: string };

export interface QuestionAnswer {
  kind: 'question';
  /** Question id → selected labels and/or free text. */
  answers: Record<string, string[]>;
}

export interface PlanApprovalAnswer {
  kind: 'plan_approval';
  approve: boolean;
  message?: string;
}

export type InteractionAnswer = ApprovalAnswer | QuestionAnswer | PlanApprovalAnswer;

/** Item as an adapter builds it: turn and start time default to the current ones. */
export type ItemDraft = Item extends infer I
  ? I extends Item
    ? Omit<I, 'turnId' | 'startedAt'> & Partial<Pick<ItemBase, 'turnId' | 'startedAt'>>
    : never
  : never;
