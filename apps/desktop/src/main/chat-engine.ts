import type { ProjectContext } from './projects';

import { LiveChat, type Deps } from './chat-model';
import { ChatViews } from './chat-views';
import { ChatConversation } from './chat-conversation';
import { ChatConfiguration } from './chat-settings';
import { ChatProposals } from './chat-proposals';
import { ChatPlan } from './chat-plan';
import { ChatImportStart } from './chat-import-start';
import { ChatImportStage } from './chat-import-stage';
import { ChatImportReview } from './chat-import-review';
import { ChatDocuments } from './chat-documents';
import { ChatPlans } from './chat-plans';
import { ChatContext } from './chat-context';
import { ChatSessions } from './chat-sessions';
import { ChatHistory } from './chat-history';
import { ChatPlanning } from './chat-planning';
import { ChatPlanningContinuation } from './chat-planning-continuation';
import { ChatPlanDecisions } from './chat-plan-decisions';
import { ChatPlanReview } from './chat-plan-review';
import { ChatTaskReplans } from './chat-task-replans';
export class ChatEngine {
  closing = false;
  readonly live = new Map<string, LiveChat>();
  readonly views = new ChatViews(this);
  readonly conversation = new ChatConversation(this);
  readonly settings = new ChatConfiguration(this);
  readonly proposals = new ChatProposals(this);
  readonly plan = new ChatPlan(this);
  readonly importStart = new ChatImportStart(this);
  readonly importStage = new ChatImportStage(this);
  readonly importReview = new ChatImportReview(this);
  readonly documents = new ChatDocuments(this);
  readonly plans = new ChatPlans(this);
  readonly context = new ChatContext(this);
  readonly sessions: ChatSessions;
  readonly history = new ChatHistory(this);
  readonly planning = new ChatPlanning(this);
  readonly planningContinuation = new ChatPlanningContinuation(this);
  readonly planDecisions = new ChatPlanDecisions(this);
  readonly planReview = new ChatPlanReview(this);
  readonly replans = new ChatTaskReplans(this);
  readonly deps: Deps;
  constructor(deps: Deps) {
    this.deps = deps;
    this.sessions = new ChatSessions(this);
  }
  listChanged(projectId: string, chatId?: string): void {
    this.deps.emit('chats.changed', { projectId, ...(chatId ? { chatId } : {}) });
  }
  project(projectId: string): ProjectContext {
    return this.deps.projects.get(projectId);
  }
}
