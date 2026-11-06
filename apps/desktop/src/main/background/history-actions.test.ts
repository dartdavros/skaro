import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { type Item, type TimelineState } from '@skaro/timeline';
import { isPendingProposal, pendingProposals } from '../../shared/feed-actions';
import { HistoryIndex } from './history-index';
import { PayloadStore } from './payload-store';

it('keeps unresolved C4 decisions resident beyond the history tail, including after restart and retry', () => {
  const directory = mkdtempSync(join(tmpdir(), 'skaro-history-actions-'));
  let store = new PayloadStore(directory);
  try {
    const proposal: Extract<Item, { kind: 'proposal' }> = {
      id: 'review',
      kind: 'proposal',
      turnId: 'turn',
      status: 'done',
      state: 'pending',
      startedAt: 1,
      native: { agent: 'codex', type: 'proposal', ref: 'review' },
      proposal: {
        type: 'architecture',
        packageId: 'package',
        baseRevision: 1,
        title: 'Architecture review',
        summary: 'Review requires a decision',
        files: [{ path: 'architecture.md', before: null, after: 'Package body' }],
      },
    };
    const state: TimelineState = {
      turns: [],
      interactions: [],
      status: 'idle',
      items: [
        proposal,
        ...Array.from({ length: 30 }, (_, i): Item => ({
          id: `reply-${i}`,
          kind: 'message',
          role: 'agent',
          text: `Reply ${i}`,
          turnId: 'turn',
          status: 'done',
          startedAt: i + 2,
          native: { agent: 'codex', type: 'message', ref: `reply-${i}` },
        })),
      ],
    };
    new HistoryIndex(store).initialize('owner', 'pending', state);
    store.db.close();
    store = new PayloadStore(directory);
    const index = new HistoryIndex(store);
    const restored = index.matches('owner', 'pending')!;
    const pending = pendingProposals(restored.timeline.items);
    expect(pending.map((item) => item.id)).toEqual(['review']);
    expect(pending[0]!.proposal).not.toHaveProperty('files');
    expect(pending[0]!.proposal).toHaveProperty('contentRef', 'review');
    const updated = index.events('owner', [{ t: 'status', state: 'working' }], 'working')!;
    expect(pendingProposals(updated.timeline.items).map((item) => item.id)).toEqual(['review']);
    for (const outcome of ['accepted', 'applied', 'rejected', 'superseded'] as const) {
      proposal.state = outcome;
      proposal.result = { error: 'Application needs retry' };
      const view = index.initialize('owner', outcome, state);
      expect(pendingProposals(view.timeline.items).length).toBe(outcome === 'accepted' ? 1 : 0);
      expect(isPendingProposal(proposal)).toBe(outcome === 'accepted');
    }
  } finally {
    store.db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
