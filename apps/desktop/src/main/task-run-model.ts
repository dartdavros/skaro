import { type WriteStream } from 'node:fs';
import { SessionSecrets } from './private-input';
import { type AppDb, type AttachmentStore, type RunRecord, type ProjectCheck } from '@skaro/core';
import type { Grant, McpHttpServer, SkaroScope } from '@skaro/mcp-server';
import { Timeline, type AgentSession, type TimelineEvent } from '@skaro/timeline';
import type { Events, EventName } from '../shared/ipc';
import type { AgentManager } from './agents';
import type { Projects } from './projects';
import type { NotifyKind } from './notifier';
import type { EnvironmentDocker } from './task-environment-docker';

export interface TaskRunDeps {
  db: AppDb;
  /** App data folder: runs/, worktrees/. */
  dataDir: string;
  projects: Projects;
  agents: AgentManager;
  attachments: AttachmentStore;
  mcp: McpHttpServer<SkaroScope>;
  emit: <E extends EventName>(event: E, payload: Events[E]) => void;
  locale: () => string;
  /** A system notification ("Настройки" → "Уведомления"). */
  notify?: (kind: NotifyKind, text: string, title?: string) => void;
  /** Docker operations of task environments; the system Docker unless a test replaces them. */
  docker?: EnvironmentDocker;
}

/** A task's latest run, with or without an agent process attached. */
export class ActiveRun {
  readonly secrets = new SessionSecrets();
  get memoryBytes(): number {
    return this.timeline.retainedBytes;
  }
  readonly projectId: string;
  readonly taskId: string;
  run: RunRecord;
  readonly timeline: Timeline;
  session: AgentSession | undefined;
  grant: Grant | undefined;
  log: WriteStream | undefined;
  /** Events not yet sent to the renderer. */
  pending: TimelineEvent[] = [];
  /** Events applied to the timeline so far. */
  seq = 0;
  /** Agent processes the run log holds so far ("segment" lines); turns are numbered per segment. */
  segments = 0;
  flushTimer: NodeJS.Timeout | undefined;
  /** Frees the queue slot when the turn that took it ends. */
  release: (() => void) | undefined;
  /** Summary the agent gave to merge_task. */
  mergeSummary: string | undefined;
  /** Commit message the agent proposed for the merge (submit_result, merge_task). */
  commitMessage: string | undefined;
  verification: ProjectCheck[] | undefined;
  /** The merge met a conflict: what the agent of the task is told to do about it. */
  conflictOrder: string | undefined;
  /** The automatic merge that just happened (the agent is told about it). */
  merged: { commit: string; base: string } | undefined;
  /** Serializes session start and resume. */
  attaching: Promise<AgentSession> | undefined;
  /** Work that waits for the running turn to end (cleanup after a merge). */
  afterTurn: (() => Promise<void>) | undefined;
  /** A handoff freezes side effects from the old session until its successor is published. */
  switching = false;
  handoffError: string | undefined;
  readonly operations = new Set<Promise<unknown>>();
  pumping: Promise<void> | undefined;

  constructor(projectId: string, taskId: string, run: RunRecord, timeline: Timeline) {
    this.projectId = projectId;
    this.taskId = taskId;
    this.run = run;
    this.timeline = timeline;
  }
}
