<script lang="ts">
  import { feedRows, type Interaction, type TimelineState } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import { tick } from 'svelte';
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
   * The agent feed: rows, the live line, open cards at the end. Sticks to the bottom while the
   * user is there; otherwise shows "К концу диалога".
   */
  let {
    timeline,
    cwd,
    mergeMessage,
  }: { timeline: TimelineState; cwd?: string; mergeMessage: string } = $props();

  let scroller: HTMLDivElement | undefined = $state();
  let atBottom = $state(true);
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

  /** Where the feed was last scrolled to: only the user moves it up. */
  let lastTop = 0;
  let content: HTMLDivElement | undefined = $state();

  /** Follows the end while the user has not scrolled up to read. */
  function stick(): void {
    if (!scroller || !atBottom) return;
    scroller.scrollTop = scroller.scrollHeight;
    lastTop = scroller.scrollTop;
  }

  $effect(() => {
    void rows;
    void timeline.interactions;
    void timeline.activity;
    void tick().then(stick);
  });

  // Rows grow without new events too: Markdown and diagrams render, images load, cards open.
  $effect(() => {
    if (!content || !scroller) return;
    const observer = new ResizeObserver(stick);
    observer.observe(content);
    observer.observe(scroller);
    return () => observer.disconnect();
  });

  // The user's own new message brings the feed back to the end.
  const lastUser = $derived(rows.findLast((r) => r.type === 'user')?.id);
  let seenUser: string | undefined;
  $effect(() => {
    const id = lastUser;
    if (seenUser !== undefined && id !== seenUser) atBottom = true;
    seenUser = id;
  });

  function onscroll(): void {
    if (!scroller) return;
    const top = scroller.scrollTop;
    const distance = scroller.scrollHeight - top - scroller.clientHeight;
    // Scrolling the feed to the end also fires "scroll"; only moving up means the user left it.
    if (top < lastTop - 1 && distance > 2) atBottom = false;
    else if (distance < 40) atBottom = true;
    lastTop = top;
  }

  function toBottom(): void {
    scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
  }
</script>

<div class="wrap">
  <div class="fade"></div>
  <div class="scroller" bind:this={scroller} {onscroll}>
    <div class="fd-feed" bind:this={content}>
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
        {#if interaction.kind === 'question'}
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
  {#if !atBottom}
    <button
      type="button"
      class="down"
      data-tip={t('task.toBottom')}
      aria-label={t('task.toBottom')}
      onclick={toBottom}
    >
      <Icon name="arrowDown" size={16} stroke={2.2} />
    </button>
  {/if}
</div>

<style>
  .wrap {
    flex: 1;
    min-height: 0;
    position: relative;
    display: flex;
    flex-direction: column;
  }

  .fade {
    position: absolute;
    left: 0;
    right: 5px;
    top: 0;
    height: 30px;
    z-index: 3;
    pointer-events: none;
    background: linear-gradient(
      180deg,
      var(--sk-fill-5) 0%,
      var(--sk-bg-a85) 35%,
      var(--sk-bg-a0) 100%
    );
  }

  .scroller {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overflow-x: hidden;
    padding: 34px 26px 30px;
  }

  .down {
    position: absolute;
    left: 50%;
    bottom: 12px;
    transform: translateX(-50%);
    z-index: 4;
    width: 34px;
    height: 34px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: var(--sk-float-a72);
    backdrop-filter: blur(8px);
    box-shadow:
      0 0 0 1px var(--sk-white-a6),
      0 8px 20px var(--sk-black-a45);
    color: var(--sk-text-6);
    cursor: pointer;
  }

  .down:hover {
    background: var(--sk-float-hover-a90);
    color: var(--sk-text-1);
  }
</style>
