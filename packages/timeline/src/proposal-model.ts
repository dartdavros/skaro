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
