<script lang="ts">
  import {
    feedRows,
    liveActivity,
    startingEnvironment as hasStartingEnvironment,
    type Interaction,
    type TimelineState,
  } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import { FeedScroll } from './scroll.svelte';
  import './feed-layout.css';
  import './feed.css';
  import FeedRows from './FeedRows.svelte';
  import PagedFeedRows from './PagedFeedRows.svelte';
  import type { HistorySource } from '../../../shared/history';
  import FormCard from './FormCard.svelte';
  import LiveLine from './LiveLine.svelte';
  import LoginCard from './LoginCard.svelte';
  import MergeCard from './MergeCard.svelte';
  import PermissionCard from './PermissionCard.svelte';
  import PlanCard from './PlanCard.svelte';
  import { installHistoryCopy } from './history-copy.svelte';
  import { useFeed } from './context.svelte';
  import { provideFeedLoading } from './feed-loading.svelte';
  import LoadingIndicator from '../LoadingIndicator.svelte';

  /**
   * The agent feed: rows, the live line and unanchored cards. Sticks to the bottom while the
   * user is there; otherwise shows "К концу диалога".
   */
  let {
    timeline,
    cwd,
    mergeMessage,
    history,
    historyPage,
  }: {
    timeline: TimelineState;
    cwd?: string;
    mergeMessage: string;
    history?: HistorySource;
    historyPage?: import('../../../shared/history').HistoryPage;
  } = $props();

  const scroll = new FeedScroll();
  const loading = provideFeedLoading();
  let activitySince = $state(Date.now());

  const rows = $derived(
    feedRows(
      history
        ? {
            ...timeline,
            items: timeline.items.filter((item) => (item as { localEcho?: boolean }).localEcho),
          }
        : timeline,
    ),
  );
  installHistoryCopy(() => (history ? rows : undefined), useFeed());
  const waiting = $derived(
    new Set(
      timeline.interactions
        .filter((i): i is Extract<Interaction, { kind: 'approval' }> => i.kind === 'approval')
        .map((i) => i.itemId)
        .filter((id): id is string => id !== undefined),
    ),
  );
  const approvals = $derived(
    timeline.interactions.filter(
      (i): i is Extract<Interaction, { kind: 'approval' }> => i.kind === 'approval',
    ),
  );
  const firstApproval = $derived(approvals[0]?.id);
  // Skaro's start_environment runs for minutes: the agent waits for it, not for the model.
  const startingEnvironment = $derived(hasStartingEnvironment(timeline));
  const activity = $derived(liveActivity(timeline));
  // A running reasoning row already says "Думает…".
  const showLive = $derived(
    timeline.status !== 'idle' &&
      (startingEnvironment ||
        (activity !== undefined &&
          !(
            activity.state === 'thinking' &&
            timeline.items.some((i) => i.kind === 'reasoning' && i.status === 'running')
          ))),
  );

  $effect(() => {
    void activity?.state;
    void activity?.target;
    void startingEnvironment;
    activitySince = Date.now();
  });

  $effect(() => {
    void rows;
    void history?.revision;
    void timeline.interactions;
    void timeline.activity;
    scroll.updated();
  });

  const lastUser = $derived(
    history
      ? timeline.items.findLast(
          (item) => item.kind === 'message' && item.role === 'user' && !item.parentId,
        )?.id
      : rows.findLast((r) => r.type === 'user')?.id,
  );
  $effect(() => scroll.userMessage(lastUser));
</script>

<div class="wrap feed-wrap">
  {#if loading.busy}<div class="feed-loading"><LoadingIndicator /></div>{/if}
  <div class="fade"></div>
  <div class="scroller" bind:this={scroll.scroller}>
    <div class="fd-feed" bind:this={scroll.content}>
      {#if history}<PagedFeedRows source={history} initial={historyPage} {waiting} />{/if}
      {#if rows.length}<FeedRows {rows} {waiting} nested={!!history} />{/if}
      {#if showLive}
        <LiveLine {activity} environment={startingEnvironment} since={activitySince} {cwd} />
      {/if}
      {#if approvals.length}
        <div class="fd-block" style="gap: 8px">
          {#each approvals as interaction (interaction.id)}
            <PermissionCard {interaction} primary={interaction.id === firstApproval} />
          {/each}
        </div>
      {/if}
      {#each timeline.interactions as interaction (interaction.id)}
        {#if interaction.kind === 'plan_approval'}
          <PlanCard {interaction} />
        {:else if interaction.kind === 'form'}
          <FormCard {interaction} />
        {:else if interaction.kind === 'login'}
          <LoginCard {interaction} />
        {:else if interaction.kind === 'merge'}
          <MergeCard {interaction} defaultMessage={interaction.message ?? mergeMessage} />
        {/if}
      {/each}
    </div>
  </div>
  {#if !scroll.atBottom}
    <button
      type="button"
      class="down"
      data-tip={t('task.toBottom')}
      aria-label={t('task.toBottom')}
      onclick={scroll.toBottom}
    >
      <Icon name="arrowDown" size={16} stroke={2.2} />
    </button>
  {/if}
</div>

<style>
  .feed-loading {
    position: absolute;
    inset: 0;
    display: grid;
    place-items: center;
    pointer-events: none;
    z-index: 2;
  }
</style>
