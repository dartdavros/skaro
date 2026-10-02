<script lang="ts">
  import { feedRows, type Interaction, type TimelineState } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import { FeedScroll } from './scroll.svelte';
  import './feed-layout.css';
  import './feed.css';
  import FeedRows from './FeedRows.svelte';
  import FormCard from './FormCard.svelte';
  import LiveLine from './LiveLine.svelte';
  import LoginCard from './LoginCard.svelte';
  import MergeCard from './MergeCard.svelte';
  import PermissionCard from './PermissionCard.svelte';
  import PlanCard from './PlanCard.svelte';
  import QuestionCard from './QuestionCard.svelte';

  /**
   * The agent feed: rows, the live line and unanchored cards. Sticks to the bottom while the
   * user is there; otherwise shows "К концу диалога".
   */
  let {
    timeline,
    cwd,
    mergeMessage,
  }: { timeline: TimelineState; cwd?: string; mergeMessage: string } = $props();

  const scroll = new FeedScroll();
  let activitySince = $state(Date.now());

  const rows = $derived(feedRows(timeline));
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
  // A running reasoning row already says "Думает…".
  const showLive = $derived(
    timeline.status !== 'idle' &&
      timeline.activity !== undefined &&
      !(
        timeline.activity.state === 'thinking' &&
        timeline.items.some((i) => i.kind === 'reasoning' && i.status === 'running')
      ),
  );

  $effect(() => {
    void timeline.activity?.state;
    void timeline.activity?.target;
    activitySince = Date.now();
  });

  $effect(() => {
    void rows;
    void timeline.interactions;
    void timeline.activity;
    scroll.updated();
  });

  const lastUser = $derived(rows.findLast((r) => r.type === 'user')?.id);
  $effect(() => scroll.userMessage(lastUser));
</script>

<div class="wrap feed-wrap">
  <div class="fade"></div>
  <div class="scroller" bind:this={scroll.scroller}>
    <div class="fd-feed" bind:this={scroll.content}>
      <FeedRows {rows} {waiting} />
      {#if showLive && timeline.activity}
        <LiveLine activity={timeline.activity} since={activitySince} {cwd} />
      {/if}
      {#if approvals.length}
        <div class="fd-block" style="gap: 8px">
          {#each approvals as interaction (interaction.id)}
            <PermissionCard {interaction} primary={interaction.id === firstApproval} />
          {/each}
        </div>
      {/if}
      {#each timeline.interactions as interaction (interaction.id)}
        {#if interaction.kind === 'question' && !interaction.itemId}
          <QuestionCard {interaction} />
        {:else if interaction.kind === 'plan_approval'}
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
