import type { C4Model } from './model.ts';
export interface C4Attachment {
  model: C4Model;
  views: string[];
}
export interface C4DocumentSnapshot {
  body: string;
  attachment?: C4Attachment;
}
