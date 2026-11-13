import { expect, it } from 'vitest';
import { emptyTimeline, type Interaction } from '@skaro/timeline';
import {
  decisionTimeline,
  taskDecisionTimeline,
  integrationDecisionLive,
  projectDecisionProjection,
} from './decision-projection';
import type { DecisionSource } from '../shared/project-decisions';

const approval: Interaction = {
  kind: 'approval',
  id: 'native-observation',
  action: { type: 'other', title: 'Observation' },
  choices: ['allow_once', 'deny'],
};
const source = (id: string): DecisionSource => ({
  projectId: process.cwd(),
  kind: 'task',
  id,
  title: id,
  epoch: 'observed',
  timeline: { ...emptyTimeline(), interactions: [approval] },
});
it('keeps genuine pending choices but excludes an obsolete merge after task completion without rewriting history', () => {
  const merge: Interaction = {
    kind: 'merge',
    id: 'previous-merge',
    from: 'task',
    to: 'main',
    files: 1,
    added: 1,
    removed: 0,
    blockers: [],
    baseAhead: 0,
    skaroChanges: [],
    conflicts: [],
  };
  const question: Interaction = { ...approval, id: 'coordinator:still-pending', delivery: 'async' };
  const state = { ...emptyTimeline(), interactions: [merge, question] };
  expect(taskDecisionTimeline(state, false, false).interactions).toEqual([merge, question]);
  expect(taskDecisionTimeline(state, false, true).interactions).toEqual([question]);
  expect(state.interactions).toEqual([merge, question]);
});
it('keeps accepted architecture in the source while removing it from unanswered decisions', () => {
  const entry = source('architecture-owner');
  entry.timeline.interactions = [];
  entry.timeline.items = [
    {
      id: 'skaro-c4-observed',
      kind: 'proposal',
      turnId: '',
      status: 'done',
      state: 'accepted',
      startedAt: 0,
      native: { agent: 'skaro', type: 'proposal', ref: 'architecture' },
      proposal: {
        type: 'architecture',
        packageId: 'observed',
        title: 'Architecture',
        summary: 'Protocol metadata',
        baseRevision: 1,
      },
    },
  ];
  expect(projectDecisionProjection([entry])).toEqual([]);
  expect(entry.timeline.items[0]!.kind === 'proposal' && entry.timeline.items[0]!.state).toBe(
    'accepted',
  );
  entry.timeline.items[0] = {
    ...entry.timeline.items[0]!,
    state: 'pending',
  } as (typeof entry.timeline.items)[number];
  expect(projectDecisionProjection([entry])).toHaveLength(1);
});
it('drops an expired native permission but keeps durable controller approvals without attaching an executor', () => {
  const state = {
    ...emptyTimeline(),
    interactions: [
      approval,
      { ...approval, id: 'coordinator:observation', delivery: 'async' as const },
    ],
  };
  expect(decisionTimeline(state, false).interactions.map((i) => i.id)).toEqual([
    'coordinator:observation',
  ]);
  expect(decisionTimeline(state, true).interactions).toHaveLength(2);
});
it('uses source-scoped IDs, shares a controller decision and refuses conflicting presentations', () => {
  expect(projectDecisionProjection([source('one'), source('two')])).toHaveLength(2);
  const a = source('one'),
    b = source('two');
  a.timeline.interactions = [{ ...approval, id: 'coordinator:observation' }];
  b.timeline.interactions = [...a.timeline.interactions];
  expect(projectDecisionProjection([a, b])).toHaveLength(1);
  b.timeline.interactions = [{ ...approval, id: 'coordinator:observation', choices: ['deny'] }];
  expect(() => projectDecisionProjection([a, b])).toThrow('decision_projection_conflict');
});
it('distinguishes identical native request counters from different turns of the same run', () => {
  const first = source('same-owner'),
    second = source('same-owner');
  first.timeline.turns = [{ id: 'observed-turn-one' }];
  second.timeline.turns = [{ id: 'observed-turn-two' }];
  expect(projectDecisionProjection([first, second])).toHaveLength(2);
  expect(decisionTimeline(first.timeline, true).turns).toEqual(first.timeline.turns);
});
it('keeps decision identity and receipt revision when only the source title changes', () => {
  const first = source('same-owner'),
    renamed = { ...first, title: 'Renamed source', cwd: process.cwd() };
  const before = projectDecisionProjection([first])[0]!;
  const after = projectDecisionProjection([renamed])[0]!;
  expect(after.id).toBe(before.id);
  expect(after.revision).toBe(before.revision);
});
it('keeps an integration request in its own turn namespace inside a composed task', () => {
  const first = source('base-task'),
    second = source('base-task');
  first.timeline.turns = second.timeline.turns = [{ id: 'base-turn' }];
  first.requestEpochs = { [approval.id]: 'integration-turn-one' };
  second.requestEpochs = { [approval.id]: 'integration-turn-two' };
  const projected = projectDecisionProjection([first, second]);
  expect(projected).toHaveLength(2);
  expect(projected[0]!.origin).not.toHaveProperty('requestEpochs');
});
it('requires the attached integration channel and its own current open turn for native permissions', () => {
  const state = emptyTimeline();
  state.turns = [{ id: 'integration-observed:current-worker:turn' }];
  expect(integrationDecisionLive(state, 'observed')).toBe(false);
  expect(integrationDecisionLive(state, 'observed', 'old-worker')).toBe(false);
  expect(integrationDecisionLive(state, 'observed', 'current-worker')).toBe(true);
  state.interactions = [
    { ...approval, id: 'integration-observed:old-worker:req-0' },
    { ...approval, id: 'integration-observed:current-worker:req-0' },
  ];
  expect(
    decisionTimeline(state, true, 'integration-observed:current-worker:').interactions.map(
      (i) => i.id,
    ),
  ).toEqual(['integration-observed:current-worker:req-0']);
  state.turns[0]!.outcome = 'done';
  expect(integrationDecisionLive(state, 'observed', 'current-worker')).toBe(false);
});
