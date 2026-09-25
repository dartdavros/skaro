<script lang="ts">
  import type { TimelineState } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import { clock } from './context.svelte';
  import { clock as formatClock, displayPath } from './format';

  /** "Агент сейчас…": one line at the bottom of the feed, replaced by the next event (mockup 9b). */
  let {
    activity,
    since,
    cwd,
  }: { activity: NonNullable<TimelineState['activity']>; since: number; cwd?: string } = $props();
</script>

<div
  class="fd-live"
  data-tip={activity.state === 'waiting_model' ? t('feed.live.model.tip') : t('feed.live')}
>
  <span class="fd-pulse"></span>
  {#if activity.state === 'thinking'}
    {t('feed.live.thinking')}
  {:else if activity.state === 'writing'}
    {t('feed.live.writing')}
  {:else if activity.state === 'preparing_edit'}
    {#if activity.target}
      {t('feed.live.edit')}&nbsp;<code>{displayPath(activity.target, cwd)}</code>…
    {:else}
      {t('feed.live.editNoTarget')}
    {/if}
  {:else}
    {t('feed.live.model')} · <span class="mono">{formatClock(clock.now - since)}</span>
  {/if}
</div>

<style>
  .mono {
    font-family: var(--sk-mono);
  }
</style>
