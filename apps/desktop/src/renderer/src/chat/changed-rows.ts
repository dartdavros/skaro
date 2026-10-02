import type { Item } from '@skaro/timeline';
import { t, tn } from '@skaro/ui';
export type ProposalItem = Extract<Item, { kind: 'proposal' }>;
/** "Изменено в чате": what each proposal is and where it stands. */
function changed(item: ProposalItem): {
  icon: 'file' | 'adr' | 'spec' | 'milestone' | 'import';
  title: string;
  note: string;
  pending: boolean;
} {
  const p = item.proposal;
  const pending = item.state === 'pending';
  const settled =
    item.state === 'rejected'
      ? t('changed.rejected')
      : item.state === 'reverted'
        ? t('changed.reverted')
        : undefined;
  switch (p.type) {
    case 'doc':
      return {
        icon: 'file',
        title: p.path,
        pending,
        note: pending
          ? t('changed.pending')
          : (settled ??
            (p.before === undefined ? t('changed.doc.created') : t('changed.doc.updated'))),
      };
    case 'task':
      return {
        icon: 'file',
        title: `${p.id} · ${p.title}`,
        pending,
        note: pending ? t('changed.pending') : (settled ?? t('changed.task.updated')),
      };
    case 'adr':
      return {
        icon: 'adr',
        title: `ADR-${item.result?.adr?.id ?? p.id} · ${item.result?.adr?.title ?? p.title}`,
        pending,
        note: pending ? t('changed.pending') : (settled ?? t('changed.adr.accepted')),
      };
    case 'import':
      return {
        icon: 'import',
        title: t('changed.import'),
        pending,
        note: pending ? t('changed.pending') : (settled ?? t('changed.pending')),
      };
    case 'spec':
      return {
        icon: 'spec',
        title: `SPEC-${item.result?.spec?.id ?? p.id} · ${item.result?.spec?.title ?? p.title}`,
        pending,
        note: pending ? t('changed.pending') : (settled ?? t('changed.spec.accepted')),
      };
    case 'spec_change':
      return {
        icon: 'spec',
        title: `SPEC-${p.id} · ${p.title}`,
        pending,
        note: pending ? t('changed.pending') : (settled ?? t('changed.spec.updated')),
      };
    case 'plan':
      return {
        icon: 'milestone',
        title: p.milestone?.isNew
          ? `${item.result?.milestone?.id ?? p.milestone.id} · ${p.milestone.title}`
          : `${p.milestone ? `${p.milestone.id} · ` : ''}${tn('proposal.tasks', p.tasks.length)}`,
        pending,
        note: pending
          ? t('changed.pending')
          : (settled ??
            (p.milestone?.isNew ? t('changed.plan.milestone') : t('changed.plan.tasks'))),
      };
  }
}

/** Rows of "Изменено в чате": one per proposal, what an applied import wrote one by one. */
export function changedRows(proposals: ProposalItem[]) {
  return proposals.flatMap((item) => {
    if (item.proposal.type === 'import' && item.state === 'applied') {
      return (item.result?.imported ?? [])
        .filter((x) => x.kind !== 'plan' || x.code?.startsWith('M'))
        .map((x, i) => ({ key: `${item.id}-${i}`, item, c: importedRow(x) }));
    }
    return [{ key: item.id, item, c: changed(item) }];
  });
}

function importedRow(x: {
  kind: string;
  code?: string;
  title: string;
  update: boolean;
}): ReturnType<typeof changed> {
  const titled = x.code ? `${x.code} · ${x.title}` : x.title;
  switch (x.kind) {
    case 'adr':
      return {
        icon: 'adr',
        title: titled,
        pending: false,
        note: x.update ? t('changed.doc.updated') : t('changed.adr.accepted'),
      };
    case 'spec':
      return {
        icon: 'spec',
        title: titled,
        pending: false,
        note: x.update ? t('changed.spec.updated') : t('changed.spec.accepted'),
      };
    case 'plan':
      return {
        icon: 'milestone',
        title: titled,
        pending: false,
        note: t('changed.plan.milestone'),
      };
    default:
      return {
        icon: 'file',
        title:
          x.kind === 'brief' ? 'brief.md' : x.kind === 'architecture' ? 'architecture.md' : x.title,
        pending: false,
        note: x.update ? t('changed.doc.updated') : t('changed.doc.createdShort'),
      };
  }
}
