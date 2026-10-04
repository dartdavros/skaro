<script lang="ts">
  import { Icon, t } from '@skaro/ui';
  import type { PinnedZoneController } from './pinned-zone-controller.svelte';
  let { state }: { state: PinnedZoneController } = $props();
</script>

{#if state.showPlan}
  <div data-pinned-zone class="plan">
    {#if state.planOpen}
      <div data-pinned-zone class="steps">
        {#each state.plan as step (step.id)}
          <div data-pinned-zone class="step {step.status}">
            <span data-pinned-zone class="mark">
              {#if step.status === 'done'}
                <Icon name="check" size={13} stroke={2.6} />
              {:else if step.status === 'active'}
                <span data-pinned-zone class="fd-pulse" style="margin: 3px"></span>
              {:else}
                <span data-pinned-zone class="todo"></span>
              {/if}
            </span>
            <span data-pinned-zone class="text"
              >{step.status === 'active' ? (step.activeText ?? step.text) : step.text}</span
            >
          </div>
        {/each}
      </div>
    {/if}
    <button
      data-pinned-zone
      type="button"
      class="head"
      data-tip={t('pinned.plan.tip')}
      onclick={() => (state.planOpen = !state.planOpen)}
    >
      {#if state.active}<span data-pinned-zone class="fd-pulse"></span>{:else}<span
          data-pinned-zone
          class="fd-dot-gray"
        ></span>{/if}
      <span data-pinned-zone class="label"
        >{t('pinned.plan')} ·
        <span data-pinned-zone class="count">{state.done} / {state.plan.length}</span></span
      >
      <span data-pinned-zone class="current"
        >{state.active ? (state.active.activeText ?? state.active.text) : ''}</span
      >
      <span data-pinned-zone class="chev" class:open={state.planOpen}
        ><Icon name="chevronUp" size={12} stroke={2.2} color="var(--sk-text-25)" /></span
      >
    </button>
  </div>
{/if}
