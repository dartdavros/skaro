import type { DecisionSource } from '../shared/project-decisions';
import type { C4ProposalRecord } from './c4-service';

/** Storage wins when a crash separated the confirmed package from its timeline publication. */
export function canonicalC4Decisions(
  source: DecisionSource,
  records: C4ProposalRecord[],
): DecisionSource {
  const owned = records.filter(
    (record) =>
      record.scope.projectId === source.projectId &&
      (source.kind === 'chat'
        ? record.scope.chatId === source.id
        : record.scope.taskId === source.id && record.scope.runId === source.epoch),
  );
  const current = new Map(owned.map((record) => [record.item.id, record.item]));
  const items = source.timeline.items.map((item) => current.get(item.id) ?? item);
  const present = new Set(items.map((item) => item.id));
  for (const record of owned) if (!present.has(record.item.id)) items.push(record.item);
  return { ...source, timeline: { ...source.timeline, items } };
}
