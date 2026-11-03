import { Timeline } from '@skaro/timeline';
import type { RuntimeJournal } from '../journal.ts';
import type { RuntimeFact } from '../model.ts';

/** A new process closes interrupted model lifecycles, never replays their POSTs or owner inputs. */
export async function recoverModelTurns(journal: RuntimeJournal) {
  const timeline = new Timeline();
  for (const record of journal.records)
    for (const fact of record.facts) if (fact.type === 'timeline') timeline.apply(fact.event);
  const open = new Set(timeline.state.turns.filter((turn) => !turn.outcome).map((turn) => turn.id));
  if (!open.size) return;
  for (const record of [...journal.records]) {
    const value = record.result.value as { kind?: string; modelTurnId?: string } | undefined;
    const modelId =
      record.id.startsWith('model-lifecycle:') && record.id.endsWith(':started')
        ? record.id.slice('model-lifecycle:'.length, -':started'.length)
        : value?.kind === 'owner-input'
          ? value.modelTurnId
          : undefined;
    const start = record.facts.find(
      (fact) => fact.type === 'timeline' && fact.event.t === 'turn.started',
    );
    if (!modelId || start?.type !== 'timeline' || start.event.t !== 'turn.started') continue;
    const turnId = start.event.turnId;
    if (!open.has(turnId)) continue;
    const facts: RuntimeFact[] = timeline.state.items
      .filter((item) => item.turnId === turnId && item.status === 'running')
      .map((item) => ({
        type: 'timeline',
        event: { t: 'item.upsert', item: { ...item, status: 'interrupted', endedAt: Date.now() } },
      }));
    facts.push({
      type: 'timeline',
      event: { t: 'turn.completed', turnId, outcome: 'interrupted' },
    });
    await journal.append(
      `cmd:${modelId}`,
      facts,
      { error: 'Model turn interrupted by process exit; explicit new input required' },
      record.requestHash,
    );
    open.delete(turnId);
  }
}
