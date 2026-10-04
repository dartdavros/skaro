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
  | { kind: 'question'; id: string; questions: Question[]; delivery?: 'async'; itemId?: string }
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
      blockers: ('dirty_base' | 'not_on_base' | 'conflicts' | 'no_changes' | 'criteria')[];
      localChanges?: string[];
      /** Warnings: base commits the branch lacks, and .skaro/ changes that will be dropped. */
      baseAhead: number;
      skaroChanges: string[];
      conflicts: string[];
      /** Commit message the agent proposed, in the repository's convention. */
      message?: string;
      /** The merge of a stage: the tasks that go in, each with the message of its commit. */
      stage?: StageMerge;
    };

export interface StageMerge {
  /** The milestone. */
  id: string;
  tasks: { id: string; title: string; message: string }[];
  /** «Влить готовое»: the finished tasks go in while the stage goes on. */
  partial: boolean;
  /** Readiness criteria that are not ticked: the stage is not merged while there are any. */
  unmet: string[];
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
