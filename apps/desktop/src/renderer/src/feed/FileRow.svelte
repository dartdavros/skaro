<script lang="ts">
  import type { FileRow } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import ActionIcon from './ActionIcon.svelte';
  import DiffLines from './DiffLines.svelte';
  import { fileDiffLines } from './diff-model';
  import { useFeed } from './context.svelte';
  import { displayPath } from './format';

  /** "✎ path +a −r": one line per file, the diff inside (mockup 1a). */
  let { row, waiting = false }: { row: FileRow; waiting?: boolean } = $props();

  const feed = useFeed();
  let open = $state(false);

  const path = $derived(displayPath(row.path, feed.cwd));
  const label = $derived(
    row.change === 'move' && row.movePath
      ? `${path} → ${displayPath(row.movePath, feed.cwd)}`
      : path,
  );
  const declined = $derived(row.status === 'declined');
  const failed = $derived(row.status === 'failed');
  const pending = $derived(waiting || row.status === 'queued');
  const hasDiff = $derived(row.diffs.some((d) => d.trim()));

  const lines = $derived(fileDiffLines(row));

  const tip = $derived(
    pending
      ? t('feed.waiting')
      : declined
        ? t('feed.file.declinedTip')
        : failed
          ? t('feed.file.failedTip')
          : row.change === 'add'
            ? t('feed.file.newTip')
            : row.change === 'delete'
              ? t('feed.file.deletedTip')
              : row.change === 'move'
                ? t('feed.file.movedTip')
                : t('feed.file.tip'),
  );
</script>

<div class="fd-block">
  <button
    type="button"
    class="fd-row"
    class:clickable={hasDiff}
    data-tip={tip}
    onclick={() => hasDiff && (open = !open)}
  >
    <ActionIcon kind="file" />
    <span class="fd-main" class:struck={declined}>{label}</span>
    {#if pending}
      <span class="fd-wait-dot"></span>
    {:else if declined}
      <span class="fd-meta">{t('feed.file.declined')}</span>
    {:else if failed}
      <span class="fd-meta bad">{t('feed.file.failed')}</span>
    {:else if row.status === 'running'}
      <span class="fd-meta"><span class="fd-pulse"></span></span>
    {:else if row.change === 'delete'}
      <span class="fd-meta">{t('feed.file.deleted')}</span>
    {:else if row.change === 'move'}
      <span class="fd-meta">{t('feed.file.moved')}</span>
    {:else if row.change === 'add'}
      <span class="fd-meta"
        >{t('feed.file.new')}{#if row.added !== undefined}<span class="fd-plus">+{row.added}</span
          >{/if}</span
      >
    {:else if row.added !== undefined || row.removed !== undefined}
      <span class="fd-meta" style="gap: 6px"
        ><span class="fd-plus">+{row.added ?? 0}</span><span class="fd-minus"
          >−{row.removed ?? 0}</span
        ></span
      >
    {/if}
  </button>
  {#if open && hasDiff}
    <div class="fd-expanded">
      <DiffLines {lines} />
    </div>
  {/if}
</div>
