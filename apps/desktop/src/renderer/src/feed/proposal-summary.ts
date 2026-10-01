import type { Item } from '@skaro/timeline';
import { t, tn } from '@skaro/ui';
export function proposalSummary(item: Extract<Item, { kind: 'proposal' }>):
  | {
      text: string;
      ok: boolean;
      open?: 'plan' | 'docs' | 'tasks';
      tip?: string;
      /** Link text other than "Открыть". */
      action?: string;
    }
  | undefined {
  const proposal = item.proposal;
  if (item.state === 'pending') return undefined;
  if (proposal.type === 'plan') {
    if (item.state === 'rejected') {
      return {
        ok: false,
        text: proposal.milestone?.isNew
          ? t('proposal.rejected.plan', {
              id: proposal.milestone.id,
              title: proposal.milestone.title,
            })
          : t('proposal.rejected.tasks', {
              tasks: tn('proposal.tasks', proposal.tasks.length),
            }),
      };
    }
    const created = item.result?.tasks?.length ?? 0;
    const milestone = item.result?.milestone;
    if (milestone) {
      return {
        ok: true,
        text: t('proposal.done.plan', {
          id: milestone.id,
          title: milestone.title,
          tasks: tn('proposal.tasks', created),
        }),
        open: 'plan',
        tip: t('proposal.open.plan.tip'),
      };
    }
    const text = tn('proposal.done.tasks', created);
    return {
      ok: true,
      text: proposal.milestone
        ? t('proposal.done.inMilestone', { text, id: proposal.milestone.id })
        : text,
      open: proposal.milestone ? 'plan' : 'tasks',
      tip: proposal.milestone ? t('proposal.open.plan.tip') : t('proposal.open.tasks.tip'),
    };
  }
  if (proposal.type === 'import') {
    if (item.state === 'rejected') return { ok: false, text: t('proposal.import.rejected') };
    return {
      ok: true,
      text: t('proposal.import.done', {
        n: item.result?.applied ?? proposal.total,
        of: proposal.total,
      }),
      open: 'docs',
      action: t('proposal.import.openDocs'),
    };
  }
  if (proposal.type === 'spec') {
    if (item.state === 'rejected') {
      return { ok: false, text: t('proposal.rejected.spec', { title: proposal.title }) };
    }
    return {
      ok: true,
      text: t('proposal.done.spec', { id: item.result?.spec?.id ?? proposal.id }),
      open: 'docs',
      tip: t('proposal.open'),
    };
  }
  if (proposal.type === 'spec_change') {
    if (item.state === 'rejected') {
      return { ok: false, text: t('proposal.rejected.specChange', { id: proposal.id }) };
    }
    return {
      ok: true,
      text: t('proposal.done.specChange', { id: proposal.id }),
      open: 'docs',
      tip: t('proposal.open'),
    };
  }
  if (proposal.type === 'adr') {
    if (item.state === 'rejected') {
      return { ok: false, text: t('proposal.rejected.adr', { title: proposal.title }) };
    }
    const adr = item.result?.adr ?? { id: proposal.id, title: proposal.title };
    return {
      ok: true,
      text: t('proposal.done.adr', { id: adr.id, title: adr.title }),
      open: 'docs',
      tip: t('proposal.open.adr.tip'),
    };
  }
  return undefined;
}
