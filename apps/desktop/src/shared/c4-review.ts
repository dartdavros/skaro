import type { C4Model, C4PackageReview } from '@skaro/core/c4-view';
import type { TextComparison } from '@skaro/timeline';

export interface C4ReviewDetail {
  before: string;
  after: string;
  comparison: TextComparison;
}
export interface C4ReviewMethods {
  'c4.review': (projectId: string, itemId: string) => C4PackageReview;
  'c4.reviewDetail': (projectId: string, itemId: string, key: string) => C4ReviewDetail;
  'c4.reviewModel': (projectId: string, itemId: string, side: 'before' | 'after') => C4Model | null;
}
