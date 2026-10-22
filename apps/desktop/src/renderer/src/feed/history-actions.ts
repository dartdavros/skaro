import type { FeedActions } from './context.svelte';
import type { HistoryPage } from '../../../shared/history';

/** History-backed content is read only when a corresponding existing viewer is opened. */
export function historyActions(
  projectId: string,
  onerror: (error: string) => void,
  onpage: (page: HistoryPage) => void,
  onrefresh: () => void,
): Pick<
  FeedActions,
  | 'historyError'
  | 'refreshHistory'
  | 'architectureFiles'
  | 'architectureFile'
  | 'architectureContent'
  | 'architectureReview'
  | 'architectureReviewDetail'
  | 'architectureReviewModel'
  | 'rememberHistoryPage'
> {
  return {
    historyError: onerror,
    refreshHistory: onrefresh,
    rememberHistoryPage: onpage,
    architectureReview: (id) => window.skaro.invoke('c4.review', projectId, id),
    architectureReviewDetail: (id, key) =>
      window.skaro.invoke('c4.reviewDetail', projectId, id, key),
    architectureReviewModel: (id, side) =>
      window.skaro.invoke('c4.reviewModel', projectId, id, side),
    architectureFiles: (id) => window.skaro.invoke('c4.files', projectId, id),
    architectureFile: (id, path, side) => window.skaro.invoke('c4.file', projectId, id, path, side),
    architectureContent: (id, side) => window.skaro.invoke('c4.content', projectId, id, side),
  };
}
