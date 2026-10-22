import type {
  ProjectToolHandlers,
  FinishImportArgs,
  ProposeAdrArgs,
  ProposeSpecArgs,
  StageArtifactArgs,
  ProposeMilestonesArgs,
  ProposeTasksArgs,
  SkaroScope,
  ToolResult,
  UpdateTaskArgs,
  WriteDocArgs,
} from '@skaro/mcp-server';
import { type InteractionAnswer, type Item } from '@skaro/timeline';
import { assertQuestionsAnswered } from '@skaro/timeline';
import type {
  ChatSettings,
  ChatSummary,
  ChatView,
  ImportReview,
  ImportSource,
  MessageInput,
  ProposalAction,
} from '../shared/ipc';
import type { Deps } from './chat-model';
import type { ChatRange } from '../shared/chat-catalog';
import { background } from './background/client';

import { ChatEngine } from './chat-engine';
import { clearChat } from './chat-clear';
export { titleOf } from './chat-settings-helpers';
export { projectContextText } from './chat-context-text';

export class ChatSessions implements ProjectToolHandlers {
  assertMayWork(chatId: string): void {
    const live = this.engine.live.get(chatId);
    if (live) assertQuestionsAnswered(live.timeline.state);
  }
  async architectureEvent(
    scope: SkaroScope,
    item: Extract<Item, { kind: 'proposal' }>,
  ): Promise<void> {
    if (!scope.chatId) throw new Error('Missing architecture chat');
    const live = await this.engine.history.restore(scope.projectId, scope.chatId);
    const previous = live.timeline.state.items.find((i) => i.id === item.id);
    if (
      previous?.kind === 'proposal' &&
      previous.proposal.type === 'architecture' &&
      item.proposal.type === 'architecture' &&
      previous.proposal.packageId === item.proposal.packageId &&
      previous.state === item.state &&
      previous.result?.error === item.result?.error &&
      previous.proposal.contentRef === item.proposal.contentRef
    )
      return;
    this.engine.history.skaroEvent(live, {
      t: 'item.upsert',
      item: { ...item, turnId: previous?.turnId ?? live.timeline.state.turns.at(-1)?.id ?? '' },
    });
  }
  async stageC4(
    args: import('@skaro/mcp-server').ProposeC4Args,
    scope: SkaroScope,
  ): Promise<ToolResult> {
    return this.engine.importStage.stageC4(args, scope);
  }
  private readonly engine: ChatEngine;
  constructor(deps: Deps) {
    this.engine = new ChatEngine(deps);
  }
  get planning(): NonNullable<ProjectToolHandlers['planning']> {
    return this.engine.planning;
  }
  list(projectId: string): ChatSummary[] {
    return this.engine.views.list(projectId);
  }
  liveRows<T extends { chats: ChatSummary[] }>(page: T): T {
    return {
      ...page,
      chats: page.chats.map((chat) => ({
        ...chat,
        live:
          this.engine.live.get(chat.id)?.timeline.state.status !== undefined &&
          this.engine.live.get(chat.id)?.timeline.state.status !== 'idle',
      })),
    };
  }
  async query(projectId: string, archived: boolean) {
    return this.liveRows(
      await background(this.engine.deps.dataDir, 'chats.query', projectId, archived),
    );
  }
  async page(source: ChatRange, start: number) {
    return this.liveRows(await background(this.engine.deps.dataDir, 'chats.page', source, start));
  }
  find(source: ChatRange, id: string) {
    return background(this.engine.deps.dataDir, 'chats.find', source, id);
  }
  busy(): boolean {
    for (const chat of this.engine.live.values())
      if (chat.timeline.state.status !== 'idle') return true;
    return false;
  }
  activity(): { working: number; waiting: number } {
    let working = 0;
    let waiting = 0;
    for (const chat of this.engine.live.values()) {
      if (chat.timeline.state.status === 'waiting') waiting++;
      else if (chat.timeline.state.status === 'working' || chat.attaching) working++;
    }
    return { working, waiting };
  }
  async defaults(projectId: string): Promise<ChatSettings> {
    return this.engine.views.defaults(projectId);
  }
  async open(projectId: string, chatId: string, options?: { paged: boolean }): Promise<ChatView> {
    return this.engine.views.open(projectId, chatId, options);
  }
  async create(
    projectId: string,
    settings: ChatSettings,
    input: MessageInput,
  ): Promise<ChatSummary> {
    return this.engine.conversation.create(projectId, settings, input);
  }
  async send(projectId: string, chatId: string, input: MessageInput): Promise<void> {
    return this.engine.conversation.send(projectId, chatId, input);
  }
  async respond(
    projectId: string,
    chatId: string,
    interactionId: string,
    answer: InteractionAnswer,
  ): Promise<void> {
    return this.engine.conversation.respond(projectId, chatId, interactionId, answer);
  }
  async interrupt(projectId: string, chatId: string): Promise<void> {
    return this.engine.conversation.interrupt(projectId, chatId);
  }
  async setSettings(projectId: string, chatId: string, next: ChatSettings): Promise<void> {
    return this.engine.settings.setSettings(projectId, chatId, next);
  }
  async archive(projectId: string, chatId: string, archived: boolean): Promise<void> {
    return this.engine.conversation.archive(projectId, chatId, archived);
  }
  clear(projectId: string, chatId: string): Promise<void> {
    return clearChat(this.engine, projectId, chatId);
  }
  async proposal(
    projectId: string,
    chatId: string,
    itemId: string,
    action: ProposalAction,
  ): Promise<void> {
    return this.engine.proposals.proposal(projectId, chatId, itemId, action);
  }
  scanImport(paths: string[]): Promise<ImportSource[]> {
    return this.engine.importStart.scanImport(paths);
  }
  async startImport(
    projectId: string,
    paths: string[],
    settings: ChatSettings,
  ): Promise<ChatSummary> {
    return this.engine.importStart.startImport(projectId, paths, settings);
  }
  async stageArtifact(args: StageArtifactArgs, scope: SkaroScope): Promise<ToolResult> {
    return this.engine.importStage.stageArtifact(args, scope);
  }
  async finishImport(args: FinishImportArgs, scope: SkaroScope): Promise<ToolResult> {
    return this.engine.importStage.finishImport(args, scope);
  }
  async importReview(projectId: string, chatId: string): Promise<ImportReview> {
    return this.engine.importReview.importReview(projectId, chatId);
  }
  async openImportSource(projectId: string, chatId: string, source: string): Promise<string> {
    return this.engine.importReview.openImportSource(projectId, chatId, source);
  }
  async context(scope: SkaroScope): Promise<ToolResult> {
    return this.engine.context.context(scope);
  }
  async operationNotice(
    projectId: string,
    chatId: string,
    text: string,
    error: boolean,
  ): Promise<void> {
    const live = await this.engine.history.restore(projectId, chatId);
    this.engine.history.notice(live, 'other', error ? 'error' : 'info', text);
  }
  async writeDoc(args: WriteDocArgs, scope: SkaroScope): Promise<ToolResult> {
    return this.engine.documents.writeDoc(args, scope);
  }
  async proposeAdr(args: ProposeAdrArgs, scope: SkaroScope): Promise<ToolResult> {
    return this.engine.documents.proposeAdr(args, scope);
  }
  async proposeSpec(args: ProposeSpecArgs, scope: SkaroScope): Promise<ToolResult> {
    return this.engine.documents.proposeSpec(args, scope);
  }
  async proposeMilestones(args: ProposeMilestonesArgs, scope: SkaroScope): Promise<ToolResult> {
    return this.engine.plans.proposeMilestones(args, scope);
  }
  async proposeTasks(args: ProposeTasksArgs, scope: SkaroScope): Promise<ToolResult> {
    return this.engine.plans.proposeTasks(args, scope);
  }
  async updateTask(args: UpdateTaskArgs, scope: SkaroScope): Promise<ToolResult> {
    return this.engine.plans.updateTask(args, scope);
  }
  async replanTasks(
    args: import('@skaro/mcp-server').ReplanTasksArgs,
    scope: SkaroScope,
  ): Promise<ToolResult> {
    return this.engine.replans.tool(args, scope);
  }
  async recoverReplans(): Promise<void> {
    return this.engine.replans.recoverAll();
  }
  async close(): Promise<void> {
    return this.engine.sessions.close();
  }
}
