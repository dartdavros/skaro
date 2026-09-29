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

export type ProposalState = 'pending' | 'applied' | 'rejected' | 'reverted';

/** A task in a proposed plan; `ref` links tasks of the same proposal to each other. */
export interface ProposedTask {
  ref: string;
  title: string;
  /** Task file body: "Цель", "Критерии приёмки", "Заметки". */
  body: string;
  /** Refs of tasks in this chat's proposals or ids of existing tasks. */
  dependsOn: string[];
  /** Titles of those tasks, for "после «…»" on the card. */
  dependsOnTitles: string[];
  /** Specification the task implements ("0003"). */
  spec?: string;
}

export type Proposal =
  | {
      /** brief.md, architecture.md or docs/<name>.md, written as a whole. */
      type: 'doc';
      /** Path inside .skaro/. */
      path: string;
      /** Undefined when the document is new. */
      before?: string;
      after: string;
      /** What changed, in the agent's words. */
      summary?: string;
    }
  | {
      type: 'adr';
      /** Number the ADR gets if accepted now, e.g. "0007". */
      id: string;
      title: string;
      body: string;
      /** ADR it replaces. */
      replaces?: string;
      /** A sentence or two for the card. */
      summary?: string;
    }
  | {
      /** A new specification (architecture.md 3.7). */
      type: 'spec';
      /** Number the specification gets if accepted now, e.g. "0003". */
      id: string;
      title: string;
      body: string;
      /** Specification it replaces. */
      replaces?: string;
      /** A sentence or two for the card. */
      summary?: string;
    }
  | {
      /** A change to an existing specification, written as a whole. */
      type: 'spec_change';
      id: string;
      title: string;
      before: string;
      after: string;
      summary?: string;
    }
  | {
      /** A milestone with its tasks, or tasks for an existing milestone. */
      type: 'plan';
      milestone?: { id: string; title: string; body?: string; isNew: boolean };
      tasks: ProposedTask[];
    }
  | {
      /** "Импорт готов": what the import agent staged, decided on the review screen. */
      type: 'import';
      /** Id of the import (its folder in the app data). */
      id: string;
      /** A line per kind of artifact: "Бриф", "4 ADR", "2 этапа · 6 задач". */
      groups: { kind: ImportKind; count: number; tasks?: number; updates: number }[];
      /** Items in all, as the review screen counts them. */
      total: number;
      skipped: number;
      notes: number;
    }
  | {
      /** Changes to an existing task. */
      type: 'task';
      id: string;
      title: string;
      /** Task as text before and after, for the diff. */
      before: string;
      after: string;
      patch: {
        title?: string;
        body?: string;
        dependsOn?: string[];
        milestone?: string;
      };
    };

export interface ProposalResult {
  milestone?: { id: string; title: string };
  /** Created tasks; `ref` links them to the proposal (later cards may depend on them). */
  tasks?: { id: string; title: string; ref: string }[];
  adr?: { id: string; title: string };
  spec?: { id: string; title: string };
  /** Import: what was written, for "Изменено в чате" and the summary line. */
  imported?: { kind: ImportKind; code?: string; title: string; update: boolean }[];
  /** Import: items applied of all. */
  applied?: number;
}

export type ImportKind = 'brief' | 'architecture' | 'adr' | 'spec' | 'doc' | 'plan';

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
      /** Commit message the agent proposed, in the repository's convention. */
      message?: string;
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

/** MCP form: submitted values by field id, or declined. */
export interface FormAnswer {
  kind: 'form';
  action: 'accept' | 'decline';
  values?: Record<string, string | number | boolean>;
}

/** MCP sign-in in the browser finished or was cancelled. */
export interface LoginAnswer {
  kind: 'login';
  action: 'done' | 'cancel';
}

export type InteractionAnswer =
  ApprovalAnswer | QuestionAnswer | PlanApprovalAnswer | FormAnswer | LoginAnswer;

/** Item as an adapter builds it: turn and start time default to the current ones. */
export type ItemDraft = Item extends infer I
  ? I extends Item
    ? Omit<I, 'turnId' | 'startedAt'> & Partial<Pick<ItemBase, 'turnId' | 'startedAt'>>
    : never
  : never;
