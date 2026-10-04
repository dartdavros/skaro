<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { ConfirmDialog, Icon, t, tn } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import './merge-undo-i18n';

  let { row }: { row: Extract<FeedRow, { type: 'notice' }> } = $props();
  const feed = useFeed();
  let confirm = $state(false);
  let busy = $state(false);
  const commit = $derived(row.item.native.ref);
  /** The merge of a stage: it took several tasks, «Влить готовое» only the finished ones. */
  const stage = $derived(row.item.merge?.tasks ? row.item.merge : undefined);

  async function revert(): Promise<void> {
    if (busy || !feed.revertMerge) return;
    busy = true;
    try {
      await feed.revertMerge(commit);
    } catch {
      /* The task controller shows the existing action-error banner. */
    } finally {
      busy = false;
    }
  }
</script>

<div class="fd-divider" data-tip={t('feed.notice.merged.tip', { commit: commit.slice(0, 7) })}>
  <span
    >{stage?.partial
      ? tn('feed.notice.merged.partial', stage.tasks ?? 0, { branch: row.item.text })
      : t('feed.notice.merged', { branch: row.item.text })}</span
  >
  {#if feed.revertMerge}
    <button
      type="button"
      class="fd-icon-btn"
      disabled={busy}
      data-tip={t('feed.mergeUndo.tip', { commit: commit.slice(0, 7) })}
      aria-label={t('feed.mergeUndo.action')}
      onclick={() => (confirm = true)}
    >
      <Icon name="undo" size={14} stroke={1.9} />
    </button>
  {/if}
</div>

<ConfirmDialog
  bind:open={confirm}
  title={t('feed.mergeUndo.action')}
  text={stage
    ? tn('feed.mergeUndo.stage', stage.tasks ?? 0)
    : t('feed.mergeUndo.confirm', { commit: commit.slice(0, 7) })}
  action={t('feed.mergeUndo.action')}
  icon="undo"
  onconfirm={() => void revert()}
/>
