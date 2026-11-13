import type { DecisionAnswer } from '../shared/project-decisions';
import type { InteractionAnswer } from '@skaro/timeline';
export function decisionIsSafety(action: DecisionAnswer): boolean {
  if (action.kind === 'proposal') return action.action.action === 'reject';
  if (action.kind === 'merge') return action.action.action === 'cancel';
  const answer = action.answer;
  return (
    (answer.kind === 'approval' && answer.choice === 'deny') ||
    (answer.kind === 'plan_approval' && answer.approve === false) ||
    (answer.kind === 'form' && answer.action === 'decline') ||
    (answer.kind === 'login' && answer.action === 'cancel')
  );
}
export function safetyDecisionMethod(method: string, args: unknown[]): boolean {
  if (method === 'c4.auditStop') return true;
  if (['task.respond', 'chat.respond', 'incidents.answer'].includes(method)) {
    const answer = args[method === 'incidents.answer' ? 2 : 3] as InteractionAnswer | undefined;
    return !!answer && decisionIsSafety({ kind: 'respond', answer });
  }
  if (method === 'c4.decide') return args[2] === 'reject';
  if (method === 'chat.proposal') return (args[3] as { action?: string })?.action === 'reject';
  return method === 'task.merge' && (args[3] as { action?: string })?.action === 'cancel';
}
