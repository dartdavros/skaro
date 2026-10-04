import type { Proposal } from '@skaro/timeline';
import { t, tn } from '@skaro/ui';
type ImportGroup = Extract<Proposal, { type: 'import' }>['groups'][number];
export function importLabel(g: ImportGroup): string {
  switch (g.kind) {
    case 'brief':
      return t('proposal.import.brief');
    case 'architecture':
      return t('proposal.import.architecture');
    case 'adr':
      return t('proposal.import.adr', { n: g.count });
    case 'spec':
      return tn('proposal.import.specs', g.count);
    case 'doc':
      return tn('proposal.import.docs', g.count);
    case 'plan': {
      const tasks = g.tasks ? tn('proposal.tasks', g.tasks) : '';
      return g.count
        ? [tn('proposal.import.milestones', g.count), tasks].filter(Boolean).join(' · ')
        : tasks;
    }
  }
}

export function importMark(g: ImportGroup): { text: string; update: boolean } {
  if (!g.updates) return { text: t('proposal.import.new'), update: false };
  if (g.updates === g.count) return { text: t('proposal.import.update'), update: true };
  return { text: `${t('proposal.import.update')} ${g.updates}`, update: true };
}

export function segments(text: string): { code: boolean; text: string }[] {
  return text
    .split(/(`[^`]+`)/)
    .map((part) =>
      part.startsWith('`') && part.endsWith('`') && part.length > 2
        ? { code: true, text: part.slice(1, -1) }
        : { code: false, text: part },
    );
}

export function adrText(p: { summary?: string; body: string }): string {
  if (p.summary) return p.summary;
  const plain = p.body
    .split('\n')
    .filter((l) => !/^#{1,6}\s/.test(l))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 280 ? `${plain.slice(0, 279)}…` : plain;
}
