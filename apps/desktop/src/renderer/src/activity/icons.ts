import brain from './assets/brain-glints.svg?raw';
import hammer from './assets/hammer.svg?raw';
import hourglass from './assets/hourglass.svg?raw';
import shapes from './assets/shapes.svg?raw';
import compaction from './assets/compaction.svg?raw';
import type { AgentActivity } from '@skaro/timeline';

/** Owner-supplied SVGs, bundled locally; no agent output is inserted as markup. */
export const activityIcons: Record<AgentActivity, string> = {
  thinking: brain,
  writing: brain,
  preparing_edit: hammer,
  waiting_model: hourglass,
  starting_environment: shapes,
  compacting_context: compaction,
};

export const activityLabel: Record<AgentActivity, string> = {
  thinking: 'feed.live.thinking',
  writing: 'feed.live.writing',
  preparing_edit: 'feed.live.editNoTarget',
  waiting_model: 'feed.live.model',
  starting_environment: 'feed.live.environment',
  compacting_context: 'feed.live.compaction',
};
