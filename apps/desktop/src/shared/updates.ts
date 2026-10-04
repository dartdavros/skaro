import type { AgentId } from './ipc';

export interface UpdateComponent {
  id: 'skaro' | AgentId;
  current: string;
  latest: string;
  url: string;
}

/** Single main-process snapshot shared by the title bar, settings and modal. */
export interface UpdateState {
  current: string;
  phase: 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'applying' | 'error';
  components: UpdateComponent[];
  checked: boolean;
  busy: boolean;
  installable: boolean;
  error?: string;
  progress?: number;
  retry?: 'check' | 'download' | 'apply';
}
