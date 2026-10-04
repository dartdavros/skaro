import type { IconName } from '@skaro/ui';
import type { Format } from './format';

export const TOOLS: { kind: Format; icon: IconName; tip: string }[] = [
  { kind: 'bold', icon: 'bold', tip: 'docs.fmt.bold' },
  { kind: 'italic', icon: 'italic', tip: 'docs.fmt.italic' },
  { kind: 'heading', icon: 'heading', tip: 'docs.fmt.heading' },
  { kind: 'list', icon: 'list', tip: 'docs.fmt.list' },
  { kind: 'code', icon: 'code', tip: 'docs.fmt.code' },
  { kind: 'link', icon: 'link', tip: 'docs.fmt.link' },
  { kind: 'table', icon: 'table', tip: 'docs.fmt.table' },
];
