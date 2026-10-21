import type { C4ViewKind } from '@skaro/core/c4-view';
import type { IconName } from '@skaro/ui';

export const viewKinds = [
  'context',
  'container',
  'component',
  'code',
  'dynamic',
  'deployment',
] as const satisfies readonly C4ViewKind[];

export const viewKindIcons: Record<C4ViewKind, IconName> = {
  context: 'network',
  container: 'box',
  component: 'grid',
  code: 'code',
  dynamic: 'swap',
  deployment: 'layers',
};
