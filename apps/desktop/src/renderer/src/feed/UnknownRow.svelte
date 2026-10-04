<script lang="ts">
  import { unknownShape, type FeedRow } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import NoticeRow from './NoticeRow.svelte';
  import '../settings/diagnostics-i18n';

  let { row }: { row: Extract<FeedRow, { type: 'unknown' }> } = $props();
  const notice = $derived({
    type: 'notice' as const,
    id: row.id,
    item: {
      ...row.item,
      kind: 'notice' as const,
      level: 'warning' as const,
      code: 'other' as const,
      text: `${t('feed.unknown')}\n${row.item.native.agent} · ${row.item.native.type}\n${JSON.stringify(unknownShape(row.item.raw))}`,
    },
  });
</script>

<NoticeRow row={notice} last={false} />
