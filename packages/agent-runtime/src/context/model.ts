import type { BuiltinContextConfig } from '@skaro/timeline';

export interface ContextSource {
  id: string;
  path: string;
  kind: BuiltinContextConfig['documents'][number]['kind'] | 'scope-instructions';
  revision: string;
  bytes: number;
  lines: number;
  /** Only applicable scope instructions are pinned verbatim. Documents remain paged data. */
  exactText?: string;
  skill?: { name: string; description: string };
}
export interface ContextSnapshot {
  schema: 1;
  revision: string;
  pins: BuiltinContextConfig['pins'];
  sources: ContextSource[];
}
export interface ContextCheckpoint {
  kind: 'builtin-context';
  schema: 1;
  epoch: number;
  snapshot: ContextSnapshot;
  history: { throughSequence: number; headHash: string };
  /** Source references, not model-authored decisions or rewritten native provider state. */
  historyRefs: { sequence: number; id: string; hash: string; category: string }[];
}
