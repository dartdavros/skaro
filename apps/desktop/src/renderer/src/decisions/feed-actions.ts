import type { FeedActions } from '../feed/context.svelte';
import type { DecisionOrigin } from '../../../shared/project-decisions';
import type { DecisionCardState } from './card-state.svelte';
import { historyActions } from '../feed/history-actions';

/** Card views reuse the existing file/review services and exactly one decision answer route. */
export function decisionFeedActions(
  card: DecisionCardState,
  open: (origin: DecisionOrigin, importId?: string) => void,
  image: (src: string) => void,
): FeedActions {
  const origin = () => card.entry!.origin;
  const task = () => (origin().kind === 'task' ? origin().id : '');
  return {
    ...historyActions(
      origin().projectId,
      () => {
        card.status = 'error';
      },
      () => {},
      () => card.update(),
    ),
    get draftOwner() {
      const o = origin();
      return JSON.stringify([o.projectId, o.kind, o.id, o.epoch]);
    },
    get cwd() {
      return origin().cwd;
    },
    get interactive() {
      return card.status === 'pending' || card.status === 'error';
    },
    openPath: (path) => {
      void window.skaro.invoke('files.open', origin().projectId, task(), path).catch(() => {
        card.status = 'error';
      });
    },
    existing: (paths) => window.skaro.invoke('files.exist', origin().projectId, task(), paths),
    fileDiff: (path) => window.skaro.invoke('files.diff', origin().projectId, task(), path),
    openExternal: (url) => {
      void window.skaro.invoke('shell.openExternal', url);
    },
    viewImage: image,
    stopBackground: () => open(origin()),
    responseAccepted: () => card.status === 'answered' || card.status === 'denied',
    respond: (_id, answer) => card.answer({ kind: 'respond', answer }),
    merge: (_id, action) => card.answer({ kind: 'merge', action }),
    proposal: (_id, action) => card.answer({ kind: 'proposal', action }),
    restart: () => open(origin()),
    reviewImport: (id) => open(origin(), id),
    openSection: () => open(origin()),
    openStage: () => open(origin()),
  };
}
