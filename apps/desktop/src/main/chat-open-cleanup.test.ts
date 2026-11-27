import { operationTimeout } from '@skaro/timeline';
import { expect, it } from 'vitest';
import { planningWorkspace } from './chat-planning-test-workspace';
import { HistoryReads, setHistoryReads } from './history-read-service';
import { cleanTaskCheckout } from './project-task-mutations';

it('opens paged chat history while checkout cleanup still owns the task graph', async () => {
  const w = await planningWorkspace();
  const reads = new HistoryReads(w.root, w.engine.deps.emit);
  setHistoryReads(reads);
  const { projectId, chat } = w.live;
  let notifyEntered!: () => void;
  let releaseCleanup!: () => void;
  const entered = new Promise<void>((resolve) => (notifyEntered = resolve));
  const release = new Promise<void>((resolve) => (releaseCleanup = resolve));
  const cleanup = cleanTaskCheckout(
    w.engine.project(projectId),
    () => new Set(['T-024']),
    async () => {
      notifyEntered();
      await release;
    },
  );
  try {
    await entered;
    w.engine.history.skaroEvent(w.live, {
      t: 'item.upsert',
      item: {
        id: 'saved-message',
        turnId: '',
        kind: 'message',
        role: 'user',
        text: 'Existing project chat message',
        startedAt: 0,
        status: 'done',
        native: { agent: 'skaro', type: 'user', ref: '' },
      },
    });
    const view = await operationTimeout(
      w.engine.views.open(projectId, chat.id, { paged: true }),
      10_000,
      'Opening the chat waited for task cleanup',
    );
    expect(view.chat.id).toBe(chat.id);
    expect(view.history?.itemCount).toBe(1);
    expect(view.historyPage?.blocks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: expect.stringContaining('saved-message') }),
      ]),
    );
    await operationTimeout(w.engine.replans.recover(w.live), 1000, 'No replan to recover');
  } finally {
    releaseCleanup();
    await cleanup;
    await reads.close();
    await w.close();
  }
}, 30_000);
