/** Reported primary receipts only. Missing billing is never a zero cost or subscription quota. */
export interface ModelUsageSummary {
  checkedAt: string;
  requests: number;
  responses: number;
  costsUnreported: number;
  reportedCost: { currency: string; amount: string }[];
  knownInputTokens: number;
  knownOutputTokens: number;
  tokensUnreported: number;
  unavailableSessions: number;
}
export interface ModelUsageMethods {
  'models.usage': (projectId: string) => ModelUsageSummary;
}
export interface ModelUsageSource {
  kind: 'tasks' | 'chats';
  id: string;
  sessionId: string;
}
