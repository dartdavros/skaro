import { agentCatalog, agentName } from '@skaro/agents/catalog';
import { t } from '@skaro/ui';
import type { MilestoneInfo } from '../../../shared/ipc';
import type { TaskFacets } from '../../../shared/task-catalog';
import { STATUS_META, STATUS_ORDER } from './model';
export function toolbarOptions(milestones: MilestoneInfo[], facets?: TaskFacets) {
  const msOptions = [
    ...milestones.map((m) => ({
      value: m.id,
      label: m.title,
      short: m.id,
      count: facets?.milestones[m.id] ?? 0,
    })),
    // "Без этапа": tasks without a milestone.
    {
      value: '',
      label: t('board.loose'),
      short: '',
      count: facets?.milestones[''] ?? 0,
    },
  ];
  const stOptions = STATUS_ORDER.map((s) => ({
    value: s,
    label: t(STATUS_META[s].label),
    count: facets?.statuses[s] ?? 0,
  }));
  const agOptions = [...agentCatalog().map((agent) => agent.id), 'none'].map((a) => ({
    value: a as string,
    label: a === 'none' ? t('board.f.none') : agentName(a),
    count: facets?.agents[a] ?? 0,
  }));
  return { msOptions, stOptions, agOptions };
}
