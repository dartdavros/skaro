import type { AgentInfo, ChatSummary } from '../../../shared/ipc';
export type ImportProps = {
  projectId: string;
  agents: AgentInfo[];
  onclose: () => void;
  onstart: (chat: ChatSummary) => void;
};
