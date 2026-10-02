<script lang="ts">
  import type { FeedRow } from '@skaro/timeline';
  import { ConfirmDialog, t } from '@skaro/ui';
  import { useFeed } from './context.svelte';
  import './merge-undo-i18n';

  let { row }: { row: Extract<FeedRow, { type: 'notice' }> } = $props();
  const feed = useFeed();
  let confirm = $state(false);
  let busy = $state(false);
  const commit = $derived(row.item.native.ref);

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
  <span>{t('feed.notice.merged', { branch: row.item.text })}</span>
  {#if feed.revertMerge}
    <button type="button" class="fd-btn" disabled={busy} onclick={() => (confirm = true)}
      >{t('feed.mergeUndo.action')}</button
    >
  {/if}
</div>

<ConfirmDialog
  bind:open={confirm}
  title={t('feed.mergeUndo.action')}
  text={t('feed.mergeUndo.confirm', { commit: commit.slice(0, 7) })}
  action={t('feed.mergeUndo.action')}
  icon="undo"
  onconfirm={() => void revert()}
/>
