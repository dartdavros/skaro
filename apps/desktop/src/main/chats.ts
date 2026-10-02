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
import { type InteractionAnswer } from '@skaro/timeline';
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

import { ChatEngine } from './chat-engine';
export { titleOf } from './chat-settings-helpers';
export { projectContextText } from './chat-context-text';

export class ChatSessions implements ProjectToolHandlers {
  private readonly engine: ChatEngine;
  constructor(deps: Deps) {
    this.engine = new ChatEngine(deps);
  }
  list(projectId: string): ChatSummary[] {
    return this.engine.views.list(projectId);
  }
  async defaults(projectId: string): Promise<ChatSettings> {
    return this.engine.views.defaults(projectId);
  }
  async open(projectId: string, chatId: string): Promise<ChatView> {
    return this.engine.views.open(projectId, chatId);
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
  async rewind(
    projectId: string,
    chatId: string,
    itemId: string,
    resend?: MessageInput,
  ): Promise<void> {
    return this.engine.conversation.rewind(projectId, chatId, itemId, resend);
  }
  async setSettings(projectId: string, chatId: string, next: ChatSettings): Promise<void> {
    return this.engine.settings.setSettings(projectId, chatId, next);
  }
  async archive(projectId: string, chatId: string, archived: boolean): Promise<void> {
    return this.engine.conversation.archive(projectId, chatId, archived);
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
  async close(): Promise<void> {
    return this.engine.sessions.close();
  }
}
