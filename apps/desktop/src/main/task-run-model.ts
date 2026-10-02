import { type WriteStream } from 'node:fs';
import {
  type AppDb,
  type AttachmentStore,
  type RunRecord,
} from '@skaro/core';
import type { Grant, McpHttpServer, SkaroScope } from '@skaro/mcp-server';
import { Timeline, type AgentSession, type TimelineEvent } from '@skaro/timeline';
import type { Events, EventName } from '../shared/ipc';
import type { AgentManager } from './agents';
import type { Projects } from './projects';
import type { NotifyKind } from './notifier';

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
  notify?: (kind: NotifyKind, text: string) => void;
}

/** A task's latest run, with or without an agent process attached. */
export class ActiveRun {
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
  /** Resolves the queue slot when the first turn ends. */
  release: (() => void) | undefined;
  /** Summary the agent gave to merge_task. */
  mergeSummary: string | undefined;
  /** Commit message the agent proposed for the merge (submit_result, merge_task). */
  commitMessage: string | undefined;
  /** The automatic merge that just happened (the agent is told about it). */
  merged: { commit: string; base: string } | undefined;
  /** Serializes session start and resume. */
  attaching: Promise<AgentSession> | undefined;
  /** Work that waits for the running turn to end (cleanup after a merge). */
  afterTurn: (() => Promise<void>) | undefined;

  constructor(projectId: string, taskId: string, run: RunRecord, timeline: Timeline) {
    this.projectId = projectId;
    this.taskId = taskId;
    this.run = run;
    this.timeline = timeline;
  }
}
