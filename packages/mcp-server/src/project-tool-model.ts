import type { ToolResult } from './server.ts';
import type { SkaroScope } from './tools.ts';
import type { C4DocumentChange } from '@skaro/core';

/** A task the agent proposes; `ref` lets tasks of one call depend on each other. */
export interface ProposedTaskArgs {
  ref: string;
  title: string;
  goal: string;
  criteria: string[];
  notes?: string;
  verificationNotes?: string;
  /** Refs of tasks in the same call or ids of existing tasks (T-004). */
  dependsOn: string[];
  /** Specification the task implements (0003). */
  spec?: string;
}

export interface WriteDocArgs {
  /** brief.md, architecture.md or docs/<name>.md, inside .skaro/. */
  path: string;
  content: string;
  summary?: string;
}

export interface ProposeAdrArgs {
  title: string;
  context: string;
  decision: string;
  consequences: string;
  replaces?: string;
  summary?: string;
}

export interface ProposeSpecArgs {
  c4?: { baseRevision: number; model: unknown; documents: C4DocumentChange[] };
  /** An existing specification to change (0003); without it the specification is new. */
  id?: string;
  title?: string;
  /** New specification Markdown: Problem, Scenarios, Requirements, Out of scope, Open questions. */
  content?: string;
  replaces?: string;
  summary?: string;
}

export type StagedArtifactType =
  'brief' | 'architecture' | 'adr' | 'spec' | 'doc' | 'milestone' | 'task';

/** An artifact of an import, staged until the user applies it (architecture.md 12.4). */
export interface StageArtifactArgs {
  type: StagedArtifactType;
  key: string;
  title?: string;
  /** Markdown text; for a milestone the goal and the done criterion, for a task the goal. */
  body?: string;
  goal?: string;
  doneWhen?: string;
  criteria?: string[];
  notes?: string;
  sources: string[];
  /** An existing ADR or specification number, or a document name, the artifact changes. */
  updates?: string;
  status?: 'proposed' | 'accepted' | 'superseded';
  milestone?: string;
  dependsOn?: string[];
  spec?: string;
  name?: string;
}

export interface FinishImportArgs {
  skipped: { path: string; reason: string }[];
  notes: string[];
}

export interface ProposeMilestonesArgs {
  milestones: { title: string; goal: string; doneWhen: string; tasks: ProposedTaskArgs[] }[];
}

export interface ProposeTasksArgs {
  /** Existing milestone the tasks go to. */
  milestone?: string;
  tasks: ProposedTaskArgs[];
}

export interface UpdateTaskArgs {
  id: string;
  title?: string;
  goal?: string;
  criteria?: string[];
  notes?: string;
  dependsOn?: string[];
  milestone?: string;
}

export interface ProjectToolHandlers {
  replanTasks?: (
    args: import('./task-replan-tool.ts').ReplanTasksArgs,
    scope: SkaroScope,
  ) => Promise<ToolResult>;
  planning?: import('./project-planning-model.ts').ProjectPlanningHandlers;
  context(scope: SkaroScope): Promise<ToolResult>;
  writeDoc(args: WriteDocArgs, scope: SkaroScope): Promise<ToolResult>;
  proposeAdr(args: ProposeAdrArgs, scope: SkaroScope): Promise<ToolResult>;
  proposeSpec(args: ProposeSpecArgs, scope: SkaroScope): Promise<ToolResult>;
  proposeMilestones(args: ProposeMilestonesArgs, scope: SkaroScope): Promise<ToolResult>;
  proposeTasks(args: ProposeTasksArgs, scope: SkaroScope): Promise<ToolResult>;
  updateTask(args: UpdateTaskArgs, scope: SkaroScope): Promise<ToolResult>;
  stageArtifact(args: StageArtifactArgs, scope: SkaroScope): Promise<ToolResult>;
  finishImport(args: FinishImportArgs, scope: SkaroScope): Promise<ToolResult>;
}
