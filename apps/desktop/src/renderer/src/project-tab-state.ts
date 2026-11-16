import type { ProjectCard } from '../../shared/ipc';

export function projectTabState(
  card: Pick<ProjectCard, 'counts'>,
  pendingDecisions = 0,
): 'working' | 'attention' | 'none' {
  if (pendingDecisions > 0 || card.counts.needs + card.counts.review > 0) return 'attention';
  return card.counts.working > 0 ? 'working' : 'none';
}
