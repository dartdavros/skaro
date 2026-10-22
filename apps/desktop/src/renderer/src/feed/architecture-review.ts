import type { C4PackageReview, C4Model } from '@skaro/core/c4-view';
import { t } from '@skaro/ui';
export function architectureCounts(review: C4PackageReview): string {
  const count = (op: string) => review.model.filter((c) => c.operation === op).length;
  return t('c4.review.objects', {
    added: count('add'),
    changed: count('update'),
    removed: count('remove'),
  });
}
export function architectureEntries(review: C4PackageReview) {
  return [
    ...review.documents.map((d) => ({
      value: `document:${d.path}`,
      label: `${t('c4.review.document')} · ${d.path}${d.comparison.status === 'exact' ? ` · +${d.comparison.added} −${d.comparison.removed}` : ''}`,
    })),
    ...review.model.map((c) => ({
      value: c.key,
      label: `${t(`c4.review.${c.group}`)} · ${c.id === '$order' ? t('c4.review.order') : c.title} · ${t(`c4.review.${c.operation}`)}`,
    })),
    ...review.generated.map((path) => ({
      value: `generated:${path}`,
      label: `${t('c4.review.generatedLabel')} · ${path}`,
    })),
  ];
}

/** Source mode is context text, never auto-detected as a patch because of Markdown/YAML signs. */
export function sourceDiff(text: string): string {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  return `@@ -1,${lines.length} +1,${lines.length} @@\n${lines.map((line) => ` ${line}`).join('\n')}`;
}

export function reviewedView(
  model: C4Model,
  review: C4PackageReview | undefined,
  key: string,
): string {
  const change = review?.model.find((c) => c.key === key);
  const path = key.startsWith('document:') ? key.slice('document:'.length) : undefined;
  const bound = path && model.specifications.find((s) => s.path === path)?.views[0];
  return (
    model.views.find((v) => v.id === bound || (change?.group === 'views' && v.id === change.id))
      ?.id ??
    model.views.find(
      (v) => change && (v.elements.includes(change.id) || v.relationships.includes(change.id)),
    )?.id ??
    model.views[0]!.id
  );
}
