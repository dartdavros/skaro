// "Документы" (Documents mockup): the tree, ADR statuses and dates.

import { i18n, t } from '@skaro/ui';
import type { DocEntry, DocRecord } from '../../../shared/ipc';
import { agoLong, agoOrDate } from '../ago';

export type AdrStatus = 'proposed' | 'accepted' | 'superseded';

export const ADR_STATUS: Record<AdrStatus, { label: string; dot: string }> = {
  proposed: { label: 'docs.adr.proposed', dot: 'var(--sk-accent)' },
  accepted: { label: 'docs.adr.accepted', dot: 'var(--sk-fill-41)' },
  superseded: { label: 'docs.adr.superseded', dot: 'var(--sk-fill-36)' },
};

/** Specifications have the statuses of an ADR, in the feminine: «Предложена». */
export const SPEC_STATUS: Record<AdrStatus, { label: string; dot: string }> = {
  proposed: { label: 'docs.spec.proposed', dot: 'var(--sk-accent)' },
  accepted: { label: 'docs.spec.accepted', dot: 'var(--sk-fill-41)' },
  superseded: { label: 'docs.spec.superseded', dot: 'var(--sk-fill-36)' },
};

/** Number, status and links of an ADR or a specification. */
export function recordOf(doc: DocEntry): DocRecord | undefined {
  return doc.adr ?? doc.spec;
}

/** "ADR-0004", "SPEC-0003". */
export function codeOf(doc: Pick<DocEntry, 'kind'>, id: string): string {
  return `${doc.kind === 'spec' ? 'SPEC' : 'ADR'}-${id}`;
}

export const BRIEF = '.skaro/brief.md';
export const ARCHITECTURE = '.skaro/architecture.md';

/** Brief and architecture always have a place in the tree, created or not. */
export function fixed(entries: DocEntry[]): DocEntry[] {
  const find = (path: string) => entries.find((d) => d.path === path);
  return [
    find(BRIEF) ?? { kind: 'brief', path: BRIEF, title: t('docs.brief'), editedAt: 0 },
    find(ARCHITECTURE) ?? {
      kind: 'architecture',
      path: ARCHITECTURE,
      title: t('docs.architecture'),
      editedAt: 0,
    },
  ];
}

export function titleOf(doc: DocEntry): string {
  if (doc.kind === 'brief') return t('docs.brief');
  if (doc.kind === 'architecture') return t('docs.architecture');
  return doc.title;
}

/** "изменён 2 ч назад", "изменён 12 сен". */
export function edited(at: number, now: number): string {
  return now - at < 7 * 86_400_000 ? agoLong(at, now) : agoOrDate(at, now);
}

const MONTHS: Record<string, string[]> = {
  ru: ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'],
  en: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
};

/** ADR date "2026-09-12" as "12 сен 2026". */
export function adrDate(date: string | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date ?? '');
  if (!m) return date ?? '';
  const month = (MONTHS[i18n.locale] ?? MONTHS['en']!)[Number(m[2]) - 1] ?? '';
  const day = Number(m[3]);
  return i18n.locale === 'en' ? `${month} ${day}, ${m[1]}` : `${day} ${month} ${m[1]}`;
}

/** A link inside a document that points to an ADR: "adr/0001-database.md", "ADR-0001". */
export function adrLink(href: string): string | undefined {
  return /(?:^|\/)adr\/(\d{4})/i.exec(href)?.[1];
}

/** A link to a specification: "specs/0003-card-refunds.md". */
export function specLink(href: string): string | undefined {
  return /(?:^|\/)specs\/(\d{4})/i.exec(href)?.[1];
}
