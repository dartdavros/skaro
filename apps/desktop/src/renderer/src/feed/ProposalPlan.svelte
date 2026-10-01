<script lang="ts">
  import { Icon, t, tn } from '@skaro/ui';
  import type { ProposalState } from './proposal-state.svelte';
  let { state }: { state: ProposalState } = $props();
  const plan = $derived(state.plan);
</script>

{#if plan}
  <div class="card flush">
    <div class="head plan-head">
      <Icon name="package" size={14} stroke={1.9} color="var(--sk-accent)" />
      <span class="title">{state.planTitle()}</span>
    </div>
    <div class="tasks">
      {#each plan.tasks as task (task.ref)}
        {@const on = !state.skipped.includes(task.ref)}
        <button
          type="button"
          class="task"
          class:static={!state.actionable}
          role="checkbox"
          aria-checked={on}
          onclick={() => state.toggle(task.ref)}
        >
          <span class="box" class:on>
            {#if on}<Icon name="check" size={11} stroke={3.2} color="var(--sk-text-3)" />{/if}
          </span>
          <span class="task-texts">
            <span class="task-title" class:on>{task.title}</span>
            <span class="task-meta">{state.meta(task)}</span>
          </span>
        </button>
      {/each}
    </div>
    {#if state.actionable}
      <div class="foot plan-foot">
        <span class="hint"
          >{state.chosen.length === 0
            ? t('proposal.plan.hint.none')
            : plan.milestone
              ? t('proposal.plan.hint', { id: plan.milestone.id })
              : t('proposal.plan.hint.loose')}</span
        >
        <button
          type="button"
          class="btn"
          disabled={state.busy}
          onclick={() => void state.decide({ action: 'reject' })}
          ><Icon name="close" size={13} stroke={2.2} />{t('proposal.reject')}</button
        >
        <button
          type="button"
          class="btn primary"
          disabled={state.busy || state.chosen.length === 0}
          onclick={() =>
            void state.decide({ action: 'apply', tasks: state.chosen.map((c) => c.ref) })}
          ><Icon name="plus" size={13} stroke={2.4} />{state.chosen.length === 0
            ? t('proposal.plan.pick')
            : state.chosen.length === plan.tasks.length
              ? t('proposal.plan.create', { tasks: tn('proposal.tasks', state.chosen.length) })
              : t('proposal.plan.createSome', { n: state.chosen.length })}</button
        >
      </div>
    {/if}
  </div>
{/if}
