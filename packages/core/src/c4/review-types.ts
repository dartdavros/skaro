import type { TextComparison } from '@skaro/timeline';
import type { C4ModelChange } from './review-model.ts';
export interface C4ReviewDocument {
  path: string;
  operation: 'add' | 'update';
  beforeHash: string | null;
  afterHash: string;
  comparison:
    Omit<Extract<TextComparison, { status: 'exact' }>, 'patch'> | { status: 'unavailable' };
}
export interface C4PackageReview {
  packageId: string;
  fingerprint: string;
  baseRevision: number;
  revision: number;
  documents: C4ReviewDocument[];
  model: C4ModelChange[];
  generated: string[];
}
