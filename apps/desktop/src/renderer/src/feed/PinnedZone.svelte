<script lang="ts">
  import { backgroundCommands, type TimelineState } from '@skaro/timeline';
  import { Icon, t } from '@skaro/ui';
  import { clock, useFeed } from './context.svelte';
  import { clock as formatClock } from './format';

  /** Above the composer: background commands and the agent plan, pinned (agent-output.md 7.4). */
  let { timeline }: { timeline: TimelineState } = $props();

  const feed = useFeed();
  let planOpen = $state(false);
  let outputOf = $state<string | undefined>();

  /** Finished background commands leave after a few seconds. */
  const background = $derived(
    backgroundCommands(timeline).filter(
      (c) => c.background?.state === 'running' || clock.now - (c.endedAt ?? clock.now) < 8000,
    ),
  );
  const plan = $derived(timeline.plan ?? []);
  const done = $derived(plan.filter((s) => s.status === 'done').length);
  const active = $derived(plan.find((s) => s.status === 'active'));
  const showPlan = $derived(plan.length > 0 && (done < plan.length || timeline.status !== 'idle'));
  const opened = $derived(background.find((c) => c.id === outputOf));
</script>

{#if opened?.output}
  <div class="fd-output" style="max-height: 180px; border-radius: 10px">
    {opened.output.replace(/\s+$/, '')}
  </div>
{/if}
{#each background as command (command.id)}
  {@const running = command.background?.state === 'running'}
  <div
    class="fd-pinned"
    role="button"
    tabindex="0"
    style="cursor: pointer"
    data-tip={t('pinned.bg.show')}
    onclick={() => (outputOf = outputOf === command.id ? undefined : command.id)}
    onkeydown={(e) =>
      e.key === 'Enter' && (outputOf = outputOf === command.id ? undefined : command.id)}
  >
    {#if running}<span class="fd-pulse"></span>{:else}<span class="fd-dot-gray"></span>{/if}
    <span class="cmd">$ {command.command}</span>
    <span class="when">
      {#if running}
        {t('pinned.bg.running', { t: formatClock(clock.now - command.startedAt) })}
      {:else if command.background?.state === 'stopped'}
        {t('pinned.bg.stopped')}
      {:else}
        {t('pinned.bg.done')} · {formatClock((command.endedAt ?? clock.now) - command.startedAt)}
      {/if}
    </span>
    {#if running && feed.interactive}
      <button
        type="button"
        class="stop"
        data-tip={t('pinned.bg.stop')}
        aria-label={t('pinned.bg.stop')}
        onclick={(e) => {
          e.stopPropagation();
          feed.stopBackground(command.background!.taskId);
        }}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"
          ><rect x="6" y="6" width="12" height="12" rx="2"></rect></svg
        >
      </button>
    {/if}
  </div>
{/each}
{#if showPlan}
  <div class="plan">
    {#if planOpen}
      <div class="steps">
        {#each plan as step (step.id)}
          <div class="step {step.status}">
            <span class="mark">
              {#if step.status === 'done'}
                <Icon name="check" size={13} stroke={2.6} />
              {:else if step.status === 'active'}
                <span class="fd-pulse" style="margin: 3px"></span>
              {:else}
                <span class="todo"></span>
              {/if}
            </span>
            <span class="text"
              >{step.status === 'active' ? (step.activeText ?? step.text) : step.text}</span
            >
          </div>
        {/each}
      </div>
    {/if}
    <button
      type="button"
      class="head"
      data-tip={t('pinned.plan.tip')}
      onclick={() => (planOpen = !planOpen)}
    >
      {#if active}<span class="fd-pulse"></span>{:else}<span class="fd-dot-gray"></span>{/if}
      <span class="label"
        >{t('pinned.plan')} · <span class="count">{done} / {plan.length}</span></span
      >
      <span class="current">{active ? (active.activeText ?? active.text) : ''}</span>
      <span class="chev" class:open={planOpen}
        ><Icon name="chevronUp" size={12} stroke={2.2} color="#6f6f6f" /></span
      >
    </button>
  </div>
{/if}

<style>
  .plan {
    border-radius: 10px;
    background: #202020;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 9px;
  }

  .steps {
    max-height: 230px;
    overflow: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .step {
    display: flex;
    align-items: flex-start;
    gap: 9px;
  }

  .mark {
    flex: none;
    margin-top: 1px;
    width: 13px;
    display: inline-flex;
    color: #a6a6a6;
  }

  .step.done .mark {
    color: #6f6f6f;
  }

  .todo {
    width: 7px;
    height: 7px;
    margin: 3px;
    border-radius: 50%;
    box-shadow: inset 0 0 0 1.5px #3b3b3b;
  }

  .text {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    line-height: 1.45;
    color: #a6a6a6;
    text-wrap: pretty;
  }

  .step.done .text {
    color: #7d7d7d;
  }

  .step.active .text {
    color: #d5d5d5;
  }

  .head {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 0;
    border: none;
    background: none;
    cursor: pointer;
    text-align: left;
    font: inherit;
    width: 100%;
  }

  .label {
    flex: none;
    font-size: 11.5px;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    color: #7d7d7d;
  }

  .count {
    font-family: var(--sk-mono);
    letter-spacing: 0;
  }

  .current {
    flex: 1;
    min-width: 0;
    font-size: 12.5px;
    color: #a6a6a6;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .chev {
    flex: none;
    display: inline-flex;
    transition: transform 0.15s;
  }

  .chev.open {
    transform: rotate(180deg);
  }
</style>
