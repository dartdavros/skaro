import { expect, it } from 'vitest';
import type { ProposalItem } from './chat-model';
import { chatC4DecisionNote, chatC4FeedbackId } from './chat-c4-feedback';

// Decision metadata only; no agent, API, backend or filesystem fixture.
const proposal: ProposalItem = {
  id: 'saved-package',
  kind: 'proposal',
  turnId: 'current-turn',
  state: 'pending',
  status: 'done',
  startedAt: 0,
  native: { agent: 'skaro', type: 'proposal', ref: 'architecture' },
  proposal: {
    type: 'architecture',
    packageId: 'saved-package',
    title: 'Specification and C4',
    summary: '',
    baseRevision: 1,
  },
};

it('replaces an earlier pending receipt with the confirmed outcome during the same turn', () => {
  const applied = { ...proposal, state: 'applied' as const };
  expect(chatC4DecisionNote(proposal, applied)).toContain('"state":"applied"');
  expect(chatC4DecisionNote(proposal, applied)).toContain('get_c4_context');
  expect(chatC4DecisionNote({ ...proposal, state: 'accepted' }, applied)).toContain(
    '"state":"applied"',
  );
  expect(chatC4DecisionNote(proposal, { ...proposal, state: 'rejected' })).toContain(
    'Do not apply or propose it again',
  );
  expect(chatC4DecisionNote(applied, applied)).toBeUndefined();
  expect(chatC4DecisionNote(undefined, applied)).toBeUndefined();
});

it('distinguishes application failure from an unanswered owner decision', () => {
  expect(chatC4DecisionNote(proposal, { ...proposal, state: 'accepted' })).toBeUndefined();
  const note = chatC4DecisionNote(proposal, {
    ...proposal,
    state: 'accepted',
    result: { error: 'Application interrupted' },
  });
  expect(note).toContain('"state":"accepted"');
  expect(note).toContain('"applicationError":"Application interrupted"');
  expect(note).toContain('not a missing owner decision');
});

it('uses a stable command identity accepted by the bundled runtime for each decision fact', () => {
  const applied = chatC4DecisionNote(proposal, { ...proposal, state: 'applied' })!;
  const rejected = chatC4DecisionNote(proposal, { ...proposal, state: 'rejected' })!;
  expect(chatC4FeedbackId(applied)).toMatch(/^[a-zA-Z0-9_-]{1,160}$/);
  expect(chatC4FeedbackId(applied)).toBe(chatC4FeedbackId(applied));
  expect(chatC4FeedbackId(applied)).not.toBe(chatC4FeedbackId(rejected));
});
