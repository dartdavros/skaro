import { type WriteStream } from 'node:fs';
import { SessionSecrets } from './private-input';
import { type AppDb, type AttachmentStore, type ChatRecord } from '@skaro/core';
import type { Grant, McpHttpServer, SkaroScope } from '@skaro/mcp-server';
import {
  Timeline,
  OperationLifetime,
  type AgentSession,
  type Item,
  type Proposal,
  type TimelineEvent,
} from '@skaro/timeline';
import type { EventName, Events } from '../shared/ipc';
import type { AgentManager } from './agents';
import type { Projects } from './projects';

export type ProposalItem = Extract<Item, { kind: 'proposal' }>;

export type PlanProposal = Extract<Proposal, { type: 'plan' }>;

export interface Deps {
  db: AppDb;
  /** App data folder: chats/. */
  dataDir: string;
  projects: Projects;
  agents: AgentManager;
  attachments: AttachmentStore;
  mcp: McpHttpServer<SkaroScope>;
  emit: <E extends EventName>(event: E, payload: Events[E]) => void;
  locale: () => string;
}

export class LiveChat {
  readonly secrets = new SessionSecrets();
  get memoryBytes(): number {
    return this.timeline.retainedBytes;
  }
  readonly projectId: string;
  chat: ChatRecord;
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
  /** Serializes session start and resume. */
  attaching: Promise<AgentSession> | undefined;
  pumping: Promise<void> | undefined;
  readonly operation = new OperationLifetime();
  stopping: Promise<void> | undefined;
  stopError: string | undefined;
  proposalQueue: Promise<void> = Promise.resolve();
  deliveryQueue: Promise<void> = Promise.resolve();
  planningRevision = 0;
  planningContinuations = 0;
  planningTimer: ReturnType<typeof setTimeout> | undefined;
  planningSending = false;
  planningPending: Promise<void> | undefined;
  planningSent = false;
  planningWake = false;

  constructor(projectId: string, chat: ChatRecord, timeline: Timeline) {
    this.projectId = projectId;
    this.chat = chat;
    this.timeline = timeline;
  }
}
