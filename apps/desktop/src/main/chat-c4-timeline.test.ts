import { expect, it } from 'vitest';
import { emptyTimeline } from '@skaro/timeline';
import type { C4ProposalRecord } from './c4-service';
import { chatC4Timeline } from './chat-c4-timeline';

// Pure delivery/ownership metadata; no backend, agent, filesystem fixture or seeded project.
const record: C4ProposalRecord = {
  scope: { kind: 'project_chat', projectId: 'project', chatId: 'general-chat' },
  package: {
    id: 'package',
    title: 'Specification and C4',
    summary: '',
    baseRevision: 1,
    files: [],
  },
  item: {
    id: 'skaro-c4-package',
    kind: 'proposal',
    turnId: 'completed-turn',
    status: 'done',
    state: 'pending',
    startedAt: 0,
    native: { agent: 'skaro', type: 'proposal', ref: 'architecture' },
    proposal: {
      type: 'architecture',
      packageId: 'package',
      title: 'Specification and C4',
      summary: '',
      baseRevision: 1,
    },
  },
};

it('recovers a saved decision missing from the paged general-chat timeline and keeps it once', () => {
  const initial = emptyTimeline();
  const recovered = chatC4Timeline('project', 'general-chat', initial, [record]);
  expect(recovered.items).toEqual([record.item]);
  expect(chatC4Timeline('project', 'general-chat', recovered, [record]).items).toEqual([
    record.item,
  ]);
  expect(initial.items).toEqual([]);
});

it('uses the saved decision state without adding resolved history or another conversation', () => {
  const initial = { ...emptyTimeline(), items: [record.item] };
  const applied: C4ProposalRecord = { ...record, item: { ...record.item, state: 'applied' } };
  expect(chatC4Timeline('project', 'general-chat', initial, [applied]).items).toEqual([
    applied.item,
  ]);
  expect(chatC4Timeline('project', 'general-chat', emptyTimeline(), [applied]).items).toEqual([]);
  expect(chatC4Timeline('project', 'other-chat', emptyTimeline(), [record]).items).toEqual([]);
  expect(chatC4Timeline('other-project', 'general-chat', emptyTimeline(), [record]).items).toEqual(
    [],
  );
});
