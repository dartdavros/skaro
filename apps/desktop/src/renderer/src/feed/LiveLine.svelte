<script lang="ts">
  import { activityKind, type TimelineState } from '@skaro/timeline';
  import { t } from '@skaro/ui';
  import { clock } from './context.svelte';
  import { clock as formatClock, displayPath } from './format';
  import ActivityMark from '../activity/ActivityMark.svelte';
  import ActivityText from '../activity/ActivityText.svelte';
  import type { ResourceWait } from '../../../shared/resource-wait';
  import { resourceWaitLabel, resourceWaitAmount, resourceWaitDetail } from '../resource-wait';

  /** "Агент сейчас…": one line at the bottom of the feed, replaced by the next event (mockup 9b). */
  let {
    activity,
    environment = false,
    since,
    cwd,
    resourceWait,
  }: {
    activity: TimelineState['activity'];
    /** Skaro starts the task environment: the agent waits for that, not for the model. */
    environment?: boolean;
    since: number;
    cwd?: string;
    resourceWait?: ResourceWait;
  } = $props();

  const tip = $derived(
    resourceWait
      ? resourceWaitDetail(resourceWait)
      : environment
        ? t('feed.live.environment.tip')
        : activity?.state === 'waiting_model'
          ? t('feed.live.model.tip')
          : t('feed.live'),
  );
</script>

<div class="fd-live" data-tip={tip}>
  <ActivityMark kind={resourceWait ? 'waiting_model' : activityKind(activity, environment)} />
  <ActivityText>
    {#if resourceWait}
      {resourceWaitLabel(resourceWait)}{#if resourceWaitAmount(resourceWait)}
        · {resourceWaitAmount(resourceWait)}{/if} ·
      <span class="time">{formatClock(clock.now - since)}</span>
    {:else if environment}
      {t('feed.live.environment')} · <span class="time">{formatClock(clock.now - since)}</span>
    {:else if activity?.state === 'thinking'}
      {t('feed.live.thinking')}
    {:else if activity?.state === 'writing'}
      {t('feed.live.writing')}
    {:else if activity?.state === 'preparing_edit'}
      {#if activity.target}
        {t('feed.live.edit')}&nbsp;<code>{displayPath(activity.target, cwd)}</code>…
      {:else}
        {t('feed.live.editNoTarget')}
      {/if}
    {:else}
      {t('feed.live.model')} · <span class="time">{formatClock(clock.now - since)}</span>
    {/if}
  </ActivityText>
</div>

<style>
  /* The time reads as part of the line: the text's own font and size, digits of equal width. */
  .time {
    font-variant-numeric: tabular-nums;
  }
</style>
