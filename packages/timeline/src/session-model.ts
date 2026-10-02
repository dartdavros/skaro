export interface AgentCapabilities {
  /** Native tool names the session exposes. */
  tools?: string[];
  /** Agent-specific protocol flags used for feature detection. */
  flags?: string[];
  agentVersion?: string;
}

export type AgentErrorCategory =
  'auth' | 'limit' | 'overloaded' | 'network' | 'context_overflow' | 'refusal' | 'other';

export interface AgentError {
  category: AgentErrorCategory;
  /** Original agent text. */
  message: string;
}
