import type { Interaction, InteractionAnswer, Item, TimelineState } from '@skaro/timeline';
import type { MergeAction, ProposalAction } from './ipc-sessions';

export interface DecisionOrigin {
  projectId: string;
  kind: 'task' | 'chat';
  id: string;
  title: string;
  epoch: string;
  cwd?: string;
}
export type DecisionPayload =
  | { kind: 'interaction'; interaction: Interaction }
  | { kind: 'proposal'; item: Extract<Item, { kind: 'proposal' }> };
export type ProjectDecision = DecisionPayload & {
  id: string;
  revision: string;
  /** Host-verified controller deadline; reaching it invalidates the read model, never grants authority. */
  expiresAt?: number;
  origin: DecisionOrigin;
};
export interface DecisionSource extends DecisionOrigin {
  timeline: TimelineState;
  /** Composed integration interactions retain their own originating turn, not the base task's. */
  requestEpochs?: Record<string, string>;
}
export type DecisionAnswer =
  | { kind: 'respond'; answer: InteractionAnswer }
  | { kind: 'proposal'; action: ProposalAction }
  | { kind: 'merge'; action: MergeAction };
/** The saved outcome is shared by the receipt and every presentation. */
export function decisionAnswerOutcome(answer: DecisionAnswer): 'answered' | 'denied' {
  return (answer.kind === 'respond' &&
    answer.answer.kind === 'approval' &&
    answer.answer.choice === 'deny') ||
    (answer.kind === 'proposal' && answer.action.action === 'reject') ||
    (answer.kind === 'merge' && answer.action.action === 'cancel')
    ? 'denied'
    : 'answered';
}
export interface ProjectDecisionMethods {
  'decisions.list': (projectId: string) => Promise<ProjectDecision[]>;
  'decisions.answer': (
    projectId: string,
    id: string,
    revision: string,
    answer: DecisionAnswer,
  ) => Promise<void>;
  'decisions.status': (
    projectId: string,
    id: string,
    revision: string,
  ) => 'expired' | 'answered' | 'denied' | 'stale';
}
